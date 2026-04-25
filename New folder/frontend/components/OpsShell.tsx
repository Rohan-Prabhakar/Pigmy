import Link from "next/link";
import type { ReactNode } from "react";

export function OpsShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "280px 1fr" }}>
      <aside style={{ borderRight: "1px solid rgba(255,255,255,0.08)", padding: "24px 18px", background: "#09131d" }}>
        <div>
          <p style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#6f8095" }}>
            Pipeline Ops
          </p>
          <h1 style={{ margin: "8px 0 0", fontSize: 22 }}>Control Plane</h1>
        </div>

        <nav style={{ marginTop: 28, display: "grid", gap: 8 }}>
          <Link href="/" style={{ padding: "10px 12px", border: "1px solid rgba(255,255,255,0.08)", background: "#0e1824" }}>
            Dashboard
          </Link>
          <Link href="/incidents/inc_001" style={{ padding: "10px 12px", border: "1px solid rgba(255,255,255,0.08)", background: "#0e1824" }}>
            Revenue Incident
          </Link>
          <Link href="/incidents/inc_002" style={{ padding: "10px 12px", border: "1px solid rgba(255,255,255,0.08)", background: "#0e1824" }}>
            Customer Incident
          </Link>
        </nav>
      </aside>

      <section>
        <header style={{ padding: "22px 28px", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "#08111a" }}>
          <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#6f8095" }}>
            {subtitle}
          </p>
          <h2 style={{ margin: "8px 0 0", fontSize: 28 }}>{title}</h2>
        </header>
        <div style={{ padding: 28 }}>{children}</div>
      </section>
    </main>
  );
}
