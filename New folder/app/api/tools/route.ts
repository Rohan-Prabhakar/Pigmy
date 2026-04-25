import { NextResponse } from "next/server";
import { listConnectorCatalog } from "@/lib/connectors/engine";

export function GET() {
  return NextResponse.json(listConnectorCatalog());
}
