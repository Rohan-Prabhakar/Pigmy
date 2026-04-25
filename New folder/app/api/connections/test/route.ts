import { NextResponse } from "next/server";
import { getConnectionRecord, refreshConnectionSnapshot } from "@/lib/connectors/vault";
import { addAuditEvent } from "@/lib/quality/store";

export async function POST(request: Request) {
  const body = await request.json();
  const connectionId = String(body.connectionId ?? "");
  const record = getConnectionRecord(connectionId);

  if (!record) {
    return NextResponse.json({ error: "Unknown connection" }, { status: 404 });
  }

  const snapshot = refreshConnectionSnapshot(connectionId);
  if (!snapshot) {
    return NextResponse.json({ error: "Unable to test connection" }, { status: 400 });
  }

  addAuditEvent({
    type: "connection_tested",
    detail: `Tested ${record.tool} connection ${record.label}`,
    metadata: {
      connectionId,
      status: snapshot.health,
      testedAt: snapshot.lastTestResult?.testedAt,
    },
  });

  return NextResponse.json({
    connectionId,
    adapterId: snapshot.adapterId,
    result: snapshot.lastTestResult,
    snapshot,
  });
}
