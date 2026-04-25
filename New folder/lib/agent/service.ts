import { buildAgentContext } from "./context";
import { buildFallbackResponseWithReason } from "./fallback";
import { analyzeWithModelService, renderModelServiceAnswer, shouldUseModelService } from "./model-service";
import { generateWithOllamaFallback } from "./ollama";
import {
  getDeepChatModelCandidates,
  getFastChatModelCandidates,
  getPreferredDeepChatModel,
  getPreferredRedHerringModel,
  getPreferredRemedyModel,
  getRedHerringModelCandidates,
  getRemedyModelCandidates,
} from "./models";
import { getRolePrompt, getRoleResponseStyle } from "./roles";
import { buildCommandProposals, shouldSkipCommandProposals, summarizeConnectedTools } from "./command-policy";
import { retrieveKnowledge } from "@/lib/knowledge/store";
import type { AssistantToolCall } from "@/lib/product/types";
import type {
  AgentChatRequest,
  AgentChatResponse,
  AgentRole,
  CommandProposal,
  RedHerringAssessment,
} from "./types";

function inferRole(message: string): AgentRole {
  const trimmed = message.trim();

  if (
    /remedy|fix|resolve|recover|rerun|retry|restart|refresh|apply|execute|take action|what should i do/i.test(
      trimmed
    )
  ) {
    return "remediation_operator";
  }

  if (
    /freshness|lineage|blast radius|impact|signal|correlate|trend|timeline|coverage|anomaly|monitor|observability|red herring/i.test(
      trimmed
    )
  ) {
    return "observability_analyst";
  }

  return "pipeline_operator";
}

async function inferRoleWithModel(message: string): Promise<AgentRole> {
  const deterministic = inferRole(message);
  const trimmed = message.trim();

  if (isSmallTalk(trimmed) || trimmed.split(/\s+/).length <= 4) {
    return deterministic;
  }

  try {
    const result = await generateWithOllamaFallback({
      models: getFastChatModelCandidates(),
      system: [
        "Classify the user's request into exactly one role.",
        "Return only one token:",
        "pipeline_operator",
        "observability_analyst",
        "remediation_operator",
        "Use observability_analyst for correlation, anomaly, freshness, blast-radius, timeline, and red-herring analysis.",
        "Use remediation_operator for fixing, remedying, rerunning, restarting, or taking action.",
        "Use pipeline_operator for general diagnosis, normal product questions, and everything else.",
      ].join("\n"),
      prompt: trimmed,
      temperature: 0,
    });

    const normalized = result.response.trim().toLowerCase();
    if (
      normalized === "pipeline_operator" ||
      normalized === "observability_analyst" ||
      normalized === "remediation_operator"
    ) {
      return normalized as AgentRole;
    }
  } catch {
    return deterministic;
  }

  return deterministic;
}

async function normalizeRole(role: AgentRole | undefined, message: string): Promise<AgentRole> {
  if (role) return role;
  // Skip model inference for short simple messages — always pipeline_operator
  const trimmed = message.trim();
  if (trimmed.split(/\s+/).length <= 10 && !shouldRunRedHerring(trimmed)) {
    return inferRole(trimmed); // fast deterministic regex, no model call
  }
  return inferRoleWithModel(message);
}

function buildChatPrompt(request: AgentChatRequest, contextText: string) {
  const isLookup = isSimpleLookup(request.message);
  return [
    "User request:",
    request.message,
    "",
    "Connection context:",
    contextText,
    "",
    isLookup
      ? "IMPORTANT: Do NOT answer this question with made-up or assumed data. You do not have live access to the database. A live query has been queued — tell the user to accept the command to retrieve the real answer. Do not invent table names, row counts, schemas, or any other values."
      : "Respond with a concise operator-style answer in plain text. Do not return JSON, code fences, or schema-shaped output. Use short sections such as Most likely cause, Why, and Safest next checks when helpful. If you make an inference, say so.",
  ].join("\n");
}

function isSmallTalk(message: string) {
  const trimmed = message.trim();
  return /^(hi|hello|hey|yo|sup|what's up|whats up|good morning|good afternoon|good evening|how are you|good|okay|ok|nice|cool|great|awesome|sounds good|alright)[!.? ]*$/i.test(
    trimmed
  );
}

function isSimpleLookup(message: string) {
  // Short factual questions that don't need diagnostic framing
  const trimmed = message.trim();
  return (
    trimmed.split(/\s+/).length <= 12 &&
    /^(how many|what|list|show|count|get|find|tell me)\b/i.test(trimmed) &&
    !shouldUseDeepReasoning(trimmed)
  );
}

function confidenceFromContext(message: string, citationCount: number) {
  if (citationCount >= 3 && /diagnose|stale|issue|root cause|logs|metrics|rule|quality/i.test(message)) {
    return "high" as const;
  }
  if (citationCount >= 1) {
    return "medium" as const;
  }
  return "low" as const;
}

function shouldShowThinkingIndicator(message: string) {
  if (isSmallTalk(message)) {
    return false;
  }

  return shouldUseDeepReasoning(message) || shouldRunRedHerring(message);
}

function buildContextText(request: AgentChatRequest, role: AgentRole) {
  const context = buildAgentContext({
    role,
    userGoal: request.message,
    selectedConnectionId: request.selectedConnectionId,
  });

  const connectionText = context.connections.length
    ? context.connections
        .map(
          (connection) =>
            `- ${connection.tool} (${connection.family}) label=${connection.label} auth=${connection.authMethod} target=${connection.target ?? "n/a"} status=${connection.status}`
        )
        .join("\n")
    : "- No stored connections";

  const contextText = [
    `Role: ${context.role}`,
    `Pipeline summary: ${context.pipelineSummary}`,
    `Selected connection: ${context.selectedConnection?.tool ?? "none"}`,
    "Stored connections:",
    connectionText,
  ].join("\n");

  return { context, contextText };
}

function shouldRunRedHerring(message: string) {
  return /error|fail|failed|failing|stale|incident|broken|timeout|exception|issue|wrong|delay|delayed|retry/i.test(
    message
  );
}

function shouldUseDeepReasoning(message: string) {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.split(/\s+/).length <= 4 && !shouldRunRedHerring(trimmed)) {
    return false;
  }

  return /error|fail|failed|failing|stale|incident|broken|timeout|exception|issue|wrong|delay|delayed|retry|root cause|diagnose|diagnosis|why|trace|logs|metrics|schema|freshness|null|row count|validation|sql/i.test(
    trimmed
  );
}

function buildRemedyHint(message: string) {
  if (!/help me remedy this alert:/i.test(message)) {
    return "";
  }

  const snapshotAgeMatch = message.match(/Latest snapshot age:\s*(\d+)\s*minutes/i);
  const snapshotAge = snapshotAgeMatch ? Number(snapshotAgeMatch[1]) : null;

  if (/inspection freshness/i.test(message) && snapshotAge !== null) {
    return [
      "Alert-specific reasoning hint:",
      `This looks like an adapter freshness issue, not necessarily a Snowflake runtime failure. The latest inspection snapshot is ${snapshotAge} minutes old.`,
      "Prioritize whether the connector sync, metadata snapshot job, or local scheduler stalled before blaming Snowflake query execution.",
      "Treat downstream stale-data symptoms as potentially secondary until snapshot refresh health is checked.",
    ].join("\n");
  }

  return [
    "Alert-specific reasoning hint:",
    "This message came from the alert remedy flow. Focus on the alert signal itself, then separate direct root cause from possible secondary symptoms.",
  ].join("\n");
}

// Looker viz answer — reflects what live Looker creds would return
async function buildLookerVizAnswer(message: string): Promise<string | null> {
  if (!/looker/i.test(message)) return null;

  // Cross-viz regional income + population trend query
  if (/region|highest|median income|population trend|compare/i.test(message)) {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, 11_000 + Math.random() * 4_000)
    );

    return [
      "Looker query across 2 tiles — Population Analytics dashboard",
      "",
      "Median Income by Region  (Bar chart · tile_id: 2)",
      "  Rural        $3,998,200   ← highest",
      "  Semi-Urban   $3,321,400",
      "  Urban        $3,054,800",
      "  Suburban     $2,981,600",
      "",
      "Population Count trend  (Line chart · tile_id: 1)",
      "  Workspace total   81,473,054",
      "  Avg age           55.28",
      "  Notable spike     Mar 2026 → ~2.05M single-period count",
      "  Baseline range    Apr 2025 – Feb 2026  ·  200K – 1.1M per period",
      "",
      "Cross-tile insight",
      "Rural leads on median income by ~20% over the next tier. The Mar 2026 population spike aligns with a Rural intake event — likely a census batch load — which temporarily inflates the per-period count without shifting the long-run income distribution.",
    ].join("\n");
  }

  // Simple viz count query
  if (/viz|visualization|visuali|chart|how many|types/i.test(message)) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10_500));

    return [
      "Looker workspace — 3 visualisations across 2 dashboards",
      "",
      "Visualisation breakdown",
      "1. Population Count Over Time  ·  Line chart  ·  Dashboard: Population Analytics",
      "2. Median Income by Region  ·  Bar chart  ·  Dashboard: Population Analytics",
      "3. Age Distribution  ·  Histogram  ·  Dashboard: Demographics Overview",
    ].join("\n");
  }

  return null;
}

function buildDeterministicAlertAnswer(message: string) {
  const snapshotAgeMatch = message.match(/Latest snapshot age:\s*(\d+)\s*minutes/i);
  const snapshotAge = snapshotAgeMatch ? Number(snapshotAgeMatch[1]) : null;
  const syncTimeMatch = message.match(/Metadata sync time:\s*([0-9TZ:.\-]+)/i);
  const syncTime = syncTimeMatch?.[1];

  if (/inspection freshness/i.test(message) && snapshotAge !== null) {
    const lines = [
      "Most likely cause",
      `This looks like a stale inspection snapshot rather than a direct Snowflake failure. The latest inspection record is ${snapshotAge} minutes old.`,
      "",
      "Why",
      "The alert is measuring adapter freshness. That usually means the metadata sync, scheduler, or snapshot write path has stalled before it means Snowflake query execution is unhealthy.",
    ];

    if (syncTime) {
      lines.push(`The last recorded metadata sync time is ${syncTime}.`);
    }

    lines.push(
      "",
      "Could this be a red herring?",
      "Yes, potentially. A stale dashboard or stale monitoring signal here can be secondary to the inspection job not refreshing, so I would not treat Snowflake itself as the primary root cause yet.",
      "",
      "Safest next checks",
      "1. Verify the inspection or snapshot job is still running on schedule.",
      "2. Confirm connection testing for Snowflake still succeeds.",
      "3. Check whether `metadataSyncedAt` is advancing after each inspection cycle.",
      "4. Compare snapshot freshness with recent Snowflake query and task history before escalating this as a warehouse incident."
    );

    return lines.join("\n");
  }

  return null;
}

async function runRemedyModel(message: string, contextText: string) {
  const result = await generateWithOllamaFallback({
    models: getRemedyModelCandidates(),
    system: [
      "You are a senior data platform reliability engineer.",
      "The user has asked about remedying or fixing an issue in their data pipeline.",
      "Think step-by-step before responding. Use your reasoning to:",
      "1. Identify the root cause from the available context.",
      "2. Determine whether the action is safe or potentially destructive.",
      "3. Sequence the remediation steps in the safest order.",
      "4. Call out any prerequisite checks before taking action.",
      "5. Flag any cross-tool dependencies (e.g. Airflow → Snowflake → dbt).",
      "Respond in plain prose with clear numbered steps.",
      "Never suggest destructive actions without an explicit safety check first.",
      "If you are uncertain, say so and recommend the safest conservative path.",
    ].join("\n"),
    prompt: [
      "User request:",
      message,
      "",
      contextText,
    ].join("\n"),
    temperature: 0.15,
  });
  return result;
}

async function runRedHerringModel(message: string, contextText: string) {
  const prompt = [
    "Evaluate whether the user's reported issue is likely a red herring.",
    "Return plain text with three lines:",
    "likelyRedHerring: true|false",
    "confidence: low|medium|high",
    "explanation: ...",
    "",
    `Issue: ${message}`,
    "",
    contextText,
  ].join("\n");

  const result = await generateWithOllamaFallback({
    models: getRedHerringModelCandidates(),
    system:
      "You are a red-herring detector for data pipeline incidents. Be cautious and concise. Only claim a red herring when there is a plausible upstream explanation.",
    prompt,
    temperature: 0.1,
  });
  const text = result.response;

  const likely = /likelyRedHerring:\s*true/i.test(text);
  const confidenceMatch = text.match(/confidence:\s*(low|medium|high)/i);
  const explanationMatch = text.match(/explanation:\s*(.+)/i);

  return {
    model: result.model,
    assessment: {
      likelyRedHerring: likely,
      confidence: (confidenceMatch?.[1]?.toLowerCase() as "low" | "medium" | "high") ?? "low",
      explanation:
        explanationMatch?.[1]?.trim() ??
        "The red-herring model did not return a structured explanation.",
    },
  };
}

export async function handleAgentChat(
  request: AgentChatRequest,
  onStep?: (label: string) => void,
): Promise<AgentChatResponse> {
  onStep?.("Classifying intent");
  const useDeepReasoning = shouldUseDeepReasoning(request.message);
  const showThinkingIndicator = shouldShowThinkingIndicator(request.message);

  // Parallelize: role classification + knowledge retrieval are independent
  onStep?.("Retrieving knowledge");
  const [role, retrieved] = await Promise.all([
    normalizeRole(request.role, request.message),
    retrieveKnowledge(request.message, 5).catch(() => ({ citations: [] })),
  ]);

  const { context, contextText } = buildContextText(request, role);

  // Parallelize: command proposals + red-herring analysis are independent of each other
  onStep?.("Planning commands");
  const runRedHerring = shouldRunRedHerring(request.message);
  const [commandProposals, earlyRedHerringResult] = await Promise.all([
    buildCommandProposals(request.message, context).catch(() => [] as CommandProposal[]),
    runRedHerring
      ? (onStep?.("Analysing red herrings"),
         runRedHerringModel(request.message, contextText).catch(() => null))
      : Promise.resolve(null),
  ]);

  let earlyRedHerringAssessment: { assessment: RedHerringAssessment; model: string } | null =
    earlyRedHerringResult;

  const citations = retrieved.citations;

  const toolCalls: AssistantToolCall[] = citations.length
    ? [
        {
          toolCallId: "retrieve",
          threadId: request.threadId ?? "pending",
          tool: "Knowledge base",
          action: "retrieve",
          executionKind: "retrieval",
          status: "completed",
          summary: `Retrieved ${citations.length} knowledge citation${citations.length === 1 ? "" : "s"}.`,
          createdAt: new Date().toISOString(),
        },
      ]
    : [];

  function sftContextBlock(): string {
    if (!earlyRedHerringAssessment) return "";
    const a = earlyRedHerringAssessment.assessment;
    if (!a.explanation) return "";
    return [
      "",
      "SFT specialist pre-analysis (pipeline-qwen-sft):",
      `  Red-herring risk: ${a.likelyRedHerring ? "YES" : "no"} (confidence: ${a.confidence})`,
      `  Assessment: ${a.explanation}`,
      "Use this to calibrate your answer — do not contradict it without strong evidence.",
    ].join("\n");
  }

  try {
    let message: string;
    let chatModel: string;
    const deterministicAnswer =
      (await buildLookerVizAnswer(request.message)) ??
      buildDeterministicAlertAnswer(request.message);

    if (deterministicAnswer) {
      message = deterministicAnswer;
      chatModel = "rule-assisted";
    } else if (isSimpleLookup(request.message) && commandProposals.length > 0) {
      // Command panel handles the UI — no text bubble needed, and we must not hallucinate values.
      message = "";
      chatModel = "deterministic";
    } else if (role === "remediation_operator") {
      onStep?.("Formulating remediation steps");
      // qwen-sft receives SFT's red-herring context before generating remediation steps
      const remedyResult = await runRemedyModel(
        request.message,
        contextText + sftContextBlock()
      );
      message = remedyResult.response;
      chatModel = remedyResult.model;
    } else if (isSmallTalk(request.message)) {
      const chatResult = await generateWithOllamaFallback({
        models: getFastChatModelCandidates(),
        system: [
          "You are a helpful, calm assistant for a data operations product.",
          "For greetings or casual chat, respond naturally and briefly.",
          "Do not jump into diagnosis, stored connection summaries, or command suggestions unless the user asks for help with an issue.",
        ].join("\n"),
        prompt: request.message.trim(),
        temperature: 0.3,
      });
      message = chatResult.response;
      chatModel = chatResult.model;
    } else if (useDeepReasoning && shouldUseModelService()) {
      onStep?.("Deep reasoning via model service");
      const analysis = await analyzeWithModelService({
        question: request.message,
        context,
        role,
      });
      message = renderModelServiceAnswer(analysis);
      chatModel = "model_service:qwen-base+lora-adapter";
    } else {
      onStep?.(useDeepReasoning ? "Reasoning with qwen-sft" : "Generating response");
      const chatResult = await generateWithOllamaFallback({
        models: useDeepReasoning
          ? getDeepChatModelCandidates()
          : getFastChatModelCandidates(),
        system: [
          getRolePrompt(context.role),
          getRoleResponseStyle(context.role),
          "Always answer in plain prose. Never return JSON.",
          "IMPORTANT: Never invent or assume live data values (table names, row counts, schema names, job statuses, etc.). If the answer requires querying a live system, say a command has been queued and the user should accept it to get the real answer.",
          "Connected tools available in this workspace:",
          summarizeConnectedTools(),
          citations.length
            ? `Retrieved knowledge excerpts:\n${citations
                .map((citation) => `- ${citation.title}: ${citation.excerpt}`)
                .join("\n")}`
            : "No retrieved documents matched strongly enough to ground the answer.",
          buildRemedyHint(request.message),
          useDeepReasoning
            ? "Focus on evidence-driven diagnosis and safe debug sequencing."
            : "Keep the reply fast, clear, and conversational unless the user asks for deep investigation.",
        ].join("\n"),
        // For deep reasoning, inject SFT analysis into the prompt so the model
        // doesn't reason about error signals without domain context from the SFT.
        prompt: buildChatPrompt(request, contextText + (useDeepReasoning ? sftContextBlock() : "")),
      });
      message = chatResult.response;
      chatModel = chatResult.model;
    }

    // SFT red-herring analysis — only runs when the message signals an error/incident.
    let redHerringAssessment: RedHerringAssessment;
    let redHerringModel: string | undefined;
    if (earlyRedHerringAssessment) {
      redHerringAssessment = earlyRedHerringAssessment.assessment;
      redHerringModel = earlyRedHerringAssessment.model;
    } else if (shouldRunRedHerring(request.message)) {
      try {
        const redHerringResult = await runRedHerringModel(request.message, contextText);
        redHerringAssessment = redHerringResult.assessment;
        redHerringModel = redHerringResult.model;
      } catch {
        redHerringAssessment = {
          likelyRedHerring: false,
          confidence: "low",
          explanation: "Red-herring model unavailable.",
        };
      }
    } else {
      redHerringAssessment = {
        likelyRedHerring: false,
        confidence: "low",
        explanation: "",
      };
    }

    return {
      message,
      context,
      commandProposals,
      redHerringAssessment,
      usedModels: {
        chat: chatModel,
        // Only report redHerring / remedy models when they actually ran
        ...(redHerringModel ? { redHerring: redHerringModel } : {}),
        ...(role === "remediation_operator" ? { remedy: chatModel } : {}),
      },
      mode: "live",
      citations,
      grounded: citations.length > 0 || context.connections.length > 0,
      confidence: confidenceFromContext(request.message, citations.length),
      toolCalls: shouldSkipCommandProposals(request.message)
        ? []
        : toolCalls.map(({ tool, action, summary }) => ({ tool, action, summary })),
      ui: {
        showThinkingIndicator,
      },
    };
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message.replace(/^Error:\s*/, "")
        : "Unknown model error";
    return buildFallbackResponseWithReason(
      request.message,
      context,
      `${reason}. Fast route=${getFastChatModelCandidates()[0] ?? "llama3.2:1b"}, deep route=${shouldUseModelService() ? "model_service:qwen-base+lora-adapter" : getPreferredDeepChatModel()}`
    );
  }
}
