"use client";

import type { PipelineIdentifierResult } from "@/lib/connectors/types";
import { BrandMark } from "@/components/BrandMark";
import { getBrandLogo } from "@/lib/connectors/brand-logos";

const CW = 960;
const CH = 280;
const ICON = 64;
const NODE_W = 110;
const NODE_H = 100;
const PAD_X = 90;
const PAD_Y = 56;

type LayoutNode = { id: string };
type LayoutEdge = { from: string; to: string };

function computeLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): Map<string, { cx: number; cy: number }> {
  if (nodes.length === 0) return new Map();

  const successors = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  const predecessorCount = new Map<string, number>(nodes.map((node) => [node.id, 0]));

  for (const edge of edges) {
    if (successors.has(edge.from)) successors.get(edge.from)!.push(edge.to);
    if (predecessorCount.has(edge.to)) {
      predecessorCount.set(edge.to, (predecessorCount.get(edge.to) ?? 0) + 1);
    }
  }

  const layer = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const sources = nodes
    .filter((node) => predecessorCount.get(node.id) === 0)
    .map((node) => node.id);
  const start = sources.length > 0 ? sources : nodes.map((node) => node.id);

  const queue = [...start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const currentLayer = layer.get(id) ?? 0;
    for (const successorId of successors.get(id) ?? []) {
      if ((layer.get(successorId) ?? 0) < currentLayer + 1) {
        layer.set(successorId, currentLayer + 1);
        queue.push(successorId);
      }
    }
  }

  const byLayer = new Map<number, string[]>();
  for (const node of nodes) {
    const nodeLayer = layer.get(node.id) ?? 0;
    if (!byLayer.has(nodeLayer)) byLayer.set(nodeLayer, []);
    byLayer.get(nodeLayer)!.push(node.id);
  }

  const sortedLayers = Array.from(byLayer.keys()).sort((a, b) => a - b);
  const positions = new Map<string, { cx: number; cy: number }>();

  sortedLayers.forEach((layerIndex, index) => {
    const nodeIds = byLayer.get(layerIndex) ?? [];
    const cx =
      sortedLayers.length === 1
        ? CW / 2
        : PAD_X + (index / (sortedLayers.length - 1)) * (CW - 2 * PAD_X);

    nodeIds.forEach((id, nodeIndex) => {
      const cy =
        nodeIds.length === 1
          ? CH / 2
          : PAD_Y + (nodeIndex / (nodeIds.length - 1)) * (CH - 2 * PAD_Y);
      positions.set(id, { cx, cy });
    });
  });

  return positions;
}

function edgePath(sx: number, sy: number, ex: number, ey: number): string {
  const dx = ex - sx;
  const curveX = Math.max(50, Math.abs(dx) * 0.38);
  const bow = Math.abs(ey - sy) < 20 ? Math.min(28, Math.abs(dx) * 0.055) : 0;
  return `M ${sx} ${sy} C ${sx + curveX} ${sy + bow}, ${ex - curveX} ${ey + bow}, ${ex} ${ey}`;
}

const EDGE_COLORS = ["#7dd3fc", "#a78bfa", "#6ee7b7", "#fbbf24", "#f9a8d4"];

const REGION_LABELS: Record<string, string> = {
  source: "Source",
  ingestion: "Ingestion",
  streaming: "Streaming",
  orchestration: "Orchestration",
  transform: "Transform",
  warehouse: "Warehouse",
  quality: "Quality",
  bi: "BI",
  monitoring: "Monitoring",
  reverse_etl: "Reverse ETL",
  infrastructure: "Infrastructure",
};

type PipelineMapProps = {
  identifiedPipeline?: PipelineIdentifierResult | null;
};

export function PipelineMap({ identifiedPipeline }: PipelineMapProps) {
  const nodes = identifiedPipeline?.nodes ?? [];
  const edges = identifiedPipeline?.edges ?? [];

  if (!nodes.length) {
    return (
      <div
        className="rounded-2xl border border-[rgba(93,105,160,0.16)]"
        style={{
          background:
            "radial-gradient(circle at 50% 0%,rgba(214,194,255,0.16),transparent 55%),linear-gradient(180deg,#fdfbff,#f5f0ff)",
        }}
      >
        <div className="border-b border-[rgba(93,105,160,0.10)] px-5 pb-3 pt-4">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Stack map</p>
          <p className="mt-1 text-base font-semibold tracking-[-0.03em] text-slate-900">Pipeline Map</p>
        </div>
        <div className="flex min-h-[280px] items-center justify-center px-6 py-10 text-center">
          <div>
            <p className="text-sm font-medium text-slate-700">No pipeline data available</p>
            <p className="mt-2 text-sm text-slate-400">
              Connect a stack and run discovery to populate the map.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const layout = computeLayout(nodes, edges);

  return (
    <div
      className="rounded-2xl border border-[rgba(93,105,160,0.16)]"
      style={{
        background:
          "radial-gradient(circle at 50% 0%,rgba(214,194,255,0.16),transparent 55%),linear-gradient(180deg,#fdfbff,#f5f0ff)",
      }}
    >
      <div className="border-b border-[rgba(93,105,160,0.10)] px-5 pb-3 pt-4">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Stack map</p>
        <p className="mt-1 text-base font-semibold tracking-[-0.03em] text-slate-900">Pipeline Map</p>
      </div>

      <svg
        viewBox={`0 0 ${CW} ${CH}`}
        width="100%"
        height="auto"
        preserveAspectRatio="xMidYMid meet"
        className="block"
      >
        {edges.map((edge, index) => {
          const from = layout.get(edge.from);
          const to = layout.get(edge.to);
          if (!from || !to) return null;

          const color = EDGE_COLORS[index % EDGE_COLORS.length];
          const confidence =
            "confidence" in edge ? (edge as { confidence: number }).confidence : 0.8;

          return (
            <path
              key={`${edge.from}-${edge.to}-${index}`}
              d={edgePath(from.cx, from.cy, to.cx, to.cy)}
              fill="none"
              stroke={color}
              strokeWidth={1.5 + confidence * 0.8}
              strokeLinecap="round"
              opacity={0.5 + confidence * 0.35}
            />
          );
        })}

        {nodes.map((node) => {
          const position = layout.get(node.id);
          if (!position) return null;

          const x = position.cx - NODE_W / 2;
          const y = position.cy - NODE_H / 2;
          const logo = getBrandLogo(node.tool);
          const status = "status" in node ? (node as { status?: string }).status : undefined;

          return (
            <foreignObject key={node.id} x={x} y={y} width={NODE_W} height={NODE_H} overflow="visible">
              <div
                // @ts-expect-error required for foreignObject HTML
                xmlns="http://www.w3.org/1999/xhtml"
                style={{ display: "flex", flexDirection: "column", alignItems: "center", width: NODE_W }}
              >
                <div
                  style={{
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
                  }}
                >
                  <BrandMark name={node.tool} slug={logo.slug} fallback={logo.fallback} />
                  {status === "auth_required" ? (
                    <span
                      style={{
                        position: "absolute",
                        top: -8,
                        right: -8,
                        borderRadius: 99,
                        border: "1px solid #fde68a",
                        background: "#fffbeb",
                        padding: "1px 5px",
                        fontSize: 9,
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        color: "#b45309",
                        textTransform: "uppercase",
                      }}
                    >
                      Auth
                    </span>
                  ) : null}
                  {status === "connected" ? (
                    <span
                      style={{
                        position: "absolute",
                        top: -8,
                        right: -8,
                        borderRadius: 99,
                        border: "1px solid #a7f3d0",
                        background: "#ecfdf5",
                        padding: "1px 5px",
                        fontSize: 9,
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        color: "#065f46",
                        textTransform: "uppercase",
                      }}
                    >
                      Live
                    </span>
                  ) : null}
                </div>
                <p
                  style={{
                    marginTop: 6,
                    textAlign: "center",
                    fontSize: 11,
                    fontWeight: 500,
                    color: "#1f2937",
                    lineHeight: 1.3,
                    width: "100%",
                    padding: "0 4px",
                    wordBreak: "break-word",
                  }}
                >
                  {node.label}
                </p>
                <p style={{ marginTop: 2, textAlign: "center", fontSize: 10, color: "#9ca3af", lineHeight: 1.3 }}>
                  {"region" in node
                    ? REGION_LABELS[(node as { region: string }).region] ??
                      (node as { region: string }).region
                    : ""}
                </p>
                {"metric" in node && (node as { metric?: string }).metric ? (
                  <p
                    style={{
                      marginTop: 3,
                      textAlign: "center",
                      fontSize: 9,
                      fontWeight: 600,
                      color: "#6366f1",
                      lineHeight: 1.3,
                      padding: "0 4px",
                      wordBreak: "break-word",
                    }}
                  >
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
