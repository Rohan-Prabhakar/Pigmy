import { NextResponse } from "next/server";
import { hydrateCoreStateFromMongo } from "@/lib/platform/state-sync";
import { getQualityStore, getSettings, saveQualityStore, upsertComputedRuns } from "@/lib/quality/store";
import { getCachedGeneratedQualityBundle } from "@/lib/quality/qa-agent";
import { listConnectionSnapshots } from "@/lib/connectors/vault";
import { applyLiveOverrides, getCachedLiveSnowflakeOverrides } from "@/lib/quality/live-snowflake";
import { buildLogMonitoringBundle } from "@/lib/quality/log-monitor";
import { getCachedLogWatchdogBundle } from "@/lib/quality/log-watchdog";
import { buildSystemQualityBundle, mergeQualityBundles } from "@/lib/quality/system-tests";

export async function GET() {
  await hydrateCoreStateFromMongo();
  const quality = getQualityStore();

  // Heal corrupted rules — drop any rule missing a title or severity (caused by
  // Object.assign overwriting fields with undefined in a previous bug)
  const corruptedRuleIds = new Set(
    quality.rules.filter((r) => !r.title || !r.severity).map((r) => r.ruleId)
  );
  if (corruptedRuleIds.size > 0) {
    quality.rules = quality.rules.filter((r) => !corruptedRuleIds.has(r.ruleId));
    quality.runs = quality.runs.filter((r) => !corruptedRuleIds.has(r.ruleId));
    quality.alerts = quality.alerts.filter((a) => !corruptedRuleIds.has(a.ruleId));
    saveQualityStore(quality);
  }

  const settings = getSettings();
  const snapshots = listConnectionSnapshots();

  // No connections — scrub any leftover system entries and return only user-created data
  if (!snapshots.length) {
    const hadSystemEntries =
      quality.rules.some((r) => r.ruleId.startsWith("system-")) ||
      quality.runs.some((r) => r.ruleId.startsWith("system-")) ||
      quality.alerts.some((a) => a.ruleId.startsWith("system-"));

    if (hadSystemEntries) {
      quality.rules = quality.rules.filter((r) => !r.ruleId.startsWith("system-"));
      quality.runs = quality.runs.filter((r) => !r.ruleId.startsWith("system-"));
      quality.alerts = quality.alerts.filter((a) => !a.ruleId.startsWith("system-"));
      saveQualityStore(quality);
    }

    return NextResponse.json({
      summary: {
        rules: quality.rules,
        runs: quality.runs,
        alerts: quality.alerts,
        mail: settings.mail,
        adapters: [],
        charts: {
          validation: { pass: 0, warn: 0, fail: 0 },
          severity: { "SEV-1": 0, "SEV-2": 0, "SEV-3": 0, "SEV-4": 0 },
        },
      },
    });
  }

  const liveOverrides = getCachedLiveSnowflakeOverrides(snapshots);
  const system = applyLiveOverrides(buildSystemQualityBundle(snapshots), liveOverrides);
  const generated = getCachedGeneratedQualityBundle(snapshots);
  const logs = buildLogMonitoringBundle();
  const watchdog = getCachedLogWatchdogBundle(snapshots);
  const computed = mergeQualityBundles(system, generated, logs, watchdog);

  // Respect rule frequency — only record a new run when the window has elapsed
  const frequencyMs: Record<string, number> = {
    "Hourly": 60 * 60 * 1000,
    "Daily": 24 * 60 * 60 * 1000,
    "Before refresh": 60 * 60 * 1000,
    "After refresh": 60 * 60 * 1000,
  };
  const allRules = [...computed.rules, ...quality.rules];
  const now = Date.now();
  const runsToUpsert = computed.runs.filter((run) => {
    const rule = allRules.find((r) => r.ruleId === run.ruleId);
    const windowMs = frequencyMs[rule?.frequency ?? "Hourly"] ?? 60 * 60 * 1000;
    if (!windowMs) return true;
    const lastRun = quality.runs.find((r) => r.ruleId === run.ruleId);
    if (!lastRun) return true; // never run before
    return now - new Date(lastRun.executedAt).getTime() >= windowMs;
  });
  upsertComputedRuns(runsToUpsert);

  const allAlerts = [...computed.alerts, ...quality.alerts];
  // One alert per ruleId, then one per title — keeps latest of each
  const byRuleId = new Map<string, typeof allAlerts[number]>();
  for (const a of allAlerts) {
    const cur = byRuleId.get(a.ruleId);
    if (!cur || a.createdAt > cur.createdAt) byRuleId.set(a.ruleId, a);
  }
  const byTitle = new Map<string, typeof allAlerts[number]>();
  for (const a of byRuleId.values()) {
    const cur = byTitle.get(a.title);
    if (!cur || a.createdAt > cur.createdAt) byTitle.set(a.title, a);
  }
  const deduplicatedAlerts = [...byTitle.values()];

  // Deduplicate rules by ruleId — persisted quality rules win over computed copies
  // so that user changes (pause, disable, frequency) are not overwritten by recomputation
  const allRulesMerged = [...quality.rules, ...computed.rules];
  const ruleById = new Map<string, typeof allRulesMerged[number]>();
  for (const rule of allRulesMerged) {
    if (!ruleById.has(rule.ruleId)) ruleById.set(rule.ruleId, rule);
  }
  const deduplicatedRules = [...ruleById.values()];

  return NextResponse.json({
    summary: {
      rules: deduplicatedRules,
      runs: quality.runs.filter(
        (r, i, arr) => arr.findIndex((x) => x.ruleId === r.ruleId) === i
      ),
      alerts: deduplicatedAlerts,
      mail: settings.mail,
      adapters: snapshots.map((snapshot) => ({
        tool: snapshot.tool,
        status: snapshot.health,
        validation: snapshot.diagnostics.lastValidationStatus,
      })),
      charts: {
        validation: computed.statusBreakdown,
        severity: computed.severityBreakdown,
      },
    },
  });
}
