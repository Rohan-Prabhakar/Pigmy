"use client";

import { useEffect, useState } from "react";
import type { StoredConnection } from "@/lib/connectors/credentials";
import type { PipelineIdentifierResult } from "@/lib/connectors/types";
import { PipelineMap } from "@/components/PipelineMap";

type IdentifyResponse = {
  result: PipelineIdentifierResult;
  connection: StoredConnection;
};

export function PipelineIdentifierPanel() {
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [identified, setIdentified] = useState<IdentifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadFirstConnection();
  }, []);

  useEffect(() => {
    if (!selectedConnectionId) {
      setIdentified(null);
      return;
    }

    if (identified?.connection.connectionId === selectedConnectionId) {
      return;
    }

    void runIdentifier(selectedConnectionId);
  }, [identified?.connection.connectionId, selectedConnectionId]);

  async function loadFirstConnection() {
    const response = await fetch("/api/connections");
    const data = await response.json();
    const nextConnections = (data.connections ?? []) as StoredConnection[];
    setSelectedConnectionId(nextConnections[0]?.connectionId || "");
  }

  async function runIdentifier(connectionId = selectedConnectionId) {
    if (!connectionId) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/pipeline/identify?connectionId=${encodeURIComponent(connectionId)}`
      );
      const data = (await response.json()) as IdentifyResponse & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Failed to identify pipeline");
        setIdentified(null);
        return;
      }
      setIdentified(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to identify pipeline");
      setIdentified(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-[20px] border border-[rgba(236,72,153,0.22)] bg-[#fff1f5] p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className={loading ? "opacity-80 transition" : "transition"}>
        <PipelineMap identifiedPipeline={identified?.result ?? null} />
      </div>

      {identified ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs tracking-[0.14em] text-neutral-500">
              Inspection plan
            </p>
            <div className="rounded-full border border-[rgba(93,105,160,0.16)] bg-[rgba(243,245,255,0.92)] px-3 py-1 text-xs text-neutral-700">
              {identified.result.inspectionPlan.length} steps
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="flex min-w-full gap-4 pb-2">
              {identified.result.inspectionPlan.map((step) => (
                <div
                  key={step.id}
                  className="w-[320px] min-w-[320px] rounded-[22px] border border-[rgba(93,105,160,0.16)] bg-[rgba(255,255,255,0.78)] p-5 backdrop-blur-xl"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-neutral-950">
                      {step.tool} / {step.surface}
                    </p>
                    <p className="text-[11px] uppercase tracking-[0.12em] text-neutral-500">
                      {step.executionKind}
                    </p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-neutral-700">
                    {step.purpose}
                  </p>
                  <pre className="mt-4 overflow-auto whitespace-pre-wrap rounded-[16px] border border-[rgba(93,105,160,0.14)] bg-white p-3 text-xs text-neutral-600">
                    {step.commandPreview}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
