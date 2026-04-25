import { NextResponse } from "next/server";
import { retrieveKnowledge } from "@/lib/knowledge/store";
import { hydrateCoreStateFromMongo, persistCoreStateToMongo } from "@/lib/platform/state-sync";
import {
  addQualityRule,
  approveQualityRule,
  deleteQualityRule,
  getQualityStore,
  updateQualityRule,
  upsertQualityRule,
} from "@/lib/quality/store";
import type { QualityRule, QualityRuleCondition, QualitySeverity } from "@/lib/product/types";
import { listConnectionSnapshots } from "@/lib/connectors/vault";
import { applyLiveOverrides, getCachedLiveSnowflakeOverrides } from "@/lib/quality/live-snowflake";
import { buildLogMonitoringBundle } from "@/lib/quality/log-monitor";
import { getCachedLogWatchdogBundle } from "@/lib/quality/log-watchdog";
import { buildSystemQualityBundle, mergeQualityBundles } from "@/lib/quality/system-tests";
import { getCachedGeneratedQualityBundle } from "@/lib/quality/qa-agent";
import { generateWithOllamaFallback } from "@/lib/agent/ollama";
import { getRemedyModelCandidates } from "@/lib/agent/models";

function getComputedRules(): QualityRule[] {
  try {
    const snapshots = listConnectionSnapshots();
    const liveOverrides = getCachedLiveSnowflakeOverrides(snapshots);
    const system = applyLiveOverrides(buildSystemQualityBundle(snapshots), liveOverrides);
    const generated = getCachedGeneratedQualityBundle(snapshots);
    const logs = buildLogMonitoringBundle();
    const watchdog = getCachedLogWatchdogBundle(snapshots);
    return mergeQualityBundles(system, generated, logs, watchdog).rules;
  } catch {
    return [];
  }
}

function inferSeverity(message: string): QualitySeverity {
  if (/critical|outage|customer impact|data loss/i.test(message)) return "SEV-1";
  if (/blocked|major|stale dashboard|failing pipeline/i.test(message)) return "SEV-2";
  if (/warn|freshness|null|degraded|delay/i.test(message)) return "SEV-3";
  return "SEV-4";
}

function inferConditions(message: string): QualityRuleCondition[] {
  if (/freshness|stale/i.test(message)) {
    return [{ metric: "freshness", operator: ">", threshold: "60" }];
  }
  if (/null/i.test(message)) {
    return [{ metric: "null_rate", operator: ">", threshold: "0.05" }];
  }
  if (/row count|volume/i.test(message)) {
    return [{ metric: "row_count", operator: "<", threshold: "expected_baseline" }];
  }
  return [{ metric: "custom", operator: "contains", threshold: "user-defined condition" }];
}

type RuleDraft = {
  title: string;
  description: string;
  severity: QualitySeverity;
  conditions: QualityRuleCondition[];
  generatedSql: string;
  assumptions: string[];
};

async function generateRuleWithDeepseek(
  prompt: string,
  context: string
): Promise<{ draft: RuleDraft; model: string } | null> {
  try {
    const result = await generateWithOllamaFallback({
      models: getRemedyModelCandidates(),
      system: [
        "You are a data quality rule engineer. Generate a quality rule from the user's request.",
        "Respond with valid JSON only — no markdown, no explanation, no code fences, no <think> tags.",
        "JSON schema:",
        '{"title":"string","description":"string","severity":"SEV-1"|"SEV-2"|"SEV-3"|"SEV-4","conditions":[{"metric":"freshness"|"row_count"|"null_rate"|"schema"|"custom","operator":">"|"<"|">="|"<="|"="|"contains","threshold":"string"}],"generatedSql":"string","assumptions":["string"]}',
        "severity: SEV-1=critical/data-loss, SEV-2=major/pipeline-blocked, SEV-3=warn/freshness/nulls, SEV-4=info.",
        "generatedSql: a realistic read-only SQL SELECT that detects the violation.",
        "assumptions: 2-3 short notes about prerequisites or edge cases.",
      ].join("\n"),
      prompt: `User request: ${prompt}\n\nWorkspace context:\n${context}`,
      temperature: 0.2,
    });

    // Strip <think>...</think> blocks (deepseek-r1), code fences, and leading/trailing whitespace
    const raw = result.response
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/^```(?:json)?|```$/gm, "")
      .trim();

    // Extract the first {...} JSON object in case there is surrounding text
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON object found in response");

    const draft = JSON.parse(jsonMatch[0]) as RuleDraft;
    return { draft, model: result.model };
  } catch (err) {
    console.error("[rule-gen] LLM generation failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function GET() {
  await hydrateCoreStateFromMongo();
  return NextResponse.json({ rules: getQualityStore().rules });
}

export async function POST(request: Request) {
  await hydrateCoreStateFromMongo();
  const body = await request.json();

  if (body.approveRuleId) {
    const ruleId = String(body.approveRuleId);
    let approved = approveQualityRule(ruleId);
    if (!approved) {
      // Computed rule — promote it first, then approve
      const computedRule = getComputedRules().find((r) => r.ruleId === ruleId);
      if (!computedRule) {
        return NextResponse.json({ error: "Unknown rule" }, { status: 404 });
      }
      upsertQualityRule({ ...computedRule, updatedAt: new Date().toISOString() });
      approved = approveQualityRule(ruleId);
    }
    if (!approved) {
      return NextResponse.json({ error: "Unknown rule" }, { status: 404 });
    }
    await persistCoreStateToMongo();
    return NextResponse.json({ rule: approved });
  }

  if (body.updateRuleId) {
    const ruleId = String(body.updateRuleId);
    // Strip undefined — Object.assign would overwrite existing fields with undefined
    const updates = Object.fromEntries(
      Object.entries({
        status: body.status as string | undefined,
        frequency: body.frequency as string | undefined,
        title: body.title as string | undefined,
        description: body.description as string | undefined,
        severity: body.severity as string | undefined,
      }).filter(([, v]) => v !== undefined)
    ) as Partial<Pick<QualityRule, "status" | "frequency" | "title" | "description" | "severity">>;
    let updated = updateQualityRule(ruleId, updates);
    if (!updated) {
      // Computed rule — promote it with the updates applied
      const computedRule = getComputedRules().find((r) => r.ruleId === ruleId);
      if (!computedRule) {
        return NextResponse.json({ error: "Unknown rule" }, { status: 404 });
      }
      const promoted: QualityRule = {
        ...computedRule,
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.frequency !== undefined && { frequency: updates.frequency }),
        ...(updates.title !== undefined && { title: updates.title }),
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.severity !== undefined && { severity: updates.severity }),
        updatedAt: new Date().toISOString(),
      };
      updated = upsertQualityRule(promoted);
    }
    await persistCoreStateToMongo();
    return NextResponse.json({ rule: updated });
  }

  if (body.deleteRuleId) {
    const ruleId = String(body.deleteRuleId);
    let deleted = deleteQualityRule(ruleId);
    if (!deleted) {
      // Computed rule — promote it first so deleteQualityRule can find and remove it
      const computedRule = getComputedRules().find((r) => r.ruleId === ruleId);
      if (!computedRule) {
        return NextResponse.json({ error: "Unknown rule" }, { status: 404 });
      }
      upsertQualityRule({ ...computedRule, updatedAt: new Date().toISOString() });
      deleted = deleteQualityRule(ruleId);
    }
    if (!deleted) {
      return NextResponse.json({ error: "Unknown rule" }, { status: 404 });
    }
    await persistCoreStateToMongo();
    return NextResponse.json({ rule: deleted });
  }

  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }

  const [retrieved, snapshots] = await Promise.all([
    retrieveKnowledge(prompt, 5),
    Promise.resolve(listConnectionSnapshots()),
  ]);

  const workspaceContext = snapshots.length
    ? snapshots.map((s) => `- ${s.tool} (${s.connectionId}): health=${s.health}`).join("\n")
    : "No connections configured.";

  const llmResult = await generateRuleWithDeepseek(prompt, workspaceContext);
  const llm = llmResult?.draft ?? null;
  const generatedBy = llmResult ? llmResult.model : "heuristic";

  const severity   = llm?.severity   ?? inferSeverity(prompt);
  const conditions = llm?.conditions ?? inferConditions(prompt);

  const rule = addQualityRule({
    title:       llm?.title       ?? body.title ?? prompt.slice(0, 64),
    description: llm?.description ?? prompt,
    tool:        body.tool ?? "Workspace",
    targetScope: body.targetScope ?? "global",
    frequency:   body.frequency ?? "Hourly",
    severity,
    status: "draft",
    conditions,
    generatedDsl: {
      type: "quality_rule",
      target: body.targetScope ?? "global",
      conditions,
      severity,
      generatedBy,
    },
    draft: {
      assumptions: llm?.assumptions ?? [
        "Rule executes through an adapter-backed read-only validation plan.",
        "Thresholds can be refined before approval.",
      ],
      evidence: retrieved.citations.map((c) => c.title),
      generatedSql: llm?.generatedSql ?? "SELECT * FROM target_table WHERE freshness_minutes > 60 OR null_rate > 0.05;",
      generatedScript: `validate_metric('${conditions[0]?.metric ?? "custom"}', threshold=${conditions[0]?.threshold ?? "user-defined"})`,
    },
    citations: retrieved.citations,
  });

  await persistCoreStateToMongo();

  return NextResponse.json({ rule, generatedBy });
}
