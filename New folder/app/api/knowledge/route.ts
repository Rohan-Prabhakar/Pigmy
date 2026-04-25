import { NextResponse } from "next/server";
import { addKnowledgeDocument, getKnowledgeStore, retrieveKnowledge } from "@/lib/knowledge/store";
import { hydrateCoreStateFromMongo, persistCoreStateToMongo } from "@/lib/platform/state-sync";

export async function GET(request: Request) {
  await hydrateCoreStateFromMongo();
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  if (query) {
    return NextResponse.json({ result: await retrieveKnowledge(query) });
  }
  return NextResponse.json({ knowledge: getKnowledgeStore() });
}

export async function POST(request: Request) {
  await hydrateCoreStateFromMongo();
  const body = await request.json();
  if (!body.title || !body.text) {
    return NextResponse.json({ error: "Title and text are required" }, { status: 400 });
  }

  const document = addKnowledgeDocument({
    title: body.title,
    text: body.text,
    sourceType: body.sourceType ?? "uploaded",
    tags: Array.isArray(body.tags) ? body.tags : [],
    tool: body.tool,
    ruleId: body.ruleId,
    dataset: body.dataset,
    owner: body.owner,
  });

  await persistCoreStateToMongo();
  return NextResponse.json({ document });
}
