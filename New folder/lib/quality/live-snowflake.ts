import { makeId, readStore, writeStore } from "@/lib/platform/json-store";
import type {
  AdapterSnapshot,
  QualityAlert,
  QualityRun,
  StoredConnectionRecord,
} from "@/lib/product/types";
import type { SystemQualityBundle } from "@/lib/quality/system-tests";

const CACHE_FILE = "quality-live-snowflake.json";
const CACHE_TTL_MS = 1000 * 60 * 10;

type SnowflakeLiveCache = {
  generatedAt: string;
  byConnection: Record<
    string,
    {
      signature: string;
      runs: QualityRun[];
      alerts: QualityAlert[];
    }
  >;
};

const emptyCache: SnowflakeLiveCache = {
  generatedAt: new Date(0).toISOString(),
  byConnection: {},
};

type QueryResult = {
  rows: Record<string, unknown>[];
};

type SnowflakeConnectionLike = {
  execute: (options: {
    sqlText: string;
    complete: (
      error: Error | null,
      stmt: unknown,
      resultRows: Record<string, unknown>[]
    ) => void;
  }) => void;
  destroy: (callback: () => void) => void;
};

type RunSpec = {
  ruleSuffix: string;
  sqlText?: string;
  requiresDatabase?: boolean;
  skipReason?: string;
  execute: (connection: SnowflakeConnectionLike) => Promise<QueryResult>;
  evaluate: (result: QueryResult) => {
    status: QualityRun["status"];
    evidence: string[];
  };
};

function snapshotSignature(snapshot: AdapterSnapshot) {
  return JSON.stringify({
    connectionId: snapshot.connectionId,
    syncedAt: snapshot.metadataSyncedAt,
    health: snapshot.health,
    validation: snapshot.diagnostics.lastValidationStatus,
  });
}

async function runSnowflakeSql(
  sfConnection: SnowflakeConnectionLike,
  sqlText: string
): Promise<QueryResult> {
  const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
    sfConnection.execute({
      sqlText,
      complete: (error: Error | null, _stmt: unknown, resultRows: Record<string, unknown>[]) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(resultRows ?? []);
      },
    });
  });

  return { rows };
}

async function connectSnowflake(connection: StoredConnectionRecord): Promise<SnowflakeConnectionLike> {
  const snowflake = require("snowflake-sdk");
  const config: Record<string, unknown> = {
    account: connection.details?.account ?? connection.target,
    username: connection.details?.username ?? connection.principal,
    password: connection.details?.password,
    warehouse: connection.details?.warehouse,
    database: connection.details?.database,
    role: connection.details?.role,
    schema: connection.details?.schema,
    application: "PipelineOps",
  };

  const sfConnection = snowflake.createConnection(config) as SnowflakeConnectionLike & {
    connect: (callback: (error: Error | null) => void) => void;
  };

  await new Promise<void>((resolve, reject) => {
    sfConnection.connect((error: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return sfConnection;
}

async function destroySnowflakeConnection(connection: SnowflakeConnectionLike) {
  try {
    await new Promise<void>((resolve) => {
      connection.destroy(() => resolve());
    });
  } catch {
    // ignore cleanup error
  }
}

function countFromRow(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number") return value;
    if (typeof value === "bigint") return Number(value);
  }
  return 0;
}

function buildSpecs(connection: StoredConnectionRecord): RunSpec[] {
  const database = connection.details?.database;
  const showScope = database ? ` IN DATABASE ${database}` : "";

  return [
    {
      ruleSuffix: "snowflake-query-history",
      sqlText:
        "SELECT COUNT(*) AS FAILURE_COUNT FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND EXECUTION_STATUS <> 'SUCCESS';",
      execute: (sfConnection) =>
        runSnowflakeSql(
          sfConnection,
          "SELECT COUNT(*) AS FAILURE_COUNT FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND EXECUTION_STATUS <> 'SUCCESS';"
        ),
      evaluate: (result) => {
        const count = countFromRow(result.rows[0] ?? {}, ["FAILURE_COUNT", "failure_count"]);
        return {
          status: count > 0 ? "fail" : "pass",
          evidence: [`${count} failed queries in the last 24 hours.`],
        };
      },
    },
    {
      ruleSuffix: "snowflake-task-history",
      sqlText:
        "SELECT COUNT(*) AS FAILURE_COUNT FROM TABLE(SNOWFLAKE.INFORMATION_SCHEMA.TASK_HISTORY(SCHEDULED_TIME_RANGE_START => DATEADD('hour', -24, CURRENT_TIMESTAMP()), RESULT_LIMIT => 100, ERROR_ONLY => TRUE));",
      execute: (sfConnection) =>
        runSnowflakeSql(
          sfConnection,
          "SELECT COUNT(*) AS FAILURE_COUNT FROM TABLE(SNOWFLAKE.INFORMATION_SCHEMA.TASK_HISTORY(SCHEDULED_TIME_RANGE_START => DATEADD('hour', -24, CURRENT_TIMESTAMP()), RESULT_LIMIT => 100, ERROR_ONLY => TRUE));"
        ),
      evaluate: (result) => {
        const count = countFromRow(result.rows[0] ?? {}, ["FAILURE_COUNT", "failure_count", "COUNT"]);
        return {
          status: count > 0 ? "fail" : "pass",
          evidence: [`${count} failed task runs in the last 24 hours.`],
        };
      },
    },
    {
      ruleSuffix: "snowflake-copy-history",
      sqlText:
        "SELECT COUNT(*) AS FAILURE_COUNT FROM SNOWFLAKE.ACCOUNT_USAGE.COPY_HISTORY WHERE LAST_LOAD_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND STATUS <> 'LOADED';",
      execute: (sfConnection) =>
        runSnowflakeSql(
          sfConnection,
          "SELECT COUNT(*) AS FAILURE_COUNT FROM SNOWFLAKE.ACCOUNT_USAGE.COPY_HISTORY WHERE LAST_LOAD_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND STATUS <> 'LOADED';"
        ),
      evaluate: (result) => {
        const count = countFromRow(result.rows[0] ?? {}, ["FAILURE_COUNT", "failure_count"]);
        return {
          status: count > 0 ? "warn" : "pass",
          evidence: [`${count} copy-load failures in the last 24 hours.`],
        };
      },
    },
    {
      ruleSuffix: "snowflake-warehouse-load-check",
      sqlText:
        "SELECT MAX(AVG_QUEUED_LOAD) AS MAX_QUEUED_LOAD, MAX(AVG_QUEUED_PROVISIONING) AS MAX_QUEUED_PROVISIONING FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_LOAD_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP());",
      execute: (sfConnection) =>
        runSnowflakeSql(
          sfConnection,
          "SELECT MAX(AVG_QUEUED_LOAD) AS MAX_QUEUED_LOAD, MAX(AVG_QUEUED_PROVISIONING) AS MAX_QUEUED_PROVISIONING FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_LOAD_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP());"
        ),
      evaluate: (result) => {
        const row = result.rows[0] ?? {};
        const queuedLoad = Number(row.MAX_QUEUED_LOAD ?? row.max_queued_load ?? 0);
        const queuedProvisioning = Number(
          row.MAX_QUEUED_PROVISIONING ?? row.max_queued_provisioning ?? 0
        );
        const status =
          queuedLoad > 0.15 || queuedProvisioning > 0.15
            ? "warn"
            : "pass";
        return {
          status,
          evidence: [
            `Max queued load ${queuedLoad.toFixed(2)}, provisioning queue ${queuedProvisioning.toFixed(2)}.`,
          ],
        };
      },
    },
    {
      ruleSuffix: "snowflake-long-running-query-check",
      sqlText:
        "SELECT COUNT(*) AS SLOW_QUERY_COUNT FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND TOTAL_ELAPSED_TIME > 60000;",
      execute: (sfConnection) =>
        runSnowflakeSql(
          sfConnection,
          "SELECT COUNT(*) AS SLOW_QUERY_COUNT FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND TOTAL_ELAPSED_TIME > 60000;"
        ),
      evaluate: (result) => {
        const count = countFromRow(result.rows[0] ?? {}, ["SLOW_QUERY_COUNT", "slow_query_count"]);
        return {
          status: count > 10 ? "warn" : "pass",
          evidence: [`${count} long-running queries exceeded 60 seconds.`],
        };
      },
    },
    {
      ruleSuffix: "snowflake-error-family-check",
      sqlText:
        "SELECT COALESCE(MAX(FAILURE_COUNT), 0) AS TOP_FAILURES FROM (SELECT ERROR_CODE, COUNT(*) AS FAILURE_COUNT FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND EXECUTION_STATUS <> 'SUCCESS' GROUP BY ERROR_CODE);",
      execute: (sfConnection) =>
        runSnowflakeSql(
          sfConnection,
          "SELECT COALESCE(MAX(FAILURE_COUNT), 0) AS TOP_FAILURES FROM (SELECT ERROR_CODE, COUNT(*) AS FAILURE_COUNT FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND EXECUTION_STATUS <> 'SUCCESS' GROUP BY ERROR_CODE);"
        ),
      evaluate: (result) => {
        const top = countFromRow(result.rows[0] ?? {}, ["TOP_FAILURES", "top_failures"]);
        return {
          status: top >= 3 ? "fail" : top > 0 ? "warn" : "pass",
          evidence: [`Top clustered Snowflake error family has ${top} failures.`],
        };
      },
    },
    {
      ruleSuffix: "snowflake-role-auth-check",
      sqlText:
        "SELECT COUNT(*) AS LOGIN_FAILURES FROM SNOWFLAKE.ACCOUNT_USAGE.LOGIN_HISTORY WHERE EVENT_TIMESTAMP >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND NOT IS_SUCCESS;",
      execute: (sfConnection) =>
        runSnowflakeSql(
          sfConnection,
          "SELECT COUNT(*) AS LOGIN_FAILURES FROM SNOWFLAKE.ACCOUNT_USAGE.LOGIN_HISTORY WHERE EVENT_TIMESTAMP >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND NOT IS_SUCCESS;"
        ),
      evaluate: (result) => {
        const count = countFromRow(result.rows[0] ?? {}, ["LOGIN_FAILURES", "login_failures"]);
        return {
          status: count > 0 ? "fail" : "pass",
          evidence: [`${count} failed Snowflake login attempts in the last 24 hours.`],
        };
      },
    },
    {
      ruleSuffix: "snowflake-stream-lag-check",
      sqlText: `SHOW STREAMS${showScope};`,
      requiresDatabase: true,
      execute: (sfConnection) => runSnowflakeSql(sfConnection, `SHOW STREAMS${showScope};`),
      evaluate: (result) => {
        const staleStreams = result.rows.filter((row) => Boolean(row.stale ?? row.STALE)).length;
        return {
          status: staleStreams > 0 ? "warn" : "pass",
          evidence: [`${staleStreams} streams are currently marked stale.`],
        };
      },
    },
    {
      ruleSuffix: "snowflake-stage-file-gap-check",
      sqlText: `SHOW STAGES${showScope};`,
      requiresDatabase: true,
      execute: (sfConnection) => runSnowflakeSql(sfConnection, `SHOW STAGES${showScope};`),
      evaluate: (result) => {
        const count = result.rows.length;
        return {
          status: count === 0 ? "warn" : "pass",
          evidence: [`${count} stages are visible for the selected database scope.`],
        };
      },
    },
    {
      ruleSuffix: "snowflake-load-to-query-gap-check",
      sqlText:
        "WITH latest_load AS (SELECT MAX(LAST_LOAD_TIME) AS LAST_LOAD_TIME FROM SNOWFLAKE.ACCOUNT_USAGE.COPY_HISTORY WHERE LAST_LOAD_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP())), latest_query AS (SELECT MAX(START_TIME) AS LAST_QUERY_TIME FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP())) SELECT DATEDIFF('minute', LAST_LOAD_TIME, LAST_QUERY_TIME) AS GAP_MINUTES FROM latest_load, latest_query;",
      execute: (sfConnection) =>
        runSnowflakeSql(
          sfConnection,
          "WITH latest_load AS (SELECT MAX(LAST_LOAD_TIME) AS LAST_LOAD_TIME FROM SNOWFLAKE.ACCOUNT_USAGE.COPY_HISTORY WHERE LAST_LOAD_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP())), latest_query AS (SELECT MAX(START_TIME) AS LAST_QUERY_TIME FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP())) SELECT DATEDIFF('minute', LAST_LOAD_TIME, LAST_QUERY_TIME) AS GAP_MINUTES FROM latest_load, latest_query;"
        ),
      evaluate: (result) => {
        const gap = Number(result.rows[0]?.GAP_MINUTES ?? result.rows[0]?.gap_minutes ?? 0);
        return {
          status: gap > 120 ? "warn" : "pass",
          evidence: [`Load-to-query gap is ${gap} minutes.`],
        };
      },
    },
    {
      ruleSuffix: "snowflake-row-volume-shift-check",
      sqlText:
        "SELECT COALESCE(MAX(ACTIVE_BYTES), 0) AS MAX_ACTIVE_BYTES FROM SNOWFLAKE.ACCOUNT_USAGE.TABLE_STORAGE_METRICS;",
      execute: (sfConnection) =>
        runSnowflakeSql(
          sfConnection,
          "SELECT COALESCE(MAX(ACTIVE_BYTES), 0) AS MAX_ACTIVE_BYTES FROM SNOWFLAKE.ACCOUNT_USAGE.TABLE_STORAGE_METRICS;"
        ),
      evaluate: (result) => {
        const maxBytes = Number(result.rows[0]?.MAX_ACTIVE_BYTES ?? result.rows[0]?.max_active_bytes ?? 0);
        return {
          status: maxBytes <= 0 ? "warn" : "pass",
          evidence: [`Largest tracked table active footprint is ${maxBytes} bytes.`],
        };
      },
    },
    {
      ruleSuffix: "snowflake-warehouse-resume-check",
      sqlText:
        "SELECT COUNT(*) AS ACTIVE_INTERVALS FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_LOAD_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND AVG_RUNNING > 0;",
      execute: (sfConnection) =>
        runSnowflakeSql(
          sfConnection,
          "SELECT COUNT(*) AS ACTIVE_INTERVALS FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_LOAD_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND AVG_RUNNING > 0;"
        ),
      evaluate: (result) => {
        const intervals = countFromRow(result.rows[0] ?? {}, ["ACTIVE_INTERVALS", "active_intervals"]);
        return {
          status: intervals === 0 ? "warn" : "pass",
          evidence: [`Warehouse had ${intervals} active 5-minute intervals in the last 24 hours.`],
        };
      },
    },
    {
      ruleSuffix: "snowflake-top-failing-user-check",
      sqlText:
        "SELECT COALESCE(MAX(FAILURE_COUNT), 0) AS TOP_USER_FAILURES FROM (SELECT USER_NAME, COUNT(*) AS FAILURE_COUNT FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND EXECUTION_STATUS <> 'SUCCESS' GROUP BY USER_NAME);",
      execute: (sfConnection) =>
        runSnowflakeSql(
          sfConnection,
          "SELECT COALESCE(MAX(FAILURE_COUNT), 0) AS TOP_USER_FAILURES FROM (SELECT USER_NAME, COUNT(*) AS FAILURE_COUNT FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND EXECUTION_STATUS <> 'SUCCESS' GROUP BY USER_NAME);"
        ),
      evaluate: (result) => {
        const count = countFromRow(result.rows[0] ?? {}, ["TOP_USER_FAILURES", "top_user_failures"]);
        return {
          status: count >= 3 ? "fail" : count > 0 ? "warn" : "pass",
          evidence: [`Top failing principal recorded ${count} failed queries.`],
        };
      },
    },
    {
      ruleSuffix: "snowflake-recent-object-change-check",
      sqlText:
        "SELECT COUNT(*) AS DDL_COUNT FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND QUERY_TYPE IN ('CREATE_TABLE','ALTER_TABLE','CREATE_VIEW','ALTER_VIEW','CREATE_TASK','ALTER_TASK','CREATE_PIPE','ALTER_PIPE');",
      execute: (sfConnection) =>
        runSnowflakeSql(
          sfConnection,
          "SELECT COUNT(*) AS DDL_COUNT FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND QUERY_TYPE IN ('CREATE_TABLE','ALTER_TABLE','CREATE_VIEW','ALTER_VIEW','CREATE_TASK','ALTER_TASK','CREATE_PIPE','ALTER_PIPE');"
        ),
      evaluate: (result) => {
        const count = countFromRow(result.rows[0] ?? {}, ["DDL_COUNT", "ddl_count"]);
        return {
          status: count > 0 ? "warn" : "pass",
          evidence: [`${count} recent DDL changes detected across key objects.`],
        };
      },
    },
    {
      ruleSuffix: "snowflake-failed-copy-target-check",
      sqlText:
        "SELECT COALESCE(MAX(FAILURE_COUNT), 0) AS TOP_TARGET_FAILURES FROM (SELECT TABLE_NAME, COUNT(*) AS FAILURE_COUNT FROM SNOWFLAKE.ACCOUNT_USAGE.COPY_HISTORY WHERE LAST_LOAD_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND STATUS <> 'LOADED' GROUP BY TABLE_NAME);",
      execute: (sfConnection) =>
        runSnowflakeSql(
          sfConnection,
          "SELECT COALESCE(MAX(FAILURE_COUNT), 0) AS TOP_TARGET_FAILURES FROM (SELECT TABLE_NAME, COUNT(*) AS FAILURE_COUNT FROM SNOWFLAKE.ACCOUNT_USAGE.COPY_HISTORY WHERE LAST_LOAD_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND STATUS <> 'LOADED' GROUP BY TABLE_NAME);"
        ),
      evaluate: (result) => {
        const count = countFromRow(result.rows[0] ?? {}, ["TOP_TARGET_FAILURES", "top_target_failures"]);
        return {
          status: count >= 3 ? "warn" : count > 0 ? "warn" : "pass",
          evidence: [`Top load target recorded ${count} failed load attempts.`],
        };
      },
    },
    {
      ruleSuffix: "snowflake-cross-surface-root-cause-check",
      sqlText:
        "WITH q AS (SELECT COUNT(*) AS query_failures FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND EXECUTION_STATUS <> 'SUCCESS'), t AS (SELECT COUNT(*) AS task_failures FROM TABLE(SNOWFLAKE.INFORMATION_SCHEMA.TASK_HISTORY(SCHEDULED_TIME_RANGE_START => DATEADD('hour', -24, CURRENT_TIMESTAMP()), RESULT_LIMIT => 100, ERROR_ONLY => TRUE))), c AS (SELECT COUNT(*) AS copy_failures FROM SNOWFLAKE.ACCOUNT_USAGE.COPY_HISTORY WHERE LAST_LOAD_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND STATUS <> 'LOADED') SELECT q.query_failures, t.task_failures, c.copy_failures FROM q, t, c;",
      execute: (sfConnection) =>
        runSnowflakeSql(
          sfConnection,
          "WITH q AS (SELECT COUNT(*) AS query_failures FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND EXECUTION_STATUS <> 'SUCCESS'), t AS (SELECT COUNT(*) AS task_failures FROM TABLE(SNOWFLAKE.INFORMATION_SCHEMA.TASK_HISTORY(SCHEDULED_TIME_RANGE_START => DATEADD('hour', -24, CURRENT_TIMESTAMP()), RESULT_LIMIT => 100, ERROR_ONLY => TRUE))), c AS (SELECT COUNT(*) AS copy_failures FROM SNOWFLAKE.ACCOUNT_USAGE.COPY_HISTORY WHERE LAST_LOAD_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND STATUS <> 'LOADED') SELECT q.query_failures, t.task_failures, c.copy_failures FROM q, t, c;"
        ),
      evaluate: (result) => {
        const row = result.rows[0] ?? {};
        const queryFailures = countFromRow(row, ["QUERY_FAILURES", "query_failures"]);
        const taskFailures = countFromRow(row, ["TASK_FAILURES", "task_failures"]);
        const copyFailures = countFromRow(row, ["COPY_FAILURES", "copy_failures"]);
        const max = Math.max(queryFailures, taskFailures, copyFailures);
        return {
          status: max > 0 ? "warn" : "pass",
          evidence: [
            `Cross-surface failures -> queries: ${queryFailures}, tasks: ${taskFailures}, loads: ${copyFailures}.`,
          ],
        };
      },
    },
    {
      ruleSuffix: "snowflake-freshness-sla-check",
      sqlText:
        "WITH latest_load AS (SELECT MAX(LAST_LOAD_TIME) AS LAST_LOAD_TIME FROM SNOWFLAKE.ACCOUNT_USAGE.COPY_HISTORY), latest_task AS (SELECT MAX(COMPLETED_TIME) AS LAST_TASK_TIME FROM TABLE(SNOWFLAKE.INFORMATION_SCHEMA.TASK_HISTORY(SCHEDULED_TIME_RANGE_START => DATEADD('day', -1, CURRENT_TIMESTAMP()), RESULT_LIMIT => 100))) SELECT GREATEST(DATEDIFF('minute', LAST_LOAD_TIME, CURRENT_TIMESTAMP()), DATEDIFF('minute', LAST_TASK_TIME, CURRENT_TIMESTAMP())) AS STALENESS_MINUTES FROM latest_load, latest_task;",
      execute: (sfConnection) =>
        runSnowflakeSql(
          sfConnection,
          "WITH latest_load AS (SELECT MAX(LAST_LOAD_TIME) AS LAST_LOAD_TIME FROM SNOWFLAKE.ACCOUNT_USAGE.COPY_HISTORY), latest_task AS (SELECT MAX(COMPLETED_TIME) AS LAST_TASK_TIME FROM TABLE(SNOWFLAKE.INFORMATION_SCHEMA.TASK_HISTORY(SCHEDULED_TIME_RANGE_START => DATEADD('day', -1, CURRENT_TIMESTAMP()), RESULT_LIMIT => 100))) SELECT GREATEST(DATEDIFF('minute', LAST_LOAD_TIME, CURRENT_TIMESTAMP()), DATEDIFF('minute', LAST_TASK_TIME, CURRENT_TIMESTAMP())) AS STALENESS_MINUTES FROM latest_load, latest_task;"
        ),
      evaluate: (result) => {
        const stale = Number(result.rows[0]?.STALENESS_MINUTES ?? result.rows[0]?.staleness_minutes ?? 0);
        return {
          status: stale > 120 ? "fail" : stale > 60 ? "warn" : "pass",
          evidence: [`Latest end-to-end staleness signal is ${stale} minutes.`],
        };
      },
    },
  ];
}

function buildRun(
  snapshot: AdapterSnapshot,
  ruleId: string,
  status: QualityRun["status"],
  severity: "SEV-2" | "SEV-3" | "SEV-4",
  evidence: string[]
): QualityRun {
  return {
    runId: `live-run-${makeId("sf")}`,
    ruleId,
    status,
    severity,
    triggerSource: "schedule",
    adapterId: snapshot.adapterId,
    evidence,
    citations: [],
    executedAt: new Date().toISOString(),
  };
}

function buildSkippedRun(snapshot: AdapterSnapshot, ruleId: string, spec: RunSpec): QualityRun {
  return buildRun(snapshot, ruleId, "warn", "SEV-3", [
    spec.skipReason ??
      "This Snowflake check was skipped because the connection is missing required scope configuration.",
    `Executed SQL: ${spec.sqlText ?? "No SQL captured."}`,
  ]);
}

function buildAlert(run: QualityRun, title: string): QualityAlert | null {
  if (run.status === "pass") return null;
  return {
    alertId: `live-alert-${makeId("sf")}`,
    ruleId: run.ruleId,
    title,
    severity: run.severity,
    status: "open",
    detail: run.evidence[0] ?? "Live Snowflake QA check surfaced an issue.",
    createdAt: run.executedAt,
  };
}

export async function buildLiveSnowflakeOverrides(
  snapshots: AdapterSnapshot[],
  records: StoredConnectionRecord[]
): Promise<{ runs: QualityRun[]; alerts: QualityAlert[] }> {
  const cache = readStore<SnowflakeLiveCache>(CACHE_FILE, emptyCache);
  const now = Date.now();
  const nextCache: SnowflakeLiveCache = {
    generatedAt: new Date().toISOString(),
    byConnection: { ...cache.byConnection },
  };

  const runs: QualityRun[] = [];
  const alerts: QualityAlert[] = [];

  for (const snapshot of snapshots.filter((item) => item.tool === "Snowflake")) {
    const record = records.find((item) => item.connectionId === snapshot.connectionId);
    if (!record || record.authMethod !== "basic") {
      continue;
    }

    const signature = snapshotSignature(snapshot);
    const cached = cache.byConnection[snapshot.connectionId];
    const isFresh =
      cached &&
      cached.signature === signature &&
      now - new Date(cache.generatedAt).getTime() < CACHE_TTL_MS;

    if (isFresh) {
      runs.push(...cached.runs);
      alerts.push(...cached.alerts);
      continue;
    }

    const connectionRuns: QualityRun[] = [];
    const connectionAlerts: QualityAlert[] = [];
    const specs = buildSpecs(record);

    let sfConnection: SnowflakeConnectionLike | null = null;
    try {
      sfConnection = await connectSnowflake(record);

      for (const spec of specs) {
        const ruleId = `system-${snapshot.connectionId}-${spec.ruleSuffix}`;
        if (spec.requiresDatabase && !record.details?.database) {
          const run = buildSkippedRun(snapshot, ruleId, {
            ...spec,
            skipReason:
              "Database is not configured on this Snowflake connection, so this database-scoped check was skipped instead of falling back to USER$/DEFAULT$ scope.",
          });
          connectionRuns.push(run);
          const alert = buildAlert(run, spec.ruleSuffix.replace(/-/g, " "));
          if (alert) connectionAlerts.push(alert);
          continue;
        }

        try {
          const result = await spec.execute(sfConnection);
          const evaluated = spec.evaluate(result);
          const severity =
            evaluated.status === "fail"
              ? "SEV-2"
              : evaluated.status === "warn"
                ? "SEV-3"
                : "SEV-4";
          const run = buildRun(snapshot, ruleId, evaluated.status, severity, [
            ...evaluated.evidence,
            `Executed SQL: ${spec.sqlText ?? "No SQL captured."}`,
          ]);
          connectionRuns.push(run);
          const alert = buildAlert(run, spec.ruleSuffix.replace(/-/g, " "));
          if (alert) connectionAlerts.push(alert);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown Snowflake execution error";
          const run = buildRun(snapshot, ruleId, "fail", "SEV-2", [
            `Execution error: ${message}`,
            `Executed SQL: ${spec.sqlText ?? "No SQL captured."}`,
          ]);
          connectionRuns.push(run);
          const alert = buildAlert(run, spec.ruleSuffix.replace(/-/g, " "));
          if (alert) connectionAlerts.push(alert);
        }
      }
    } finally {
      if (sfConnection) {
        await destroySnowflakeConnection(sfConnection);
      }
    }

    nextCache.byConnection[snapshot.connectionId] = {
      signature,
      runs: connectionRuns,
      alerts: connectionAlerts,
    };

    runs.push(...connectionRuns);
    alerts.push(...connectionAlerts);
  }

  writeStore(CACHE_FILE, nextCache);
  return { runs, alerts };
}

export function getCachedLiveSnowflakeOverrides(
  snapshots: AdapterSnapshot[]
): { runs: QualityRun[]; alerts: QualityAlert[] } {
  const cache = readStore<SnowflakeLiveCache>(CACHE_FILE, emptyCache);
  const now = Date.now();
  const runs: QualityRun[] = [];
  const alerts: QualityAlert[] = [];

  for (const snapshot of snapshots) {
    const cached = cache.byConnection[snapshot.connectionId];
    const isFresh =
      cached &&
      cached.signature === snapshotSignature(snapshot) &&
      now - new Date(cache.generatedAt).getTime() < CACHE_TTL_MS;

    if (!isFresh) {
      continue;
    }

    runs.push(...cached.runs);
    alerts.push(...cached.alerts);
  }

  return { runs, alerts };
}

export function applyLiveOverrides(
  bundle: SystemQualityBundle,
  overrides: { runs: QualityRun[]; alerts: QualityAlert[] }
): SystemQualityBundle {
  const overrideIds = new Set(overrides.runs.map((run) => run.ruleId));
  const mergedRuns = [
    ...bundle.runs.filter((run) => !overrideIds.has(run.ruleId)),
    ...overrides.runs,
  ];
  const mergedAlerts = [
    ...bundle.alerts.filter((alert) => !overrideIds.has(alert.ruleId)),
    ...overrides.alerts,
  ];

  const statusBreakdown = { pass: 0, warn: 0, fail: 0 };
  const severityBreakdown = { "SEV-1": 0, "SEV-2": 0, "SEV-3": 0, "SEV-4": 0 };

  for (const run of mergedRuns) {
    statusBreakdown[run.status] += 1;
    severityBreakdown[run.severity] += 1;
  }

  return {
    ...bundle,
    runs: mergedRuns,
    alerts: mergedAlerts,
    statusBreakdown,
    severityBreakdown,
  };
}
