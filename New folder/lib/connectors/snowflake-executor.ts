/**
 * snowflake-executor.ts
 *
 * Real Snowflake execution using snowflake-sdk.
 * Called from the execute route when a Snowflake connection has live credentials.
 * Falls back to a descriptive error if credentials are missing.
 */

import snowflake from "snowflake-sdk";
import type { StoredConnectionRecord } from "@/lib/product/types";
import type { ConnectorAction } from "@/lib/connectors/types";

export type ExecutorResult = {
  summary: string;
  evidence: string[];
  rows?: Record<string, unknown>[];
  live: boolean;
};

// Suppress the noisy snowflake-sdk OCSP/keepalive logs in Next.js
snowflake.configure({ logLevel: "ERROR" } as Parameters<typeof snowflake.configure>[0]);

function buildCredentials(connection: StoredConnectionRecord) {
  const account = connection.details?.account ?? connection.target ?? "";
  const username = connection.principal ?? "";
  const password = connection.secret ?? "";
  const database = connection.details?.database ?? "";
  const warehouse = connection.details?.warehouse ?? "";
  const role = connection.details?.role;
  const schema = connection.details?.schema ?? "PUBLIC";
  return { account, username, password, database, warehouse, role, schema };
}

function executeStatement(conn: ReturnType<typeof snowflake.createConnection>, sqlText: string) {
  return new Promise<Record<string, unknown>[]>((resolve, reject) => {
    conn.execute({
      sqlText,
      complete: (err, _stmt, rows) => {
        if (err) reject(new Error(`Snowflake query: ${err.message}`));
        else resolve((rows ?? []) as Record<string, unknown>[]);
      },
    });
  });
}

async function runQuery(
  creds: ReturnType<typeof buildCredentials>,
  sql: string
): Promise<Record<string, unknown>[]> {
  const conn = snowflake.createConnection({
    account: creds.account,
    username: creds.username,
    password: creds.password,
    database: creds.database || undefined,
    warehouse: creds.warehouse || undefined,
    role: creds.role,
    schema: creds.schema,
  });

  await new Promise<void>((resolve, reject) => {
    conn.connect((err) => {
      if (err) reject(new Error(`Snowflake connect: ${err.message}`));
      else resolve();
    });
  });

  try {
    // Set database/warehouse context — unquoted so Snowflake treats them
    // case-insensitively (quoted identifiers are case-sensitive in Snowflake).
    if (creds.database) {
      await executeStatement(conn, `USE DATABASE ${creds.database.toUpperCase()};`);
    }
    if (creds.warehouse) {
      await executeStatement(conn, `USE WAREHOUSE ${creds.warehouse.toUpperCase()};`);
    }

    const rows = await executeStatement(conn, sql);
    return rows;
  } finally {
    await new Promise<void>((resolve) => {
      conn.destroy((err) => {
        if (err) console.warn("[snowflake-executor] destroy:", err);
        resolve();
      });
    });
  }
}

function rowsToEvidence(rows: Record<string, unknown>[], maxRows = 10): string[] {
  return rows.slice(0, maxRows).map((row) =>
    Object.entries(row)
      .map(([k, v]) => `${k}=${v ?? "null"}`)
      .join("  ")
  );
}

function buildSql(action: ConnectorAction, _creds: ReturnType<typeof buildCredentials>): string {
  // USE DATABASE is run before this query so information_schema is always in context.
  switch (action) {
    case "test_connection":
      return "SELECT CURRENT_VERSION() AS version, CURRENT_WAREHOUSE() AS warehouse, CURRENT_DATABASE() AS database, CURRENT_ROLE() AS role;";

    case "discover":
    case "fetch_metadata":
      return `SELECT table_schema, table_name, table_type, row_count, bytes FROM information_schema.tables WHERE table_schema NOT IN ('INFORMATION_SCHEMA') ORDER BY row_count DESC NULLS LAST LIMIT 30;`;

    case "query":
      return `SELECT table_schema, table_name, table_type, row_count, bytes FROM information_schema.tables WHERE table_schema NOT IN ('INFORMATION_SCHEMA') ORDER BY row_count DESC NULLS LAST LIMIT 20;`;

    case "validate":
      return `SELECT name, state, scheduled_time, completed_time, error_code, error_message
              FROM TABLE(SNOWFLAKE.INFORMATION_SCHEMA.TASK_HISTORY(
                SCHEDULED_TIME_RANGE_START => DATEADD('hour', -24, CURRENT_TIMESTAMP()),
                RESULT_LIMIT => 50,
                ERROR_ONLY => TRUE
              ));`;

    case "fetch_logs":
      return `SELECT query_id, LEFT(query_text, 120) AS query_preview,
                     execution_status, error_message,
                     ROUND(total_elapsed_time / 1000, 1) AS elapsed_sec,
                     start_time
              FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
              WHERE start_time >= DATEADD('hour', -24, CURRENT_TIMESTAMP())
                AND execution_status <> 'SUCCESS'
              ORDER BY start_time DESC
              LIMIT 20;`;

    case "inspect":
    default:
      return `SELECT table_schema, table_name, row_count, bytes FROM ${infoSchema} ORDER BY row_count DESC NULLS LAST LIMIT 15;`;
  }
}

export async function executeSnowflakeDiagnostic(
  connection: StoredConnectionRecord,
  action: ConnectorAction,
  generatedQuery?: string
): Promise<ExecutorResult> {
  const creds = buildCredentials(connection);

  if (!creds.account || !creds.username || !creds.password) {
    return {
      summary: "Snowflake credentials incomplete — account, username, or password missing.",
      evidence: [
        `Account: ${creds.account || "missing"}`,
        `Username: ${creds.username || "missing"}`,
        "Password: not set — re-save the connection with credentials to enable live execution.",
      ],
      live: false,
    };
  }

  const sql = generatedQuery?.trim() || buildSql(action, creds);

  try {
    const rows = await runQuery(creds, sql);

    const summary =
      rows.length === 0
        ? `Snowflake ${action} returned no rows — pipeline looks clean for the last 24 h.`
        : `Snowflake ${action} returned ${rows.length} row${rows.length === 1 ? "" : "s"} from ${creds.database}.`;

    return {
      summary,
      evidence: [
        `Account: ${creds.account}`,
        `Database: ${creds.database}`,
        `SQL: ${sql.replace(/\s+/g, " ").trim().slice(0, 120)}...`,
        ...rowsToEvidence(rows),
      ],
      rows,
      live: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      summary: `Snowflake live execution failed: ${message}`,
      evidence: [
        `Account: ${creds.account}`,
        `Database: ${creds.database}`,
        `Action: ${action}`,
        `Error: ${message}`,
      ],
      live: false,
    };
  }
}
