import { NextResponse } from "next/server";
import { buildOverviewSummary } from "@/lib/overview/service";
import { hydrateCoreStateFromMongo } from "@/lib/platform/state-sync";

export async function GET() {
  await hydrateCoreStateFromMongo();
  return NextResponse.json({ summary: buildOverviewSummary() });
}
