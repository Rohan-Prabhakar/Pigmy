import { ChatPanel } from "@/components/ChatPanel";
import { OpsShell } from "@/components/OpsShell";
import { getIncidentDetail, runAction } from "@/lib/api";

export default async function IncidentDetailPage({
  params,
}: {
  params: { incidentId: string };
}) {
  const detail = await getIncidentDetail(params.incidentId);

  async function executeAction(formData: FormData) {
    "use server";
    const action = String(formData.get("action"));
    await runAction(params.incidentId, action as never);
  }

  return (
    <OpsShell title={detail.incident.title} subtitle={`Incident ${detail.incident.id}`}>
      <div style={{ display: "grid", gap: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.35fr 0.85fr", gap: 18 }}>
          <section style={{ border: "1px solid rgba(255,255,255,0.08)", background: "#0d1621", padding: 20 }}>
            <p style={{ margin: 0, color: "#6f8095", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.16em" }}>
              Summary
            </p>
            <p style={{ margin: "10px 0 0", fontSize: 18 }}>{detail.analysis.summary}</p>

            <div style={{ marginTop: 18 }}>
              <p style={{ margin: 0, color: "#6f8095", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.16em" }}>
                Likely root cause
              </p>
              <p style={{ margin: "10px 0 0" }}>{detail.analysis.likely_root_cause}</p>
            </div>

            <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
              <div>
                <p style={{ margin: 0, color: "#6f8095", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.16em" }}>
                  Evidence
                </p>
                <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
                  {detail.analysis.supporting_evidence.map((item) => (
                    <li key={item} style={{ marginBottom: 8 }}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p style={{ margin: 0, color: "#6f8095", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.16em" }}>
                  Suggested fix
                </p>
                <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
                  {detail.analysis.suggested_fix.map((item) => (
                    <li key={item} style={{ marginBottom: 8 }}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p style={{ margin: 0, color: "#6f8095", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.16em" }}>
                  Debug steps
                </p>
                <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
                  {detail.analysis.debug_steps.map((item) => (
                    <li key={item} style={{ marginBottom: 8 }}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section style={{ display: "grid", gap: 18 }}>
            <div style={{ border: "1px solid rgba(255,255,255,0.08)", background: "#0d1621", padding: 20 }}>
              <p style={{ margin: 0, color: "#6f8095", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.16em" }}>
                Confidence
              </p>
              <p style={{ margin: "10px 0 0", fontSize: 28, textTransform: "capitalize" }}>
                {detail.analysis.confidence}
              </p>
            </div>

            <div style={{ border: "1px solid rgba(255,255,255,0.08)", background: "#0d1621", padding: 20 }}>
              <p style={{ margin: 0, color: "#6f8095", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.16em" }}>
                Safe actions
              </p>
              <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                {detail.analysis.recommended_actions.map((action) => (
                  <form key={action.action} action={executeAction}>
                    <input type="hidden" name="action" value={action.action} />
                    <button
                      type="submit"
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "12px 14px",
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "#08111a",
                        color: "#e7eef7",
                        cursor: "pointer",
                      }}
                    >
                      {action.label}
                    </button>
                  </form>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <section style={{ border: "1px solid rgba(255,255,255,0.08)", background: "#0d1621", padding: 20 }}>
            <h3 style={{ marginTop: 0 }}>Logs</h3>
            <div style={{ display: "grid", gap: 10 }}>
              {detail.logs.map((log) => (
                <div key={`${log.timestamp}-${log.message}`} style={{ border: "1px solid rgba(255,255,255,0.06)", padding: 12, background: "#08111a" }}>
                  <p style={{ margin: 0, fontSize: 12, color: "#6f8095" }}>{log.level} · {log.source}</p>
                  <p style={{ margin: "6px 0 0" }}>{log.message}</p>
                </div>
              ))}
            </div>
          </section>

          <section style={{ border: "1px solid rgba(255,255,255,0.08)", background: "#0d1621", padding: 20 }}>
            <h3 style={{ marginTop: 0 }}>Metrics and checks</h3>
            <div style={{ display: "grid", gap: 12 }}>
              {detail.metrics.map((metric) => (
                <div key={metric.collected_at} style={{ border: "1px solid rgba(255,255,255,0.06)", padding: 12, background: "#08111a" }}>
                  <p style={{ margin: 0 }}>Freshness: {metric.freshness_minutes} min</p>
                  <p style={{ margin: "6px 0 0" }}>Row count: {metric.row_count}</p>
                  <p style={{ margin: "6px 0 0" }}>Null rate: {metric.null_rate}</p>
                </div>
              ))}
              {detail.schema_checks.map((check) => (
                <div key={check.name} style={{ border: "1px solid rgba(255,255,255,0.06)", padding: 12, background: "#08111a" }}>
                  <p style={{ margin: 0 }}>{check.name}</p>
                  <p style={{ margin: "6px 0 0", color: "#90a0b6" }}>{check.detail}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <ChatPanel incidentId={detail.incident.id} />
      </div>
    </OpsShell>
  );
}
