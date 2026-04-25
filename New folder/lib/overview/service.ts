import {
  listConnectionSnapshots,
  listConnections,
} from "@/lib/connectors/vault";
import { getCachedGeneratedQualityBundle } from "@/lib/quality/qa-agent";
import { buildLogMonitoringBundle } from "@/lib/quality/log-monitor";
import { getCachedLogWatchdogBundle } from "@/lib/quality/log-watchdog";
import { getAuditLog, getQualityStore } from "@/lib/quality/store";
import {
  buildSystemQualityBundle,
  mergeOverviewWithSystemQuality,
  mergeQualityBundles,
} from "@/lib/quality/system-tests";
import type { OverviewSummary } from "@/lib/product/types";

export function buildOverviewSummary(): OverviewSummary {
  const connections = listConnections();
  const effectiveSnapshots = listConnectionSnapshots();
  const quality = getQualityStore();
  const audit = getAuditLog();

  const confirmedNodes =
    effectiveSnapshots.reduce((count, snapshot) => count + (snapshot.pipeline?.nodes.length ?? 0), 0) || 0;
  const inferredNodes =
    effectiveSnapshots.reduce(
      (count, snapshot) =>
        count +
        (snapshot.pipeline?.nodes.filter((node) => !node.inferredFrom.includes("saved connection"))
          .length ?? 0),
      0
    ) || 0;

  const baseSummary: OverviewSummary = {
    metrics: [
      {
        id: "connections",
        label: "Saved connections",
        value: String(connections.length),
      },
      {
        id: "healthy",
        label: "Healthy adapters",
        value: String(effectiveSnapshots.filter((snapshot) => snapshot.health === "healthy").length),
        tone: "good",
      },
      {
        id: "quality-alerts",
        label: "Open quality alerts",
        value: String(quality.alerts.filter((alert) => alert.status === "open").length),
        tone: quality.alerts.some((alert) => alert.severity === "SEV-1") ? "critical" : "warn",
      },
      {
        id: "coverage",
        label: "Graph coverage",
        value: `${confirmedNodes || 0}/${Math.max(confirmedNodes + inferredNodes, 1)}`,
      },
    ],
    connectionHealth: effectiveSnapshots.map((snapshot) => ({
      connectionId: snapshot.connectionId,
      tool: snapshot.tool,
      status: snapshot.health,
      lastTestAt: snapshot.lastTestResult?.testedAt,
      lastSyncAt: snapshot.metadataSyncedAt,
    })),
    recentActivity: [
      ...effectiveSnapshots.flatMap((snapshot) => snapshot.activity.map((item) => `${snapshot.tool}: ${item}`)),
      ...audit.slice(0, 6).map((event) => event.detail),
    ].slice(0, 8),
    latestValidation: effectiveSnapshots.map((snapshot) => {
      const status = snapshot.diagnostics.lastValidationStatus ?? "unknown";
      return `${snapshot.tool}: ${status}`;
    }),
    graphCoverage: {
      nodes: confirmedNodes + inferredNodes,
      confirmed: confirmedNodes,
      inferred: inferredNodes,
    },
    qualityBreakdown: {
      pass: 0,
      warn: 0,
      fail: 0,
    },
    severityBreakdown: {
      "SEV-1": quality.alerts.filter((alert) => alert.severity === "SEV-1" && alert.status === "open").length,
      "SEV-2": quality.alerts.filter((alert) => alert.severity === "SEV-2" && alert.status === "open").length,
      "SEV-3": quality.alerts.filter((alert) => alert.severity === "SEV-3" && alert.status === "open").length,
      "SEV-4": quality.alerts.filter((alert) => alert.severity === "SEV-4" && alert.status === "open").length,
    },
  };

  const combinedQuality = mergeQualityBundles(
    buildSystemQualityBundle(effectiveSnapshots),
    getCachedGeneratedQualityBundle(effectiveSnapshots),
    buildLogMonitoringBundle(),
    getCachedLogWatchdogBundle(effectiveSnapshots)
  );

  return mergeOverviewWithSystemQuality(baseSummary, combinedQuality);
}
