import { getDeepChatModelCandidates } from "@/lib/agent/models";
import { generateWithOllamaFallback } from "@/lib/agent/ollama";
import { makeId, readStore, writeStore } from "@/lib/platform/json-store";
import type {
  AdapterSnapshot,
  Citation,
  QualityAlert,
  QualityRule,
  QualityRun,
  QualitySeverity,
} from "@/lib/product/types";
import { collectWorkspaceLogFindings, type LogFinding } from "@/lib/quality/log-monitor";
import type { SystemQualityBundle } from "@/lib/quality/system-tests";

const CACHE_FILE = "quality-log-watchdog.json";
const CACHE_TTL_MS = 1000 * 60 * 20;

type CachedWatchdog = {
  generatedAt: string;
  byTool: Record<
    string,
    {
      signature: string;
      rules: QualityRule[];
      runs: QualityRun[];
      alerts: QualityAlert[];
    }
  >;
};

type GeneratedRisk = {
  title: string;
  severity: QualitySeverity;
  description: string;
  rationale: string;
  commandPreview: string;
  riskType: string;
  redHerringRisk?: string;
};

const emptyCache: CachedWatchdog = {
  generatedAt: new Date(0).toISOString(),
  byTool: {},
};

const docCitations: Record<string, Citation[]> = {
  "Power BI": [
    {
      documentId: "https://learn.microsoft.com/en-us/rest/api/power-bi/datasets/get-refresh-history",
      title: "Power BI refresh history",
      excerpt:
        "Refresh history returns dataset refresh status, attempts, and serviceExceptionJson for failed refreshes.",
      score: 1,
    },
  ],
  Tableau: [
    {
      documentId:
        "https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm",
      title: "Tableau jobs, tasks, and schedules",
      excerpt:
        "Tableau REST API supports listing jobs and extract refresh tasks to inspect failures and queue state.",
      score: 1,
    },
  ],
  "Apache Superset": [
    {
      documentId: "https://superset.apache.org/developer-docs/api/log-rest-api/",
      title: "Superset log REST API",
      excerpt:
        "Superset exposes log and recent activity endpoints under /api/v1/log/ for audit and activity history.",
      score: 1,
    },
    {
      documentId: "https://superset.apache.org/developer-docs/api/dashboards/",
      title: "Superset dashboards API",
      excerpt:
        "Superset dashboard APIs include dashboard detail, chart definitions, and dashboard datasets endpoints.",
      score: 1,
    },
  ],
};

const heuristics: Record<string, string[]> = {
  "Power BI": [
    "Failed refreshes with credential or gateway errors are often upstream access problems, not visual/reporting defects.",
    "Repeated refresh attempts with serviceExceptionJson suggest dataset credential drift or gateway breakage.",
  ],
  Tableau: [
    "Backgrounder and extract refresh failures can create stale dashboards while the dashboards themselves remain healthy.",
    "Queueing or job backlog in extract refresh tasks is often a red herring for warehouse slowdowns or credential expiry upstream.",
  ],
  "Apache Superset": [
    "Audit-log errors and chart-data failures often indicate dataset, database, or permission problems rather than dashboard-specific defects.",
    "Dashboard dataset mismatches and SQL Lab/query failures can be upstream warehouse issues surfacing in BI.",
  ],
  Snowflake: [
    "SQL compilation, authorization, or object-not-found errors can point to configuration drift rather than underlying warehouse instability.",
  ],
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

function statusFromSeverity(severity: QualitySeverity): QualityRun["status"] {
  if (severity === "SEV-1" || severity === "SEV-2") return "fail";
  if (severity === "SEV-3") return "warn";
  return "pass";
}

function normalizeTool(tool: string) {
  if (/power bi/i.test(tool)) return "Power BI";
  if (/tableau/i.test(tool)) return "Tableau";
  if (/superset/i.test(tool)) return "Apache Superset";
  if (/snowflake/i.test(tool)) return "Snowflake";
  return tool;
}

function signatureFor(tool: string, findings: LogFinding[], snapshots: AdapterSnapshot[]) {
  return JSON.stringify({
    tool,
    findings: findings.map((finding) => ({
      source: finding.source,
      modifiedAt: finding.modifiedAt,
      issueLines: finding.issueLines,
      authLines: finding.authLines,
      warningLines: finding.warningLines,
    })),
    snapshots: snapshots
      .filter((snapshot) => normalizeTool(snapshot.tool) === tool)
      .map((snapshot) => ({
        connectionId: snapshot.connectionId,
        syncedAt: snapshot.metadataSyncedAt,
        health: snapshot.health,
        validation: snapshot.diagnostics.lastValidationStatus,
      })),
  });
}

function sanitizeGeneratedRisks(text: string): GeneratedRisk[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as GeneratedRisk[];
    return parsed
      .filter((item) => item?.title && item?.description && item?.commandPreview)
      .slice(0, 2);
  } catch {
    return [];
  }
}

function fallbackRisks(tool: string, findings: LogFinding[]): GeneratedRisk[] {
  const authFinding = findings.find((finding) => finding.authLines.length > 0);
  const errorFinding = findings.find((finding) => finding.issueLines.length > 0);
  const risks: GeneratedRisk[] = [];

  if (authFinding) {
    risks.push({
      title: `${tool} credential drift risk`,
      severity: "SEV-2",
      description:
        "Recent auth or permission failures suggest connector credentials or role grants may have drifted.",
      rationale: authFinding.authLines[0] ?? "Recent log evidence shows auth failures.",
      commandPreview: `Review ${authFinding.source} auth failures and compare with the latest ${tool} refresh/job failures.`,
      riskType: "credential_drift",
      redHerringRisk:
        "A BI refresh or dashboard failure here may be a red herring for upstream credential or permission issues.",
    });
  }

  if (errorFinding) {
    risks.push({
      title: `${tool} upstream failure masking BI symptom`,
      severity: "SEV-3",
      description:
        "Repeated runtime errors suggest the visible BI symptom may be secondary to an upstream warehouse or refresh issue.",
      rationale: errorFinding.issueLines[0] ?? "Recent error cluster detected in connector logs.",
      commandPreview: `Compare ${errorFinding.source} error timestamps with ${tool} refresh/task history before restarting BI assets.`,
      riskType: "upstream_masking",
      redHerringRisk:
        "The dashboard/report symptom may be a red herring if upstream refresh or warehouse execution failed first.",
    });
  }

  return risks.slice(0, 2);
}

function buildPrompt(tool: string, findings: LogFinding[], snapshots: AdapterSnapshot[]) {
  const relatedSnapshots = snapshots.filter((snapshot) => normalizeTool(snapshot.tool) === tool);
  return [
    "You analyze connector logs for a pipeline operations product.",
    "Return JSON only: an array of up to 2 objects.",
    'Each object must include: "title", "severity", "description", "rationale", "commandPreview", "riskType", "redHerringRisk".',
    "Focus on anomalies, likely hidden upstream causes, and potential risks that the operator should investigate next.",
    "Prefer read-only follow-up checks and avoid generic advice.",
    "",
    `Tool: ${tool}`,
    `Heuristics: ${(heuristics[tool] ?? ["Look for upstream causes before blaming downstream BI symptoms."]).join(" | ")}`,
    `Snapshots: ${
      relatedSnapshots.length
        ? relatedSnapshots
            .map(
              (snapshot) =>
                `${snapshot.tool} health=${snapshot.health} validation=${snapshot.diagnostics.lastValidationStatus ?? "unknown"} surfaces=${snapshot.surfaces
                  .map((surface) => `${surface.surface}:${surface.summary}`)
                  .join(" | ")}`
            )
            .join(" || ")
        : "none"
    }`,
    `Log evidence: ${findings
      .map(
        (finding) =>
          `${finding.source}: issues=[${finding.issueLines.slice(0, 3).join(" | ")}] auth=[${finding.authLines
            .slice(0, 2)
            .join(" | ")}] warnings=[${finding.warningLines.slice(0, 2).join(" | ")}]`
      )
      .join(" || ")}`,
  ].join("\n");
}

async function generateRisks(tool: string, findings: LogFinding[], snapshots: AdapterSnapshot[]) {
  try {
    const result = await generateWithOllamaFallback({
      models: getDeepChatModelCandidates(),
      system:
        "You are a log watchdog for BI and data connector incidents. Identify hidden risks, likely red herrings, and the next best read-only follow-up checks.",
      prompt: buildPrompt(tool, findings, snapshots),
      temperature: 0.15,
    });
    const parsed = sanitizeGeneratedRisks(result.response);
    return parsed.length ? parsed : fallbackRisks(tool, findings);
  } catch {
    return fallbackRisks(tool, findings);
  }
}

function toRule(tool: string, risk: GeneratedRisk, findings: LogFinding[]): QualityRule {
  const timestamp = findings[0]?.modifiedAt ?? new Date().toISOString();
  const logCitation: Citation[] = findings.slice(0, 2).map((finding) => ({
    documentId: `workspace-log:${finding.source}`,
    title: `${finding.source} log`,
    excerpt:
      finding.issueLines[0] ?? finding.authLines[0] ?? finding.warningLines[0] ?? `Recent log evidence from ${finding.source}.`,
    score: 1,
  }));
  return {
    ruleId: `watchdog-${tool.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${makeId("risk")}`,
    title: risk.title,
    description: risk.description,
    tool,
    targetScope: findings[0]?.source ?? tool,
    severity: risk.severity,
    status: "approved",
    conditions: [{ metric: "custom", operator: "contains", threshold: risk.riskType }],
    generatedDsl: {
      type: "log_watchdog_risk",
      source: "llm_log_watchdog",
      metric: risk.riskType,
      commandPreview: risk.commandPreview,
      redHerringRisk: risk.redHerringRisk,
    },
    draft: {
      assumptions: [
        "This risk was generated from recent connector/workspace log evidence plus official BI/API best-practice surfaces.",
      ],
      evidence: [risk.rationale, ...(risk.redHerringRisk ? [risk.redHerringRisk] : [])],
      generatedScript: risk.commandPreview,
    },
    citations: [...(docCitations[tool] ?? []), ...logCitation],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function toRun(rule: QualityRule): QualityRun {
  return {
    runId: `watchdog-run-${rule.ruleId}`,
    ruleId: rule.ruleId,
    status: statusFromSeverity(rule.severity),
    severity: rule.severity,
    triggerSource: "assistant",
    adapterId: "log-watchdog",
    evidence: rule.draft.evidence,
    citations: rule.citations,
    executedAt: rule.updatedAt,
  };
}

function toAlert(rule: QualityRule, run: QualityRun): QualityAlert | null {
  if (run.status === "pass") return null;
  return {
    alertId: `watchdog-alert-${rule.ruleId}`,
    ruleId: rule.ruleId,
    title: rule.title,
    severity: rule.severity,
    status: "open",
    detail: rule.draft.evidence[0] ?? rule.description,
    createdAt: run.executedAt,
  };
}

export async function buildLogWatchdogBundle(
  snapshots: AdapterSnapshot[]
): Promise<SystemQualityBundle> {
  const cache = readStore<CachedWatchdog>(CACHE_FILE, emptyCache);
  const now = Date.now();
  const nextCache: CachedWatchdog = {
    generatedAt: new Date().toISOString(),
    byTool: { ...cache.byTool },
  };

  const bundle = emptyBundle();
  const findings = collectWorkspaceLogFindings();
  const activeTools = Array.from(
    new Set(
      [
        ...snapshots.filter((snapshot) => snapshot.family === "bi").map((snapshot) => normalizeTool(snapshot.tool)),
        ...findings.map((finding) => normalizeTool(finding.tool)),
      ].filter(Boolean)
    )
  );

  for (const tool of activeTools) {
    const relevantFindings = findings.filter((finding) => normalizeTool(finding.tool) === tool);
    const fallbackFindings =
      relevantFindings.length > 0
        ? relevantFindings
        : findings.filter((finding) => normalizeTool(finding.tool) === "Workspace logs");
    if (!relevantFindings.length) {
      if (!fallbackFindings.length) {
        continue;
      }
    }

    const signature = signatureFor(tool, fallbackFindings, snapshots);
    const cached = cache.byTool[tool];
    const isFresh =
      cached &&
      cached.signature === signature &&
      now - new Date(cache.generatedAt).getTime() < CACHE_TTL_MS;

    let rules: QualityRule[];
    let runs: QualityRun[];
    let alerts: QualityAlert[];

    if (isFresh) {
      rules = cached.rules;
      runs = cached.runs;
      alerts = cached.alerts;
    } else {
      const generated = await generateRisks(tool, fallbackFindings, snapshots);
      rules = generated.map((risk) => toRule(tool, risk, fallbackFindings));
      runs = rules.map((rule) => toRun(rule));
      alerts = runs
        .map((run) => {
          const rule = rules.find((item) => item.ruleId === run.ruleId);
          return rule ? toAlert(rule, run) : null;
        })
        .filter((alert): alert is QualityAlert => Boolean(alert));

      nextCache.byTool[tool] = {
        signature,
        rules,
        runs,
        alerts,
      };
    }

    bundle.rules.push(...rules);
    bundle.runs.push(...runs);
    bundle.alerts.push(...alerts);

    for (const run of runs) {
      bundle.statusBreakdown[run.status] += 1;
      bundle.severityBreakdown[run.severity] += 1;
    }
  }

  writeStore(CACHE_FILE, nextCache);
  return bundle;
}

export function getCachedLogWatchdogBundle(snapshots: AdapterSnapshot[]): SystemQualityBundle {
  const cache = readStore<CachedWatchdog>(CACHE_FILE, emptyCache);
  const findings = collectWorkspaceLogFindings();
  const bundle = emptyBundle();

  for (const [tool, cached] of Object.entries(cache.byTool)) {
    const relevantFindings = findings.filter((finding) => normalizeTool(finding.tool) === tool);
    const fallbackFindings =
      relevantFindings.length > 0
        ? relevantFindings
        : findings.filter((finding) => normalizeTool(finding.tool) === "Workspace logs");
    if (cached.signature !== signatureFor(tool, fallbackFindings, snapshots)) {
      continue;
    }
    bundle.rules.push(...cached.rules);
    bundle.runs.push(...cached.runs);
    bundle.alerts.push(...cached.alerts);
    for (const run of cached.runs) {
      bundle.statusBreakdown[run.status] += 1;
      bundle.severityBreakdown[run.severity] += 1;
    }
  }

  return bundle;
}
