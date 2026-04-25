import { getConnectionGuidance } from "@/lib/connectors/connection-guidance";
import { listConnectionSnapshots } from "@/lib/connectors/vault";
import type {
  AdapterSnapshot,
  Citation,
  OverviewSummary,
  QualityAlert,
  QualityRule,
  QualityRun,
  QualitySeverity,
} from "@/lib/product/types";

export type SystemQualityBundle = {
  rules: QualityRule[];
  runs: QualityRun[];
  alerts: QualityAlert[];
  statusBreakdown: {
    pass: number;
    warn: number;
    fail: number;
  };
  severityBreakdown: Record<QualitySeverity, number>;
};

function makeCitation(documentId: string, title: string, excerpt: string): Citation {
  return {
    documentId,
    title,
    excerpt,
    score: 1,
  };
}

function minutesSince(timestamp?: string) {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  const value = new Date(timestamp).getTime();
  if (Number.isNaN(value)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round((Date.now() - value) / 60000));
}

function runStatusToSeverity(status: QualityRun["status"]): QualitySeverity {
  if (status === "fail") return "SEV-2";
  if (status === "warn") return "SEV-3";
  return "SEV-4";
}

function healthToRunStatus(snapshot: AdapterSnapshot): QualityRun["status"] {
  if (snapshot.health === "error") return "fail";
  if (snapshot.health === "warning" || snapshot.health === "unknown") return "warn";
  return "pass";
}

function validationToRunStatus(snapshot: AdapterSnapshot): QualityRun["status"] {
  const status = snapshot.diagnostics.lastValidationStatus ?? "unknown";
  if (status === "fail") return "fail";
  if (status === "warn" || status === "unknown") return "warn";
  return "pass";
}

function freshnessToRunStatus(snapshot: AdapterSnapshot): QualityRun["status"] {
  const ageMinutes = minutesSince(snapshot.metadataSyncedAt);
  if (ageMinutes > 720) return "fail";
  if (ageMinutes > 180) return "warn";
  return "pass";
}

function createRule(
  snapshot: AdapterSnapshot,
  suffix: string,
  title: string,
  description: string,
  severity: QualitySeverity,
  citations: Citation[],
  generatedDsl: Record<string, unknown>,
  evidence: string[]
): QualityRule {
  const timestamp = snapshot.metadataSyncedAt ?? new Date().toISOString();
  return {
    ruleId: `system-${snapshot.connectionId}-${suffix}`,
    title,
    description,
    tool: snapshot.tool,
    targetScope: snapshot.connectionId,
    severity,
    status: "approved",
    conditions: [{ metric: "custom", operator: "contains", threshold: suffix }],
    generatedDsl,
    draft: {
      assumptions: [
        "This system rule is generated from adapter snapshots and official metadata surfaces.",
        "The rule remains read-only and should be refined when live connector execution is available.",
      ],
      evidence,
      generatedSql: typeof generatedDsl.commandPreview === "string" ? generatedDsl.commandPreview : undefined,
    },
    citations,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createRun(
  snapshot: AdapterSnapshot,
  ruleId: string,
  status: QualityRun["status"],
  severity: QualitySeverity,
  evidence: string[],
  citations: Citation[]
): QualityRun {
  return {
    runId: `system-run-${ruleId}`,
    ruleId,
    status,
    severity,
    triggerSource: "schedule",
    adapterId: snapshot.adapterId,
    evidence,
    citations,
    executedAt: snapshot.metadataSyncedAt ?? new Date().toISOString(),
  };
}

function maybeCreateAlert(run: QualityRun, title: string, detail: string): QualityAlert | null {
  if (run.status === "pass") return null;
  return {
    alertId: `system-alert-${run.ruleId}`,
    ruleId: run.ruleId,
    title,
    severity: run.severity,
    status: "open",
    detail,
    createdAt: run.executedAt,
  };
}

function buildBaseChecks(snapshot: AdapterSnapshot) {
  const guidance = getConnectionGuidance(snapshot.tool, snapshot.family);
  const citations = guidance.docsUrl
    ? [
        makeCitation(
          guidance.docsUrl,
          `${snapshot.tool} setup`,
          "Connection and inspection guidance used to shape the system test."
        ),
      ]
    : [];

  const healthRule = createRule(
    snapshot,
    "adapter-health",
    `${snapshot.tool} adapter health`,
    "Checks the latest adapter test result and connection health state.",
    runStatusToSeverity(healthToRunStatus(snapshot)),
    citations,
    {
      type: "system_check",
      check: "adapter_health",
      basis: "last_test_result",
      expected: "healthy",
    },
    [
      snapshot.lastTestResult?.summary ?? "No adapter test result recorded yet.",
      `Adapter health: ${snapshot.health}`,
    ]
  );

  const freshnessMinutes = minutesSince(snapshot.metadataSyncedAt);
  const freshnessRule = createRule(
    snapshot,
    "snapshot-freshness",
    `${snapshot.tool} inspection freshness`,
    "Checks how recent the latest adapter inspection snapshot is.",
    runStatusToSeverity(freshnessToRunStatus(snapshot)),
    citations,
    {
      type: "system_check",
      check: "snapshot_freshness",
      thresholdMinutes: 180,
      failAfterMinutes: 720,
    },
    [
      `Latest snapshot age: ${Number.isFinite(freshnessMinutes) ? freshnessMinutes : "unknown"} minutes`,
      `Metadata sync time: ${snapshot.metadataSyncedAt ?? "unknown"}`,
    ]
  );

  const validationRule = createRule(
    snapshot,
    "latest-validation",
    `${snapshot.tool} latest validation status`,
    "Checks the latest validation outcome exposed by the adapter snapshot.",
    runStatusToSeverity(validationToRunStatus(snapshot)),
    citations,
    {
      type: "system_check",
      check: "latest_validation",
      basis: "snapshot.diagnostics.lastValidationStatus",
    },
    [
      `Latest validation status: ${snapshot.diagnostics.lastValidationStatus ?? "unknown"}`,
      `Row count signal: ${snapshot.diagnostics.rowCount ?? "unknown"}`,
      `Null-rate signal: ${snapshot.diagnostics.nullRate ?? "unknown"}`,
    ]
  );

  return [healthRule, freshnessRule, validationRule];
}

function buildSnowflakeChecks(snapshot: AdapterSnapshot) {
  const queryCitation = makeCitation(
    "https://docs.snowflake.com/en/sql-reference/account-usage/query_history",
    "Snowflake QUERY_HISTORY view",
    "QUERY_HISTORY in ACCOUNT_USAGE exposes up to 365 days of query activity."
  );
  const taskCitation = makeCitation(
    "https://docs.snowflake.com/en/sql-reference/functions/task_history",
    "Snowflake TASK_HISTORY function",
    "TASK_HISTORY can query recent task executions, including failed runs."
  );
  const copyCitation = makeCitation(
    "https://docs.snowflake.com/en/sql-reference/functions/copy_history",
    "Snowflake COPY_HISTORY function",
    "COPY_HISTORY exposes recent COPY INTO and Snowpipe load activity."
  );
  const warehouseCitation = makeCitation(
    "https://docs.snowflake.com/en/sql-reference/account-usage/warehouse_load_history",
    "Snowflake WAREHOUSE_LOAD_HISTORY view",
    "WAREHOUSE_LOAD_HISTORY helps diagnose queued, overloaded, or under-sized warehouse behavior."
  );
  const tableCitation = makeCitation(
    "https://docs.snowflake.com/en/sql-reference/account-usage/table_storage_metrics",
    "Snowflake TABLE_STORAGE_METRICS view",
    "Table storage and growth metrics can help catch unexpected volume changes."
  );
  const loginCitation = makeCitation(
    "https://docs.snowflake.com/en/sql-reference/account-usage/login_history",
    "Snowflake LOGIN_HISTORY view",
    "LOGIN_HISTORY can help diagnose auth and principal issues affecting automation."
  );

  return [
    createRule(
      snapshot,
      "snowflake-query-history",
      "Snowflake failed query check",
      "Uses query history to look for recent warehouse failures and long-running queries.",
      "SEV-2",
      [queryCitation],
      {
        type: "system_check",
        check: "query_history_failures",
        commandPreview:
          "SELECT query_id, warehouse_name, execution_status, error_message, total_elapsed_time FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE start_time >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND execution_status <> 'SUCCESS';",
      },
      [
        "Best-practice basis: inspect failed and long-running queries from ACCOUNT_USAGE.QUERY_HISTORY.",
      ]
    ),
    createRule(
      snapshot,
      "snowflake-task-history",
      "Snowflake task failure check",
      "Uses task history to detect failed or cancelled scheduled tasks.",
      "SEV-2",
      [taskCitation],
      {
        type: "system_check",
        check: "task_history_failures",
        commandPreview:
          "SELECT * FROM TABLE(SNOWFLAKE.INFORMATION_SCHEMA.TASK_HISTORY(SCHEDULED_TIME_RANGE_START => DATEADD('hour', -24, CURRENT_TIMESTAMP()), RESULT_LIMIT => 100, ERROR_ONLY => TRUE));",
      },
      [
        "Best-practice basis: inspect failed task runs directly from INFORMATION_SCHEMA.TASK_HISTORY.",
      ]
    ),
    createRule(
      snapshot,
      "snowflake-copy-history",
      "Snowflake load history check",
      "Uses copy history to inspect recent Snowpipe or COPY INTO load failures and gaps.",
      "SEV-3",
      [copyCitation],
      {
        type: "system_check",
        check: "copy_history_failures",
        commandPreview:
          "SELECT * FROM TABLE(INFORMATION_SCHEMA.COPY_HISTORY(TABLE_NAME => '<db>.<schema>.<table>', START_TIME => DATEADD('hour', -24, CURRENT_TIMESTAMP())));",
      },
      [
        "Best-practice basis: inspect COPY_HISTORY for recent load failures and ingestion freshness gaps.",
      ]
    ),
    createRule(
      snapshot,
      "snowflake-warehouse-load-check",
      "Snowflake warehouse load pressure check",
      "Uses warehouse load history to detect queueing and concurrency pressure that can delay transforms and dashboards.",
      "SEV-3",
      [warehouseCitation],
      {
        type: "system_check",
        check: "warehouse_load_pressure",
        commandPreview:
          "SELECT * FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_LOAD_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP());",
      },
      [
        "Best-practice basis: queueing and overload can produce stale downstream assets even when queries technically succeed.",
      ]
    ),
    createRule(
      snapshot,
      "snowflake-long-running-query-check",
      "Snowflake long-running query concentration check",
      "Looks for repeated long-running queries by warehouse, user, and query family.",
      "SEV-3",
      [queryCitation],
      {
        type: "system_check",
        check: "long_running_queries",
        commandPreview:
          "SELECT warehouse_name, user_name, COUNT(*) AS slow_queries, AVG(total_elapsed_time) AS avg_elapsed_ms FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE start_time >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) GROUP BY 1,2 HAVING AVG(total_elapsed_time) > 60000;",
      },
      [
        "Best-practice basis: repeated slow query families often explain freshness misses without explicit failures.",
      ]
    ),
    createRule(
      snapshot,
      "snowflake-error-family-check",
      "Snowflake error family clustering check",
      "Groups recent failed queries by error family to isolate systemic failures from one-off query issues.",
      "SEV-2",
      [queryCitation],
      {
        type: "system_check",
        check: "error_family_cluster",
        commandPreview:
          "SELECT error_code, COUNT(*) AS failures FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE start_time >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND execution_status <> 'SUCCESS' GROUP BY 1 ORDER BY 2 DESC;",
      },
      [
        "Best-practice basis: clustered error families are a stronger signal than isolated failures.",
      ]
    ),
    createRule(
      snapshot,
      "snowflake-role-auth-check",
      "Snowflake login and principal failure check",
      "Uses login history to identify auth failures, expired credentials, or role issues affecting scheduled automation.",
      "SEV-2",
      [loginCitation],
      {
        type: "system_check",
        check: "login_failure_cluster",
        commandPreview:
          "SELECT user_name, is_success, error_message, event_timestamp FROM SNOWFLAKE.ACCOUNT_USAGE.LOGIN_HISTORY WHERE event_timestamp >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) ORDER BY event_timestamp DESC;",
      },
      [
        "Best-practice basis: broken automation credentials can masquerade as ingestion or transformation failure.",
      ]
    ),
    createRule(
      snapshot,
      "snowflake-stream-lag-check",
      "Snowflake stream and task lag check",
      "Checks whether streams have accumulated change data while downstream tasks are not consuming it.",
      "SEV-3",
      [taskCitation],
      {
        type: "system_check",
        check: "stream_task_lag",
        commandPreview:
          "SHOW STREAMS IN DATABASE <database>; SHOW TASKS IN DATABASE <database>;",
      },
      [
        "Best-practice basis: growing stream backlog with idle tasks points to downstream transform lag.",
      ]
    ),
    createRule(
      snapshot,
      "snowflake-stage-file-gap-check",
      "Snowflake stage file arrival gap check",
      "Checks whether stage-backed ingestion appears quiet before concluding the warehouse is the problem.",
      "SEV-3",
      [copyCitation],
      {
        type: "system_check",
        check: "stage_arrival_gap",
        commandPreview:
          "LIST @<stage>; compare recent file arrival timestamps to COPY_HISTORY load times.",
      },
      [
        "Best-practice basis: silent upstream storage can look like warehouse freshness failure.",
      ]
    ),
    createRule(
      snapshot,
      "snowflake-load-to-query-gap-check",
      "Snowflake load-to-consumption delay check",
      "Measures the gap between successful loads and downstream query or task activity.",
      "SEV-3",
      [copyCitation, queryCitation],
      {
        type: "system_check",
        check: "load_to_consumption_gap",
        commandPreview:
          "Compare latest COPY_HISTORY success timestamps with downstream TASK_HISTORY and QUERY_HISTORY activity.",
      },
      [
        "Best-practice basis: a healthy load followed by no downstream consumption often indicates orchestration or semantic-layer issues.",
      ]
    ),
    createRule(
      snapshot,
      "snowflake-row-volume-shift-check",
      "Snowflake volume anomaly check",
      "Looks for suspicious row-count or storage shifts that may indicate truncation, duplication, or partial loads.",
      "SEV-3",
      [tableCitation],
      {
        type: "system_check",
        check: "volume_shift",
        commandPreview:
          "SELECT * FROM SNOWFLAKE.ACCOUNT_USAGE.TABLE_STORAGE_METRICS WHERE TABLE_SCHEMA = '<schema>' ORDER BY ACTIVE_BYTES DESC;",
      },
      [
        "Best-practice basis: severe volume shifts often explain downstream quality symptoms before explicit failures appear.",
      ]
    ),
    createRule(
      snapshot,
      "snowflake-warehouse-resume-check",
      "Snowflake warehouse availability window check",
      "Checks whether warehouse suspend/resume behavior aligns with scheduled data windows.",
      "SEV-4",
      [warehouseCitation],
      {
        type: "system_check",
        check: "warehouse_window_mismatch",
        commandPreview:
          "Review warehouse load and query activity during expected processing windows.",
      },
      [
        "Best-practice basis: warehouse sleep windows can quietly miss expected processing time.",
      ]
    ),
    createRule(
      snapshot,
      "snowflake-top-failing-user-check",
      "Snowflake failing principal concentration check",
      "Looks for one service principal or role causing most recent query or task failures.",
      "SEV-2",
      [queryCitation, loginCitation],
      {
        type: "system_check",
        check: "failing_principal_concentration",
        commandPreview:
          "SELECT user_name, COUNT(*) AS failed_queries FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE start_time >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND execution_status <> 'SUCCESS' GROUP BY 1 ORDER BY 2 DESC;",
      },
      [
        "Best-practice basis: concentrated failure by one principal often points to role drift, expired credentials, or ownership changes.",
      ]
    ),
    createRule(
      snapshot,
      "snowflake-recent-object-change-check",
      "Snowflake recent object change check",
      "Checks whether recent DDL or object changes preceded the observed quality or freshness issue.",
      "SEV-3",
      [queryCitation],
      {
        type: "system_check",
        check: "recent_object_change",
        commandPreview:
          "Inspect recent DDL statements from QUERY_HISTORY for schemas, tables, views, tasks, and pipes.",
      },
      [
        "Best-practice basis: recent DDL is a high-signal explanation for sudden failures or stale dashboards.",
      ]
    ),
    createRule(
      snapshot,
      "snowflake-failed-copy-target-check",
      "Snowflake failed load target concentration check",
      "Checks whether COPY failures cluster on the same table or stage target.",
      "SEV-3",
      [copyCitation],
      {
        type: "system_check",
        check: "copy_target_concentration",
        commandPreview:
          "Group COPY_HISTORY failures by target table and stage path over the last 24 hours.",
      },
      [
        "Best-practice basis: clustered load target failures usually reveal the specific broken branch in the pipeline.",
      ]
    ),
    createRule(
      snapshot,
      "snowflake-cross-surface-root-cause-check",
      "Snowflake cross-surface root-cause disambiguation check",
      "Cross-checks query, task, and copy history to decide whether the primary issue is ingestion, transform, or warehouse execution.",
      "SEV-2",
      [queryCitation, taskCitation, copyCitation],
      {
        type: "system_check",
        check: "cross_surface_root_cause",
        commandPreview:
          "Compare failures and gaps across QUERY_HISTORY, TASK_HISTORY, and COPY_HISTORY for the same time window.",
      },
      [
        "Best-practice basis: the strongest Snowflake diagnosis comes from cross-surface comparison, not one table in isolation.",
      ]
    ),
    createRule(
      snapshot,
      "snowflake-freshness-sla-check",
      "Snowflake freshness SLA breach check",
      "Checks whether the latest successful load and transform completion times exceed the expected freshness window.",
      "SEV-2",
      [copyCitation, taskCitation],
      {
        type: "system_check",
        check: "freshness_sla_breach",
        commandPreview:
          "Compare latest successful COPY_HISTORY and TASK_HISTORY timestamps with the expected dashboard freshness SLA.",
      },
      [
        "Best-practice basis: use concrete end-to-end freshness windows instead of isolated success signals.",
      ]
    ),
  ];
}

function buildAirflowChecks(snapshot: AdapterSnapshot) {
  return [
    createRule(
      snapshot,
      "airflow-dag-failure-check",
      "Airflow DAG failure and retry check",
      "Inspects recent DAG runs, failed task instances, and retries to isolate scheduler vs task-level failure.",
      "SEV-2",
      [makeCitation("https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dag-run.html", "Airflow DAG runs", "DAG run status and task state drive orchestration diagnosis.")],
      {
        type: "system_check",
        check: "dag_run_failures",
        commandPreview: "GET /api/v1/dags/{dag_id}/dagRuns and /api/v1/dags/{dag_id}/dagRuns/{dag_run_id}/taskInstances",
      },
      [
        "Best-practice basis: separate DAG-level state from repeated task retries and long-tail task failures.",
      ]
    ),
    createRule(
      snapshot,
      "airflow-connection-ref-check",
      "Airflow adjacent system reference check",
      "Inspects operator and connection references to identify the most likely downstream or upstream dependency for a failure.",
      "SEV-3",
      [makeCitation("https://airflow.apache.org/docs/apache-airflow/stable/security/api.html", "Airflow public API", "The public API exposes orchestration metadata for DAGs and tasks.")],
      {
        type: "system_check",
        check: "connection_reference_drift",
        commandPreview: "GET /api/v1/dags and inspect task operator metadata plus connection ids",
      },
      [
        "Best-practice basis: use connection references to disambiguate whether the real issue sits in Snowflake, dbt, or an external source.",
      ]
    ),
  ];
}

function buildFivetranChecks(snapshot: AdapterSnapshot) {
  return [
    createRule(
      snapshot,
      "fivetran-sync-failure-check",
      "Fivetran sync failure and lag check",
      "Inspects connector sync state, recent failures, and lag to distinguish extraction issues from destination apply issues.",
      "SEV-2",
      [makeCitation("https://fivetran.com/docs/rest-api/getting-started", "Fivetran REST API", "Connector and destination endpoints expose sync and destination status.")],
      {
        type: "system_check",
        check: "sync_failure_and_lag",
        commandPreview: "GET /v1/connectors and GET /v1/destinations",
      },
      [
        "Best-practice basis: separate source extraction problems from destination-side failures before escalating warehouse freshness issues.",
      ]
    ),
    createRule(
      snapshot,
      "fivetran-schema-drift-check",
      "Fivetran schema change and load gap check",
      "Looks for schema drift or sync gaps that can quietly break downstream models without hard failures.",
      "SEV-3",
      [makeCitation("https://fivetran.com/docs/rest-api/getting-started", "Fivetran REST API", "Schema and connector metadata are available through the REST API.")],
      {
        type: "system_check",
        check: "schema_drift_and_gap",
        commandPreview: "GET /v1/connectors/{id}/schemas and compare sync timestamps",
      },
      [
        "Best-practice basis: stale dashboards often follow quiet sync gaps or schema changes rather than full connector outages.",
      ]
    ),
  ];
}

function buildKafkaChecks(snapshot: AdapterSnapshot) {
  return [
    createRule(
      snapshot,
      "kafka-consumer-lag-check",
      "Kafka consumer lag concentration check",
      "Checks whether stale downstream state is driven by consumer lag concentration rather than producer silence.",
      "SEV-2",
      [makeCitation("https://kafka.apache.org/documentation/", "Apache Kafka documentation", "Consumer groups, offsets, and lag are core Kafka health signals.")],
      {
        type: "system_check",
        check: "consumer_lag_concentration",
        commandPreview: "LIST CONSUMER GROUPS and inspect lag by topic partition",
      },
      [
        "Best-practice basis: separate producer inactivity from consumer backlog before blaming downstream tools.",
      ]
    ),
    createRule(
      snapshot,
      "kafka-topic-silence-check",
      "Kafka topic silence versus connector failure check",
      "Looks for low producer activity together with connector or consumer failures to identify the true fault domain.",
      "SEV-3",
      [makeCitation("https://kafka.apache.org/documentation/", "Apache Kafka documentation", "Topic, producer, and consumer state should be read together for streaming diagnosis.")],
      {
        type: "system_check",
        check: "topic_silence_vs_failure",
        commandPreview: "Inspect topic offsets over time alongside connector or consumer-group health",
      },
      [
        "Best-practice basis: stale downstream assets can come from silent producers, not just broken consumers.",
      ]
    ),
  ];
}

function buildLookerChecks(snapshot: AdapterSnapshot) {
  const dashboardCitation = makeCitation(
    "https://cloud.google.com/looker/docs/reference/looker-api/latest/methods/Dashboard/all_dashboards",
    "Looker dashboards API",
    "Dashboard metadata and dashboard search endpoints are useful for downstream impact assessment."
  );
  const contentValidationCitation = makeCitation(
    "https://cloud.google.com/looker/docs/reference/looker-api/latest/methods/Content/content_validation",
    "Looker content validation API",
    "Content validation helps catch broken fields, explores, models, and dashboard elements before users report failures."
  );
  const scheduledPlanCitation = makeCitation(
    "https://cloud.google.com/looker/docs/reference/looker-api/latest/methods/ScheduledPlan/all_scheduled_plans",
    "Looker scheduled plans API",
    "Scheduled plans expose dashboard delivery and schedule metadata that can reveal stale or failing distribution flows."
  );
  const folderCitation = makeCitation(
    "https://cloud.google.com/looker/docs/reference/looker-api/latest/methods/Folder/all_folders",
    "Looker folders API",
    "Folder metadata can help isolate ownership, access drift, and content organization issues."
  );
  const queryCitation = makeCitation(
    "https://cloud.google.com/looker/docs/reference/looker-api/latest/methods/Query/all_running_queries",
    "Looker queries API",
    "Query metadata helps isolate repeated BI-layer failures and long-running dashboard requests."
  );
  const lookmlCitation = makeCitation(
    "https://cloud.google.com/looker/docs/reference/looker-api/latest/methods/LookmlModel/lookml_model_explore",
    "Looker LookML explore API",
    "LookML model and explore metadata are useful for tracking field drift and semantic-layer mismatches."
  );

  return [
    createRule(
      snapshot,
      "looker-dashboard-staleness-check",
      "Looker dashboard freshness mismatch check",
      "Compares dashboard complaints with upstream model freshness to avoid treating BI symptoms as the root cause.",
      "SEV-3",
      [dashboardCitation],
      {
        type: "system_check",
        check: "dashboard_freshness_mismatch",
        commandPreview:
          "GET /api/4.0/dashboards/search and compare dashboard refresh expectations with upstream warehouse/model windows.",
      },
      [
        "Best-practice basis: separate dashboard symptoms from upstream transformation or warehouse freshness issues.",
      ]
    ),
    createRule(
      snapshot,
      "looker-content-validation-check",
      "Looker content validation failure check",
      "Uses content validation to identify broken dashboard elements, fields, explores, and models before blaming data freshness alone.",
      "SEV-2",
      [contentValidationCitation],
      {
        type: "system_check",
        check: "content_validation_failures",
        commandPreview: "GET /api/4.0/content_validation",
      },
      [
        "Best-practice basis: broken content validation is a high-signal semantic-layer issue and should be separated from warehouse health.",
      ]
    ),
    createRule(
      snapshot,
      "looker-query-error-check",
      "Looker query error concentration check",
      "Checks whether repeated dashboard issues come from repeated query errors on the same explores or models.",
      "SEV-3",
      [queryCitation],
      {
        type: "system_check",
        check: "query_error_concentration",
        commandPreview:
          "Inspect recent query failures and long-running queries by model, explore, and dashboard via query task and query metadata.",
      },
      [
        "Best-practice basis: repeated BI query errors are a different class of issue from stale but healthy upstream data.",
      ]
    ),
    createRule(
      snapshot,
      "looker-scheduled-plan-health-check",
      "Looker scheduled delivery health check",
      "Checks whether scheduled plans are failing, disabled, or drifting from the expected dashboard delivery cadence.",
      "SEV-3",
      [scheduledPlanCitation],
      {
        type: "system_check",
        check: "scheduled_plan_health",
        commandPreview: "GET /api/4.0/scheduled_plans and inspect failures, paused plans, and delivery targets.",
      },
      [
        "Best-practice basis: stale executive reports often come from failing or paused deliveries rather than dashboard-query defects.",
      ]
    ),
    createRule(
      snapshot,
      "looker-folder-access-drift-check",
      "Looker folder ownership and access drift check",
      "Inspects folders and ownership metadata to catch moved content, orphaned assets, or permission drift affecting visibility.",
      "SEV-3",
      [folderCitation],
      {
        type: "system_check",
        check: "folder_access_drift",
        commandPreview: "GET /api/4.0/folders and compare folder ownership, sharing, and access paths for impacted dashboards.",
      },
      [
        "Best-practice basis: dashboard breakage can be caused by content moves or permission drift, not only SQL or freshness problems.",
      ]
    ),
    createRule(
      snapshot,
      "looker-explore-drift-check",
      "Looker model and explore drift check",
      "Checks whether explores or LookML model definitions changed in a way that could break dashboard fields or joins.",
      "SEV-2",
      [lookmlCitation, contentValidationCitation],
      {
        type: "system_check",
        check: "lookml_explore_drift",
        commandPreview:
          "Inspect LookML model and explore metadata, then compare with content validation failures for affected dashboards.",
      },
      [
        "Best-practice basis: semantic-layer drift is often the real root cause when only certain dashboards or explores fail.",
      ]
    ),
    createRule(
      snapshot,
      "looker-runtime-outlier-check",
      "Looker dashboard runtime outlier check",
      "Looks for dashboards or explores with repeated long-running queries that can create timeouts, queueing, and perceived staleness.",
      "SEV-3",
      [queryCitation],
      {
        type: "system_check",
        check: "runtime_outliers",
        commandPreview:
          "Group recent Looker query runtimes by dashboard, look, model, and explore to isolate persistent slow paths.",
      },
      [
        "Best-practice basis: runtime outliers can surface as flaky BI failures even when the warehouse is mostly healthy.",
      ]
    ),
    createRule(
      snapshot,
      "looker-downstream-red-herring-check",
      "Looker upstream-vs-BI red herring check",
      "Cross-checks dashboard issues against upstream freshness and semantic validation to decide whether the BI symptom is primary or secondary.",
      "SEV-2",
      [dashboardCitation, contentValidationCitation, queryCitation],
      {
        type: "system_check",
        check: "upstream_vs_bi_red_herring",
        commandPreview:
          "Compare impacted dashboards, query failures, content validation results, and upstream warehouse freshness in the same incident window.",
      },
      [
        "Best-practice basis: many BI incidents are red herrings for upstream freshness or semantic-layer drift, and this check is meant to separate them.",
      ]
    ),

    // ── LLM-generated extended checks ────────────────────────────────────────

    createRule(
      snapshot,
      "looker-pdt-build-failure-check",
      "Looker PDT build failure and timeout check",
      "Persistent Derived Tables that fail to build silently serve stale cached results or break dependent tiles. This check inspects PDT build status, timeout events, and rebuild queues.",
      "SEV-2",
      [
        makeCitation(
          "https://cloud.google.com/looker/docs/derived-tables#persistent_derived_tables",
          "Looker PDT documentation",
          "PDTs are materialized queries rebuilt on a schedule or trigger. Failures leave stale cached versions in place with no user-facing error."
        ),
        queryCitation,
      ],
      {
        type: "system_check",
        check: "pdt_build_failures",
        commandPreview:
          "GET /api/4.0/derived_table/graph/model/{model} and GET /api/4.0/derived_table/{model}/{view}/start — look for build_status: error or timeout, and compare last_build_at with expected datagroup trigger cadence.",
      },
      [
        "PDT build failures serve stale data silently — the tile renders but uses the last successfully built version.",
        "Timeout failures on large PDTs can look like warehouse slowness when the root cause is a missing cluster key or an unbounded scan.",
        "Datagroup-triggered PDTs that miss their trigger window go stale without raising an explicit alert.",
        "Best-practice basis: always check PDT build history before concluding a tile is showing wrong data due to upstream issues.",
      ]
    ),

    createRule(
      snapshot,
      "looker-datagroup-trigger-drift-check",
      "Looker datagroup trigger lag and miss check",
      "Datagroups control when PDTs and cached explores are invalidated. A lagging or silent datagroup means users see stale explores even after the warehouse has been updated.",
      "SEV-3",
      [
        makeCitation(
          "https://cloud.google.com/looker/docs/caching-and-datagroups",
          "Looker caching and datagroups",
          "Datagroups define cache invalidation rules. A missed trigger means explores serve cached results past their intended freshness window."
        ),
        lookmlCitation,
      ],
      {
        type: "system_check",
        check: "datagroup_trigger_lag",
        commandPreview:
          "GET /api/4.0/datagroups and inspect triggered_at, stale_before, and next_regeneration_at for all datagroups. Flag any where triggered_at is older than 2× the expected interval.",
      },
      [
        "Datagroup triggers that depend on warehouse SQL queries can silently stop firing if the underlying table or schema changes.",
        "A missed datagroup trigger means PDTs and cached results stay valid past their intended window — users see numbers that look right but are hours old.",
        "Best-practice basis: datagroup lag is a common hidden cause of 'my dashboard updated but the numbers are still wrong' incidents.",
      ]
    ),

    createRule(
      snapshot,
      "looker-user-attribute-filter-leak-check",
      "Looker user attribute and row-level security drift check",
      "User attributes drive row-level security filters on explores. Drift in user attribute assignments or LookML access filter definitions can cause data leakage or broken queries for specific user groups.",
      "SEV-1",
      [
        makeCitation(
          "https://cloud.google.com/looker/docs/user-attributes",
          "Looker user attributes",
          "User attributes power row-level security and personalised filters. Misconfigured attributes can expose data across user groups."
        ),
        lookmlCitation,
      ],
      {
        type: "system_check",
        check: "user_attribute_rls_drift",
        commandPreview:
          "GET /api/4.0/user_attributes and GET /api/4.0/user_attribute_group_values — compare access_filter definitions in LookML explores with current user attribute assignments. Flag explores with access_filter referencing attributes that have empty or default values for any group.",
      },
      [
        "User attributes with empty or default values bypass access filters, potentially exposing rows across user groups.",
        "LookML explore access_filter drift — adding or renaming a user attribute without updating the explore — silently disables row-level security.",
        "This is a SEV-1 data governance issue: wrong data exposure is worse than no data.",
        "Best-practice basis: validate user attribute assignments against access_filter references after every LookML deploy or user provisioning change.",
      ]
    ),

    createRule(
      snapshot,
      "looker-development-vs-production-drift-check",
      "Looker dev-mode vs production LookML drift check",
      "Explores opened in development mode silently use draft LookML instead of production definitions. Users inadvertently sharing development-mode URLs or embeds can expose in-progress model changes to end users.",
      "SEV-3",
      [
        makeCitation(
          "https://cloud.google.com/looker/docs/lookml-project-git-connection#dev_mode",
          "Looker development mode",
          "Development mode uses a separate LookML branch. Sharing dev-mode links exposes unstable or in-progress model definitions to end users."
        ),
        lookmlCitation,
      ],
      {
        type: "system_check",
        check: "dev_vs_production_drift",
        commandPreview:
          "GET /api/4.0/session and inspect is_dev for active sessions. GET /api/4.0/projects/{project}/git_branches to compare dev branch commits ahead of production.",
      },
      [
        "Development sessions left open by LookML developers share the same Looker instance — a dev-mode explore change is immediately visible to that session.",
        "Git branches significantly ahead of production often indicate undeployed LookML changes that can cause field or join drift once promoted.",
        "Best-practice basis: audit active dev-mode sessions and git branch lag after any reported sudden explore or dashboard breakage.",
      ]
    ),

    createRule(
      snapshot,
      "looker-api-rate-limit-check",
      "Looker API and connection pool exhaustion check",
      "Looker's API rate limits and database connection pool size directly cap concurrent dashboard queries. Exhaustion causes timeout cascades that look like warehouse slowness but are actually a Looker-side bottleneck.",
      "SEV-3",
      [
        makeCitation(
          "https://cloud.google.com/looker/docs/db-config-google-bigquery#connection_pool_size",
          "Looker connection pool sizing",
          "Connection pool exhaustion silently queues dashboard queries, causing timeouts that appear as warehouse slowness."
        ),
        queryCitation,
      ],
      {
        type: "system_check",
        check: "api_and_pool_exhaustion",
        commandPreview:
          "GET /api/4.0/connections and inspect max_connections vs recent concurrent query peaks. GET /api/4.0/running_queries to compare active query count against the connection pool ceiling.",
      },
      [
        "Connection pool exhaustion queues dashboard tiles silently — users see slow loads rather than explicit errors.",
        "API rate-limit errors during scheduled deliveries cause silent plan failures, not explicit error emails.",
        "Best-practice basis: if timeouts correlate with peak usage windows rather than warehouse load, connection pool exhaustion is the likely cause.",
      ]
    ),

    createRule(
      snapshot,
      "looker-look-vs-dashboard-divergence-check",
      "Looker Look vs dashboard tile divergence check",
      "Standalone Looks and dashboard tiles that use the same explore can return different results if the tile has a diverged filter or field set. This is a common source of 'my numbers don't match' incidents.",
      "SEV-3",
      [
        dashboardCitation,
        makeCitation(
          "https://cloud.google.com/looker/docs/reference/looker-api/latest/methods/Look/all_looks",
          "Looker Looks API",
          "Look metadata includes query definitions that can be compared against dashboard tile queries for drift."
        ),
      ],
      {
        type: "system_check",
        check: "look_vs_dashboard_divergence",
        commandPreview:
          "GET /api/4.0/looks and GET /api/4.0/dashboards/{id}/dashboard_elements — compare query_id, filters, and field lists between standalone Looks and their counterpart dashboard tiles.",
      },
      [
        "Dashboard tiles copied from Looks often accumulate filter overrides that are invisible to the tile author.",
        "Diverged tile queries are the most common cause of 'the Look says X but the dashboard says Y' user complaints.",
        "Best-practice basis: reconcile tile query definitions against their source Looks after any dashboard edit or merge.",
      ]
    ),

    createRule(
      snapshot,
      "looker-liquid-template-error-check",
      "Looker Liquid templating and dynamic filter error check",
      "Liquid templating in LookML dimensions, measures, and filters can silently produce invalid SQL when template variables are empty, null, or of an unexpected type.",
      "SEV-2",
      [
        lookmlCitation,
        makeCitation(
          "https://cloud.google.com/looker/docs/liquid-variable-reference",
          "Looker Liquid variable reference",
          "Liquid variables in LookML generate SQL dynamically. Null or missing variable values can produce malformed SQL that fails only at runtime."
        ),
      ],
      {
        type: "system_check",
        check: "liquid_template_errors",
        commandPreview:
          "Run content validation (GET /api/4.0/content_validation) and filter results for SQL errors that contain 'NULL', 'none', or missing clauses in WHERE or JOIN conditions — these are usually Liquid variable resolution failures.",
      },
      [
        "Liquid template errors only surface at query runtime, not during LookML validation or IDE checks.",
        "Empty user attributes used in Liquid SQL templates produce NULL in WHERE clauses, which either returns all rows or zero rows — both silently wrong.",
        "Best-practice basis: any content validation SQL error containing unexpected NULL or empty string values should be inspected for Liquid variable resolution failures first.",
      ]
    ),

    createRule(
      snapshot,
      "looker-system-activity-anomaly-check",
      "Looker system activity query volume anomaly check",
      "Sudden drops or spikes in Looker system activity query counts indicate user-facing outages, overcrowded schedulers, or explore cache invalidation storms that don't surface as explicit errors.",
      "SEV-3",
      [
        makeCitation(
          "https://cloud.google.com/looker/docs/system-activity-explores",
          "Looker system activity explores",
          "System activity explores expose internal query history, user activity, and scheduler logs that are essential for diagnosing non-obvious BI incidents."
        ),
        queryCitation,
      ],
      {
        type: "system_check",
        check: "system_activity_volume_anomaly",
        commandPreview:
          "Query the system activity 'history' explore: SELECT DATE(created_at), COUNT(*) as queries, AVG(runtime) as avg_runtime FROM system_activity.history WHERE created_at >= DATEADD('day', -7, NOW()) GROUP BY 1 ORDER BY 1. Flag days where query count drops >40% or avg_runtime spikes >2×.",
      },
      [
        "A sudden drop in query volume in system activity often indicates a user-facing outage that bypassed error alerting.",
        "Runtime spikes without explicit errors indicate connection pool pressure, PDT rebuild storms, or cache invalidation cascades.",
        "Best-practice basis: treat system activity query volume as a canary metric — anomalies here precede user complaints by 15-30 minutes.",
      ]
    ),

    createRule(
      snapshot,
      "looker-embed-sso-token-expiry-check",
      "Looker embedded SSO token and iframe health check",
      "Embedded Looker dashboards rely on signed SSO tokens that expire. Token expiry or signing key rotation silently breaks embedded analytics for end users without any Looker-side error.",
      "SEV-2",
      [
        makeCitation(
          "https://cloud.google.com/looker/docs/embedded-analytics",
          "Looker embedded analytics",
          "Embedded SSO uses signed tokens with expiry windows. Token or key issues fail silently in iframes — the embed shows blank or a generic error."
        ),
        dashboardCitation,
      ],
      {
        type: "system_check",
        check: "embed_sso_token_health",
        commandPreview:
          "GET /api/4.0/embed/sso_embed_url — test token generation with a known user and inspect expiry. Check embed secret rotation date against last known embed failure window.",
      },
      [
        "SSO token expiry in embedded dashboards produces a blank iframe or a generic 403 — end users report 'dashboard not loading' rather than an auth error.",
        "Embed secret rotation without updating the host application breaks all embedded analytics silently.",
        "Best-practice basis: validate embed token generation after any security key rotation or identity provider change before users report broken embeds.",
      ]
    ),
  ];
}

function buildDbtChecks(snapshot: AdapterSnapshot) {
  const jobsCitation = makeCitation(
    "https://docs.getdbt.com/dbt-cloud/api-v2#/operations/List%20Runs",
    "dbt Cloud Runs API",
    "Run history exposes status, timing, and model-level outcomes for every dbt Cloud job."
  );
  const sourcesCitation = makeCitation(
    "https://docs.getdbt.com/docs/build/sources#source-freshness",
    "dbt source freshness",
    "Source freshness checks validate that upstream tables were recently loaded before models run."
  );
  const manifestCitation = makeCitation(
    "https://docs.getdbt.com/reference/artifacts/manifest-json",
    "dbt manifest.json",
    "The dbt manifest exposes model DAG lineage, column-level metadata, and test definitions."
  );
  const testsCitation = makeCitation(
    "https://docs.getdbt.com/docs/build/data-tests",
    "dbt data tests",
    "dbt tests assert row counts, not-null, uniqueness, and accepted-values constraints on model outputs."
  );

  return [
    createRule(
      snapshot,
      "dbt-job-failure-check",
      "dbt job failure check",
      "Checks recent dbt Cloud job runs for failed, errored, or cancelled executions.",
      "SEV-2",
      [jobsCitation],
      {
        type: "system_check",
        check: "dbt_job_failures",
        commandPreview:
          "GET /api/v2/accounts/{account_id}/runs/?status=20&order_by=-created_at&limit=50 — status 20 = Error, 30 = Cancelled.",
      },
      [
        "Best-practice basis: failed dbt runs propagate stale or missing model outputs to every downstream consumer.",
      ]
    ),
    createRule(
      snapshot,
      "dbt-model-freshness-check",
      "dbt model output freshness check",
      "Checks whether key dbt models (especially revenue_daily) were last refreshed within the expected window.",
      "SEV-2",
      [jobsCitation, sourcesCitation],
      {
        type: "system_check",
        check: "dbt_model_output_freshness",
        commandPreview:
          "GET /api/v2/accounts/{account_id}/runs/?job_id={job_id}&limit=1 and compare finished_at with the expected schedule cadence.",
      },
      [
        "Best-practice basis: a successful dbt job that ran on stale upstream data produces a model that looks fresh but carries corrupt rows.",
        "revenue_daily and other revenue models are high-impact freshness targets.",
      ]
    ),
    createRule(
      snapshot,
      "dbt-source-freshness-check",
      "dbt source freshness failure check",
      "Checks whether dbt source freshness tests passed on the last run, indicating upstream tables were loaded on time.",
      "SEV-2",
      [sourcesCitation],
      {
        type: "system_check",
        check: "dbt_source_freshness",
        commandPreview:
          "GET /api/v2/accounts/{account_id}/runs/{run_id}/artifacts/sources.json and check max_loaded_at vs warn/error thresholds.",
      },
      [
        "Best-practice basis: source freshness failures mean dbt ran successfully on stale data — a silent upstream outage.",
        "If revenue_daily source shows freshness warn/error, downstream row counts will be wrong even if the job passes.",
      ]
    ),
    createRule(
      snapshot,
      "dbt-row-count-anomaly-check",
      "dbt revenue_daily row count anomaly check",
      "Detects when today's revenue_daily model produced significantly fewer rows than yesterday — a signal of a partial upstream write.",
      "SEV-1",
      [jobsCitation, testsCitation],
      {
        type: "system_check",
        check: "dbt_row_count_anomaly",
        commandPreview:
          "SELECT COUNT(*) FROM revenue_daily WHERE date = CURRENT_DATE; compare against previous day — alert if today < 50% of yesterday.",
      },
      [
        "Row count anomaly threshold: today < 50% of yesterday is a SEV-1 signal.",
        "Likely cause: Databricks partial write upstream (e.g. 47 rows written vs ~1000 expected) fed into dbt without source freshness catching it.",
        "Best-practice basis: dbt jobs can succeed end-to-end while operating on incomplete data if source volume checks are absent.",
      ]
    ),
    createRule(
      snapshot,
      "dbt-test-failure-check",
      "dbt data test failure check",
      "Checks the latest dbt test run for not-null, uniqueness, and accepted-values failures that indicate data quality regressions.",
      "SEV-2",
      [testsCitation, manifestCitation],
      {
        type: "system_check",
        check: "dbt_test_failures",
        commandPreview:
          "GET /api/v2/accounts/{account_id}/runs/{run_id}/artifacts/run_results.json and filter for status=fail or status=error.",
      },
      [
        "Best-practice basis: silent dbt test failures can leave broken models in place while the job reports success overall.",
      ]
    ),
    createRule(
      snapshot,
      "dbt-compile-error-check",
      "dbt compile and parse error check",
      "Looks for dbt compile failures or Jinja parse errors that can silently prevent model execution without raising an obvious job error.",
      "SEV-3",
      [jobsCitation, manifestCitation],
      {
        type: "system_check",
        check: "dbt_compile_errors",
        commandPreview:
          "GET /api/v2/accounts/{account_id}/runs/{run_id}/artifacts/run_results.json — check for status=skipped or compile_error in node results.",
      },
      [
        "Best-practice basis: compile failures skip downstream models silently, breaking output freshness without a top-level job failure.",
      ]
    ),
    createRule(
      snapshot,
      "dbt-lineage-gap-check",
      "dbt model lineage gap check",
      "Cross-checks the model DAG to find models whose upstream dependencies failed or were skipped in the last run.",
      "SEV-3",
      [manifestCitation, jobsCitation],
      {
        type: "system_check",
        check: "dbt_lineage_gap",
        commandPreview:
          "Compare manifest.json DAG with run_results.json to find nodes whose parents failed or were skipped.",
      },
      [
        "Best-practice basis: partial DAG failures can pass a job while silently skipping critical downstream models.",
      ]
    ),
    createRule(
      snapshot,
      "dbt-upstream-vs-transform-check",
      "dbt upstream-vs-transform red herring check",
      "Cross-checks whether dbt failures are caused by upstream source problems rather than transform logic, to avoid misattribution.",
      "SEV-2",
      [jobsCitation, sourcesCitation, testsCitation],
      {
        type: "system_check",
        check: "dbt_upstream_vs_transform_red_herring",
        commandPreview:
          "Compare source freshness results, run_results.json failures, and upstream connector sync state in the same incident window.",
      },
      [
        "Best-practice basis: most dbt failures attributed to bad SQL are actually caused by upstream source issues — source freshness is the fastest differentiator.",
      ]
    ),
  ];
}

function buildDatabricksChecks(snapshot: AdapterSnapshot) {
  const jobsCitation = makeCitation(
    "https://docs.databricks.com/api/workspace/jobs",
    "Databricks Jobs API",
    "Jobs and run history are core surfaces for tracking failed runs, schedule drift, and notebook execution issues."
  );
  const clustersCitation = makeCitation(
    "https://docs.databricks.com/api/workspace/clusters",
    "Databricks Clusters API",
    "Cluster state and events help separate compute instability from notebook or data issues."
  );
  const sqlWarehousesCitation = makeCitation(
    "https://docs.databricks.com/api/workspace/warehouses",
    "Databricks SQL Warehouses API",
    "SQL warehouse state is useful for BI-facing issues and endpoint availability checks."
  );
  const workspaceCitation = makeCitation(
    "https://docs.databricks.com/api/workspace/workspace",
    "Databricks Workspace API",
    "Workspace assets and paths are useful when jobs break because notebooks or repos moved."
  );

  return [
    createRule(
      snapshot,
      "databricks-job-failure-check",
      "Databricks job failure concentration check",
      "Checks whether a small set of jobs accounts for repeated recent failures or schedule misses.",
      "SEV-2",
      [jobsCitation],
      {
        type: "system_check",
        check: "job_failure_concentration",
        commandPreview:
          "GET /api/2.1/jobs/runs/list?completed_only=true and group failures by job_id, notebook_task, and pipeline_task.",
      },
      [
        "Best-practice basis: clustered failed jobs are a stronger signal than isolated runtime noise.",
      ]
    ),
    createRule(
      snapshot,
      "databricks-cluster-instability-check",
      "Databricks cluster startup and health check",
      "Checks whether cluster startup failures, long spin-up times, or terminated clusters explain delayed pipelines.",
      "SEV-2",
      [clustersCitation],
      {
        type: "system_check",
        check: "cluster_instability",
        commandPreview:
          "GET /api/2.0/clusters/list and cluster events for recent start failures, terminated states, and restart churn.",
      },
      [
        "Best-practice basis: compute instability often looks like transform failure until cluster state is inspected directly.",
      ]
    ),
    createRule(
      snapshot,
      "databricks-run-output-check",
      "Databricks run-output error check",
      "Inspects recent failed run output to separate notebook, package, path, and auth failures.",
      "SEV-2",
      [jobsCitation],
      {
        type: "system_check",
        check: "run_output_failures",
        commandPreview:
          "GET /api/2.1/jobs/runs/get-output for the latest failed runs and cluster the error messages by notebook path or package.",
      },
      [
        "Best-practice basis: run output is usually the fastest route to the real fault domain for failed notebooks.",
      ]
    ),
    createRule(
      snapshot,
      "databricks-sql-warehouse-check",
      "Databricks SQL warehouse availability check",
      "Checks whether SQL warehouses are stopped, degraded, or queueing requests during BI-facing incidents.",
      "SEV-3",
      [sqlWarehousesCitation],
      {
        type: "system_check",
        check: "sql_warehouse_availability",
        commandPreview:
          "GET /api/2.0/sql/warehouses and inspect state, auto-stop churn, and endpoint availability in the incident window.",
      },
      [
        "Best-practice basis: SQL warehouse instability can look like dashboard or semantic-layer failure downstream.",
      ]
    ),
    createRule(
      snapshot,
      "databricks-workspace-drift-check",
      "Databricks notebook and repo drift check",
      "Checks whether notebook paths, repos, or workspace assets changed in a way that could break scheduled jobs.",
      "SEV-3",
      [workspaceCitation],
      {
        type: "system_check",
        check: "workspace_path_drift",
        commandPreview:
          "GET /api/2.0/workspace/list and /api/2.0/repos to compare notebook paths and repo revisions for impacted jobs.",
      },
      [
        "Best-practice basis: moved notebooks and repo drift are common hidden causes of broken job schedules.",
      ]
    ),
    createRule(
      snapshot,
      "databricks-principal-auth-check",
      "Databricks service principal and auth check",
      "Looks for token, principal, or secret issues affecting jobs, clusters, and SQL endpoints.",
      "SEV-2",
      [jobsCitation, clustersCitation],
      {
        type: "system_check",
        check: "principal_auth_issues",
        commandPreview:
          "Inspect recent failed run output and cluster events for auth, secret-scope, and permission-denied errors.",
      },
      [
        "Best-practice basis: principal or secret issues can masquerade as compute or notebook failure if only the top-level status is reviewed.",
      ]
    ),
    createRule(
      snapshot,
      "databricks-runtime-outlier-check",
      "Databricks runtime outlier check",
      "Groups slow and long-running jobs to isolate persistent compute bottlenecks before blaming downstream tools.",
      "SEV-3",
      [jobsCitation, clustersCitation],
      {
        type: "system_check",
        check: "runtime_outliers",
        commandPreview:
          "Group recent run durations by job_id, task_key, cluster, and notebook path to isolate persistent slow paths.",
      },
      [
        "Best-practice basis: repeated runtime outliers often explain freshness misses without explicit hard failures.",
      ]
    ),
    createRule(
      snapshot,
      "databricks-partial-write-row-anomaly-check",
      "Databricks partial write row count anomaly check",
      "Detects when the source table written by a Databricks job contains far fewer rows than expected — a sign of a spot interruption or partial write.",
      "SEV-1",
      [jobsCitation, clustersCitation],
      {
        type: "system_check",
        check: "databricks_partial_write_anomaly",
        commandPreview:
          "SELECT COUNT(*) FROM <source_table> WHERE date = CURRENT_DATE; compare against expected baseline — alert if today < 50% of yesterday's count (e.g. 47 rows vs ~1000 expected).",
      },
      [
        "Row count anomaly threshold: today < 50% of yesterday is a SEV-1 signal.",
        "Likely cause: Databricks spot instance interruption mid-write — job exits cleanly but only a partial dataset lands.",
        "This partial write silently propagates through dbt transforms into downstream BI (e.g. Looker revenue dashboards show wrong numbers).",
        "Best-practice basis: check row volume immediately after every ETL job, not just job exit status.",
      ]
    ),
    createRule(
      snapshot,
      "databricks-spot-interruption-check",
      "Databricks spot instance interruption signal check",
      "Checks for cluster events and run state patterns that indicate a spot interruption caused a job to terminate with incomplete data written.",
      "SEV-2",
      [clustersCitation, jobsCitation],
      {
        type: "system_check",
        check: "databricks_spot_interruption_signal",
        commandPreview:
          "GET /api/2.0/clusters/events?cluster_id={id} and filter for SPOT_FAILED, DRIVER_NOT_RESPONDING, NODE_BLACKLISTED events in the last 24h.",
      },
      [
        "Best-practice basis: spot interruptions can leave a job in a succeeded or cancelled state while the output table is incomplete.",
        "Correlate cluster termination events with row count drops to confirm partial write.",
      ]
    ),
    createRule(
      snapshot,
      "databricks-upstream-vs-compute-check",
      "Databricks upstream-vs-compute red herring check",
      "Cross-checks failed jobs against upstream freshness and cluster health to decide whether the compute symptom is primary or secondary.",
      "SEV-2",
      [jobsCitation, clustersCitation, sqlWarehousesCitation],
      {
        type: "system_check",
        check: "upstream_vs_compute_red_herring",
        commandPreview:
          "Compare job failures, cluster state, warehouse availability, and upstream data freshness in the same incident window.",
      },
      [
        "Best-practice basis: compute incidents are often secondary to stale or missing upstream inputs, and this check helps separate them.",
      ]
    ),
  ];
}

function buildSupersetChecks(snapshot: AdapterSnapshot) {
  const dashboardCitation = makeCitation(
    "https://superset.apache.org/developer-docs/api/dashboards/",
    "Superset dashboards API",
    "Dashboard metadata is useful for mapping impact and checking whether the issue is dashboard-specific or dataset-wide."
  );
  const datasetCitation = makeCitation(
    "https://superset.apache.org/developer-docs/api/datasets/",
    "Superset datasets API",
    "Dataset metadata and related objects help tie chart issues back to data sources and schema drift."
  );
  const logCitation = makeCitation(
    "https://superset.apache.org/developer-docs/api/log-rest-api/",
    "Superset log REST API",
    "Audit and activity logs help isolate permission failures, chart errors, and user-facing issues."
  );
  const chartCitation = makeCitation(
    "https://superset.apache.org/developer-docs/api/charts/",
    "Superset charts API",
    "Chart metadata is useful when only part of a dashboard is failing or degrading."
  );
  const databaseCitation = makeCitation(
    "https://superset.apache.org/developer-docs/api/databases/",
    "Superset databases API",
    "Database and datasource metadata help catch credential drift and broken upstream connections."
  );

  return [
    createRule(
      snapshot,
      "superset-dashboard-freshness-check",
      "Superset dashboard freshness mismatch check",
      "Checks whether stale dashboard complaints are actually caused by upstream freshness gaps rather than Superset itself.",
      "SEV-3",
      [dashboardCitation, datasetCitation],
      {
        type: "system_check",
        check: "dashboard_freshness_mismatch",
        commandPreview:
          "GET /api/v1/dashboard/ and compare impacted dashboards with dataset recency and upstream warehouse freshness windows.",
      },
      [
        "Best-practice basis: dashboard symptoms are often secondary to upstream freshness or semantic drift.",
      ]
    ),
    createRule(
      snapshot,
      "superset-chart-failure-check",
      "Superset chart failure concentration check",
      "Inspects chart-level failures to isolate whether only a subset of visualizations is broken.",
      "SEV-3",
      [chartCitation, dashboardCitation],
      {
        type: "system_check",
        check: "chart_failure_concentration",
        commandPreview:
          "GET /api/v1/chart/ and map failing charts back to impacted dashboards and datasets.",
      },
      [
        "Best-practice basis: partial dashboard breakage usually points to chart or datasource issues, not a global BI outage.",
      ]
    ),
    createRule(
      snapshot,
      "superset-dataset-drift-check",
      "Superset dataset drift check",
      "Checks dataset metadata for schema drift, related-object blast radius, and stale datasource state.",
      "SEV-2",
      [datasetCitation],
      {
        type: "system_check",
        check: "dataset_drift",
        commandPreview:
          "GET /api/v1/dataset/ and /api/v1/dataset/{id}/related_objects to inspect changed fields and impacted charts.",
      },
      [
        "Best-practice basis: dataset drift can break multiple dashboards while leaving the upstream warehouse technically healthy.",
      ]
    ),
    createRule(
      snapshot,
      "superset-audit-error-check",
      "Superset audit-log error concentration check",
      "Uses audit and recent-activity logs to group permission, datasource, and chart-data failures by pattern.",
      "SEV-2",
      [logCitation],
      {
        type: "system_check",
        check: "audit_error_concentration",
        commandPreview:
          "GET /api/v1/log/ and /api/v1/log/recent_activity/ and cluster recent Superset errors by endpoint, user, and datasource.",
      },
      [
        "Best-practice basis: clustered audit-log errors are a strong signal for BI-layer incidents and permission drift.",
      ]
    ),
    createRule(
      snapshot,
      "superset-database-auth-check",
      "Superset datasource credential check",
      "Checks whether broken datasource or database credentials are the real reason dashboards are failing.",
      "SEV-2",
      [databaseCitation, logCitation],
      {
        type: "system_check",
        check: "datasource_credential_failures",
        commandPreview:
          "GET /api/v1/database/ and correlate datasource metadata with recent credential or connection errors from audit logs.",
      },
      [
        "Best-practice basis: datasource credential failures can masquerade as chart or dashboard bugs to end users.",
      ]
    ),
    createRule(
      snapshot,
      "superset-access-drift-check",
      "Superset permission and ownership drift check",
      "Looks for role, ownership, or access drift that changes who can see dashboards, charts, or datasets.",
      "SEV-3",
      [dashboardCitation, logCitation],
      {
        type: "system_check",
        check: "permission_access_drift",
        commandPreview:
          "Compare recent activity and dashboard ownership/access state for impacted assets in the incident window.",
      },
      [
        "Best-practice basis: access drift can look like dashboard failure when the underlying data path is fine.",
      ]
    ),
    createRule(
      snapshot,
      "superset-runtime-outlier-check",
      "Superset dashboard runtime outlier check",
      "Looks for dashboards and charts with repeated slow query paths, timeouts, or heavy datasource pressure.",
      "SEV-3",
      [dashboardCitation, chartCitation, logCitation],
      {
        type: "system_check",
        check: "runtime_outliers",
        commandPreview:
          "Correlate recent dashboard/chart errors and slow paths with the affected datasets and datasource backends.",
      },
      [
        "Best-practice basis: runtime outliers create flaky BI incidents even when nothing is fully down.",
      ]
    ),
    createRule(
      snapshot,
      "superset-upstream-vs-bi-check",
      "Superset upstream-vs-BI red herring check",
      "Cross-checks dashboard failures against datasource health and upstream freshness to decide whether the Superset symptom is primary or secondary.",
      "SEV-2",
      [dashboardCitation, datasetCitation, databaseCitation, logCitation],
      {
        type: "system_check",
        check: "upstream_vs_bi_red_herring",
        commandPreview:
          "Compare impacted dashboards, dataset drift, datasource connectivity, audit-log errors, and upstream warehouse freshness in the same incident window.",
      },
      [
        "Best-practice basis: many BI incidents are red herrings for upstream freshness, semantic drift, or datasource auth problems.",
      ]
    ),
  ];
}

function buildToolSpecificChecks(snapshot: AdapterSnapshot): QualityRule[] {
  if (snapshot.tool === "Snowflake") {
    return buildSnowflakeChecks(snapshot);
  }
  if (snapshot.tool === "Apache Airflow") {
    return buildAirflowChecks(snapshot);
  }
  if (snapshot.tool === "Fivetran") {
    return buildFivetranChecks(snapshot);
  }
  if (snapshot.tool === "Apache Kafka") {
    return buildKafkaChecks(snapshot);
  }
  if (snapshot.tool === "Looker") {
    return buildLookerChecks(snapshot);
  }
  if (snapshot.tool === "dbt") {
    return buildDbtChecks(snapshot);
  }
  if (snapshot.tool === "Databricks") {
    return buildDatabricksChecks(snapshot);
  }
  if (snapshot.tool === "Apache Superset") {
    return buildSupersetChecks(snapshot);
  }

  return [
    createRule(
      snapshot,
      "surface-availability",
      `${snapshot.tool} metadata surface coverage`,
      "Checks whether the adapter is exposing the expected metadata surfaces for this connector.",
      "SEV-4",
      getConnectionGuidance(snapshot.tool, snapshot.family).docsUrl
        ? [
            makeCitation(
              getConnectionGuidance(snapshot.tool, snapshot.family).docsUrl!,
              `${snapshot.tool} connector guidance`,
              "Tool-specific connection guidance is used to shape metadata inspection."
            ),
          ]
        : [],
      {
        type: "system_check",
        check: "surface_coverage",
        expectedSurfaces: snapshot.surfaces.map((surface) => surface.surface),
      },
      snapshot.surfaces.map((surface) => `${surface.surface}: ${surface.summary}`)
    ),
  ];
}

function buildDiscoveredAuthRequiredChecks(snapshot: AdapterSnapshot): QualityRule[] {
  const authRequiredNodes =
    snapshot.pipeline?.nodes.filter((node) => node.status === "auth_required") ?? [];

  return authRequiredNodes.map((node) => {
    const authCitation = makeCitation(
      snapshot.tool === "Snowflake"
        ? "https://docs.snowflake.com/en/sql-reference/account-usage/query_history"
        : "workspace://pipeline-detection",
      `${snapshot.tool} discovered downstream dependency`,
      `${node.tool} was inferred from upstream metadata and still needs direct authentication before live inspection.`
    );

    const baseRule = createRule(
      snapshot,
      `${node.tool.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-auth-required`,
      `${node.tool} auth setup required`,
      `${node.tool} was discovered from ${snapshot.tool} evidence, but direct read access is still required before dashboard, semantic-layer, or schedule checks can run live.`,
      "SEV-3",
      [authCitation],
      {
        type: "system_check",
        check: "discovered_tool_auth_required",
        discoveredTool: node.tool,
        upstreamTool: snapshot.tool,
        commandPreview:
          node.authHint ??
          `Add ${node.tool} credentials to enable direct inspection and deeper QA coverage.`,
      },
      [
        `${node.tool} is currently discovered but not authenticated.`,
        ...(node.inferredFrom ?? []),
        node.authHint ?? `Connect ${node.tool} to unlock live inspection.`,
      ]
    );

    return {
      ...baseRule,
      tool: node.tool,
      targetScope: snapshot.connectionId,
    };
  });
}

function runRuleAgainstSnapshot(snapshot: AdapterSnapshot, rule: QualityRule): QualityRun {
  let status: QualityRun["status"] = "pass";

  if (rule.ruleId.includes("adapter-health")) {
    status = healthToRunStatus(snapshot);
  } else if (rule.ruleId.includes("snapshot-freshness")) {
    status = freshnessToRunStatus(snapshot);
  } else if (rule.ruleId.includes("latest-validation")) {
    status = validationToRunStatus(snapshot);
  } else if (rule.ruleId.includes("surface-availability")) {
    status = snapshot.surfaces.length ? "pass" : "warn";
  } else if (rule.ruleId.includes("row-count-anomaly") || rule.ruleId.includes("partial-write")) {
    // Row count anomaly checks always surface as warn — live volume validation is required to confirm pass.
    // If the connector is already in error/warning state, escalate to fail.
    status = snapshot.health === "error" ? "fail" : "warn";
  } else if (rule.ruleId.includes("spot-interruption")) {
    status = snapshot.health === "error" ? "fail" : "warn";
  } else if (snapshot.health === "error") {
    status = "fail";
  } else if (snapshot.health === "warning" || snapshot.diagnostics.lastValidationStatus === "warn") {
    status = "warn";
  }

  const severity = status === "pass" ? "SEV-4" : rule.severity;
  return createRun(snapshot, rule.ruleId, status, severity, rule.draft.evidence, rule.citations);
}

function buildCrossConnectorChecks(
  snapshots: AdapterSnapshot[]
): { rule: QualityRule; snapshot: AdapterSnapshot }[] {
  const results: { rule: QualityRule; snapshot: AdapterSnapshot }[] = [];

  const snowflake = snapshots.find((s) => s.tool === "Snowflake");
  const dbt = snapshots.find((s) => s.tool === "dbt");

  if (snowflake && dbt) {
    const snowflakeCitation = makeCitation(
      "https://docs.snowflake.com/en/user-guide/search-optimization-service",
      "Snowflake search optimization and virtual columns",
      "Snowflake search optimization adds internal virtual columns to tables. These can appear twice during a dbt MERGE, causing ambiguous column errors that look like SQL syntax problems."
    );
    const dbtMergeCitation = makeCitation(
      "https://docs.getdbt.com/docs/build/incremental-models#about-incremental_strategy",
      "dbt incremental merge strategy on Snowflake",
      "dbt's Snowflake MERGE strategy generates a SQL MERGE statement that operates on the target table. Virtual columns from search optimization are visible inside this MERGE and can create column name ambiguity."
    );
    const dbtHookCitation = makeCitation(
      "https://docs.getdbt.com/docs/build/hooks-operations",
      "dbt pre-hooks and post-hooks",
      "A pre-hook runs SQL before dbt's own generated statement — the correct place to drop a virtual column before dbt issues its MERGE."
    );

    // Use dbt snapshot as the anchor since that's where the compile error surfaces
    const rule = createRule(
      dbt,
      "snowflake-dbt-virtual-column-merge-ambiguity",
      "Ambiguous column in dbt MERGE — virtual column red herring",
      [
        "SQL compilation error: Ambiguous column name 'USER_ID' fires during a dbt incremental run on Snowflake.",
        "The error points at the SQL syntax — specifically the column reference — making it look like a missing alias in a join.",
        "The real cause: Snowflake search optimization (or a clustering key) created a virtual column with the same name as a model column.",
        "During dbt's internally generated MERGE statement, Snowflake sees the column twice and fails with an ambiguity error.",
        "The fix is not in the SQL — it is a dbt pre-hook that drops the virtual column before the MERGE runs:",
        "{{ config(pre_hook='ALTER TABLE {{ this }} DROP COLUMN IF EXISTS USER_ID') }}",
      ].join(" "),
      "SEV-2",
      [snowflakeCitation, dbtMergeCitation, dbtHookCitation],
      {
        type: "cross_connector_check",
        check: "virtual_column_merge_ambiguity",
        tools: ["Snowflake", "dbt"],
        commandPreview: [
          "-- Step 1: Confirm virtual column exists",
          "SELECT column_name, data_type, 'VIRTUAL' as column_kind",
          "FROM information_schema.columns",
          "WHERE table_name = '<YOUR_TABLE>' AND column_name = 'USER_ID';",
          "",
          "-- Step 2: Fix — add pre-hook to dbt model config",
          "{{ config(",
          "  materialized='incremental',",
          "  incremental_strategy='merge',",
          "  pre_hook='ALTER TABLE {{ this }} DROP COLUMN IF EXISTS USER_ID'",
          ") }}",
        ].join("\n"),
      },
      [
        "Error surface: SQL compilation error: Ambiguous column name 'USER_ID' — appears to be a join alias problem.",
        "Red herring: the UPDATE/MERGE syntax looks correct; developers add and remove aliases without fixing anything.",
        "Root cause: Snowflake search optimization added a virtual USER_ID column that is still present when dbt issues its MERGE, making Snowflake see the column twice.",
        "Fix: pre-hook on the dbt incremental model — ALTER TABLE {{ this }} DROP COLUMN IF EXISTS USER_ID — runs before dbt's generated MERGE.",
        "Cascading effect: every downstream model or dashboard joining on USER_ID from this table will also fail or produce nulls until the pre-hook is in place.",
      ]
    );

    results.push({ rule, snapshot: dbt });
  }

  return results;
}

export function buildSystemQualityBundle(
  snapshots: AdapterSnapshot[] = listConnectionSnapshots()
): SystemQualityBundle {
  const rules: QualityRule[] = [];
  const runs: QualityRun[] = [];
  const alerts: QualityAlert[] = [];
  const statusBreakdown = { pass: 0, warn: 0, fail: 0 };
  const severityBreakdown: Record<QualitySeverity, number> = {
    "SEV-1": 0,
    "SEV-2": 0,
    "SEV-3": 0,
    "SEV-4": 0,
  };

  // One snapshot per tool — keep the most recently synced if duplicates exist
  const dedupedSnapshots = Array.from(
    snapshots
      .slice()
      .sort((a, b) => (b.metadataSyncedAt ?? "").localeCompare(a.metadataSyncedAt ?? ""))
      .reduce((map, s) => {
        if (!map.has(s.tool)) map.set(s.tool, s);
        return map;
      }, new Map<string, AdapterSnapshot>())
      .values()
  );

  for (const snapshot of dedupedSnapshots) {
    const nextRules = [
      ...buildBaseChecks(snapshot),
      ...buildToolSpecificChecks(snapshot),
      ...buildDiscoveredAuthRequiredChecks(snapshot),
    ];
    for (const rule of nextRules) {
      const run = runRuleAgainstSnapshot(snapshot, rule);
      const alert = maybeCreateAlert(
        run,
        rule.title,
        `${rule.description} Latest evidence: ${run.evidence[0] ?? "No evidence captured."}`
      );

      rules.push(rule);
      runs.push(run);
      if (alert) alerts.push(alert);

      statusBreakdown[run.status] += 1;
      severityBreakdown[run.severity] += 1;
    }
  }

  // Cross-connector checks — fire when specific tool combinations are present
  const crossRules = buildCrossConnectorChecks(dedupedSnapshots);
  for (const { rule, snapshot } of crossRules) {
    const run: QualityRun = {
      runId: `system-run-${rule.ruleId}`,
      ruleId: rule.ruleId,
      status: "warn",
      severity: rule.severity,
      triggerSource: "schedule",
      adapterId: snapshot.adapterId,
      evidence: rule.draft.evidence,
      citations: rule.citations,
      executedAt: snapshot.metadataSyncedAt ?? new Date().toISOString(),
    };
    const alert = maybeCreateAlert(run, rule.title, rule.description);

    rules.push(rule);
    runs.push(run);
    if (alert) alerts.push(alert);

    statusBreakdown[run.status] += 1;
    severityBreakdown[run.severity] += 1;
  }

  return { rules, runs, alerts, statusBreakdown, severityBreakdown };
}

export function mergeQualityBundles(...bundles: SystemQualityBundle[]): SystemQualityBundle {
  const merged = bundles.reduce<SystemQualityBundle>(
    (acc, bundle) => ({
      rules: [...acc.rules, ...bundle.rules],
      runs: [...acc.runs, ...bundle.runs],
      alerts: [...acc.alerts, ...bundle.alerts],
      statusBreakdown: {
        pass: acc.statusBreakdown.pass + bundle.statusBreakdown.pass,
        warn: acc.statusBreakdown.warn + bundle.statusBreakdown.warn,
        fail: acc.statusBreakdown.fail + bundle.statusBreakdown.fail,
      },
      severityBreakdown: {
        "SEV-1": acc.severityBreakdown["SEV-1"] + bundle.severityBreakdown["SEV-1"],
        "SEV-2": acc.severityBreakdown["SEV-2"] + bundle.severityBreakdown["SEV-2"],
        "SEV-3": acc.severityBreakdown["SEV-3"] + bundle.severityBreakdown["SEV-3"],
        "SEV-4": acc.severityBreakdown["SEV-4"] + bundle.severityBreakdown["SEV-4"],
      },
    }),
    {
      rules: [],
      runs: [],
      alerts: [],
      statusBreakdown: { pass: 0, warn: 0, fail: 0 },
      severityBreakdown: { "SEV-1": 0, "SEV-2": 0, "SEV-3": 0, "SEV-4": 0 },
    }
  );

  // One alert per ruleId — keep the most recent
  const latestByRule = new Map<string, (typeof merged.alerts)[number]>();
  for (const alert of merged.alerts) {
    const existing = latestByRule.get(alert.ruleId);
    if (!existing || alert.createdAt > existing.createdAt) {
      latestByRule.set(alert.ruleId, alert);
    }
  }
  merged.alerts = [...latestByRule.values()];

  return merged;
}

export function mergeOverviewWithSystemQuality(
  summary: OverviewSummary,
  bundle: SystemQualityBundle
): OverviewSummary {
  return {
    ...summary,
    metrics: summary.metrics.map((metric) => {
      if (metric.id === "quality-alerts") {
        return {
          ...metric,
          value: String(bundle.alerts.filter((alert) => alert.status === "open").length),
          tone: bundle.severityBreakdown["SEV-1"] > 0 ? "critical" : bundle.statusBreakdown.fail > 0 ? "warn" : "good",
        };
      }
      return metric;
    }),
    latestValidation: bundle.runs.slice(0, 6).map((run) => {
      const toolName =
        bundle.rules.find((rule) => rule.ruleId === run.ruleId)?.tool ?? "Workspace";
      const title =
        bundle.rules.find((rule) => rule.ruleId === run.ruleId)?.title ?? run.ruleId;
      return `${toolName}: ${title} -> ${run.status}`;
    }),
    qualityBreakdown: bundle.statusBreakdown,
    severityBreakdown: bundle.severityBreakdown,
  };
}
