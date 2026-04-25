"use client";

import { useEffect, useMemo, useState } from "react";
import pygmyLogo from "@/app/assets/logo.png.png";
import { ConnectionConsole } from "@/components/ConnectionConsole";
import { OverviewDashboard } from "@/components/OverviewDashboard";
import { QualityConsole } from "@/components/QualityConsole";
// PipelineMap removed — now rendered inside OverviewDashboard if needed
import { SettingsConsole } from "@/components/SettingsConsole";
import { SidebarChat } from "@/components/SidebarChat";
import type { StoredConnection } from "@/lib/connectors/credentials";
import type { PipelineIdentifierResult } from "@/lib/connectors/types";
import type { OverviewSummary, QualityAlert, QualityRule, QualityRun } from "@/lib/product/types";

const navItems = [
  { id: "connections", label: "Connections" },
  { id: "overview", label: "Overview" },
  { id: "rules", label: "Rules" },
  { id: "alerts", label: "Alerts" },
  { id: "assistant", label: "Assistant" },
  { id: "settings", label: "Settings" },
] as const;

const pageTitles: Record<(typeof navItems)[number]["id"], string> = {
  connections: "Connections",
  overview: "Overview",
  rules: "Rules",
  alerts: "Alerts",
  assistant: "Assistant",
  settings: "Settings",
};

type IdentifyResponse = {
  result: PipelineIdentifierResult;
  connection: StoredConnection;
};

type QualitySummaryResponse = {
  summary: {
    alerts: QualityAlert[];
    runs: QualityRun[];
  };
};

function OverviewSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl border border-slate-200 bg-white" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_360px]">
        <div className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="h-52 rounded-2xl border border-slate-200 bg-white" />
            <div className="h-52 rounded-2xl border border-slate-200 bg-white" />
          </div>
          <div className="h-64 rounded-2xl border border-slate-200 bg-white" />
          <div className="h-32 rounded-2xl border border-slate-200 bg-white" />
        </div>
        <div className="space-y-5">
          <div className="h-36 rounded-2xl border border-slate-200 bg-white" />
          <div className="h-44 rounded-2xl border border-slate-200 bg-white" />
          <div className="h-40 rounded-2xl border border-slate-200 bg-white" />
        </div>
      </div>
    </div>
  );
}

function EmptyOverviewState() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Overview</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-slate-900">
        Connect a stack to populate the dashboard
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-slate-500">
        Pipeline coverage, run health, alerts, and timelines will appear as soon as the first
        connector snapshot lands.
      </p>
    </div>
  );
}

function NoStackState({ tab, onConnect }: { tab: string; onConnect: () => void }) {
  const meta: Record<string, { icon: string; title: string; desc: string }> = {
    rules:     { icon: "rule",          title: "No stack connected",    desc: "Connect a data stack to create and manage quality rules." },
    alerts:    { icon: "notifications", title: "No alerts to show",     desc: "Alerts will appear here once a stack is connected and rules are running." },
    assistant: { icon: "support_agent", title: "No stack connected",    desc: "Connect a stack so the assistant can diagnose issues, run queries, and propose remediation." },
  };
  const { icon, title, desc } = meta[tab] ?? meta.rules;
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-sm text-center">
        <span className="material-symbols-rounded text-[48px] text-slate-300">{icon}</span>
        <p className="mt-4 text-lg font-semibold tracking-[-0.03em] text-slate-800">{title}</p>
        <p className="mt-2 text-sm text-slate-400">{desc}</p>
        <button
          type="button"
          onClick={onConnect}
          className="mt-6 rounded-full border border-indigo-600 bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700"
        >
          Connect a stack
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<(typeof navItems)[number]["id"]>("connections");
  const [connections, setConnections] = useState<StoredConnection[]>([]);
  const [identifiedPipeline, setIdentifiedPipeline] = useState<PipelineIdentifierResult | null>(null);
  const [overviewSummary, setOverviewSummary] = useState<OverviewSummary | null>(null);
  const [qualityAlerts, setQualityAlerts] = useState<QualityAlert[]>([]);
  const [qualityRuns, setQualityRuns] = useState<QualityRun[]>([]);
  const [queuedAssistantPrompt, setQueuedAssistantPrompt] = useState<string | null>(null);
  const [isOverviewLoading, setIsOverviewLoading] = useState(true);

  const activeTitle = pageTitles[activeTab];
  const primaryConnection = connections[0] ?? null;

  const mappedLayers = useMemo(() => {
    if (!identifiedPipeline) return "0";
    return String(new Set(identifiedPipeline.nodes.map((node) => node.region)).size);
  }, [identifiedPipeline]);

  const activity = useMemo(() => {
    if (!primaryConnection)
      return ["No saved connection", "No pipeline graph", "No assistant context"];
    if (!identifiedPipeline)
      return [`${primaryConnection.tool} connected`, "Graph pending", "Context available in assistant"];
    return [
      `${primaryConnection.tool} connected`,
      `${identifiedPipeline.nodes.length} graph nodes`,
      `${identifiedPipeline.inspectionPlan.length} inspection steps`,
      identifiedPipeline.nodes.map((n) => n.tool).join(" → "),
    ];
  }, [identifiedPipeline, primaryConnection]);

  useEffect(() => {
    void hydrateConnectionsAndPipeline();
  }, []);

  async function hydrateConnectionsAndPipeline() {
    setIsOverviewLoading(true);
    try {
      const connectionsResponse = await fetch("/api/connections");
      if (!connectionsResponse.ok) {
        throw new Error("Unable to load saved connections.");
      }

      const data = await connectionsResponse.json();
      const nextConnections = (data.connections ?? []) as StoredConnection[];
      setConnections(nextConnections);

      try {
        const overviewResponse = await fetch("/api/overview");
        if (overviewResponse.ok) {
          const overviewData = (await overviewResponse.json()) as { summary: OverviewSummary };
          setOverviewSummary(overviewData.summary);
        }
      } catch {}

      try {
        const qualityResponse = await fetch("/api/quality/summary");
        if (qualityResponse.ok) {
          const qualityData = (await qualityResponse.json()) as QualitySummaryResponse;
          setQualityAlerts(qualityData.summary.alerts ?? []);
          setQualityRuns(qualityData.summary.runs ?? []);
        }
      } catch {}

      const firstConnectionId = nextConnections[0]?.connectionId;
      if (!firstConnectionId) {
        setIdentifiedPipeline(null);
        return;
      }

      try {
        const identifyResponse = await fetch(
          `/api/pipeline/identify?connectionId=${encodeURIComponent(firstConnectionId)}`
        );

        if (!identifyResponse.ok) {
          setIdentifiedPipeline(null);
          return;
        }

        const identified = (await identifyResponse.json()) as IdentifyResponse;
        setIdentifiedPipeline(identified.result);
      } catch {
        setIdentifiedPipeline(null);
      }
    } catch {
      setIdentifiedPipeline(null);
    } finally {
      setIsOverviewLoading(false);
    }
  }

  return (
    <main className="h-screen overflow-hidden bg-transparent text-[#151828]">
      <div className="grid h-full min-h-0 lg:grid-cols-[272px_minmax(0,1fr)]">
        <aside className="border-r border-white/10 bg-[#171a2a] px-4 py-5 text-white lg:sticky lg:top-0 lg:h-screen lg:self-start">
          <div className="flex items-center px-2">
            <img src={pygmyLogo.src} alt="Pygmy" className="h-20 object-contain" />
            <span style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }} className="text-2xl text-white -ml-2">
              Pygmy
            </span>
          </div>

          <div className="mt-3 rounded-[20px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl">
            <p className="text-[11px] tracking-[0.14em] text-white/45">Connected stack</p>
            {primaryConnection ? (
              <>
                <p className="mt-2 text-sm font-medium text-white">{primaryConnection.tool}</p>
                <p className="text-xs text-white/45">{connections.length} connector{connections.length !== 1 ? "s" : ""} live</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-white/45">No stack connected</p>
            )}
          </div>

          <nav className="mt-4 space-y-1.5">
            {navItems.map((item) => {
              const active = item.id === activeTab;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex w-full items-center justify-between rounded-[16px] border px-3 py-2.5 text-left text-sm transition ${
                    active
                      ? "border-[rgba(132,140,255,0.44)] bg-[linear-gradient(180deg,rgba(108,114,255,0.22),rgba(108,114,255,0.14))] text-white"
                      : "border-transparent bg-transparent text-white/62 hover:border-white/10 hover:bg-white/6 hover:text-white"
                  }`}
                >
                  <span>{item.label}</span>
                  {active ? <span className="h-2 w-2 rounded-full bg-[#8d92ff]" /> : null}
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="flex min-w-0 min-h-0 flex-col overflow-hidden">
          <header className="shrink-0 flex flex-wrap items-end justify-between gap-4 border-b border-[rgba(93,105,160,0.12)] bg-white/35 px-5 py-5 backdrop-blur-xl md:px-6">
            <div className="min-w-0">
              <h1 className="text-4xl font-semibold tracking-[-0.04em] text-[#151828] md:text-5xl">
                {activeTitle}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 rounded-full border border-[rgba(93,105,160,0.16)] bg-white/78 px-3 py-2 text-[#48506b]">
                <span className="text-[#93a0bf]">Search</span>
                <input
                  type="text"
                  placeholder="Search"
                  className="min-w-48 bg-transparent outline-none placeholder:text-[#93a0bf]"
                />
              </label>
              <button
                className="rounded-full border border-[rgba(108,114,255,0.28)] bg-[linear-gradient(180deg,#7d83ff,#6c72ff)] px-4 py-2 text-sm font-medium text-white"
                type="button"
                onClick={() => setActiveTab("connections")}
              >
                Connect
              </button>
            </div>
          </header>

          <div
            className={`min-h-0 flex-1 ${activeTab === "assistant" ? "overflow-hidden p-0" : "overflow-auto p-5 md:p-6"}`}
          >
            {activeTab === "overview" ? (
              isOverviewLoading ? (
                <OverviewSkeleton />
              ) : !connections.length ? (
                <EmptyOverviewState />
              ) : (
                <OverviewDashboard
                  connections={connections}
                  identifiedPipeline={identifiedPipeline}
                  overviewSummary={overviewSummary}
                  qualityAlerts={qualityAlerts}
                  qualityRuns={qualityRuns}
                  onNavigateTo={(tab) => setActiveTab(tab as typeof activeTab)}
                />
              )
            ) : null}

            {activeTab === "connections" ? (
              <ConnectionConsole
                onConnect={() => void hydrateConnectionsAndPipeline()}
                onDisconnect={() => {
                  setConnections([]);
                  setIdentifiedPipeline(null);
                  setOverviewSummary(null);
                  void hydrateConnectionsAndPipeline();
                }}
              />
            ) : null}
            {activeTab === "rules" ? (
              connections.length ? (
                <QualityConsole initialSection="Rules" showHeader={false} showSectionTabs={false} />
              ) : (
                <NoStackState tab="rules" onConnect={() => setActiveTab("connections")} />
              )
            ) : null}
            {activeTab === "alerts" ? (
              connections.length ? (
                <QualityConsole
                  initialSection="Alerts"
                  showHeader={false}
                  showSectionTabs={false}
                  onRemedyAlert={(alert: QualityAlert, rule?: QualityRule) => {
                    const prompt = [
                      `Help me remedy this alert: ${alert.title}.`,
                      `Severity: ${alert.severity}.`,
                      `Status: ${alert.status}.`,
                      `Detail: ${alert.detail}`,
                      rule ? `Associated rule: ${rule.title}.` : "",
                      rule?.description ? `Rule context: ${rule.description}` : "",
                      rule?.draft.evidence?.length
                        ? `Evidence: ${rule.draft.evidence.slice(0, 3).join(" | ")}`
                        : "",
                      "Please assess whether this could be a red herring, explain the most likely root cause, and suggest the safest next checks.",
                    ]
                      .filter(Boolean)
                      .join("\n");
                    setQueuedAssistantPrompt(prompt);
                    setActiveTab("assistant");
                  }}
                />
              ) : (
                <NoStackState tab="alerts" onConnect={() => setActiveTab("connections")} />
              )
            ) : null}

            {activeTab === "assistant" ? (
              connections.length ? (
                <SidebarChat
                  queuedPrompt={queuedAssistantPrompt}
                  onQueuedPromptConsumed={() => setQueuedAssistantPrompt(null)}
                />
              ) : (
                <NoStackState tab="assistant" onConnect={() => setActiveTab("connections")} />
              )
            ) : null}

            {activeTab === "settings" ? <SettingsConsole /> : null}
          </div>
        </section>
      </div>
    </main>
  );
}
