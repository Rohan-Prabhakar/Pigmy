import { NextResponse } from "next/server";
import { connectTool } from "@/lib/connectors/engine";

export async function POST(request: Request) {
  const body = await request.json();
  const result = connectTool({
    tool: body.tool,
    workspaceId: body.workspaceId,
    target: body.target,
    credentials: body.credentials,
    dryRun: body.dryRun,
  });

  return NextResponse.json(result);
}
