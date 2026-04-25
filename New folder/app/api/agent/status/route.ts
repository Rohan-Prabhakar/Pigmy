import { NextResponse } from "next/server";
import { getAgentStep } from "@/lib/platform/mongo";

export async function GET(request: Request) {
  const threadId = new URL(request.url).searchParams.get("threadId");
  if (!threadId) return NextResponse.json({ step: null });
  const step = await getAgentStep(threadId);
  return NextResponse.json({ step });
}
