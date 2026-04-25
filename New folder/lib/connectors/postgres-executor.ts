/**
 * postgres-executor.ts
 *
 * Real SQL execution for PostgreSQL and Amazon Redshift (Redshift is
 * Postgres-wire-compatible so the same `pg` client works for both).
 */

import { Client } from "pg";
import type { StoredConnectionRecord } from "@/lib/product/types";
import type { ConnectorAction } from "@/lib/connectors/types";

export type ExecutorResult = {
  summary: string;
  evidence: string[];
  rows?: Record<string, unknown>[];
  live: boolean;
};

function buildSql(tool: string, action: ConnectorAction, database: string): string {
  const isRedshift = tool.toLowerCase().includes("redshift");

  if (isRedshift) {
    switch (action) {
      case "query":
      case "fetch_metadata":
      case "discover":
        return `SELECT table_schema, table_name, "rows", size FROM SVV_TABLE_INFO ORDER BY "rows" DESC NULLS LAST LIMIT 20;`;
      case "fetch_logs":
        return `SELECT starttime, filename, err_reason, raw_line FROM stl_load_errors ORDER BY starttime DESC LIMIT 20;`;
      case "validate":
        return `SELECT query, starttime, endtime, aborted, elapsed FROM stl_query WHERE starttime >= dateadd(hour, -24, getdate()) AND aborted = 1 ORDER BY starttime DESC LIMIT 20;`;
      case "test_connection":
        return `SELECT version();`;
      default:
        return `SELECT table_schema, table_name FROM information_schema.tables WHERE table_type='BASE TABLE' LIMIT 15;`;
    }
  }

  // PostgreSQL
  switch (action) {
    case "query":
      return `SELECT schemaname, relname AS table_name, n_live_tup AS row_estimate, pg_size_pretty(pg_total_relation_size(relid)) AS total_size FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 20;`;
    case "fetch_logs":
      return `SELECT pid, now() - pg_stat_activity.query_start AS duration, state, left(query, 100) AS query_preview FROM pg_stat_activity WHERE state <> 'idle' AND query_start < now() - interval '30 seconds' ORDER BY duration DESC LIMIT 20;`;
    case "validate":
      return `SELECT schemaname, relname, n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 20;`;
    case "fetch_metadata":
    case "discover":
      return `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema') ORDER BY schema_name;`;
    case "test_connection":
      return `SELECT version(), current_database(), current_user;`;
    default:
      return `SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 15;`;
  }
}

export async function executePostgres(
  connection: StoredConnectionRecord,
  action: ConnectorAction,
  generatedQuery?: string
): Promise<ExecutorResult> {
  const host     = connection.details?.host ?? connection.target ?? "";
  const database = connection.details?.database ?? "postgres";
  const user     = connection.principal ?? "";
  const password = connection.secret ?? "";
  const port     = Number(connection.details?.port ?? 5432);
  const ssl      = connection.details?.ssl !== "false";
  const tool     = connection.tool;

  if (!host || !user || !password) {
    return {
      summary: "PostgreSQL credentials incomplete — host, principal, or secret missing.",
      evidence: [
        `Host: ${host || "missing"}`,
        `User: ${user || "missing"}`,
        "Password: not set",
      ],
      live: false,
    };
  }

  const client = new Client({
    host,
    port,
    database,
    user,
    password,
    ssl: ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
  });

  try {
    await client.connect();
    const sql = generatedQuery?.trim() || buildSql(tool, action, database);
    const result = await client.query(sql);
    const rows = result.rows as Record<string, unknown>[];

    const summary =
      rows.length === 0
        ? `${tool} ${action} returned no rows.`
        : `${tool} ${action}: ${rows.length} row(s) from ${database}.`;

    return {
      summary,
      evidence: [
        `Host: ${host}:${port}`,
        `Database: ${database}`,
        `SQL: ${sql.replace(/\s+/g, " ").trim().slice(0, 120)}...`,
        ...rows.slice(0, 10).map((row) =>
          Object.entries(row)
            .map(([k, v]) => `${k}=${v ?? "null"}`)
            .join("  ")
        ),
      ],
      rows,
      live: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      summary: `${tool} live execution failed: ${message}`,
      evidence: [`Host: ${host}`, `Database: ${database}`, `Error: ${message}`],
      live: false,
    };
  } finally {
    await client.end().catch(() => {});
  }
}
