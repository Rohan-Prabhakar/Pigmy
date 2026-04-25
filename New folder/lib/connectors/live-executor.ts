/**
 * live-executor.ts
 *
 * Single entry point for all live connector execution.
 * Routes to the right executor based on tool name.
 */

import type { StoredConnectionRecord } from "@/lib/product/types";
import type { ConnectorAction } from "@/lib/connectors/types";
import { executeSnowflakeDiagnostic } from "./snowflake-executor";
import { executeHttpConnector, canHandleHttp } from "./http-executor";
import { executePostgres } from "./postgres-executor";
import { executeKafka } from "./kafka-executor";
import { executeS3 } from "./s3-executor";

export type ExecutorResult = {
  summary: string;
  evidence: string[];
  rows?: Record<string, unknown>[];
  live: boolean;
};

type Executor = (c: StoredConnectionRecord, a: ConnectorAction, q?: string) => Promise<ExecutorResult>;

const TOOL_MAP: Record<string, Executor> = {
  "snowflake":        executeSnowflakeDiagnostic,
  "postgresql":       executePostgres,
  "amazon redshift":  executePostgres,
  "apache kafka":     executeKafka,
  "amazon s3":        executeS3,
};

export function canExecuteLive(tool: string): boolean {
  const key = tool.toLowerCase();
  return key in TOOL_MAP || canHandleHttp(key);
}

export async function executeLive(
  connection: StoredConnectionRecord,
  action: ConnectorAction,
  generatedQuery?: string
): Promise<ExecutorResult> {
  const key = connection.tool.toLowerCase();

  const executor = TOOL_MAP[key];
  if (executor) return executor(connection, action, generatedQuery);

  if (canHandleHttp(key)) return executeHttpConnector(connection, action, generatedQuery);

  return {
    summary: `No live executor available for ${connection.tool}. Using diagnostic scaffold.`,
    evidence: [`Tool: ${connection.tool}`, "Live execution not yet implemented for this connector."],
    live: false,
  };
}
