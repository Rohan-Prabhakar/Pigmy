import Link from "next/link";
import { OpsShell } from "@/components/OpsShell";
import { getDashboard } from "@/lib/api";

export default async function DashboardPage() {
  const dashboard = await getDashboard();

  return (
    <OpsShell title="Incidents and operator context" subtitle="Dashboard">
      <div style={{ display: "grid", gap: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14 }}>
          {[
            ["Open incidents", String(dashboard.incidents.length)],
            ["Critical or high", String(dashboard.incidents.filter((item) => item.severity === "critical" || item.severity === "high").length)],
            ["Investigating", String(dashboard.incidents.filter((item) => item.status === "investigating").length)],
            ["Audit events", String(dashboard.audit_trail.length)],
          ].map(([label, value]) => (
            <div key={label} style={{ padding: 18, border: "1px solid rgba(255,255,255,0.08)", background: "#0d1621" }}>
              <p style={{ margin: 0, color: "#6f8095", fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase" }}>{label}</p>
              <p style={{ margin: "10px 0 0", fontSize: 28, fontWeight: 700 }}>{value}</p>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.9fr", gap: 18 }}>
          <section style={{ border: "1px solid rgba(255,255,255,0.08)", background: "#0d1621" }}>
            <div style={{ padding: 18, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <h3 style={{ margin: 0 }}>Active incidents</h3>
            </div>
            <div>
              {dashboard.incidents.map((incident) => (
                <Link
                  key={incident.id}
                  href={`/incidents/${incident.id}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.6fr 0.8fr 0.8fr 0.8fr",
                    gap: 12,
                    padding: 18,
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontWeight: 600 }}>{incident.title}</p>
                    <p style={{ margin: "6px 0 0", color: "#90a0b6", fontSize: 14 }}>{incident.summary}</p>
                  </div>
                  <div>{incident.severity}</div>
                  <div>{incident.status}</div>
                  <div>{incident.pipeline}</div>
                </Link>
              ))}
            </div>
          </section>

          <section style={{ border: "1px solid rgba(255,255,255,0.08)", background: "#0d1621" }}>
            <div style={{ padding: 18, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <h3 style={{ margin: 0 }}>Recent audit trail</h3>
            </div>
            <div style={{ display: "grid", gap: 0 }}>
              {dashboard.audit_trail.slice(0, 8).map((event) => (
                <div key={event.id} style={{ padding: 16, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <p style={{ margin: 0, fontSize: 12, color: "#6f8095", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                    {event.type}
                  </p>
                  <p style={{ margin: "8px 0 0" }}>{event.detail}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </OpsShell>
  );
}
