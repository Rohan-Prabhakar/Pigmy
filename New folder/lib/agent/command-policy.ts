import { CONNECTOR_CATALOG } from "@/lib/connectors/catalog";
import { generateWithOllamaFallback } from "./ollama";
import { getFastChatModelCandidates, getRedHerringModelCandidates, getRemedyModelCandidates } from "./models";
import type { ConnectorAction } from "@/lib/connectors/types";
import type { AgentContext, CommandProposal } from "./types";

const SMALL_TALK_PATTERN =
  /^(hi|hello|hey|yo|sup|what'?s up|good (morning|afternoon|evening)|how are you|thanks|thank you|good|okay|ok|nice|cool|great|awesome|sounds good|alright)[!.? ]*$/i;

const READ_ONLY_ACTIONS: ConnectorAction[] = [
  "query", "fetch_logs", "validate", "fetch_metadata", "inspect", "discover", "test_connection",
];

export function shouldSkipCommandProposals(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return true;
  return SMALL_TALK_PATTERN.test(trimmed);
}

type RouterOutput = {
  propose: boolean;
  action?: ConnectorAction;
  tool?: string;
  rationale?: string;
};

function parseRouterOutput(raw: string): RouterOutput {
  // Extract the first JSON object from the model output
  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) return { propose: false };
  try {
    return JSON.parse(match[0]) as RouterOutput;
  } catch {
    return { propose: false };
  }
}

function buildRouterPrompt(message: string, context: AgentContext): string {
  const connections = (
    context.selectedConnection
      ? [context.selectedConnection]
      : context.connections.slice(0, 5)
  )
    .map((c) => `- ${c.tool} (${c.family})${c.target ? `: ${c.target}` : ""}`)
    .join("\n");

  return [
    `User message: "${message}"`,
    "",
    "Available connections:",
    connections || "- none",
  ].join("\n");
}

async function routeWithModel(
  message: string,
  context: AgentContext
): Promise<RouterOutput> {
  const result = await generateWithOllamaFallback({
    models: getFastChatModelCandidates(),
    system: [
      "You are a command router for a data platform agent.",
      "Decide whether the user's message warrants running a connector command.",
      "",
      "Return ONLY a single JSON object — no explanation, no markdown:",
      '{"propose": true, "action": "<action>", "tool": "<exact tool name>", "rationale": "<one short sentence>"}',
      "or",
      '{"propose": false}',
      "",
      "Available actions:",
      "  query           — count objects, list tables/schemas/jobs/dashboards",
      "  fetch_logs      — recent errors, failures, run logs",
      "  validate        — health check, test connection, verify freshness",
      "  fetch_metadata  — metadata, structure, schema inventory",
      "  inspect         — general inspection, explore surfaces",
      "  discover        — topology discovery, pipeline mapping",
      "  test_connection — ping the connection",
      "  restart         — restart a job or service (requires approval)",
      "  refresh         — refresh a dataset or extract (requires approval)",
      "  trigger         — trigger a DAG or pipeline run (requires approval)",
      "",
      "Rules:",
      "  - propose=false for greetings, general questions, or opinions",
      "  - propose=false if no matching connection exists",
      "  - prefer read-only actions unless the user explicitly asks to restart/refresh/trigger",
      "  - pick the most relevant tool from the available connections",
      "  - rationale must be one sentence, plain English, no jargon",
    ].join("\n"),
    prompt: buildRouterPrompt(message, context),
    temperature: 0,
  });

  return parseRouterOutput(result.response);
}

/**
 * Stage 1 — pipeline-qwen-sft: domain analysis
 * Identifies relevant schema context, likely error patterns, and whether the
 * intent touches a known failure mode. The output is passed to qwen-sft as
 * grounding context so it can generate a precise, non-generic query.
 */
async function analyzeDomainContext(
  userIntent: string,
  tool: string,
  family: string,
  action: ConnectorAction,
  target?: string
): Promise<string> {
  try {
    const result = await generateWithOllamaFallback({
      models: getRedHerringModelCandidates(), // pipeline-qwen-sft is first candidate
      system: [
        `You are a domain analyst for a ${family} data platform (tool: ${tool}).`,
        "Your job is to enrich a user intent with relevant domain context so that a query generator can produce a precise, non-generic SQL or API call.",
        "",
        "Given the user's intent and the action type, return a SHORT structured analysis (3–5 lines) covering:",
        "  relevant_objects: which tables, schemas, topics, buckets, or DAGs are likely involved",
        "  error_patterns: any known failure modes this intent relates to (or 'none')",
        "  red_herring_risk: whether the symptom might be a secondary artifact rather than root cause (true/false + reason)",
        "  query_hint: one concrete hint for the query generator (e.g. 'filter by last 24h', 'join with job_runs table', 'use ACCOUNT_USAGE schema')",
        "",
        "Be concise. Return plain key: value lines. No markdown, no JSON.",
      ].join("\n"),
      prompt: [
        `Intent: "${userIntent}"`,
        `Tool: ${tool}`,
        `Family: ${family}`,
        `Action: ${action}`,
        target ? `Target: ${target}` : "",
      ].filter(Boolean).join("\n"),
      temperature: 0.1,
    });
    return result.response.trim();
  } catch {
    return "";
  }
}

/**
 * Stage 2 — qwen-sft-r1:8b: final query generation
 * Receives the SFT domain analysis + user intent and generates the exact
 * SQL or API call to execute. The SFT output grounds qwen-sft so it avoids
 * generic templates and produces intent-specific queries.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

async function formulateQuery(
  userIntent: string,
  tool: string,
  family: string,
  action: ConnectorAction,
  target?: string
): Promise<string | undefined> {
  // qwen-sft generates the SQL/API call directly (capped at 12s so it never blocks the response)
  try {
    const result = await withTimeout(generateWithOllamaFallback({
      models: getRemedyModelCandidates(), // qwen-sft-r1:8b is first candidate
      system: [
        `You are a query generator for a ${family} connector named ${tool}.`,
        "Generate the EXACT query or API call to execute for the user's intent — nothing else.",
        "",
        "Output rules:",
        "  - SQL connectors (Snowflake, BigQuery, Redshift, PostgreSQL): return valid SQL only",
        "  - API connectors (Databricks, Airflow, Looker, Airbyte, dbt Cloud, etc.): HTTP method + path, e.g. GET /api/v1/dags",
        "  - Streaming (Kafka, Confluent): admin operation, e.g. LIST TOPICS",
        "  - Storage (S3): operation, e.g. ListObjectsV2 bucket=my-bucket prefix=data/",
        "  - Be specific to what the user asked — not a generic template",
        "  - Return ONLY the executable query/command — no explanation, no markdown, no code fences",
      ].join("\n"),
      prompt: [
        `User intent: "${userIntent}"`,
        `Tool: ${tool}`,
        `Action: ${action}`,
        target ? `Target: ${target}` : "",
      ].filter(Boolean).join("\n"),
      temperature: 0,
    }), 5_000);

    const query = result?.response.trim().replace(/^```[\w]*\n?/, "").replace(/```$/, "").trim();
    return query || undefined;
  } catch {
    return undefined;
  }
}

export async function buildCommandProposals(
  message: string,
  context: AgentContext
): Promise<CommandProposal[]> {
  if (shouldSkipCommandProposals(message)) return [];
  if (!context.connections.length && !context.selectedConnection) return [];

  let routing: RouterOutput;
  try {
    routing = await routeWithModel(message, context);
  } catch {
    return [];
  }

  // Fallback: if the router passed on a clear data-fetch question, propose anyway
  if (!routing.propose) {
    const isDataFetch =
      /^(how many|what|list|show|count|get|find|tell me)\b/i.test(message.trim()) &&
      message.trim().split(/\s+/).length <= 14;
    const fallbackConn = context.selectedConnection ?? context.connections[0];
    if (isDataFetch && fallbackConn) {
      routing = {
        propose: true,
        action: "query",
        tool: fallbackConn.tool,
        rationale: "Fetching live data from your connected database to answer this question.",
      };
    }
  }

  if (!routing.propose || !routing.action || !routing.tool) return [];

  // Match to a real connection (case-insensitive)
  const connection =
    context.connections.find(
      (c) => c.tool.toLowerCase() === routing.tool!.toLowerCase()
    ) ??
    context.selectedConnection ??
    context.connections[0];

  if (!connection) return [];

  const approvalRequired = !READ_ONLY_ACTIONS.includes(routing.action);

  const generatedQuery = await formulateQuery(
    message,
    connection.tool,
    connection.family,
    routing.action,
    connection.target
  );

  return [
    {
      tool: connection.tool,
      family: connection.family,
      action: routing.action,
      target: connection.target,
      rationale: routing.rationale ?? `Run ${routing.action} on ${connection.tool}.`,
      approvalRequired,
      generatedQuery,
      userIntent: message,
    },
  ];
}

export function summarizeConnectedTools() {
  return CONNECTOR_CATALOG.map((profile) => profile.name).join(", ");
}
