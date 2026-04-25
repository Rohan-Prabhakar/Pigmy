import { NextResponse } from "next/server";
import { identifyPipelineFromConnection } from "@/lib/connectors/engine";
import { getConnection, getConnectionSnapshot, listConnections, refreshConnectionSnapshot } from "@/lib/connectors/vault";
import { hydrateCoreStateFromMongo } from "@/lib/platform/state-sync";

export async function GET(request: Request) {
  await hydrateCoreStateFromMongo();
  const { searchParams } = new URL(request.url);
  const connectionId = searchParams.get("connectionId");
  const allConnections = listConnections();

  const connection =
    (connectionId ? getConnection(connectionId) : null) ?? allConnections[0] ?? null;

  if (!connection) {
    return NextResponse.json(
      { error: "No saved connections available for pipeline identification." },
      { status: 404 }
    );
  }

  const snapshot = refreshConnectionSnapshot(connection.connectionId) ?? getConnectionSnapshot(connection.connectionId);
  const result = snapshot?.pipeline ?? identifyPipelineFromConnection(connection, allConnections);
  return NextResponse.json({ result, connection });
}
