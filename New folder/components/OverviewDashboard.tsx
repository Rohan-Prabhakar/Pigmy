"use client";

import { useMemo } from "react";
import {
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  LineChart, Line,
  RadialBarChart, RadialBar,
  XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { OverviewSummary, QualityAlert, QualityRun } from "@/lib/product/types";
import type { StoredConnection } from "@/lib/connectors/credentials";
import type { PipelineIdentifierResult } from "@/lib/connectors/types";
import { PipelineMap } from "@/components/PipelineMap";

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  connections: StoredConnection[];
  identifiedPipeline: PipelineIdentifierResult | null;
  overviewSummary: OverviewSummary | null;
  qualityAlerts: QualityAlert[];
  qualityRuns: QualityRun[];
  onNavigateTo: (tab: string) => void;
};

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  pass:    "#34d399",
  warn:    "#fbbf24",
  fail:    "#f87171",
  sev1:    "#f87171",
  sev2:    "#fb923c",
  sev3:    "#fbbf24",
  sev4:    "#94a3b8",
  indigo:  "#6366f1",
  violet:  "#8b5cf6",
  sky:     "#38bdf8",
  slate:   "#94a3b8",
  manual:  "#6366f1",
  assist:  "#8b5cf6",
  sched:   "#38bdf8",
};

const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  boxShadow: "0 4px 24px rgba(15,23,42,0.08)",
  fontSize: 12,
  padding: "8px 12px",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function last14Days() {
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return {
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString([], { weekday: "short" }),
      dayLabel: d.toLocaleDateString([], { month: "short", day: "numeric" }),
    };
  });
}

function formatTime(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-5 ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({ label, title, right }: { label: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">{label}</p>
        <p className="mt-1.5 text-xl font-semibold tracking-[-0.03em] text-slate-900">{title}</p>
      </div>
      {right}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, tone, icon }: {
  label: string; value: string; sub?: string;
  tone?: "neutral" | "good" | "warn" | "critical"; icon: string;
}) {
  const dot = tone === "critical" ? "bg-rose-400" : tone === "warn" ? "bg-amber-400" : tone === "good" ? "bg-emerald-400" : "";
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">{label}</p>
        <div className="flex items-center gap-1.5">
          {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
          <span className="material-symbols-rounded text-[20px] leading-none text-slate-300">{icon}</span>
        </div>
      </div>
      <p className="mt-3 text-[2rem] font-semibold tracking-[-0.04em] text-slate-900 leading-none">{value}</p>
      {sub && <p className="mt-2 text-xs text-slate-400">{sub}</p>}
    </Card>
  );
}

// ─── 1. Runs Timeline — stacked bar ──────────────────────────────────────────

function RunsTimeline({ runs }: { runs: QualityRun[] }) {
  const data = useMemo(() => {
    const days = last14Days();
    const map: Record<string, { key: string; label: string; dayLabel: string; pass: number; warn: number; fail: number }> =
      Object.fromEntries(days.map((d) => [d.key, { ...d, pass: 0, warn: 0, fail: 0 }]));
    for (const r of runs) {
      const k = r.executedAt.slice(0, 10);
      if (map[k]) {
        if (r.status === "pass") map[k].pass += 1;
        else if (r.status === "warn") map[k].warn += 1;
        else if (r.status === "fail") map[k].fail += 1;
      }
    }
    return Object.values(map);
  }, [runs]);

  return (
    <Card>
      <CardHeader
        label="Runs timeline"
        title="Last 14 days — pass / warn / fail"
        right={
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
            {runs.length} total
          </span>
        }
      />
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} barSize={18} margin={{ top: 0, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="key" tickFormatter={(k) => data.find((d) => d.key === k)?.label ?? k} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(k) => data.find((d) => d.key === k)?.dayLabel ?? k}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          <Bar dataKey="pass" stackId="s" fill={C.pass} name="Pass" radius={[0, 0, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="warn" stackId="s" fill={C.warn} name="Warn" radius={[0, 0, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="fail" stackId="s" fill={C.fail} name="Fail" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ─── 2. Alert Volume Trend — area chart ──────────────────────────────────────

function AlertTrend({ alerts }: { alerts: QualityAlert[] }) {
  const data = useMemo(() => {
    const days = last14Days();
    return days.map((d) => ({
      ...d,
      open: alerts.filter((a) => a.createdAt.slice(0, 10) === d.key && a.status === "open").length,
      resolved: alerts.filter((a) => a.createdAt.slice(0, 10) === d.key && a.status === "resolved").length,
    }));
  }, [alerts]);

  return (
    <Card>
      <CardHeader
        label="Alert volume"
        title="Alerts fired · 14 days"
        right={
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
            {alerts.length} total
          </span>
        }
      />
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <defs>
            <linearGradient id="gradOpen" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={C.fail} stopOpacity={0.18} />
              <stop offset="95%" stopColor={C.fail} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradResolved" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={C.pass} stopOpacity={0.18} />
              <stop offset="95%" stopColor={C.pass} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="key" tickFormatter={(k) => data.find((d) => d.key === k)?.label ?? k} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(k) => data.find((d) => d.key === k)?.dayLabel ?? k} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          <Area type="monotone" dataKey="open" stroke={C.fail} fill="url(#gradOpen)" strokeWidth={2} name="Opened" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          <Area type="monotone" dataKey="resolved" stroke={C.pass} fill="url(#gradResolved)" strokeWidth={2} name="Resolved" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ─── 3. Health Score Trend — line chart ──────────────────────────────────────

function HealthScoreTrend({ runs }: { runs: QualityRun[] }) {
  const data = useMemo(() => {
    const days = last14Days();
    return days.map((d) => {
      const day = runs.filter((r) => r.executedAt.slice(0, 10) === d.key);
      const total = day.length;
      const pass = day.filter((r) => r.status === "pass").length;
      return { ...d, score: total ? Math.round((pass / total) * 100) : null };
    });
  }, [runs]);

  return (
    <Card>
      <CardHeader label="Health trend" title="Daily health score %" />
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="key" tickFormatter={(k) => data.find((d) => d.key === k)?.label ?? k} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} unit="%" />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: number) => [`${v}%`, "Health"]}
            labelFormatter={(k) => data.find((d) => d.key === k)?.dayLabel ?? k}
          />
          <Line
            type="monotone" dataKey="score" stroke={C.indigo} strokeWidth={2}
            dot={{ fill: C.indigo, r: 3 }} activeDot={{ r: 5 }}
            connectNulls={false} name="Health %" isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ─── 4. Quality Donut ─────────────────────────────────────────────────────────

const DONUT_COLORS = [C.pass, C.warn, C.fail];

function QualityDonut({ pass, warn, fail }: { pass: number; warn: number; fail: number }) {
  const total = pass + warn + fail;
  const data = [
    { name: "Pass", value: pass },
    { name: "Warn", value: warn },
    { name: "Fail", value: fail },
  ];
  const healthPct = total ? Math.round((pass / total) * 100) : 0;

  return (
    <Card>
      <CardHeader label="Quality health" title="Run breakdown" />
      <div className="flex items-center gap-4">
        <div className="relative" style={{ width: 140, height: 140 }}>
          <ResponsiveContainer width={140} height={140}>
            <PieChart>
              <Pie
                data={data} cx="50%" cy="50%"
                innerRadius={44} outerRadius={62}
                paddingAngle={2} dataKey="value"
                startAngle={90} endAngle={-270}
              >
                {data.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i]} />)}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v, ""]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-2xl font-semibold text-slate-900 leading-none">{healthPct}%</span>
            <span className="mt-1 text-[9px] uppercase tracking-[0.16em] text-slate-400">healthy</span>
          </div>
        </div>
        <div className="flex-1 space-y-2.5">
          {data.map((row, i) => (
            <div key={row.name} className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: DONUT_COLORS[i] }} />
              <span className="text-sm text-slate-500 flex-1">{row.name}</span>
              <span className="text-sm font-semibold text-slate-900 tabular-nums">{row.value}</span>
            </div>
          ))}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-400">Total</span>
            <span className="text-xs font-semibold text-slate-900">{total} runs</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── 5. Severity Breakdown — horizontal bars ─────────────────────────────────

const SEV_COLORS = [C.sev1, C.sev2, C.sev3, C.sev4];

function SeverityBars({ severityBreakdown }: { severityBreakdown: Record<string, number> }) {
  const data = [
    { name: "SEV-1 Critical", value: severityBreakdown["SEV-1"] ?? 0, color: C.sev1 },
    { name: "SEV-2 High",     value: severityBreakdown["SEV-2"] ?? 0, color: C.sev2 },
    { name: "SEV-3 Medium",   value: severityBreakdown["SEV-3"] ?? 0, color: C.sev3 },
    { name: "SEV-4 Low",      value: severityBreakdown["SEV-4"] ?? 0, color: C.sev4 },
  ];

  return (
    <Card>
      <CardHeader label="Severity breakdown" title="Open alerts by level" />
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} layout="vertical" barSize={14} margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#f8fafc" }} />
          <Bar dataKey="value" name="Alerts" radius={[0, 4, 4, 0]}>
            {data.map((d, i) => <Cell key={i} fill={SEV_COLORS[i]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ─── 6. Trigger Source Mix — pie chart ───────────────────────────────────────

const TRIGGER_COLORS = [C.manual, C.assist, C.sched];

function TriggerSourceMix({ runs }: { runs: QualityRun[] }) {
  const data = useMemo(() => {
    const counts = { manual: 0, assistant: 0, schedule: 0 };
    for (const r of runs) if (r.triggerSource in counts) counts[r.triggerSource as keyof typeof counts] += 1;
    return [
      { name: "Manual",    value: counts.manual },
      { name: "Assistant", value: counts.assistant },
      { name: "Schedule",  value: counts.schedule },
    ].filter((d) => d.value > 0);
  }, [runs]);

  if (!data.length) return null;

  return (
    <Card>
      <CardHeader label="Trigger mix" title="How runs are fired" />
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" outerRadius={58} paddingAngle={3} dataKey="value" startAngle={90} endAngle={-270}>
            {data.map((_, i) => <Cell key={i} fill={TRIGGER_COLORS[i % TRIGGER_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ─── 7. Alert Status Mix ──────────────────────────────────────────────────────

const STATUS_COLORS = [C.fail, C.warn, C.pass];

function AlertStatusMix({ alerts }: { alerts: QualityAlert[] }) {
  const data = useMemo(() => {
    const open = alerts.filter((a) => a.status === "open").length;
    const acked = alerts.filter((a) => a.status === "acknowledged").length;
    const resolved = alerts.filter((a) => a.status === "resolved").length;
    return [
      { name: "Open",         value: open },
      { name: "Acknowledged", value: acked },
      { name: "Resolved",     value: resolved },
    ].filter((d) => d.value > 0);
  }, [alerts]);

  if (!data.length) return null;

  return (
    <Card>
      <CardHeader label="Alert status" title="Resolution breakdown" />
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={36} outerRadius={58} paddingAngle={3} dataKey="value" startAngle={90} endAngle={-270}>
            {data.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ─── 8. Per-Adapter Run Status ────────────────────────────────────────────────

function AdapterRunBreakdown({ runs }: { runs: QualityRun[] }) {
  const data = useMemo(() => {
    const adapterMap: Record<string, { adapterId: string; pass: number; warn: number; fail: number }> = {};
    for (const r of runs) {
      const id = r.adapterId || "unknown";
      if (!adapterMap[id]) adapterMap[id] = { adapterId: id, pass: 0, warn: 0, fail: 0 };
      adapterMap[id][r.status as "pass" | "warn" | "fail"] += 1;
    }
    return Object.values(adapterMap).slice(0, 8);
  }, [runs]);

  if (data.length < 2) return null;

  return (
    <Card>
      <CardHeader label="Adapter breakdown" title="Run status per adapter" />
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} barSize={12} margin={{ top: 0, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="adapterId" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#f8fafc" }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          <Bar dataKey="pass" stackId="s" fill={C.pass} name="Pass" />
          <Bar dataKey="warn" stackId="s" fill={C.warn} name="Warn" />
          <Bar dataKey="fail" stackId="s" fill={C.fail} name="Fail" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ─── 9. Graph Coverage Radial ─────────────────────────────────────────────────

function GraphCoverageGauge({ nodes, confirmed, inferred }: { nodes: number; confirmed: number; inferred: number }) {
  const pct = nodes ? Math.round((confirmed / nodes) * 100) : 0;
  const data = [{ name: "Coverage", value: pct, fill: C.indigo }];

  return (
    <Card>
      <CardHeader
        label="Graph coverage"
        title="Pipeline nodes"
        right={
          <span className="rounded-full border border-indigo-100 bg-white px-3 py-1 text-xs font-medium text-indigo-600">
            {pct}% confirmed
          </span>
        }
      />
      <div className="flex items-center gap-5">
        <div style={{ width: 120, height: 80 }}>
          <ResponsiveContainer width={120} height={80}>
            <RadialBarChart cx="50%" cy="100%" innerRadius="60%" outerRadius="100%" startAngle={180} endAngle={0} data={data}>
              <RadialBar dataKey="value" cornerRadius={6} background={{ fill: "#f1f5f9" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v}%`, "Confirmed"]} />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-2 text-xs flex-1">
          {[
            { label: "Confirmed", count: confirmed, color: "bg-indigo-400" },
            { label: "Inferred",  count: inferred,  color: "bg-slate-300" },
            { label: "Total",     count: nodes,      color: "bg-slate-200" },
          ].map((r) => (
            <div key={r.label} className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${r.color}`} />
              <span className="text-slate-500 flex-1">{r.label}</span>
              <span className="font-semibold text-slate-900 tabular-nums">{r.count}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── 10. Connection Health ────────────────────────────────────────────────────

function ConnectionHealthGrid({ connectionHealth }: { connectionHealth: OverviewSummary["connectionHealth"] }) {
  if (!connectionHealth.length) return null;

  const icon = (s: string) => s === "healthy" ? "check_circle" : s === "warning" ? "warning" : s === "error" ? "error" : "help";
  const iconColor = (s: string) => s === "healthy" ? "text-emerald-500" : s === "warning" ? "text-amber-500" : s === "error" ? "text-rose-500" : "text-slate-400";
  const badge = (s: string) => s === "healthy" ? "border-emerald-200 text-emerald-700" : s === "warning" ? "border-amber-200 text-amber-700" : s === "error" ? "border-rose-200 text-rose-700" : "border-slate-200 text-slate-500";

  return (
    <Card>
      <CardHeader label="Adapter health" title="Connected sources" />
      <div className="space-y-2">
        {connectionHealth.map((conn) => (
          <div key={conn.connectionId} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
            <span className={`material-symbols-rounded text-[20px] leading-none shrink-0 ${iconColor(conn.status)}`}>{icon(conn.status)}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{conn.tool}</p>
              {conn.lastTestAt && <p className="text-xs text-slate-400">{formatTime(conn.lastTestAt)}</p>}
            </div>
            <span className={`rounded-full border bg-white px-2 py-0.5 text-[11px] font-medium capitalize ${badge(conn.status)}`}>{conn.status}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── 12. Open Alerts Preview ──────────────────────────────────────────────────

function OpenAlertsPreview({ alerts, onViewAll }: { alerts: QualityAlert[]; onViewAll: () => void }) {
  const open = alerts.filter((a) => a.status === "open").slice(0, 4);
  const dot = (s: string) => s === "SEV-1" ? "bg-rose-400" : s === "SEV-2" ? "bg-orange-400" : s === "SEV-3" ? "bg-amber-400" : "bg-slate-300";

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400 mb-1">Open alerts</p>
          <p className="text-xl font-semibold tracking-[-0.03em] text-slate-900">Needs attention</p>
        </div>
        <button type="button" onClick={onViewAll} className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300">
          View all
        </button>
      </div>
      {open.length ? (
        <div className="space-y-2">
          {open.map((a) => (
            <div key={a.alertId} className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${dot(a.severity)}`} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{a.title}</p>
                <p className="text-xs text-slate-400 mt-0.5">{a.severity} · {a.status} · {formatTime(a.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span className="material-symbols-rounded text-[18px] leading-none text-emerald-400">check_circle</span>
          All clear — no open alerts.
        </div>
      )}
    </Card>
  );
}

// ─── 13. Activity Feed ────────────────────────────────────────────────────────

function ActivityFeed({ activity }: { activity: string[] }) {
  if (!activity.length) return null;
  return (
    <Card>
      <CardHeader label="Activity" title="Recent events" />
      <div className="divide-y divide-slate-50">
        {activity.slice(0, 7).map((item, i) => (
          <div key={`${item}-${i}`} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-500 shrink-0">{i + 1}</span>
            <p className="text-sm text-slate-600 leading-snug">{item}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export function OverviewDashboard({ connections, identifiedPipeline, overviewSummary, qualityAlerts, qualityRuns, onNavigateTo }: Props) {
  const passCount = useMemo(() => qualityRuns.filter((r) => r.status === "pass").length, [qualityRuns]);
  const warnCount = useMemo(() => qualityRuns.filter((r) => r.status === "warn").length, [qualityRuns]);
  const failCount = useMemo(() => qualityRuns.filter((r) => r.status === "fail").length, [qualityRuns]);
  const totalRuns = passCount + warnCount + failCount;
  const healthPct = totalRuns ? Math.round((passCount / totalRuns) * 100) : 0;
  const openAlerts = qualityAlerts.filter((a) => a.status === "open").length;
  const criticalAlerts = qualityAlerts.filter((a) => a.status === "open" && a.severity === "SEV-1").length;
  const healthyAdapters = overviewSummary?.connectionHealth.filter((c) => c.status === "healthy").length ?? 0;

  const severityBreakdown = overviewSummary?.severityBreakdown ?? { "SEV-1": 0, "SEV-2": 0, "SEV-3": 0, "SEV-4": 0 };
  const activity = overviewSummary?.recentActivity ?? [];

  const kpis = [
    { label: "Total runs",    value: String(totalRuns),    sub: `${passCount} pass · ${warnCount} warn · ${failCount} fail`, tone: (failCount > 0 ? "warn" : "good") as "warn" | "good",                                    icon: "play_circle" },
    { label: "Health rate",   value: `${healthPct}%`,      sub: `${passCount} of ${totalRuns} checks passed`,                tone: (healthPct >= 80 ? "good" : healthPct >= 50 ? "warn" : "critical") as "good"|"warn"|"critical", icon: "favorite" },
    { label: "Open alerts",   value: String(openAlerts),   sub: criticalAlerts > 0 ? `${criticalAlerts} critical` : "No critical issues",                                                                                     tone: (criticalAlerts > 0 ? "critical" : openAlerts > 0 ? "warn" : "good") as "critical"|"warn"|"good", icon: "notifications" },
    { label: "Connections",   value: String(connections.length), sub: `${healthyAdapters} healthy`,                          tone: "neutral" as const,                                                                        icon: "hub" },
  ];

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => <KpiCard key={k.label} {...k} />)}
      </div>

      {/* Main grid */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_360px]">
        {/* Left column */}
        <div className="space-y-5">
          {/* Pipeline map — half-page, top of left column */}
          <PipelineMap identifiedPipeline={identifiedPipeline} />
          <div className="grid gap-5 md:grid-cols-2">
            <QualityDonut pass={passCount} warn={warnCount} fail={failCount} />
            <SeverityBars severityBreakdown={severityBreakdown} />
          </div>
          <RunsTimeline runs={qualityRuns} />
          <div className="grid gap-5 md:grid-cols-2">
            <AlertTrend alerts={qualityAlerts} />
            <HealthScoreTrend runs={qualityRuns} />
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          <OpenAlertsPreview alerts={qualityAlerts} onViewAll={() => onNavigateTo("alerts")} />
          <ActivityFeed activity={activity} />
        </div>
      </div>
    </div>
  );
}
