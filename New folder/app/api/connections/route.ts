import { NextResponse } from "next/server";
import { deleteConnection, listConnections, listConnectionSnapshots, saveConnection } from "@/lib/connectors/vault";
import { parseScopes } from "@/lib/connectors/credentials";
import { addAuditEvent, getQualityStore, saveQualityStore } from "@/lib/quality/store";
import { hydrateCoreStateFromMongo, persistCoreStateToMongo } from "@/lib/platform/state-sync";

export async function GET() {
  await hydrateCoreStateFromMongo();
  const discoveredAuthRequiredTools = Array.from(
    new Set(
      listConnectionSnapshots().flatMap((snapshot) =>
        (snapshot.pipeline?.nodes ?? [])
          .filter((node) => node.status === "auth_required")
          .map((node) => node.tool)
      )
    )
  );

  return NextResponse.json({
    connections: listConnections(),
    discoveredAuthRequiredTools,
  });
}

export async function DELETE(request: Request) {
  await hydrateCoreStateFromMongo();
  const { searchParams } = new URL(request.url);
  const connectionId = searchParams.get("connectionId");
  if (!connectionId) return NextResponse.json({ error: "connectionId required" }, { status: 400 });
  deleteConnection(connectionId);

  // Purge any persisted system runs and alerts that belonged to this connection.
  // System runs use the pattern: system-run-system-<connectionId>-*
  // System alerts use:           system-alert-system-<connectionId>-*
  // Purge all persisted quality data tied to this connection.
  // System entries follow the pattern: system-<connectionId>-* (rules, runs, alerts).
  const qualityStore = getQualityStore();
  const prefix = `system-${connectionId}-`;
  qualityStore.rules = qualityStore.rules.filter(
    (r) => !r.ruleId.startsWith(prefix) && !r.ruleId.includes(connectionId)
  );
  qualityStore.runs = qualityStore.runs.filter(
    (r) => !r.ruleId.startsWith(prefix) && !r.ruleId.includes(connectionId)
  );
  qualityStore.alerts = qualityStore.alerts.filter(
    (a) => !a.ruleId.startsWith(prefix) && !a.ruleId.includes(connectionId)
  );
  saveQualityStore(qualityStore);

  await persistCoreStateToMongo();
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const body = await request.json();
  const record = saveConnection({
    tool: body.tool,
    label: body.label,
    target: body.target,
    authMethod: body.authMethod,
    principal: body.principal,
    secret: body.secret,
    details:
      body.details && typeof body.details === "object" ? body.details : undefined,
    scopes: Array.isArray(body.scopes)
      ? body.scopes
      : parseScopes(String(body.scopes ?? "")),
    notes: body.notes,
  });

  addAuditEvent({
    type: "connection_saved",
    detail: `Saved ${record.tool} connection ${record.label}`,
    metadata: { connectionId: record.connectionId, adapterId: (record as { adapterId?: string }).adapterId },
  });

  await persistCoreStateToMongo();
  return NextResponse.json({ connection: record });
}
