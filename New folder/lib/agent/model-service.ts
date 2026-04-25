import { getModelServiceBaseUrl } from "./models";
import type { AgentContext, AgentRole } from "./types";

type ModelServiceAction = {
  action: "retry_job" | "run_validation" | "create_ticket" | "notify_owner";
  label: string;
  safe: boolean;
};

type ModelServiceAnalysis = {
  summary: string;
  likely_root_cause: string;
  supporting_evidence: string[];
  suggested_fix: string[];
  debug_steps: string[];
  confidence: "low" | "medium" | "high";
  recommended_actions: ModelServiceAction[];
};

export function shouldUseModelService() {
  return (process.env.AGENT_USE_MODEL_SERVICE || "false").toLowerCase() === "true";
}

function buildIncidentStub(question: string, context: AgentContext, role: AgentRole) {
  return {
    id: "chat-analysis",
    title: question,
    severity: "investigating",
    role,
    selected_connection: context.selectedConnection?.tool ?? null,
  };
}

function buildServiceContext(context: AgentContext) {
  return {
    role: context.role,
    pipeline_summary: context.pipelineSummary,
    current_date: context.currentDate,
    selected_connection: context.selectedConnection,
    connections: context.connections,
    logs: [],
    metrics: [],
    schema_checks: [],
  };
}

export async function analyzeWithModelService(params: {
  question: string;
  context: AgentContext;
  role: AgentRole;
}) {
  const response = await fetch(`${getModelServiceBaseUrl()}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      incident: buildIncidentStub(params.question, params.context, params.role),
      question: params.question,
      context: buildServiceContext(params.context),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Model service request failed with status ${response.status}: ${errorText}`
    );
  }

  const data = (await response.json()) as ModelServiceAnalysis;
  return data;
}

export function renderModelServiceAnswer(analysis: ModelServiceAnalysis) {
  const lines = [
    analysis.summary,
    "",
    `Likely root cause: ${analysis.likely_root_cause}`,
  ];

  if (analysis.supporting_evidence.length) {
    lines.push("", "Evidence:");
    for (const item of analysis.supporting_evidence) {
      lines.push(`- ${item}`);
    }
  }

  if (analysis.suggested_fix.length) {
    lines.push("", "Suggested fix:");
    for (const item of analysis.suggested_fix) {
      lines.push(`- ${item}`);
    }
  }

  if (analysis.debug_steps.length) {
    lines.push("", "Debug steps:");
    for (const item of analysis.debug_steps) {
      lines.push(`- ${item}`);
    }
  }

  lines.push("", `Confidence: ${analysis.confidence}`);

  return lines.join("\n");
}
