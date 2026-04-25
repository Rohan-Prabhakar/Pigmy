import { NextResponse } from "next/server";
import { createThread, deleteThread, ensureThread, getLatestThread, getThread, listThreads } from "@/lib/assistant/store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const threadId = searchParams.get("threadId");
  const [thread, threads] = await Promise.all([
    threadId ? getThread(threadId) : getLatestThread(),
    listThreads(),
  ]);
  return NextResponse.json({ threads, thread });
}

export async function POST(request: Request) {
  const body = await request.json();
  const thread = body.create
    ? await createThread({ title: body.title, selectedConnectionId: body.selectedConnectionId })
    : await ensureThread({ title: body.title, selectedConnectionId: body.selectedConnectionId });
  return NextResponse.json({ thread });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const threadId = searchParams.get("threadId");
  if (!threadId) return NextResponse.json({ error: "threadId required" }, { status: 400 });
  await deleteThread(threadId);
  return NextResponse.json({ ok: true });
}
