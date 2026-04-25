import fs from "node:fs";
import path from "node:path";
import { listConnectionRecords } from "@/lib/connectors/vault";
import type {
  Citation,
  QualityAlert,
  QualityRule,
  QualityRun,
  QualitySeverity,
} from "@/lib/product/types";
import type { SystemQualityBundle } from "@/lib/quality/system-tests";

const WORKSPACE_ROOT = process.cwd();
const TOP_LEVEL_LOGS = ["snowflake.log"];
const PIPELINE_OPS_DIR = path.join(WORKSPACE_ROOT, ".pipeline-ops");
const MAX_LINES = 180;

export type LogFinding = {
  source: string;
  tool: string;
  modifiedAt?: string;
  issueLines: string[];
  authLines: string[];
  warningLines: string[];
};

function emptyBundle(): SystemQualityBundle {
  return {
    rules: [],
    runs: [],
    alerts: [],
    statusBreakdown: { pass: 0, warn: 0, fail: 0 },
    severityBreakdown: { "SEV-1": 0, "SEV-2": 0, "SEV-3": 0, "SEV-4": 0 },
  };
}

function makeCitation(documentId: string, title: string, excerpt: string): Citation {
  return {
    documentId,
    title,
    excerpt,
    score: 1,
  };
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function recentLines(filePath: string) {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-MAX_LINES);
}

function collectLogFiles() {
  const files = new Map<string, string>();

  for (const name of TOP_LEVEL_LOGS) {
    const fullPath = path.join(WORKSPACE_ROOT, name);
    if (fs.existsSync(fullPath)) {
      files.set(fullPath, /snowflake/i.test(name) ? "Snowflake" : "Workspace logs");
    }
  }

  if (fs.existsSync(PIPELINE_OPS_DIR)) {
    for (const entry of fs.readdirSync(PIPELINE_OPS_DIR)) {
      if (entry.toLowerCase().endsWith(".log")) {
        files.set(path.join(PIPELINE_OPS_DIR, entry), "Pipeline Ops");
      }
    }
  }

  for (const record of listConnectionRecords()) {
    const logPath = record.details?.log_path?.trim();
    if (logPath && fs.existsSync(logPath)) {
      files.set(logPath, record.tool);
    }
  }

  return Array.from(files.entries()).map(([filePath, tool]) => ({ filePath, tool }));
}

function inspectLog(filePath: string, tool: string): LogFinding {
  const lines = recentLines(filePath);
  const stats = fs.statSync(filePath);
  const issueLines = lines.filter((line) =>
    /(error|exception|fatal|failed|traceback|sql compilation error|denied|unauthorized|forbidden|timed out|timeout)/i.test(
      line
    )
  );
  const authLines = lines.filter((line) =>
    /(unauthorized|not authorized|forbidden|permission denied|authentication|login failure|access denied)/i.test(
      line
    )
  );
  const warningLines = lines.filter((line) => /\bwarn(ing)?\b/i.test(line));

  return {
    source: path.basename(filePath),
    tool,
    modifiedAt: stats.mtime.toISOString(),
    issueLines: issueLines.slice(-5),
    authLines: authLines.slice(-5),
    warningLines: warningLines.slice(-5),
  };
}

export function collectWorkspaceLogFindings() {
  return collectLogFiles().map(({ filePath, tool }) => inspectLog(filePath, tool));
}

function createRule(
  finding: LogFinding,
  suffix: string,
  title: string,
  description: string,
  severity: QualitySeverity,
  commandPreview: string,
  evidence: string[]
): QualityRule {
  const timestamp = finding.modifiedAt ?? new Date().toISOString();
  return {
    ruleId: `system-log-${slugify(finding.source)}-${suffix}`,
    title,
    description,
    tool: finding.tool,
    targetScope: finding.source,
    severity,
    status: "approved",
    conditions: [{ metric: "custom", operator: "contains", threshold: suffix }],
    generatedDsl: {
      type: "system_log_check",
      source: "workspace_log_monitor",
      metric: suffix,
      commandPreview,
    },
    draft: {
      assumptions: [
        "This rule is generated from local workspace and .pipeline-ops log files.",
        "It is meant to surface operational issues without requiring a separate monitoring connector.",
      ],
      evidence,
      generatedScript: commandPreview,
    },
    citations: [
      makeCitation(
        `workspace-log:${finding.source}`,
        `${finding.source} log`,
        evidence[0] ?? `Recent log evidence from ${finding.source}.`
      ),
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createRun(rule: QualityRule, status: QualityRun["status"], evidence: string[]): QualityRun {
  return {
    runId: `system-run-${rule.ruleId}`,
    ruleId: rule.ruleId,
    status,
    severity: rule.severity,
    triggerSource: "schedule",
    adapterId: "workspace-log-monitor",
    evidence,
    citations: rule.citations,
    executedAt: rule.updatedAt,
  };
}

function createAlert(rule: QualityRule, run: QualityRun): QualityAlert | null {
  if (run.status === "pass") return null;
  return {
    alertId: `system-alert-${rule.ruleId}`,
    ruleId: rule.ruleId,
    title: rule.title,
    severity: rule.severity,
    status: "open",
    detail: run.evidence[0] ?? `${rule.title} surfaced an issue in recent logs.`,
    createdAt: run.executedAt,
  };
}

function pushToBundle(bundle: SystemQualityBundle, rule: QualityRule, run: QualityRun) {
  bundle.rules.push(rule);
  bundle.runs.push(run);
  if (run.status === "pass") bundle.statusBreakdown.pass += 1;
  if (run.status === "warn") bundle.statusBreakdown.warn += 1;
  if (run.status === "fail") bundle.statusBreakdown.fail += 1;
  bundle.severityBreakdown[run.severity] += 1;
  const alert = createAlert(rule, run);
  if (alert) bundle.alerts.push(alert);
}

export function buildLogMonitoringBundle(): SystemQualityBundle {
  const bundle = emptyBundle();

  for (const finding of collectWorkspaceLogFindings()) {
    const baseCommand = `tail -n ${MAX_LINES} ${finding.source}`;

    const issueRule = createRule(
      finding,
      "error-cluster",
      `${finding.source} error cluster`,
      "Scans recent log lines for hard failures, SQL compilation problems, and repeated runtime errors.",
      finding.issueLines.length >= 3 ? "SEV-2" : "SEV-3",
      baseCommand,
      finding.issueLines.length
        ? [
            `${finding.issueLines.length} recent issue lines detected in ${finding.source}.`,
            ...finding.issueLines.slice(0, 2),
          ]
        : [`No recent hard-failure lines detected in ${finding.source}.`]
    );
    pushToBundle(
      bundle,
      issueRule,
      createRun(
        issueRule,
        finding.issueLines.length >= 3 ? "fail" : finding.issueLines.length > 0 ? "warn" : "pass",
        issueRule.draft.evidence
      )
    );

    const authRule = createRule(
      finding,
      "auth-and-access",
      `${finding.source} auth and access issues`,
      "Looks for permission, authorization, and authentication failures in recent logs.",
      finding.authLines.length > 0 ? "SEV-2" : "SEV-4",
      `${baseCommand} | filter auth/permission failures`,
      finding.authLines.length
        ? [
            `${finding.authLines.length} recent auth or permission issues detected in ${finding.source}.`,
            ...finding.authLines.slice(0, 2),
          ]
        : [`No recent auth or permission failures detected in ${finding.source}.`]
    );
    pushToBundle(
      bundle,
      authRule,
      createRun(authRule, finding.authLines.length > 0 ? "fail" : "pass", authRule.draft.evidence)
    );

    const ageMinutes = finding.modifiedAt
      ? Math.max(0, Math.round((Date.now() - new Date(finding.modifiedAt).getTime()) / 60000))
      : Number.POSITIVE_INFINITY;
    const freshnessRule = createRule(
      finding,
      "log-freshness",
      `${finding.source} log freshness`,
      "Checks whether the monitored log file has recent activity or has gone quiet for too long.",
      ageMinutes > 720 ? "SEV-3" : "SEV-4",
      `stat ${finding.source}`,
      [
        Number.isFinite(ageMinutes)
          ? `${finding.source} was last updated ${ageMinutes} minutes ago.`
          : `Could not determine when ${finding.source} was last updated.`,
        ...(finding.warningLines.length ? [finding.warningLines[0]] : []),
      ]
    );
    pushToBundle(
      bundle,
      freshnessRule,
      createRun(
        freshnessRule,
        ageMinutes > 720 ? "warn" : "pass",
        freshnessRule.draft.evidence
      )
    );
  }

  return bundle;
}
