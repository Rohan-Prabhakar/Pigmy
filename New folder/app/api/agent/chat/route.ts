import { NextResponse } from "next/server";
import { handleAgentChat } from "@/lib/agent/service";
import type { AgentChatRequest } from "@/lib/agent/types";
import { appendMessages, ensureThread } from "@/lib/assistant/store";
import { clearAgentStep, setAgentStep } from "@/lib/platform/mongo";

export async function POST(request: Request) {
  const body = (await request.json()) as AgentChatRequest;

  if (!body.message?.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const thread = await ensureThread({
    threadId: body.threadId,
    selectedConnectionId: body.selectedConnectionId,
  });

  if (!body.silentUserMessage) {
    await appendMessages(thread.threadId, [{ role: "user", text: body.message }]);
  }

  const response = await handleAgentChat(
    { ...body, threadId: thread.threadId },
    (label) => void setAgentStep(thread.threadId, label),
  );

  await clearAgentStep(thread.threadId);

  await appendMessages(thread.threadId, [
    {
      role: "assistant",
      text: response.message,
      metadata: {
        model: response.usedModels.chat,
        commandProposals: response.commandProposals,
        redHerring: response.redHerringAssessment.explanation,
        citations: response.citations,
        toolCalls: response.toolCalls?.map((tc) => ({
          toolCallId: `${tc.tool}-${tc.action}`,
          threadId: thread.threadId,
          tool: tc.tool,
          action: tc.action,
          executionKind: tc.action === "retrieve" ? "retrieval" : "api",
          status: "completed",
          summary: tc.summary,
          createdAt: new Date().toISOString(),
        })),
        confidence: response.confidence,
        grounded: response.grounded,
      },
    },
  ]);

  return NextResponse.json({ ...response, threadId: thread.threadId });
}
