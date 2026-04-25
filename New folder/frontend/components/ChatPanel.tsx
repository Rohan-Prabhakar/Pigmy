"use client";

import { useState } from "react";
import { askIncidentQuestion } from "@/lib/api";
import type { ChatResponse } from "@/lib/contracts";

export function ChatPanel({ incidentId }: { incidentId: string }) {
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState<ChatResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSend() {
    if (!draft.trim() || loading) return;
    setLoading(true);
    try {
      const response = await askIncidentQuestion(incidentId, draft);
      setReply(response);
      setDraft("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={{ border: "1px solid rgba(255,255,255,0.08)", background: "#0d1621" }}>
      <div style={{ padding: 18, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Incident Copilot</h3>
        <p style={{ margin: "8px 0 0", color: "#90a0b6", fontSize: 14 }}>
          Ask about root cause, metrics, logs, or the safest next action.
        </p>
      </div>
      <div style={{ padding: 18 }}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Why did this pipeline fail and what should I validate first?"
          style={{
            width: "100%",
            minHeight: 110,
            background: "#08111a",
            color: "#e7eef7",
            border: "1px solid rgba(255,255,255,0.08)",
            padding: 14,
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, alignItems: "center" }}>
          <p style={{ margin: 0, fontSize: 12, color: "#6f8095" }}>
            Responses stay evidence-driven and actions stay gated.
          </p>
          <button
            onClick={() => void handleSend()}
            disabled={loading}
            style={{ padding: "10px 16px", background: "#f3f6fb", color: "#09131d", border: 0, cursor: "pointer" }}
          >
            {loading ? "Analyzing..." : "Send"}
          </button>
        </div>
      </div>

      {reply ? (
        <div style={{ padding: 18, borderTop: "1px solid rgba(255,255,255,0.08)", display: "grid", gap: 12 }}>
          <div>
            <p style={{ margin: 0, color: "#6f8095", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.14em" }}>
              Summary
            </p>
            <p style={{ margin: "8px 0 0" }}>{reply.answer.summary}</p>
          </div>
          <div>
            <p style={{ margin: 0, color: "#6f8095", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.14em" }}>
              Likely root cause
            </p>
            <p style={{ margin: "8px 0 0" }}>{reply.answer.likely_root_cause}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
