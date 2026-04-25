import { NextResponse } from "next/server";
import { planConnectorAction } from "@/lib/connectors/engine";
import { isBlockedMutationAction, isReadOnlyConnectorAction } from "@/lib/connectors/guardrails";
import { getConnection, getConnectionRecord, refreshConnectionSnapshot } from "@/lib/connectors/vault";
import type { ConnectorAction } from "@/lib/connectors/types";
import { resolveAdapterRecord } from "@/lib/connectors/adapters";
import { executeLive, canExecuteLive } from "@/lib/connectors/live-executor";
import { appendMessages, storeApproval, storeCommandRun } from "@/lib/assistant/store";

export async function POST(request: Request) {
  const body = await request.json();
  const connection = getConnection(String(body.connectionId ?? ""));
  const connectionRecord = getConnectionRecord(String(body.connectionId ?? ""));

  if (!connection || !connectionRecord) {
    return NextResponse.json({ error: "Unknown connection" }, { status: 404 });
  }

  try {
    const plan = planConnectorAction({
      connectionId: connection.connectionId,
      tool: body.tool || connection.tool,
      action: body.action,
      target: body.target,
      parameters: body.parameters,
      dryRun: body.dryRun,
    });

    const adapter = resolveAdapterRecord(
      connectionRecord.tool,
      connectionRecord.family,
      connectionRecord.adapterId
    );

    const approvalRequired = plan.requiresApproval;
    const approved = Boolean(body.approved);

    if (isBlockedMutationAction(plan.action)) {
      return NextResponse.json(
        {
          error: "This workspace allows read access only. Write actions are blocked.",
          guardrail: { mode: "read_only_connector_shell", blockedAction: plan.action },
        },
        { status: 403 }
      );
    }

    if (approvalRequired && !approved) {
      const approval = await storeApproval({
        threadId: String(body.threadId ?? "manual"),
        action: plan.action,
        target: plan.tool,
        approved: false,
      });
      return NextResponse.json({
        status: "awaiting_approval",
        plan,
        approval,
        message: "This action requires approval before execution.",
      });
    }

    let executionResult:
      | { summary: string; evidence?: string[]; rows?: Record<string, unknown>[]; live?: boolean }
      | null = null;

    if (body.execute) {
      if (!approvalRequired && canExecuteLive(connectionRecord.tool)) {
        executionResult = await executeLive(
          connectionRecord,
          plan.action as ConnectorAction,
          body.generatedQuery as string | undefined
        );
      } else {
        executionResult = approvalRequired
          ? adapter.runGuardedAction(
              connectionRecord,
              plan.action as Parameters<typeof adapter.runGuardedAction>[1]
            )
          : adapter.runDiagnostic(
              connectionRecord,
              plan.action as Parameters<typeof adapter.runDiagnostic>[1]
            );
      }

      await storeCommandRun({
        threadId: String(body.threadId ?? "manual"),
        connectionId: connection.connectionId,
        tool: plan.tool,
        action: plan.action,
        status: "completed",
        resultSummary: executionResult.summary,
      });

      // Persist execution result as an assistant message so it survives refresh
      if (body.threadId && executionResult) {
        await appendMessages(String(body.threadId), [
          {
            role: "assistant",
            text: executionResult.summary,
            metadata: {
              executionResult: {
                ...executionResult,
                tool: plan.tool,
                action: plan.action,
                live: executionResult.live ?? false,
              },
            },
          },
        ]);
      }

      if (!approvalRequired && isReadOnlyConnectorAction(plan.action)) {
        refreshConnectionSnapshot(connection.connectionId);
      }
    }

    return NextResponse.json({
      status: body.execute ? "executed" : "planned",
      plan,
      result: executionResult,
      message: body.execute ? "Action executed." : "Execution plan prepared.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to execute action" },
      { status: 400 }
    );
  }
}
