import type { AgentContext, AgentChatResponse, RedHerringAssessment } from "./types";
import { getPreferredChatModel, getPreferredRedHerringModel } from "./models";

function buildFallbackAssessment(message: string, context: AgentContext): RedHerringAssessment {
  const mentionsDownstream = /dashboard|bi|report|warehouse/i.test(message);
  const hasUpstream = context.connections.some(
    (connection) => connection.family === "orchestration" || connection.family === "ingestion"
  );

  if (mentionsDownstream && hasUpstream) {
    return {
      likelyRedHerring: true,
      confidence: "medium",
      explanation:
        "The symptom sounds downstream, but there are upstream connected systems that commonly cause this pattern. Check orchestration and ingestion before treating the downstream error as the root cause.",
    };
  }

  return {
    likelyRedHerring: false,
    confidence: "low",
    explanation:
      "There is not enough evidence in fallback mode to strongly call this a red herring. Use live model mode for a deeper cross-tool judgment.",
  };
}

export function buildFallbackResponse(message: string, context: AgentContext): AgentChatResponse {
  return buildFallbackResponseWithReason(message, context);
}

export function buildFallbackResponseWithReason(
  message: string,
  context: AgentContext,
  reason?: string
): AgentChatResponse {
  // buildCommandProposals is async but fallback is sync — skip proposals in fallback mode
  const commandProposals: AgentChatResponse["commandProposals"] = [];
  const redHerringAssessment = buildFallbackAssessment(message, context);
  const connectedSummary = context.connections.length
    ? context.connections.map((connection) => connection.tool).join(", ")
    : "no live tools yet";

  const suffix = reason ? ` Live model unavailable: ${reason}` : "";

  return {
    message: `I am working in fallback mode right now, so this is a rules-based answer. Based on the current role (${context.role.replace("_", " ")}) and the available connections (${connectedSummary}), I would start by inspecting the most likely fault domain first, then move to the proposed command plan if the evidence lines up.${suffix}`,
    context,
    commandProposals,
    redHerringAssessment,
    usedModels: {
      chat: getPreferredChatModel(),
      redHerring: getPreferredRedHerringModel(),
    },
    mode: "fallback",
  };
}
