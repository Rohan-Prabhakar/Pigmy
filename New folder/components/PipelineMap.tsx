"use client";

import type { PipelineIdentifierResult } from "@/lib/connectors/types";
import { BrandMark } from "@/components/BrandMark";
import { getBrandLogo } from "@/lib/connectors/brand-logos";

// ─── Canvas constants ─────────────────────────────────────────────────────────

const CW = 960;   // canvas width  (px, 1:1 with SVG units)
const CH = 280;   // canvas height (px, 1:1 with SVG units)
const ICON = 64;  // icon box size
const NODE_W = 110; // node container width (icon + label area)
const NODE_H = 100; // node container height (icon + label)
const PAD_X = 90;
const PAD_Y = 56;

// ─── Layout engine ────────────────────────────────────────────────────────────
// Input: nodes with ids + directed edges (from→to)
// Output: center (cx, cy) for each node id, in [0..CW] × [0..CH]

type LayoutNode = { id: string };
type LayoutEdge = { from: string; to: string };

function computeLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): Map<string, { cx: number; cy: number }> {
  if (nodes.length === 0) return new Map();

  // Build adjacency
  const successors = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const predCount  = new Map<string, number>(nodes.map((n) => [n.id, 0]));

  for (const e of edges) {
    if (successors.has(e.from)) successors.get(e.from)!.push(e.to);
    if (predCount.has(e.to))    predCount.set(e.to, (predCount.get(e.to) ?? 0) + 1);
  }

  // Assign layer = longest path from any source (modified BFS / relaxation)
  const layer = new Map<string, number>(nodes.map((n) => [n.id, 0]));

  // Start from sources (no predecessors)
  const queue = nodes.filter((n) => predCount.get(n.id) === 0).map((n) => n.id);
  // Fall back: if graph has cycles / all have predecessors, start from all
  const start = queue.length > 0 ? queue : nodes.map((n) => n.id);

  // BFS — push the *maximum* layer depth for each reachable node
  const bfs = [...start];
  while (bfs.length > 0) {
    const id = bfs.shift()!;
    const cur = layer.get(id) ?? 0;
    for (const sid of successors.get(id) ?? []) {
      if ((layer.get(sid) ?? 0) < cur + 1) {
        layer.set(sid, cur + 1);
        bfs.push(sid);
      }
    }
  }

  // Ensure every node has a layer
  for (const n of nodes) {
    if (!layer.has(n.id)) layer.set(n.id, 0);
  }

  // Group nodes by layer
  const byLayer = new Map<number, string[]>();
  for (const [id, l] of layer) {
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(id);
  }

  const sortedLayers = Array.from(byLayer.keys()).sort((a, b) => a - b);
  const numLayers = sortedLayers.length;

  const positions = new Map<string, { cx: number; cy: number }>();

  sortedLayers.forEach((l, lIdx) => {
    const nodeIds = byLayer.get(l)!;
    const count   = nodeIds.length;

    // x: spread layers evenly across canvas
    const cx = numLayers === 1
      ? CW / 2
      : PAD_X + (lIdx / (numLayers - 1)) * (CW - 2 * PAD_X);

    // y: spread nodes within layer evenly
    nodeIds.forEach((id, i) => {
      const cy = count === 1
        ? CH / 2
        : PAD_Y + (i / (count - 1)) * (CH - 2 * PAD_Y);
      positions.set(id, { cx, cy });
    });
  });

  return positions;
}

// ─── Edge path (smooth bezier, gentle bow on flat lines) ─────────────────────

function edgePath(sx: number, sy: number, ex: number, ey: number): string {
  const dx     = ex - sx;
  const curveX = Math.max(50, Math.abs(dx) * 0.38);
  const bow    = Math.abs(ey - sy) < 20 ? Math.min(28, Math.abs(dx) * 0.055) : 0;
  return `M ${sx} ${sy} C ${sx + curveX} ${sy + bow}, ${ex - curveX} ${ey + bow}, ${ex} ${ey}`;
}

// ─── Sample fallback data (shown when no pipeline is detected) ───────────────
const SAMPLE_NODES = [
  { id: "s1", tool: "S3",        label: "S3",        region: "source",    status: "connected" },
  { id: "n1", tool: "Fivetran",  label: "Fivetran",  region: "ingestion", status: "connected" },
  { id: "n2", tool: "Snowflake", label: "Snowflake", region: "warehouse", status: "connected" },
  { id: "n3", tool: "dbt",       label: "dbt",       region: "transform", status: "connected" },
  { id: "n4", tool: "Looker",    label: "Looker",    region: "bi",        status: "connected" },
];

const SAMPLE_EDGES = [
  { from: "s1", to: "n1", confidence: 0.92 },
  { from: "n1", to: "n2", confidence: 0.97 },
  { from: "n2", to: "n3", confidence: 0.94 },
  { from: "n3", to: "n2", confidence: 0.88 },
  { from: "n2", to: "n4", confidence: 0.91 },
];

const EDGE_COLORS = ["#7dd3fc", "#a78bfa", "#6ee7b7", "#fbbf24", "#f9a8d4"];

const REGION_LABELS: Record<string, string> = {
  source: "Source", ingestion: "Ingestion", streaming: "Streaming",
  orchestration: "Orchestration", transform: "Transform", warehouse: "Warehouse",
  quality: "Quality", bi: "BI", monitoring: "Monitoring",
  reverse_etl: "Reverse ETL", infrastructure: "Infrastructure",
};

// ─── Component ────────────────────────────────────────────────────────────────

type PipelineMapProps = {
  identifiedPipeline?: PipelineIdentifierResult | null;
};

export function PipelineMap({ identifiedPipeline }: PipelineMapProps) {
  const nodes = identifiedPipeline?.nodes ?? SAMPLE_NODES;
  const edges = identifiedPipeline?.edges ?? SAMPLE_EDGES;

  // Run layout — works for any number of nodes / topology
  const layout = computeLayout(nodes, edges);

  return (
    <div className="rounded-2xl border border-[rgba(93,105,160,0.16)]"
      style={{ background: "radial-gradient(circle at 50% 0%,rgba(214,194,255,0.16),transparent 55%),linear-gradient(180deg,#fdfbff,#f5f0ff)" }}
    >
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-[rgba(93,105,160,0.10)]">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Stack map</p>
        <p className="mt-1 text-base font-semibold tracking-[-0.03em] text-slate-900">Pipeline Map</p>
      </div>

      {/* Single SVG with viewBox — scales to fit any container width, no scroll */}
      <svg
        viewBox={`0 0 ${CW} ${CH}`}
        width="100%"
        height="auto"
        preserveAspectRatio="xMidYMid meet"
        className="block"
      >
        {/* ── Edges ─────────────────────────────────────────────────────────── */}
        {edges.map((edge, i) => {
          const from = layout.get(edge.from);
          const to   = layout.get(edge.to);
          if (!from || !to) return null;
          const color = EDGE_COLORS[i % EDGE_COLORS.length];
          const conf  = "confidence" in edge ? (edge as { confidence: number }).confidence : 0.8;
          return (
            <path
              key={i}
              d={edgePath(from.cx, from.cy, to.cx, to.cy)}
              fill="none"
              stroke={color}
              strokeWidth={1.5 + conf * 0.8}
              strokeLinecap="round"
              opacity={0.5 + conf * 0.35}
            />
          );
        })}

        {/* ── Nodes (foreignObject so HTML renders inside SVG viewBox) ─────── */}
        {nodes.map((node) => {
          const pos = layout.get(node.id);
          if (!pos) return null;

          const x    = pos.cx - NODE_W / 2;
          const y    = pos.cy - NODE_H / 2;
          const logo = getBrandLogo(node.tool);
          const status = "status" in node ? (node as { status?: string }).status : undefined;

          return (
            <foreignObject key={node.id} x={x} y={y} width={NODE_W} height={NODE_H} overflow="visible">
              <div
                // @ts-expect-error — xmlns required for foreignObject HTML
                xmlns="http://www.w3.org/1999/xhtml"
                style={{ display: "flex", flexDirection: "column", alignItems: "center", width: NODE_W }}
              >
                <div style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: ICON,
                  height: ICON,
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid #e5e7eb",
                  background: "white",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                }}>
                  <BrandMark name={node.tool} slug={logo.slug} fallback={logo.fallback} />
                  {status === "auth_required" && (
                    <span style={{
                      position: "absolute", top: -8, right: -8,
                      borderRadius: 99, border: "1px solid #fde68a",
                      background: "#fffbeb", padding: "1px 5px",
                      fontSize: 9, fontWeight: 600, letterSpacing: "0.06em",
                      color: "#b45309", textTransform: "uppercase",
                    }}>Auth</span>
                  )}
                  {status === "connected" && (
                    <span style={{
                      position: "absolute", top: -8, right: -8,
                      borderRadius: 99, border: "1px solid #a7f3d0",
                      background: "#ecfdf5", padding: "1px 5px",
                      fontSize: 9, fontWeight: 600, letterSpacing: "0.06em",
                      color: "#065f46", textTransform: "uppercase",
                    }}>Live</span>
                  )}
                </div>
                <p style={{ marginTop: 6, textAlign: "center", fontSize: 11, fontWeight: 500, color: "#1f2937", lineHeight: 1.3, width: "100%", padding: "0 4px", wordBreak: "break-word" }}>
                  {node.label}
                </p>
                <p style={{ marginTop: 2, textAlign: "center", fontSize: 10, color: "#9ca3af", lineHeight: 1.3 }}>
                  {"region" in node ? REGION_LABELS[(node as { region: string }).region] ?? (node as { region: string }).region : ""}
                </p>
                {"metric" in node && (node as { metric?: string }).metric ? (
                  <p style={{ marginTop: 3, textAlign: "center", fontSize: 9, fontWeight: 600, color: "#6366f1", lineHeight: 1.3, padding: "0 4px", wordBreak: "break-word" }}>
                    {(node as { metric: string }).metric}
                  </p>
                ) : null}
              </div>
            </foreignObject>
          );
        })}
      </svg>
    </div>
  );
}
