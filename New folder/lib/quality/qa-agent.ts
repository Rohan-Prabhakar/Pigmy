import { getDeepChatModelCandidates } from "@/lib/agent/models";
import { generateWithOllamaFallback } from "@/lib/agent/ollama";
import { retrieveKnowledge } from "@/lib/knowledge/store";
import { makeId, readStore, writeStore } from "@/lib/platform/json-store";
import type {
  AdapterSnapshot,
  Citation,
  QualityAlert,
  QualityRule,
  QualityRun,
  QualitySeverity,
} from "@/lib/product/types";
import type { SystemQualityBundle } from "@/lib/quality/system-tests";

const CACHE_FILE = "quality-agent-cache.json";
const CACHE_TTL_MS = 1000 * 60 * 20;

type CachedGeneratedBundle = {
  generatedAt: string;
  byConnection: Record<
    string,
    {
      signature: string;
      rules: QualityRule[];
      runs: QualityRun[];
      alerts: QualityAlert[];
    }
  >;
};

type GeneratedCheck = {
  title: string;
  severity: QualitySeverity;
  description: string;
  rationale: string;
  commandPreview: string;
  metric: string;
};

function normalizeSeverity(value: string | undefined): QualitySeverity {
  const normalized = value?.toUpperCase().trim();
  if (normalized === "SEV-1" || normalized === "SEV-2" || normalized === "SEV-3" || normalized === "SEV-4") {
    return normalized;
  }
  if (normalized === "CRITICAL" || normalized === "HIGH") return "SEV-2";
  if (normalized === "MEDIUM" || normalized === "MODERATE") return "SEV-3";
  return "SEV-4";
}

const emptyCache: CachedGeneratedBundle = {
  generatedAt: new Date(0).toISOString(),
  byConnection: {},
};

const bestPracticeSeeds: Record<string, string[]> = {
  Snowflake: [
    "Compare failed queries with task failures before assuming a warehouse issue is the true root cause.",
    "Use query history, task history, and copy history together to separate ingestion failure from transform failure.",
    "Look for freshness lag between successful loads and downstream task execution windows.",
  ],
  "Apache Airflow": [
    "Check DAG run success separately from task instance retries and long tail task duration.",
    "Correlate failed task instances with downstream dataset staleness rather than only DAG status.",
    "Inspect connection references and recent operator failures to isolate the adjacent system.",
  ],
  Fivetran: [
    "Review connector sync state, schema drift, and destination lag together before blaming the warehouse.",
    "Separate source extraction problems from destination apply problems.",
  ],
  "Apache Kafka": [
    "Check topic lag, consumer-group health, and connector error state together.",
    "Differentiate producer silence from consumer backlog before escalating downstream freshness alerts.",
  ],
  Looker: [
    "Compare dashboard freshness complaints with upstream model refresh windows and query errors.",
    "Separate semantic layer issues from warehouse freshness issues before notifying BI owners.",
  ],
};

function signatureForSnapshot(snapshot: AdapterSnapshot) {
  return JSON.stringify({
    connectionId: snapshot.connectionId,
    syncedAt: snapshot.metadataSyncedAt,
    health: snapshot.health,
    validation: snapshot.diagnostics.lastValidationStatus,
    surfaces: snapshot.surfaces.map((surface) => ({
      surface: surface.surface,
      count: surface.count,
      summary: surface.summary,
    })),
    activity: snapshot.activity,
  });
}

function severityRank(severity: QualitySeverity) {
  return {
    "SEV-1": 4,
    "SEV-2": 3,
    "SEV-3": 2,
    "SEV-4": 1,
  }[severity];
}

function statusFromSeverity(severity: QualitySeverity): QualityRun["status"] {
  if (severityRank(severity) >= severityRank("SEV-2")) return "fail";
  if (severity === "SEV-3") return "warn";
  return "pass";
}

function sanitizeGeneratedChecks(text: string): GeneratedCheck[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as GeneratedCheck[];
    return parsed
      .filter((item) => item?.title && item?.description && item?.commandPreview)
      .slice(0, 3)
      .map((item) => ({
        ...item,
        severity: normalizeSeverity(String(item.severity ?? "")),
      }));
  } catch {
    return [];
  }
}

function buildFallbackChecks(snapshot: AdapterSnapshot): GeneratedCheck[] {
  const topSurface = snapshot.surfaces[0];
  return [
    {
      title: `${snapshot.tool} anomaly follow-up`,
      severity:
        snapshot.health === "error"
          ? "SEV-2"
          : snapshot.diagnostics.lastValidationStatus === "warn"
            ? "SEV-3"
            : "SEV-4",
      description:
        "Cross-check the strongest snapshot signal against the most likely adjacent-system failure mode.",
      rationale:
        topSurface?.evidence[0] ??
        "Use the strongest adapter surface to guide the next read-only validation.",
      commandPreview:
        topSurface?.summary ??
        `Inspect ${snapshot.tool} snapshot surfaces and recent activity before escalating.`,
      metric: topSurface?.surface ?? "snapshot_signal",
    },
  ];
}

function buildPrompt(snapshot: AdapterSnapshot, citations: Citation[]) {
  return [
    "You generate deeper read-only QA checks for a data operations product.",
    "Return JSON only: an array of up to 3 objects.",
    'Each object must include: "title", "severity", "description", "rationale", "commandPreview", "metric".',
    "Constraints:",
    "- only read-only checks",
    "- no generic wording",
    "- prefer cross-surface checks that can disambiguate root cause",
    "- use the connector evidence and retrieved context",
    "",
    `Tool: ${snapshot.tool}`,
    `Health: ${snapshot.health}`,
    `Latest validation: ${snapshot.diagnostics.lastValidationStatus ?? "unknown"}`,
    `Surfaces: ${snapshot.surfaces
      .map((surface) => `${surface.surface} (${surface.count ?? 0}) -> ${surface.summary}`)
      .join(" | ")}`,
    `Activity: ${snapshot.activity.join(" | ") || "none"}`,
    `Best-practice seeds: ${(bestPracticeSeeds[snapshot.tool] ?? ["Use connector evidence to isolate the next highest-signal read-only validation."]).join(" | ")}`,
    citations.length
      ? `Retrieved context: ${citations.map((citation) => `${citation.title}: ${citation.excerpt}`).join(" | ")}`
      : "Retrieved context: none",
  ].join("\n");
}

async function generateChecks(snapshot: AdapterSnapshot) {
  const retrieval = await retrieveKnowledge(
    `${snapshot.tool} ${snapshot.surfaces.map((surface) => surface.surface).join(" ")} ${snapshot.activity.join(" ")}`
  );

  try {
    const result = await generateWithOllamaFallback({
      models: getDeepChatModelCandidates(),
      system:
        "You are a QA check generator for pipeline operations. Produce nuanced, read-only checks that isolate root cause and avoid repeating obvious baseline checks.",
      prompt: buildPrompt(snapshot, retrieval.citations),
      temperature: 0.15,
    });

    return {
      model: result.model,
      citations: retrieval.citations,
      checks: sanitizeGeneratedChecks(result.response),
    };
  } catch {
    return {
      model: "fallback",
      citations: retrieval.citations,
      checks: buildFallbackChecks(snapshot),
    };
  }
}

function toRule(snapshot: AdapterSnapshot, check: GeneratedCheck, citations: Citation[]): QualityRule {
  const timestamp = snapshot.metadataSyncedAt ?? new Date().toISOString();
  return {
    ruleId: `generated-${snapshot.connectionId}-${makeId("qa")}`,
    title: check.title,
    description: check.description,
    tool: snapshot.tool,
    targetScope: snapshot.connectionId,
    severity: check.severity,
    status: "approved",
    conditions: [{ metric: "custom", operator: "contains", threshold: check.metric }],
    generatedDsl: {
      type: "generated_quality_rule",
      source: "llm_augmented",
      metric: check.metric,
      commandPreview: check.commandPreview,
      rationale: check.rationale,
    },
    draft: {
      assumptions: [
        "Generated by the QA agent from adapter evidence plus retrieved context.",
        "This rule is a deeper follow-up and should complement the deterministic base pack.",
      ],
      evidence: [check.rationale],
      generatedSql: check.commandPreview,
    },
    citations,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function toRun(snapshot: AdapterSnapshot, rule: QualityRule): QualityRun {
  return {
    runId: `generated-run-${rule.ruleId}`,
    ruleId: rule.ruleId,
    status: statusFromSeverity(rule.severity),
    severity: rule.severity,
    triggerSource: "assistant",
    adapterId: snapshot.adapterId,
    evidence: rule.draft.evidence,
    citations: rule.citations,
    executedAt: snapshot.metadataSyncedAt ?? new Date().toISOString(),
  };
}

function toAlert(run: QualityRun, title: string, detail: string): QualityAlert | null {
  if (run.status === "pass") return null;
  return {
    alertId: `generated-alert-${run.ruleId}`,
    ruleId: run.ruleId,
    title,
    severity: run.severity,
    status: "open",
    detail,
    createdAt: run.executedAt,
  };
}

export async function buildGeneratedQualityBundle(
  snapshots: AdapterSnapshot[]
): Promise<SystemQualityBundle> {
  const cache = readStore<CachedGeneratedBundle>(CACHE_FILE, emptyCache);
  const now = Date.now();
  const nextCache: CachedGeneratedBundle = {
    generatedAt: new Date().toISOString(),
    byConnection: { ...cache.byConnection },
  };

  const bundle: SystemQualityBundle = {
    rules: [],
    runs: [],
    alerts: [],
    statusBreakdown: { pass: 0, warn: 0, fail: 0 },
    severityBreakdown: { "SEV-1": 0, "SEV-2": 0, "SEV-3": 0, "SEV-4": 0 },
  };

  for (const snapshot of snapshots) {
    const signature = signatureForSnapshot(snapshot);
    const cached = cache.byConnection[snapshot.connectionId];
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
      const generated = await generateChecks(snapshot);
      rules = generated.checks.map((check) => toRule(snapshot, check, generated.citations));
      runs = rules.map((rule) => toRun(snapshot, rule));
      alerts = runs
        .map((run) =>
          toAlert(
            run,
            rules.find((rule) => rule.ruleId === run.ruleId)?.title ?? run.ruleId,
            rules.find((rule) => rule.ruleId === run.ruleId)?.description ??
              "Generated QA follow-up detected a likely issue."
          )
        )
        .filter((alert): alert is QualityAlert => Boolean(alert));

      nextCache.byConnection[snapshot.connectionId] = {
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

export function getCachedGeneratedQualityBundle(
  snapshots: AdapterSnapshot[]
): SystemQualityBundle {
  const cache = readStore<CachedGeneratedBundle>(CACHE_FILE, emptyCache);
  const bundle: SystemQualityBundle = {
    rules: [],
    runs: [],
    alerts: [],
    statusBreakdown: { pass: 0, warn: 0, fail: 0 },
    severityBreakdown: { "SEV-1": 0, "SEV-2": 0, "SEV-3": 0, "SEV-4": 0 },
  };

  for (const snapshot of snapshots) {
    const cached = cache.byConnection[snapshot.connectionId];
    if (!cached || cached.signature !== signatureForSnapshot(snapshot)) {
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
