import { getConnectionGuidance } from "./connection-guidance";
import type { ConnectionRequest } from "./credentials";
import type {
  PipelineIdentifierResult,
  PipelineInspectionStep,
  ConnectorAction,
  ConnectorFamily,
} from "./types";
import type {
  AdapterInspectResponse,
  AdapterSnapshot,
  AdapterTestResponse,
  StoredConnectionRecord,
} from "@/lib/product/types";

export type ConnectorAdapterDefinition = {
  adapterId: string;
  tool: string;
  family: ConnectorFamily;
  docsUrl?: string;
  testConnection: (connection: StoredConnectionRecord) => AdapterTestResponse;
  inspect: (connection: StoredConnectionRecord) => AdapterInspectResponse;
  runDiagnostic: (
    connection: StoredConnectionRecord,
    action: Extract<
      ConnectorAction,
      "discover" | "inspect" | "query" | "validate" | "fetch_logs" | "fetch_metadata" | "test_connection"
    >
  ) => {
    summary: string;
    evidence: string[];
  };
  runGuardedAction: (
    connection: StoredConnectionRecord,
    action: Exclude<
      ConnectorAction,
      "discover" | "inspect" | "query" | "validate" | "fetch_logs" | "fetch_metadata" | "test_connection"
    >
  ) => {
    summary: string;
    approvalRequired: true;
  };
  detectPipeline?: (
    connection: StoredConnectionRecord,
    connections: StoredConnectionRecord[]
  ) => PipelineIdentifierResult | null;
};

function passResult(
  adapterId: string,
  summary: string,
  details: string[]
): AdapterTestResponse {
  return {
    adapterId,
    testedAt: new Date().toISOString(),
    ok: true,
    status: "healthy",
    summary,
    details,
  };
}

function warningResult(
  adapterId: string,
  summary: string,
  details: string[]
): AdapterTestResponse {
  return {
    adapterId,
    testedAt: new Date().toISOString(),
    ok: false,
    status: "warning",
    summary,
    details,
  };
}

function buildGenericInspect(
  connection: StoredConnectionRecord,
  surfaces: Array<{ surface: string; summary: string; count?: number; evidence: string[] }>,
  inspectionPlan: PipelineInspectionStep[],
  activity: string[]
): AdapterInspectResponse {
  return {
    adapterId: connection.adapterId,
    surfaces,
    inspectionPlan,
    activity,
  };
}

function detailsPreview(connection: StoredConnectionRecord, keys: string[]) {
  return keys
    .map((key) => connection.details?.[key])
    .filter((value): value is string => Boolean(value))
    .slice(0, 2)
    .join(", ");
}

function buildSnowflakeAdapter(): ConnectorAdapterDefinition {
  return {
    adapterId: "warehouse-snowflake",
    tool: "Snowflake",
    family: "warehouse",
    docsUrl: getConnectionGuidance("Snowflake", "warehouse").docsUrl,
    testConnection(connection) {
      const account = connection.details?.account;
      const database = connection.details?.database;
      if (!account) {
        return warningResult("warehouse-snowflake", "Missing Snowflake account identifier.", [
          "Populate the account field before running diagnostics.",
        ]);
      }

      return passResult("warehouse-snowflake", "Snowflake connection blueprint looks ready.", [
        `Account: ${account}`,
        `Database: ${database ?? "not specified"}`,
        `Auth: ${connection.authMethod}`,
      ]);
    },
    inspect(connection) {
      const database = connection.details?.database ?? "analytics";
      return buildGenericInspect(
        connection,
        [
          {
            surface: "schemas_tables",
            count: 12,
            summary: `Schema and table inventory can be inspected for object freshness, ownership, and volume shifts in ${database}.`,
            evidence: [
              "Table inventory helps answer row-count, freshness, and blast-radius questions from chat.",
              "Information schema surfaces are useful for quickly grounding warehouse topology.",
            ],
          },
          {
            surface: "stages",
            count: 2,
            summary: `Detected stage configuration for ${database}.`,
            evidence: [
              "Stage inventory is available for upstream storage mapping.",
              "Stage references can reveal S3/GCS/Azure load paths.",
            ],
          },
          {
            surface: "pipes",
            count: 1,
            summary: "Snowpipe definitions are available for ingestion discovery.",
            evidence: [
              "Pipe targets help identify ingestion and auto-load flows.",
            ],
          },
          {
            surface: "query_history",
            count: 24,
            summary: "Query history can be inspected for recent failed and slow warehouse queries.",
            evidence: [
              "QUERY_HISTORY is the best starting point for recent warehouse failures.",
              "Long-running queries can explain stale downstream assets.",
            ],
          },
          {
            surface: "task_history",
            count: 8,
            summary: "Task history can be inspected for failed or cancelled scheduled tasks.",
            evidence: [
              "TASK_HISTORY helps trace scheduled transformation failures.",
              "Task failures often explain stale downstream data without ingestion issues.",
            ],
          },
          {
            surface: "copy_history",
            count: 6,
            summary: "Copy history can be inspected for Snowpipe and COPY INTO load failures.",
            evidence: [
              "COPY_HISTORY exposes recent load gaps and ingestion failures.",
              "Load history is useful when the warehouse anchor is healthy but data is stale.",
            ],
          },
          {
            surface: "warehouse_load_history",
            count: 4,
            summary: "Warehouse load history can be inspected for queueing, overload, and concurrency pressure.",
            evidence: [
              "Queueing and overload can explain stale models and dashboards without obvious query failures.",
              "Warehouse pressure is a common hidden cause during demos with concurrent workloads.",
            ],
          },
          {
            surface: "login_history",
            count: 5,
            summary: "Login history can be inspected for service-account and auth failures affecting scheduled jobs.",
            evidence: [
              "Credential drift can look like ingestion or transform failure if only downstream symptoms are visible.",
              "Login history helps separate principal issues from SQL logic problems.",
            ],
          },
          {
            surface: "warehouse_objects",
            count: 4,
            summary: "Tables, tasks, and streams are available for warehouse-layer inspection.",
            evidence: [
              "Warehouse tasks can indicate internal orchestration.",
              "Streams suggest CDC or change capture flows.",
            ],
          },
        ],
        [
          {
            id: "snowflake-schemas-tables",
            tool: "Snowflake",
            surface: "Schemas and tables",
            purpose: "Read schema, table, and row-count metadata for topology and size grounding.",
            executionKind: "sql",
            readonly: true,
            commandPreview:
              "SELECT table_schema, table_name, row_count, bytes, last_altered FROM <database>.information_schema.tables ORDER BY row_count DESC;",
          },
          {
            id: "snowflake-stages",
            tool: "Snowflake",
            surface: "Stages",
            purpose: "Read stages to infer upstream storage and ingestion paths.",
            executionKind: "sql",
            readonly: true,
            commandPreview: `SHOW STAGES IN DATABASE ${database};`,
          },
          {
            id: "snowflake-pipes",
            tool: "Snowflake",
            surface: "Pipes",
            purpose: "Inspect Snowpipe definitions to discover source flow.",
            executionKind: "sql",
            readonly: true,
            commandPreview: `SHOW PIPES IN DATABASE ${database};`,
          },
          {
            id: "snowflake-tasks",
            tool: "Snowflake",
            surface: "Tasks",
            purpose: "Read tasks and streams for transformation and orchestration clues.",
            executionKind: "sql",
            readonly: true,
            commandPreview: `SHOW TASKS IN DATABASE ${database}; SHOW STREAMS IN DATABASE ${database};`,
          },
          {
            id: "snowflake-query-history",
            tool: "Snowflake",
            surface: "Query history",
            purpose: "Read recent failed and long-running queries from account usage.",
            executionKind: "sql",
            readonly: true,
            commandPreview:
              "SELECT query_id, query_text, execution_status, error_message, total_elapsed_time FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE start_time >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND execution_status <> 'SUCCESS';",
          },
          {
            id: "snowflake-task-history",
            tool: "Snowflake",
            surface: "Task history",
            purpose: "Read recent failed task runs from information schema.",
            executionKind: "sql",
            readonly: true,
            commandPreview:
              "SELECT * FROM TABLE(SNOWFLAKE.INFORMATION_SCHEMA.TASK_HISTORY(SCHEDULED_TIME_RANGE_START => DATEADD('hour', -24, CURRENT_TIMESTAMP()), RESULT_LIMIT => 100, ERROR_ONLY => TRUE));",
          },
          {
            id: "snowflake-copy-history",
            tool: "Snowflake",
            surface: "Copy history",
            purpose: "Inspect recent COPY INTO and Snowpipe load history for freshness gaps.",
            executionKind: "sql",
            readonly: true,
            commandPreview:
              "SELECT * FROM TABLE(INFORMATION_SCHEMA.COPY_HISTORY(TABLE_NAME => '<db>.<schema>.<table>', START_TIME => DATEADD('hour', -24, CURRENT_TIMESTAMP())));",
          },
          {
            id: "snowflake-warehouse-load-history",
            tool: "Snowflake",
            surface: "Warehouse load history",
            purpose: "Inspect queueing and overload signals that can delay downstream freshness.",
            executionKind: "sql",
            readonly: true,
            commandPreview:
              "SELECT * FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_LOAD_HISTORY WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP());",
          },
          {
            id: "snowflake-login-history",
            tool: "Snowflake",
            surface: "Login history",
            purpose: "Inspect auth failures and principal issues affecting automation.",
            executionKind: "sql",
            readonly: true,
            commandPreview:
              "SELECT user_name, is_success, error_message, event_timestamp FROM SNOWFLAKE.ACCOUNT_USAGE.LOGIN_HISTORY WHERE event_timestamp >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) ORDER BY event_timestamp DESC;",
          },
        ],
        [
          `Prepared Snowflake metadata surfaces for ${database}.`,
          "Warehouse object inspection is available.",
          "Query, task, copy, warehouse-load, and login-history checks are available.",
        ]
      );
    },
    runDiagnostic(connection, action) {
      const database = connection.details?.database ?? "analytics";
      const target = connection.target ?? connection.details?.account ?? "unknown account";

      if (action === "query") {
        return {
          summary: `Prepared read-only Snowflake query shell for ${database}.`,
          evidence: [
            `Target account: ${target}`,
            "Use information schema and ACCOUNT_USAGE surfaces for counts, freshness, and incident correlation.",
            "Good demo-safe queries include table inventory, row counts, task failures, copy history, and warehouse load pressure.",
          ],
        };
      }

      if (action === "fetch_logs") {
        return {
          summary: `Prepared Snowflake operational-log style read path for ${database}.`,
          evidence: [
            "Snowflake does not expose traditional service logs here; use QUERY_HISTORY, TASK_HISTORY, COPY_HISTORY, LOGIN_HISTORY, and WAREHOUSE_LOAD_HISTORY instead.",
            "These surfaces are the right read-only substitute for error, auth, and queueing investigation.",
          ],
        };
      }

      if (action === "fetch_metadata") {
        return {
          summary: `Prepared Snowflake metadata inspection for ${database}.`,
          evidence: [
            "Schemas, tables, stages, pipes, tasks, and streams are the highest-signal metadata surfaces for topology and freshness diagnosis.",
            "Metadata reads are also the safest way to ground red-herring analysis before inspecting failures.",
          ],
        };
      }

      if (action === "validate") {
        return {
          summary: `Prepared Snowflake validation checks for ${database}.`,
          evidence: [
            "Use validation to compare latest snapshot freshness, row-count drift, failed tasks, failed loads, and long-running query clusters.",
            "This is the right entry point when the symptom is stale data but the fault domain is unclear.",
          ],
        };
      }

      return {
        summary: `Prepared Snowflake ${action} diagnostic for ${database}.`,
        evidence: [
          `Connection target: ${target}`,
          "Diagnostics remain read-only in this release.",
          "Snowflake is the deepest live connector in this workspace for demo purposes.",
        ],
      };
    },
    runGuardedAction(_connection, action) {
      return {
        summary: `Snowflake action ${action} is guarded and requires explicit approval.`,
        approvalRequired: true,
      };
    },
  };
}

function buildAirflowAdapter(): ConnectorAdapterDefinition {
  return {
    adapterId: "orchestration-airflow",
    tool: "Apache Airflow",
    family: "orchestration",
    docsUrl: getConnectionGuidance("Apache Airflow", "orchestration").docsUrl,
    testConnection(connection) {
      const baseUrl = connection.details?.base_url;
      if (!baseUrl) {
        return warningResult("orchestration-airflow", "Missing Airflow webserver URL.", [
          "Provide the public API base URL to enable orchestration inspection.",
        ]);
      }

      return passResult("orchestration-airflow", "Airflow connection blueprint looks ready.", [
        `Webserver: ${baseUrl}`,
        `Auth: ${connection.authMethod}`,
      ]);
    },
    inspect(connection) {
      const hostname = connection.details?.base_url ?? connection.target ?? "airflow";
      return buildGenericInspect(
        connection,
        [
          {
            surface: "dags",
            count: 8,
            summary: "DAG inventory is available for path discovery.",
            evidence: [
              "Task lineage can point to warehouses, dbt jobs, and BI refreshes.",
            ],
          },
          {
            surface: "connections",
            count: 3,
            summary: "Airflow connection references can reveal adjacent systems.",
            evidence: [
              "Connection ids often encode Snowflake, dbt Cloud, or external APIs.",
            ],
          },
        ],
        [
          {
            id: "airflow-dags",
            tool: "Apache Airflow",
            surface: "DAG inventory",
            purpose: "Inspect DAGs and task operators for connected systems.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET ${hostname}/api/v1/dags`,
          },
          {
            id: "airflow-runs",
            tool: "Apache Airflow",
            surface: "Runs",
            purpose: "Read recent DAG runs and failures for root-cause tracing.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET ${hostname}/api/v1/dags/{dag_id}/dagRuns`,
          },
        ],
        ["Airflow DAG and task metadata prepared.", "Recent run history can be inspected."]
      );
    },
    runDiagnostic(connection, action) {
      return {
        summary: `Prepared Airflow ${action} diagnostic for ${connection.target ?? "orchestration context"}.`,
        evidence: ["Airflow diagnostics remain API-based and read-only in this release."],
      };
    },
    runGuardedAction(_connection, action) {
      return {
        summary: `Airflow action ${action} is guarded and requires explicit approval.`,
        approvalRequired: true,
      };
    },
  };
}

function buildFivetranAdapter(): ConnectorAdapterDefinition {
  return {
    adapterId: "ingestion-fivetran",
    tool: "Fivetran",
    family: "ingestion",
    docsUrl: getConnectionGuidance("Fivetran", "ingestion").docsUrl,
    testConnection(connection) {
      if (!connection.details?.api_key || !connection.details?.api_secret) {
        return warningResult("ingestion-fivetran", "Missing Fivetran API credentials.", [
          "Both API key and secret are required for connector inspection.",
        ]);
      }

      return passResult("ingestion-fivetran", "Fivetran connection blueprint looks ready.", [
        `Group: ${connection.details?.group_id ?? "default scope"}`,
      ]);
    },
    inspect(connection) {
      return buildGenericInspect(
        connection,
        [
          {
            surface: "connectors",
            count: 5,
            summary: "Fivetran connectors can be enumerated for pipeline discovery.",
            evidence: ["Connector destinations help anchor warehouse flow."],
          },
          {
            surface: "destinations",
            count: 1,
            summary: "Destination inventory is available for warehouse mapping.",
            evidence: ["Destination type can reveal Snowflake, BigQuery, or Redshift."],
          },
        ],
        [
          {
            id: "fivetran-connectors",
            tool: "Fivetran",
            surface: "Connectors",
            purpose: "Read connectors and sync state to discover upstream apps and destinations.",
            executionKind: "api",
            readonly: true,
            commandPreview: "GET /v1/connectors",
          },
        ],
        ["Fivetran connector inventory prepared.", "Sync history can be used for freshness inspection."]
      );
    },
    runDiagnostic(connection, action) {
      return {
        summary: `Prepared Fivetran ${action} diagnostic for group ${connection.details?.group_id ?? "default"}.`,
        evidence: ["Read-only connector status and sync history are available."],
      };
    },
    runGuardedAction(_connection, action) {
      return {
        summary: `Fivetran action ${action} is guarded and requires explicit approval.`,
        approvalRequired: true,
      };
    },
  };
}

function buildKafkaAdapter(): ConnectorAdapterDefinition {
  return {
    adapterId: "streaming-kafka",
    tool: "Apache Kafka",
    family: "streaming",
    docsUrl: getConnectionGuidance("Apache Kafka", "streaming").docsUrl,
    testConnection(connection) {
      if (!connection.details?.bootstrap_servers) {
        return warningResult("streaming-kafka", "Missing Kafka bootstrap servers.", [
          "Provide broker endpoints to inspect topics and consumer groups.",
        ]);
      }

      return passResult("streaming-kafka", "Kafka connection blueprint looks ready.", [
        `Bootstrap servers: ${connection.details.bootstrap_servers}`,
        `Mechanism: ${connection.details?.sasl_mechanism ?? "not specified"}`,
      ]);
    },
    inspect(connection) {
      return buildGenericInspect(
        connection,
        [
          {
            surface: "topics",
            count: 6,
            summary: "Topic inventory is available for producer and consumer discovery.",
            evidence: ["Topic names often map to upstream products and downstream processing jobs."],
          },
          {
            surface: "consumer_groups",
            count: 4,
            summary: "Consumer groups can be inspected for lag and ownership.",
            evidence: ["Consumer lag helps prioritize stale or delayed downstream systems."],
          },
        ],
        [
          {
            id: "kafka-topics",
            tool: "Apache Kafka",
            surface: "Topics",
            purpose: "Read topics to identify producers and downstream subscribers.",
            executionKind: "api",
            readonly: true,
            commandPreview: "LIST TOPICS",
          },
          {
            id: "kafka-consumers",
            tool: "Apache Kafka",
            surface: "Consumer groups",
            purpose: "Inspect consumer groups to identify delayed downstream jobs.",
            executionKind: "api",
            readonly: true,
            commandPreview: "LIST CONSUMER GROUPS",
          },
        ],
        ["Kafka topics and consumer groups prepared.", "Streaming lag inspection is available."]
      );
    },
    runDiagnostic(connection, action) {
      return {
        summary: `Prepared Kafka ${action} diagnostic for ${connection.details?.bootstrap_servers ?? connection.target ?? "cluster"}.`,
        evidence: ["Read-only topic and lag inspection are available."],
      };
    },
    runGuardedAction(_connection, action) {
      return {
        summary: `Kafka action ${action} is guarded and requires explicit approval.`,
        approvalRequired: true,
      };
    },
  };
}

function buildLookerAdapter(): ConnectorAdapterDefinition {
  return {
    adapterId: "bi-looker",
    tool: "Looker",
    family: "bi",
    docsUrl: getConnectionGuidance("Looker", "bi").docsUrl,
    testConnection(connection) {
      const baseUrl = connection.details?.base_url ?? connection.target;
      const clientId = connection.details?.client_id ?? connection.principal;
      const clientSecret = connection.details?.client_secret ?? connection.secret;

      if (!baseUrl) {
        return warningResult("bi-looker", "Missing Looker instance URL.", [
          "Provide the Looker host, e.g. https://yourcompany.looker.com",
        ]);
      }
      if (!clientId || !clientSecret) {
        return warningResult("bi-looker", "Missing Looker API3 credentials.", [
          "Generate a Client ID and Client Secret under Admin → Users → Edit user → API3 Keys.",
          `Host resolved: ${baseUrl}`,
        ]);
      }
      return passResult("bi-looker", "Looker API3 credentials look ready.", [
        `Host: ${baseUrl}`,
        `Client ID: ${clientId}`,
        "Client secret: provided",
      ]);
    },
    inspect(connection) {
      const baseUrl = connection.details?.base_url ?? connection.target ?? "looker";
      return buildGenericInspect(
        connection,
        [
          {
            surface: "dashboards",
            count: 7,
            summary: "Dashboard inventory is available for downstream impact mapping.",
            evidence: ["Dashboards can confirm reporting endpoints for warehouse models."],
          },
          {
            surface: "looks",
            count: 9,
            summary: "Saved Looks and explores can be inspected for BI lineage clues.",
            evidence: ["Explore usage is useful for stale dashboard diagnosis."],
          },
          {
            surface: "content_validation",
            count: 1,
            summary: "Content validation can be inspected for broken fields, explores, and dashboard elements.",
            evidence: [
              "Content validation is one of the strongest semantic-layer signals for demos.",
              "Broken content often explains BI incidents before upstream systems are at fault.",
            ],
          },
          {
            surface: "scheduled_plans",
            count: 6,
            summary: "Scheduled plans can be inspected for failed or paused dashboard deliveries.",
            evidence: [
              "Delivery failures often look like stale dashboard issues to business users.",
              "Scheduled-plan health is a useful red-herring separator for BI complaints.",
            ],
          },
          {
            surface: "folders_models",
            count: 10,
            summary: "Folders, models, and explores can be inspected for ownership drift and semantic changes.",
            evidence: [
              "Folder moves and LookML drift can break content without any warehouse outage.",
              "These surfaces help isolate BI-primary issues from upstream-primary issues.",
            ],
          },
          {
            surface: "query_tasks",
            count: 8,
            summary: "Query task metadata can be inspected for repeated dashboard query failures and slow paths.",
            evidence: [
              "Runtime outliers and repeated query failures are essential for dashboard triage.",
              "Query-task patterns are useful when the same explores keep timing out.",
            ],
          },
        ],
        [
          {
            id: "looker-dashboards",
            tool: "Looker",
            surface: "Dashboards",
            purpose: "Inspect dashboards and looks for downstream coverage and refresh impact.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET ${baseUrl}/api/4.0/dashboards and /api/4.0/dashboard/{dashboard_id}`,
          },
          {
            id: "looker-content-validation",
            tool: "Looker",
            surface: "Content validation",
            purpose: "Inspect semantic-layer failures before blaming upstream freshness.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET ${baseUrl}/api/4.0/content_validation`,
          },
          {
            id: "looker-scheduled-plans",
            tool: "Looker",
            surface: "Scheduled plans",
            purpose: "Inspect dashboard delivery and scheduled-report failures.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET ${baseUrl}/api/4.0/scheduled_plans`,
          },
          {
            id: "looker-folders-models",
            tool: "Looker",
            surface: "Folders and explores",
            purpose: "Inspect folder ownership, LookML explores, and semantic drift.",
            executionKind: "api",
            readonly: true,
            commandPreview:
              `GET ${baseUrl}/api/4.0/folders and /api/4.0/lookml_models/{model_name}/explores/{explore_name}`,
          },
          {
            id: "looker-query-tasks",
            tool: "Looker",
            surface: "Queries",
            purpose: "Inspect repeated BI query failures and runtime outliers.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET ${baseUrl}/api/4.0/running_queries and query task metadata`,
          },
        ],
        [
          "Looker dashboard, semantic-layer, and scheduled-delivery metadata prepared.",
          "Query-failure and runtime analysis surfaces are available.",
        ]
      );
    },
    runDiagnostic(connection, action) {
      const baseUrl = connection.details?.base_url ?? connection.target ?? "looker";
      if (action === "query") {
        return {
          summary: "Prepared read-only Looker inspection shell.",
          evidence: [
            `Looker host: ${baseUrl}`,
            "Good demo-safe reads include dashboards, content validation, scheduled plans, folders, explores, and query-task metadata.",
            "Use these surfaces to separate semantic-layer failures from upstream freshness problems.",
          ],
        };
      }

      if (action === "fetch_logs") {
        return {
          summary: "Prepared Looker query-task and BI error inspection.",
          evidence: [
            "Use query task metadata, content validation, and scheduled plan failures as the practical Looker log surfaces.",
            "These are the highest-signal read-only paths for dashboard incidents.",
          ],
        };
      }

      if (action === "validate") {
        return {
          summary: "Prepared Looker semantic and dashboard validation checks.",
          evidence: [
            "Validate content, scheduled delivery health, query-failure clusters, and dashboard freshness mismatch before calling the warehouse the root cause.",
          ],
        };
      }

      return {
        summary: `Prepared Looker ${action} diagnostic for ${connection.target ?? "BI context"}.`,
        evidence: [
          "Downstream dashboard, semantic-layer, and delivery coverage can be inspected read-only.",
        ],
      };
    },
    runGuardedAction(_connection, action) {
      return {
        summary: `Looker action ${action} is guarded and requires explicit approval.`,
        approvalRequired: true,
      };
    },
  };
}

function buildAirbyteAdapter(): ConnectorAdapterDefinition {
  return {
    adapterId: "ingestion-airbyte",
    tool: "Airbyte",
    family: "ingestion",
    docsUrl: getConnectionGuidance("Airbyte", "ingestion").docsUrl,
    testConnection(connection) {
      const baseUrl = connection.details?.base_url ?? connection.target;
      if (!baseUrl) {
        return warningResult("ingestion-airbyte", "Missing Airbyte API host.", [
          "Provide the Airbyte base URL to inspect sources, destinations, and sync jobs.",
        ]);
      }
      return passResult("ingestion-airbyte", "Airbyte connection blueprint looks ready.", [
        `Host: ${baseUrl}`,
        `Workspace: ${connection.details?.workspace_id ?? "default scope"}`,
      ]);
    },
    inspect(connection) {
      const baseUrl = connection.details?.base_url ?? connection.target ?? "airbyte";
      return buildGenericInspect(
        connection,
        [
          {
            surface: "sources",
            count: 6,
            summary: "Airbyte sources can be inspected for upstream system coverage.",
            evidence: ["Source connectors often identify SaaS apps or databases feeding the warehouse."],
          },
          {
            surface: "destinations",
            count: 2,
            summary: "Destination inventory can be used to anchor warehouse routing.",
            evidence: ["Destinations help confirm Snowflake, BigQuery, or Redshift landing zones."],
          },
          {
            surface: "jobs",
            count: 12,
            summary: "Job history is available for failed syncs and recent lag patterns.",
            evidence: ["Recent failed jobs usually explain stale data before transform-layer issues."],
          },
          {
            surface: "logs",
            count: 1,
            summary: "Sync logs can be fetched for connector-specific failures.",
            evidence: ["Read job logs before retrying a sync or blaming the destination."],
          },
        ],
        [
          {
            id: "airbyte-sources",
            tool: "Airbyte",
            surface: "Sources and destinations",
            purpose: "Inspect configured sources, destinations, and connection graph.",
            executionKind: "api",
            readonly: true,
            commandPreview: `POST ${baseUrl}/api/v1/sources/list and /api/v1/destinations/list`,
          },
          {
            id: "airbyte-jobs",
            tool: "Airbyte",
            surface: "Job history",
            purpose: "Read recent sync job outcomes to isolate connector failures and lag.",
            executionKind: "api",
            readonly: true,
            commandPreview: `POST ${baseUrl}/api/v1/jobs/list`,
          },
          {
            id: "airbyte-logs",
            tool: "Airbyte",
            surface: "Sync logs",
            purpose: "Fetch log excerpts for the most recent failed Airbyte jobs.",
            executionKind: "api",
            readonly: true,
            commandPreview: `POST ${baseUrl}/api/v1/jobs/get`,
          },
        ],
        ["Airbyte source, destination, and job metadata prepared.", "Connector logs are available for investigation."]
      );
    },
    runDiagnostic(connection, action) {
      return {
        summary: `Prepared Airbyte ${action} diagnostic for ${connection.details?.workspace_id ?? "default workspace"}.`,
        evidence: [
          action === "fetch_logs"
            ? "Recent Airbyte job logs are the highest-signal diagnostic for connector and schema failures."
            : "Read-only source, destination, and job inspection are available.",
        ],
      };
    },
    runGuardedAction(_connection, action) {
      return {
        summary: `Airbyte action ${action} is guarded and requires explicit approval.`,
        approvalRequired: true,
      };
    },
  };
}

function buildDatabricksAdapter(): ConnectorAdapterDefinition {
  return {
    adapterId: "compute-databricks",
    tool: "Databricks",
    family: "compute",
    docsUrl: getConnectionGuidance("Databricks", "compute").docsUrl,
    testConnection(connection) {
      const host = connection.details?.host;
      if (!host) {
        return warningResult("compute-databricks", "Missing Databricks workspace host.", [
          "Provide the workspace URL so jobs, clusters, and notebooks can be inspected.",
        ]);
      }
      return passResult("compute-databricks", "Databricks connection blueprint looks ready.", [
        `Workspace: ${host}`,
        `Auth: ${connection.authMethod}`,
      ]);
    },
    inspect(connection) {
      const host = connection.details?.host ?? connection.target ?? "databricks";
      return buildGenericInspect(
        connection,
        [
          {
            surface: "jobs",
            count: 10,
            summary: "Databricks jobs can be inspected for failed runs and schedule drift.",
            evidence: ["Job failure clusters often explain stale downstream tables before BI issues surface."],
          },
          {
            surface: "clusters",
            count: 4,
            summary: "Cluster health can be inspected for queueing and startup delays.",
            evidence: ["Cold or failed clusters often precede notebook and transform failures."],
          },
          {
            surface: "sql_warehouses",
            count: 3,
            summary: "SQL warehouses can be inspected for availability, queueing, and endpoint health.",
            evidence: [
              "Warehouse endpoint health matters for dashboards, notebooks, and dbsql workloads.",
              "SQL warehouse instability can masquerade as semantic or BI issues downstream.",
            ],
          },
          {
            surface: "notebooks",
            count: 9,
            summary: "Notebook and repo references can be inspected for path drift and changed assets.",
            evidence: [
              "Changed notebook paths and repo drift are common demo-breaking causes.",
              "Notebook lineage helps map job failures to downstream tables and dashboards.",
            ],
          },
          {
            surface: "logs",
            count: 1,
            summary: "Run-output and cluster log references are available for recent failures.",
            evidence: ["Run output is useful for spotting auth, package, or notebook path issues."],
          },
        ],
        [
          {
            id: "databricks-jobs",
            tool: "Databricks",
            surface: "Jobs",
            purpose: "Inspect jobs, runs, and schedule state.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET ${host}/api/2.1/jobs/list and /api/2.1/jobs/runs/list`,
          },
          {
            id: "databricks-clusters",
            tool: "Databricks",
            surface: "Clusters",
            purpose: "Inspect cluster state for queueing and runtime instability.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET ${host}/api/2.0/clusters/list`,
          },
          {
            id: "databricks-sql-warehouses",
            tool: "Databricks",
            surface: "SQL warehouses",
            purpose: "Inspect SQL warehouse state for BI and notebook endpoint health.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET ${host}/api/2.0/sql/warehouses`,
          },
          {
            id: "databricks-workspace",
            tool: "Databricks",
            surface: "Workspace assets",
            purpose: "Inspect notebooks and repo paths tied to failing jobs.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET ${host}/api/2.0/workspace/list and /api/2.0/repos`,
          },
          {
            id: "databricks-logs",
            tool: "Databricks",
            surface: "Run logs",
            purpose: "Fetch run output for the latest failed jobs.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET ${host}/api/2.1/jobs/runs/get-output`,
          },
        ],
        [
          "Databricks job, cluster, SQL warehouse, and workspace metadata prepared.",
          "Run-output inspection is available.",
        ]
      );
    },
    runDiagnostic(connection, action) {
      const host = connection.details?.host ?? connection.target ?? "databricks";
      if (action === "query") {
        return {
          summary: "Prepared read-only Databricks inspection shell.",
          evidence: [
            `Workspace: ${host}`,
            "Good demo-safe reads include jobs, runs, clusters, SQL warehouses, workspace assets, and run-output APIs.",
            "Use these surfaces to separate cluster/runtime issues from notebook logic or upstream data issues.",
          ],
        };
      }

      if (action === "fetch_logs") {
        return {
          summary: "Prepared Databricks run-output and cluster-log inspection.",
          evidence: [
            "Run output, cluster events, and warehouse state are the highest-signal read-only paths for recent failures.",
            "Read these before blaming upstream data or restarting compute.",
          ],
        };
      }

      if (action === "validate") {
        return {
          summary: "Prepared Databricks compute and orchestration validation checks.",
          evidence: [
            "Validate failed-job concentration, cluster startup instability, SQL warehouse availability, notebook path drift, and principal/auth issues together.",
          ],
        };
      }

      return {
        summary: `Prepared Databricks ${action} diagnostic.`,
        evidence: [
          action === "fetch_logs"
            ? "Databricks run output and cluster logs should be read before restarting a job."
            : "Read-only job, cluster, SQL warehouse, and workspace inspection are available.",
        ],
      };
    },
    runGuardedAction(_connection, action) {
      return {
        summary: `Databricks action ${action} is guarded and requires explicit approval.`,
        approvalRequired: true,
      };
    },
  };
}

function buildDbtAdapter(): ConnectorAdapterDefinition {
  return {
    adapterId: "compute-dbt",
    tool: "dbt",
    family: "compute",
    docsUrl: getConnectionGuidance("dbt", "compute").docsUrl,
    testConnection(connection) {
      const account = connection.details?.account_id ?? connection.target ?? connection.details?.host;
      if (!account) {
        return warningResult("compute-dbt", "Missing dbt account or project target.", [
          "Provide a dbt Cloud account or project target to inspect jobs and run history.",
        ]);
      }
      return passResult("compute-dbt", "dbt connection blueprint looks ready.", [
        `Target: ${account}`,
        `Project: ${connection.details?.project_id ?? "not specified"}`,
      ]);
    },
    inspect(connection) {
      const account = connection.details?.account_id ?? connection.target ?? "dbt";
      return buildGenericInspect(
        connection,
        [
          {
            surface: "jobs",
            count: 7,
            summary: "dbt jobs can be inspected for failed, canceled, and lagging runs.",
            evidence: ["Job history is the clearest signal when downstream models are stale."],
          },
          {
            surface: "models",
            count: 18,
            summary: "Model inventory can be inspected for critical downstream assets.",
            evidence: ["Model metadata helps connect Snowflake tables to BI endpoints."],
          },
          {
            surface: "logs",
            count: 1,
            summary: "dbt run logs can be fetched for compile and execution failures.",
            evidence: ["Compile errors and source freshness failures are usually obvious in dbt logs."],
          },
        ],
        [
          {
            id: "dbt-jobs",
            tool: "dbt",
            surface: "Jobs",
            purpose: "Inspect scheduled jobs and recent runs.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET /accounts/${account}/jobs/ and /runs/`,
          },
          {
            id: "dbt-logs",
            tool: "dbt",
            surface: "Run logs",
            purpose: "Fetch run details for failed and long-running dbt jobs.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET /accounts/${account}/runs/{run_id}/artifacts/run_results.json`,
          },
        ],
        ["dbt job metadata prepared.", "Model and run-log inspection are available."]
      );
    },
    runDiagnostic(_connection, action) {
      return {
        summary: `Prepared dbt ${action} diagnostic.`,
        evidence: [
          action === "fetch_logs"
            ? "dbt run artifacts and logs should be inspected before rerunning a job."
            : "Read-only job, model, and run inspection are available.",
        ],
      };
    },
    runGuardedAction(_connection, action) {
      return {
        summary: `dbt action ${action} is guarded and requires explicit approval.`,
        approvalRequired: true,
      };
    },
  };
}

function buildBigQueryAdapter(): ConnectorAdapterDefinition {
  return {
    adapterId: "warehouse-bigquery",
    tool: "Google BigQuery",
    family: "warehouse",
    docsUrl: getConnectionGuidance("Google BigQuery", "warehouse").docsUrl,
    testConnection(connection) {
      const projectId = connection.details?.project_id ?? connection.target;
      if (!projectId) {
        return warningResult("warehouse-bigquery", "Missing GCP project id.", [
          "Provide the BigQuery project so datasets, jobs, and audit surfaces can be inspected.",
        ]);
      }
      return passResult("warehouse-bigquery", "BigQuery connection blueprint looks ready.", [
        `Project: ${projectId}`,
        `Dataset: ${connection.details?.dataset ?? "not specified"}`,
      ]);
    },
    inspect(connection) {
      const projectId = connection.details?.project_id ?? connection.target ?? "project";
      const dataset = connection.details?.dataset ?? "<dataset>";
      return buildGenericInspect(
        connection,
        [
          {
            surface: "datasets",
            count: 5,
            summary: "Dataset inventory can be inspected for warehouse coverage.",
            evidence: ["Datasets often map directly to transform and reporting domains."],
          },
          {
            surface: "jobs",
            count: 20,
            summary: "Job history can be inspected for failed queries and long-running jobs.",
            evidence: ["BigQuery job failures are often the fastest path to warehouse root cause."],
          },
          {
            surface: "logs",
            count: 1,
            summary: "Cloud audit/job error details can be fetched for failed jobs.",
            evidence: ["Error payloads help separate auth, quota, and SQL failures."],
          },
        ],
        [
          {
            id: "bigquery-jobs",
            tool: "Google BigQuery",
            surface: "Jobs",
            purpose: "Read recent job history for query failures and latency spikes.",
            executionKind: "sql",
            readonly: true,
            commandPreview: `SELECT * FROM \`${projectId}\`.\`region-us\`.INFORMATION_SCHEMA.JOBS_BY_PROJECT WHERE creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)`,
          },
          {
            id: "bigquery-tables",
            tool: "Google BigQuery",
            surface: "Tables",
            purpose: "Inspect dataset tables and last modified timestamps.",
            executionKind: "sql",
            readonly: true,
            commandPreview: `SELECT * FROM \`${projectId}.${dataset}.INFORMATION_SCHEMA.TABLES\``,
          },
        ],
        ["BigQuery dataset and job metadata prepared.", "Job error surfaces are available."]
      );
    },
    runDiagnostic(connection, action) {
      return {
        summary: `Prepared BigQuery ${action} diagnostic for ${connection.details?.project_id ?? connection.target ?? "project"}.`,
        evidence: [
          action === "fetch_logs"
            ? "BigQuery job error payloads and audit details should be reviewed for failed jobs."
            : "Read-only dataset and job inspection are available.",
        ],
      };
    },
    runGuardedAction(_connection, action) {
      return {
        summary: `BigQuery action ${action} is guarded and requires explicit approval.`,
        approvalRequired: true,
      };
    },
  };
}

function buildRedshiftAdapter(): ConnectorAdapterDefinition {
  return {
    adapterId: "warehouse-redshift",
    tool: "Amazon Redshift",
    family: "warehouse",
    docsUrl: getConnectionGuidance("Amazon Redshift", "warehouse").docsUrl,
    testConnection(connection) {
      if (!connection.details?.host && !connection.target) {
        return warningResult("warehouse-redshift", "Missing Redshift host.", [
          "Provide the cluster endpoint so system tables and query logs can be inspected.",
        ]);
      }
      return passResult("warehouse-redshift", "Redshift connection blueprint looks ready.", [
        `Host: ${connection.details?.host ?? connection.target}`,
        `Database: ${connection.details?.database ?? "not specified"}`,
      ]);
    },
    inspect(connection) {
      return buildGenericInspect(
        connection,
        [
          {
            surface: "system_tables",
            count: 4,
            summary: "STL and SVL system tables can be inspected for recent failures and queueing.",
            evidence: ["Query and load system tables are the best source of warehouse diagnostics."],
          },
          {
            surface: "logs",
            count: 1,
            summary: "Load and query error logs can be inspected for failed COPY and SQL issues.",
            evidence: ["Redshift STL_LOAD_ERRORS is high-signal for ingestion failures."],
          },
        ],
        [
          {
            id: "redshift-query-errors",
            tool: "Amazon Redshift",
            surface: "Query failures",
            purpose: "Read recent query failures and queueing from system tables.",
            executionKind: "sql",
            readonly: true,
            commandPreview: "SELECT * FROM stl_query WHERE starttime >= dateadd(hour,-24,current_timestamp);",
          },
          {
            id: "redshift-load-errors",
            tool: "Amazon Redshift",
            surface: "Load errors",
            purpose: "Inspect COPY/load failures from STL_LOAD_ERRORS.",
            executionKind: "sql",
            readonly: true,
            commandPreview: "SELECT * FROM stl_load_errors ORDER BY starttime DESC LIMIT 100;",
          },
        ],
        ["Redshift system-table inspection is prepared.", "Load and query failure logs are available."]
      );
    },
    runDiagnostic(_connection, action) {
      return {
        summary: `Prepared Redshift ${action} diagnostic.`,
        evidence: [
          action === "fetch_logs"
            ? "Redshift STL_LOAD_ERRORS and query logs should be inspected before reruns."
            : "Read-only system-table inspection is available.",
        ],
      };
    },
    runGuardedAction(_connection, action) {
      return {
        summary: `Redshift action ${action} is guarded and requires explicit approval.`,
        approvalRequired: true,
      };
    },
  };
}

function buildPostgresAdapter(): ConnectorAdapterDefinition {
  return {
    adapterId: "warehouse-postgresql",
    tool: "PostgreSQL",
    family: "warehouse",
    docsUrl: getConnectionGuidance("PostgreSQL", "warehouse").docsUrl,
    testConnection(connection) {
      if (!connection.details?.host && !connection.target) {
        return warningResult("warehouse-postgresql", "Missing PostgreSQL host.", [
          "Provide the server host so schemas, tables, and statement activity can be inspected.",
        ]);
      }
      return passResult("warehouse-postgresql", "PostgreSQL connection blueprint looks ready.", [
        `Host: ${connection.details?.host ?? connection.target}`,
        `Database: ${connection.details?.database ?? "not specified"}`,
      ]);
    },
    inspect(connection) {
      const database = connection.details?.database ?? "postgres";
      return buildGenericInspect(
        connection,
        [
          {
            surface: "schemas",
            count: 6,
            summary: "Schema inventory can be inspected for warehouse coverage.",
            evidence: ["Schema and table activity can reveal transform and reporting domains."],
          },
          {
            surface: "statement_stats",
            count: 1,
            summary: "Statement and lock surfaces can be inspected for recent failures and contention.",
            evidence: ["pg_stat_activity is usually the fastest signal for blocked or failing queries."],
          },
          {
            surface: "logs",
            count: 1,
            summary: "Database log access can be used to inspect recent errors if enabled.",
            evidence: ["Postgres logs are valuable for auth and lock-timeout issues."],
          },
        ],
        [
          {
            id: "postgres-activity",
            tool: "PostgreSQL",
            surface: "Activity",
            purpose: "Inspect pg_stat_activity for blocked and failing sessions.",
            executionKind: "sql",
            readonly: true,
            commandPreview: `SELECT * FROM pg_stat_activity WHERE datname = '${database}';`,
          },
          {
            id: "postgres-tables",
            tool: "PostgreSQL",
            surface: "Tables",
            purpose: "Inspect table freshness and row-change signals.",
            executionKind: "sql",
            readonly: true,
            commandPreview: "SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables;",
          },
        ],
        ["PostgreSQL activity and table surfaces prepared.", "Read-only log inspection can be layered on when log access is available."]
      );
    },
    runDiagnostic(_connection, action) {
      return {
        summary: `Prepared PostgreSQL ${action} diagnostic.`,
        evidence: [
          action === "fetch_logs"
            ? "PostgreSQL error and connection logs should be read before restarting a downstream process."
            : "Read-only activity and table inspection are available.",
        ],
      };
    },
    runGuardedAction(_connection, action) {
      return {
        summary: `PostgreSQL action ${action} is guarded and requires explicit approval.`,
        approvalRequired: true,
      };
    },
  };
}

function buildS3Adapter(): ConnectorAdapterDefinition {
  return {
    adapterId: "storage-s3",
    tool: "Amazon S3",
    family: "storage",
    docsUrl: getConnectionGuidance("Amazon S3", "storage").docsUrl,
    testConnection(connection) {
      if (!connection.details?.bucket && !connection.target) {
        return warningResult("storage-s3", "Missing S3 bucket or target path.", [
          "Provide the bucket so prefixes and object metadata can be inspected.",
        ]);
      }
      return passResult("storage-s3", "Amazon S3 connection blueprint looks ready.", [
        `Bucket: ${connection.details?.bucket ?? connection.target}`,
      ]);
    },
    inspect(connection) {
      const bucket = connection.details?.bucket ?? connection.target ?? "<bucket>";
      return buildGenericInspect(
        connection,
        [
          {
            surface: "prefixes",
            count: 5,
            summary: "S3 prefixes can be inspected for ingestion landing zones and partitions.",
            evidence: ["Prefix shape often maps directly to upstream source systems and load cadence."],
          },
          {
            surface: "object_metadata",
            count: 12,
            summary: "Object timestamps can be inspected for freshness and quiet-path detection.",
            evidence: ["Last-modified times help separate source silence from warehouse failure."],
          },
        ],
        [
          {
            id: "s3-prefixes",
            tool: "Amazon S3",
            surface: "Prefixes",
            purpose: "Inspect buckets and prefixes for partition cadence and landing structure.",
            executionKind: "api",
            readonly: true,
            commandPreview: `ListObjectsV2 bucket=${bucket}`,
          },
        ],
        ["Amazon S3 bucket and prefix metadata prepared."]
      );
    },
    runDiagnostic(_connection, action) {
      return {
        summary: `Prepared Amazon S3 ${action} diagnostic.`,
        evidence: ["Read-only prefix and object-metadata inspection are available."],
      };
    },
    runGuardedAction(_connection, action) {
      return {
        summary: `Amazon S3 action ${action} is guarded and requires explicit approval.`,
        approvalRequired: true,
      };
    },
  };
}

function buildTableauAdapter(): ConnectorAdapterDefinition {
  return {
    adapterId: "bi-tableau",
    tool: "Tableau",
    family: "bi",
    docsUrl: getConnectionGuidance("Tableau", "bi").docsUrl,
    testConnection(connection) {
      if (!connection.details?.server_url && !connection.target) {
        return warningResult("bi-tableau", "Missing Tableau server URL.", [
          "Provide the Tableau host so workbooks and refresh tasks can be inspected.",
        ]);
      }
      return passResult("bi-tableau", "Tableau connection blueprint looks ready.", [
        `Host: ${connection.details?.server_url ?? connection.target}`,
        `Site: ${connection.details?.site_content_url ?? "default"}`,
      ]);
    },
    inspect(connection) {
      const server = connection.details?.server_url ?? connection.target ?? "tableau";
      return buildGenericInspect(
        connection,
        [
          {
            surface: "workbooks",
            count: 9,
            summary: "Workbook inventory can be inspected for downstream reporting coverage.",
            evidence: ["Workbook ownership helps identify who is impacted by freshness issues."],
          },
          {
            surface: "extract_refreshes",
            count: 4,
            summary: "Extract refresh tasks can be inspected for downstream stale-dashboard symptoms.",
            evidence: ["Refresh failures often look like BI issues but originate upstream."],
          },
          {
            surface: "logs",
            count: 1,
            summary: "Task and refresh failure details can be fetched for recent runs.",
            evidence: ["Refresh task output is the fastest route to Tableau-specific root cause."],
          },
        ],
        [
          {
            id: "tableau-workbooks",
            tool: "Tableau",
            surface: "Workbooks",
            purpose: "Inspect workbook inventory and owners.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET ${server}/api/3.20/sites/{site}/workbooks`,
          },
            {
              id: "tableau-refreshes",
              tool: "Tableau",
              surface: "Refresh tasks",
              purpose: "Read extract refresh tasks and recent failures.",
              executionKind: "api",
              readonly: true,
              commandPreview: `GET ${server}/api/3.20/sites/{site}/tasks/extractRefreshes`,
            },
            {
              id: "tableau-jobs",
              tool: "Tableau",
              surface: "Jobs",
              purpose: "Read Tableau jobs and backgrounder outcomes for extract and workbook refresh work.",
              executionKind: "api",
              readonly: true,
              commandPreview: `GET ${server}/api/3.20/sites/{site}/jobs`,
            },
          ],
        ["Tableau workbook and extract-refresh metadata prepared."]
      );
    },
    runDiagnostic(_connection, action) {
      return {
        summary: `Prepared Tableau ${action} diagnostic.`,
        evidence: [
          action === "fetch_logs"
            ? "Tableau refresh-task output should be read before refreshing extracts again."
            : "Read-only workbook and refresh-task inspection are available.",
        ],
      };
    },
    runGuardedAction(_connection, action) {
      return {
        summary: `Tableau action ${action} is guarded and requires explicit approval.`,
        approvalRequired: true,
      };
    },
  };
}

function buildPowerBiAdapter(): ConnectorAdapterDefinition {
  return {
    adapterId: "bi-power-bi",
    tool: "Power BI",
    family: "bi",
    docsUrl: getConnectionGuidance("Power BI", "bi").docsUrl,
    testConnection(connection) {
      const tenant = connection.details?.tenant_id ?? connection.target;
      if (!tenant) {
        return warningResult("bi-power-bi", "Missing Power BI tenant or workspace context.", [
          "Provide tenant/workspace details so datasets and refresh runs can be inspected.",
        ]);
      }
      return passResult("bi-power-bi", "Power BI connection blueprint looks ready.", [
        `Tenant/workspace: ${tenant}`,
      ]);
      },
      inspect(connection) {
        const groupId = connection.details?.group_id ?? "<groupId>";
        const datasetId = connection.details?.dataset_id ?? "<datasetId>";
        return buildGenericInspect(
          connection,
        [
          {
            surface: "datasets",
            count: 8,
            summary: "Dataset inventory can be inspected for stale semantic models.",
            evidence: ["Dataset refresh failures often explain dashboard issues downstream."],
          },
          {
            surface: "refreshes",
            count: 5,
            summary: "Refresh history can be inspected for failed and delayed refresh jobs.",
            evidence: ["Refresh history is the best signal before blaming report visuals."],
          },
          {
            surface: "logs",
            count: 1,
            summary: "Refresh error payloads can be inspected for recent failures.",
            evidence: ["Refresh error messages help separate upstream data and BI-specific issues."],
          },
        ],
        [
            {
              id: "powerbi-datasets",
              tool: "Power BI",
              surface: "Datasets",
              purpose: "Inspect semantic model inventory and refresh surfaces.",
              executionKind: "api",
              readonly: true,
              commandPreview: `GET https://api.powerbi.com/v1.0/myorg/groups/${groupId}/datasets`,
            },
            {
              id: "powerbi-refreshes",
              tool: "Power BI",
              surface: "Refresh history",
              purpose: "Read refresh history for failures and delay patterns.",
              executionKind: "api",
              readonly: true,
              commandPreview: `GET https://api.powerbi.com/v1.0/myorg/groups/${groupId}/datasets/${datasetId}/refreshes?$top=10`,
            },
            {
              id: "powerbi-refresh-attempts",
              tool: "Power BI",
              surface: "Refresh attempts",
              purpose: "Inspect refresh attempt details and serviceExceptionJson to isolate credential and gateway failures.",
              executionKind: "api",
              readonly: true,
              commandPreview: `GET https://api.powerbi.com/v1.0/myorg/groups/${groupId}/datasets/${datasetId}/refreshes?$top=1`,
            },
          ],
          ["Power BI dataset and refresh metadata prepared."]
        );
    },
    runDiagnostic(_connection, action) {
      return {
        summary: `Prepared Power BI ${action} diagnostic.`,
        evidence: [
          action === "fetch_logs"
            ? "Power BI refresh failure details should be inspected before forcing another refresh."
            : "Read-only dataset and refresh inspection are available.",
        ],
      };
    },
    runGuardedAction(_connection, action) {
      return {
        summary: `Power BI action ${action} is guarded and requires explicit approval.`,
        approvalRequired: true,
      };
    },
  };
}

function buildSupersetAdapter(): ConnectorAdapterDefinition {
  return {
    adapterId: "bi-apache-superset",
    tool: "Apache Superset",
    family: "bi",
    docsUrl: getConnectionGuidance("Apache Superset", "bi").docsUrl,
    testConnection(connection) {
      const baseUrl = connection.details?.base_url ?? connection.target;
      if (!baseUrl) {
        return warningResult("bi-apache-superset", "Missing Superset host.", [
          "Provide the Superset URL so dashboards, datasets, and audit logs can be inspected.",
        ]);
      }
      return passResult("bi-apache-superset", "Superset connection blueprint looks ready.", [
        `Host: ${baseUrl}`,
        `Auth: ${connection.authMethod}`,
      ]);
    },
    inspect(connection) {
      const baseUrl = connection.details?.base_url ?? connection.target ?? "superset";
      return buildGenericInspect(
        connection,
        [
          {
            surface: "dashboards",
            count: 11,
            summary: "Superset dashboards can be inspected for impacted BI endpoints.",
            evidence: ["Dashboard and chart metadata reveal which datasets are surfacing stale data."],
          },
          {
            surface: "datasets",
            count: 14,
            summary: "Dataset metadata can be inspected for related objects and schema refresh risk.",
            evidence: ["Dataset refresh and related-object counts help identify blast radius."],
          },
          {
            surface: "charts",
            count: 16,
            summary: "Chart metadata can be inspected for repeated visualization or datasource failures.",
            evidence: [
              "Chart-level issues often explain why only part of a dashboard is broken.",
              "Chart metadata is useful for separating dataset issues from rendering or permission drift.",
            ],
          },
          {
            surface: "audit_logs",
            count: 20,
            summary: "Superset audit logs and recent activity can be inspected for user-facing errors and access issues.",
            evidence: ["Log REST API is useful for catching permission failures and chart-data errors."],
          },
          {
            surface: "database_connections",
            count: 4,
            summary: "Database and datasource metadata can be inspected for broken credentials and stale metadata.",
            evidence: [
              "Datasource credential failures often surface as dashboard errors before users understand the underlying cause.",
              "Connection metadata helps isolate whether Superset or the upstream warehouse is the failing layer.",
            ],
          },
        ],
        [
          {
            id: "superset-dashboards",
            tool: "Apache Superset",
            surface: "Dashboards",
            purpose: "Inspect dashboard inventory, chart definitions, and attached datasets.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET ${baseUrl}/api/v1/dashboard/ and /api/v1/dashboard/{id_or_slug}/datasets`,
          },
          {
            id: "superset-datasets",
            tool: "Apache Superset",
            surface: "Datasets",
            purpose: "Inspect datasets and related objects to identify impacted dashboards and charts.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET ${baseUrl}/api/v1/dataset/ and /api/v1/dataset/{id}/related_objects`,
          },
          {
            id: "superset-charts",
            tool: "Apache Superset",
            surface: "Charts",
            purpose: "Inspect chart definitions tied to impacted dashboards and datasets.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET ${baseUrl}/api/v1/chart/`,
          },
          {
            id: "superset-databases",
            tool: "Apache Superset",
            surface: "Databases",
            purpose: "Inspect datasource and database metadata for credential or schema drift.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET ${baseUrl}/api/v1/database/`,
          },
          {
            id: "superset-logs",
            tool: "Apache Superset",
            surface: "Audit logs",
            purpose: "Inspect audit logs and recent activity for BI-facing failures and permission issues.",
            executionKind: "api",
            readonly: true,
            commandPreview: `GET ${baseUrl}/api/v1/log/ and /api/v1/log/recent_activity/`,
          },
        ],
        [
          "Superset dashboard, chart, dataset, database, and audit-log metadata prepared.",
        ]
      );
    },
    runDiagnostic(connection, action) {
      const baseUrl = connection.details?.base_url ?? connection.target ?? "superset";
      if (action === "query") {
        return {
          summary: "Prepared read-only Superset inspection shell.",
          evidence: [
            `Superset host: ${baseUrl}`,
            "Good demo-safe reads include dashboards, charts, datasets, databases, audit logs, and recent activity.",
            "Use these surfaces to separate BI-layer issues from upstream warehouse freshness and auth issues.",
          ],
        };
      }

      if (action === "fetch_logs") {
        return {
          summary: "Prepared Superset audit-log and recent-activity inspection.",
          evidence: [
            "Audit logs, recent activity, and datasource metadata are the main read-only failure surfaces for Superset.",
            "These help catch permission issues, dataset drift, and chart-data failures quickly.",
          ],
        };
      }

      if (action === "validate") {
        return {
          summary: "Prepared Superset dashboard and datasource validation checks.",
          evidence: [
            "Validate dashboard/chart failures, dataset drift, datasource credentials, permission drift, and upstream freshness mismatch together.",
          ],
        };
      }

      return {
        summary: `Prepared Superset ${action} diagnostic.`,
        evidence: [
          action === "fetch_logs"
            ? "Superset audit-log and recent-activity endpoints should be inspected before refreshing dashboards or datasets."
            : "Read-only dashboard, chart, dataset, database, and audit-log inspection are available.",
        ],
      };
    },
    runGuardedAction(_connection, action) {
      return {
        summary: `Superset action ${action} is guarded and requires explicit approval.`,
        approvalRequired: true,
      };
    },
  };
}

function buildConfluentAdapter(): ConnectorAdapterDefinition {
  return {
    adapterId: "streaming-confluent",
    tool: "Confluent",
    family: "streaming",
    docsUrl: getConnectionGuidance("Confluent", "streaming").docsUrl,
    testConnection(connection) {
      if (!connection.details?.base_url && !connection.details?.bootstrap_servers && !connection.target) {
        return warningResult("streaming-confluent", "Missing Confluent cluster endpoint.", [
          "Provide the cluster URL or bootstrap servers so topics and connectors can be inspected.",
        ]);
      }
      return passResult("streaming-confluent", "Confluent connection blueprint looks ready.", [
        `Endpoint: ${connection.details?.base_url ?? connection.details?.bootstrap_servers ?? connection.target}`,
      ]);
    },
    inspect(connection) {
      return buildGenericInspect(
        connection,
        [
          {
            surface: "topics",
            count: 10,
            summary: "Topic inventory can be inspected for producer and consumer flow.",
            evidence: ["Topic and partition health are core streaming root-cause signals."],
          },
          {
            surface: "connectors",
            count: 3,
            summary: "Managed connectors can be inspected for source and sink failures.",
            evidence: ["Connector status often reveals whether lag is upstream or downstream."],
          },
          {
            surface: "logs",
            count: 1,
            summary: "Connector and consumer-group error details can be inspected.",
            evidence: ["Connector failures are usually more actionable than raw lag metrics alone."],
          },
        ],
        [
          {
            id: "confluent-topics",
            tool: "Confluent",
            surface: "Topics and lag",
            purpose: "Inspect topics, partitions, and consumer lag.",
            executionKind: "api",
            readonly: true,
            commandPreview: "GET /kafka/v3/clusters/{clusterId}/topics and consumer-groups",
          },
          {
            id: "confluent-connectors",
            tool: "Confluent",
            surface: "Connectors",
            purpose: "Inspect managed connector status and failure state.",
            executionKind: "api",
            readonly: true,
            commandPreview: "GET /connect/v1/environments/{env}/clusters/{cluster}/connectors",
          },
        ],
        ["Confluent topic, lag, and connector metadata prepared."]
      );
    },
    runDiagnostic(_connection, action) {
      return {
        summary: `Prepared Confluent ${action} diagnostic.`,
        evidence: [
          action === "fetch_logs"
            ? "Connector and consumer-group error details should be inspected before restart actions."
            : "Read-only topic, lag, and connector inspection are available.",
        ],
      };
    },
    runGuardedAction(_connection, action) {
      return {
        summary: `Confluent action ${action} is guarded and requires explicit approval.`,
        approvalRequired: true,
      };
    },
  };
}

function buildGenericAdapter(
  tool: string,
  family: ConnectorFamily,
  adapterId: string
): ConnectorAdapterDefinition {
  return {
    adapterId,
    tool,
    family,
    docsUrl: getConnectionGuidance(tool, family).docsUrl,
    testConnection(connection) {
      const preview = detailsPreview(connection, ["host", "base_url", "account", "project_id"]);
      return passResult(adapterId, `${tool} connection saved.`, [
        preview || "Tool-specific validation scaffolded for this connector.",
      ]);
    },
    inspect(connection) {
      return buildGenericInspect(
        connection,
        [
          {
            surface: "metadata",
            count: 1,
            summary: `${tool} metadata surface is available through the adapter contract.`,
            evidence: ["This connector is using the generic adapter scaffold for now."],
          },
        ],
        [
          {
            id: `${adapterId}-inspect`,
            tool,
            surface: "Metadata",
            purpose: "Inspect connector metadata through the generic adapter surface.",
            executionKind: family === "warehouse" ? "sql" : "api",
            readonly: true,
            commandPreview: `adapter=${adapterId} action=inspect`,
          },
        ],
        [`${tool} metadata scaffold prepared.`]
      );
    },
    runDiagnostic(connection, action) {
      return {
        summary: `Prepared ${tool} ${action} diagnostic.`,
        evidence: [`Generic ${family} adapter contract is active for ${tool}.`],
      };
    },
    runGuardedAction(_connection, action) {
      return {
        summary: `${tool} action ${action} is guarded and requires explicit approval.`,
        approvalRequired: true,
      };
    },
  };
}

const coreAdapters = [
  buildSnowflakeAdapter(),
  buildAirflowAdapter(),
  buildFivetranAdapter(),
  buildKafkaAdapter(),
  buildLookerAdapter(),
  buildAirbyteAdapter(),
  buildDatabricksAdapter(),
  buildDbtAdapter(),
  buildBigQueryAdapter(),
  buildRedshiftAdapter(),
  buildPostgresAdapter(),
  buildS3Adapter(),
  buildTableauAdapter(),
  buildPowerBiAdapter(),
  buildSupersetAdapter(),
  buildConfluentAdapter(),
];

const adapterMap = new Map(coreAdapters.map((adapter) => [adapter.tool.toLowerCase(), adapter]));

export function resolveAdapterRecord(tool: string, family: ConnectorFamily, adapterId: string) {
  return (
    adapterMap.get(tool.toLowerCase()) ??
    buildGenericAdapter(tool, family, adapterId)
  );
}

export function buildSnapshotFromInspect(
  connection: StoredConnectionRecord,
  inspect: AdapterInspectResponse,
  test: AdapterTestResponse,
  pipeline?: PipelineIdentifierResult | null
): AdapterSnapshot {
  return {
    connectionId: connection.connectionId,
    tool: connection.tool,
    adapterId: connection.adapterId,
    family: connection.family,
    lastTestResult: test,
    metadataSyncedAt: new Date().toISOString(),
    health: test.status,
    surfaces: inspect.surfaces,
    diagnostics: {
      freshnessMinutes: inspect.surfaces.find((surface) => surface.surface === "connectors")
        ? 15
        : 45,
      rowCount: inspect.surfaces.length * 1200,
      nullRate: 0.01,
      lastValidationStatus: test.ok ? "pass" : "warn",
    },
    pipeline: pipeline ?? undefined,
    activity: inspect.activity,
  };
}

export function validateConnectionRequest(
  request: ConnectionRequest,
  requiredFields: string[]
) {
  const details = request.details ?? {};
  return requiredFields.every((field) => details[field]?.trim());
}
