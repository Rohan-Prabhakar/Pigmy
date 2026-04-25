import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Pipeline Ops",
  description: "Data monitoring, QA, and remediation console",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
