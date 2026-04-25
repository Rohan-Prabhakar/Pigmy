import type { ConnectorFamily, ConnectorProfile } from "./types";

const familyDefaults: Record<
  ConnectorFamily,
  Omit<ConnectorProfile, "name" | "family" | "adapterId">
> = {
  ingestion: {
    supportLevel: "deep",
    notes: "Good metadata and command surfaces for EL / ingestion systems.",
    defaultCapabilities: [
      {
        action: "discover",
        executionKind: "api",
        requiresApproval: false,
        description: "Inspect connector configs, jobs, and sync state.",
      },
      {
        action: "inspect",
        executionKind: "api",
        requiresApproval: false,
        description: "Fetch logs and run metadata for a connector.",
      },
      {
        action: "restart",
        executionKind: "api",
        requiresApproval: true,
        description: "Restart a connector or sync job.",
      },
      {
        action: "test_connection",
        executionKind: "api",
        requiresApproval: false,
        description: "Verify access and runtime health.",
      },
    ],
  },
  orchestration: {
    supportLevel: "deep",
    notes: "Strong DAG, run, and retry semantics.",
    defaultCapabilities: [
      {
        action: "discover",
        executionKind: "api",
        requiresApproval: false,
        description: "Inspect DAGs, schedules, and task dependencies.",
      },
      {
        action: "inspect",
        executionKind: "api",
        requiresApproval: false,
        description: "Read task logs, retries, and task state.",
      },
      {
        action: "trigger",
        executionKind: "api",
        requiresApproval: true,
        description: "Trigger a job or workflow run.",
      },
      {
        action: "pause",
        executionKind: "api",
        requiresApproval: true,
        description: "Pause a DAG, flow, or workflow.",
      },
      {
        action: "resume",
        executionKind: "api",
        requiresApproval: true,
        description: "Resume a paused workflow.",
      },
    ],
  },
  compute: {
    supportLevel: "deep",
    notes: "Useful for execution, job logs, and model/transform runs.",
    defaultCapabilities: [
      {
        action: "discover",
        executionKind: "sdk",
        requiresApproval: false,
        description: "Inspect jobs, notebooks, models, and pipelines.",
      },
      {
        action: "run",
        executionKind: "sdk",
        requiresApproval: true,
        description: "Execute a job, notebook, or transform.",
      },
      {
        action: "query",
        executionKind: "sdk",
        requiresApproval: false,
        description: "Run read-only metadata and runtime inspection queries.",
      },
      {
        action: "inspect",
        executionKind: "sdk",
        requiresApproval: false,
        description: "Fetch logs and run history.",
      },
    ],
  },
  warehouse: {
    supportLevel: "deep",
    notes: "Good for SQL, lineage, freshness, and schema change surfaces.",
    defaultCapabilities: [
      {
        action: "discover",
        executionKind: "sql",
        requiresApproval: false,
        description: "Inspect schemas, tables, roles, and query history.",
      },
      {
        action: "query",
        executionKind: "sql",
        requiresApproval: false,
        description: "Run read-only inspection queries.",
      },
      {
        action: "refresh",
        executionKind: "sql",
        requiresApproval: true,
        description: "Refresh a table, view, or materialization.",
      },
      {
        action: "validate",
        executionKind: "sql",
        requiresApproval: false,
        description: "Check freshness, row counts, or drift signals.",
      },
    ],
  },
  table_format: {
    supportLevel: "medium",
    notes: "Metadata and validation are stronger than execution.",
    defaultCapabilities: [
      {
        action: "discover",
        executionKind: "none",
        requiresApproval: false,
        description: "Inspect manifests and file metadata.",
      },
      {
        action: "validate",
        executionKind: "none",
        requiresApproval: false,
        description: "Validate file structure and table format health.",
      },
    ],
  },
  storage: {
    supportLevel: "medium",
    notes: "Good for object discovery, inventory, and path validation.",
    defaultCapabilities: [
      {
        action: "discover",
        executionKind: "api",
        requiresApproval: false,
        description: "Inspect buckets, containers, prefixes, and paths.",
      },
      {
        action: "fetch_metadata",
        executionKind: "api",
        requiresApproval: false,
        description: "Read object metadata and access patterns.",
      },
    ],
  },
  streaming: {
    supportLevel: "deep",
    notes: "Excellent for topics, consumers, schema registry, and lag.",
    defaultCapabilities: [
      {
        action: "discover",
        executionKind: "api",
        requiresApproval: false,
        description: "Inspect topics, brokers, consumers, and schemas.",
      },
      {
        action: "inspect",
        executionKind: "api",
        requiresApproval: false,
        description: "Fetch lag, offsets, and topic health.",
      },
      {
        action: "restart",
        executionKind: "api",
        requiresApproval: true,
        description: "Restart a connector or consumer group worker.",
      },
    ],
  },
  bi: {
    supportLevel: "medium",
    notes: "Focus on refresh, usage, and downstream impact.",
    defaultCapabilities: [
      {
        action: "discover",
        executionKind: "api",
        requiresApproval: false,
        description: "Inspect dashboards, models, and refresh history.",
      },
      {
        action: "refresh",
        executionKind: "api",
        requiresApproval: true,
        description: "Refresh a dashboard or semantic layer.",
      },
      {
        action: "query",
        executionKind: "api",
        requiresApproval: false,
        description: "Run read-only dashboard, model, and metadata inspection queries.",
      },
      {
        action: "inspect",
        executionKind: "api",
        requiresApproval: false,
        description: "Read usage and error metadata.",
      },
    ],
  },
  quality: {
    supportLevel: "medium",
    notes: "Reserved for internal rule execution, not user-managed connectors.",
    defaultCapabilities: [],
  },
  monitoring: {
    supportLevel: "medium",
    notes: "Reserved for internal telemetry, not user-managed connectors.",
    defaultCapabilities: [],
  },
  infrastructure: {
    supportLevel: "medium",
    notes: "Infrastructure actions need stricter approval and audit.",
    defaultCapabilities: [
      {
        action: "discover",
        executionKind: "cli",
        requiresApproval: false,
        description: "Inspect resources, jobs, or deployment metadata.",
      },
      {
        action: "deploy",
        executionKind: "cli",
        requiresApproval: true,
        description: "Apply an infrastructure or CI/CD change.",
      },
      {
        action: "restart",
        executionKind: "cli",
        requiresApproval: true,
        description: "Restart a container, pod, or service.",
      },
    ],
  },
};

function makeProfile(name: string, family: ConnectorFamily): ConnectorProfile {
  return {
    name,
    family,
    adapterId: `${family}-adapter`,
    ...familyDefaults[family],
  };
}

export const CONNECTOR_CATALOG: ConnectorProfile[] = [
  // Ingestion / EL
  makeProfile("Fivetran", "ingestion"),
  makeProfile("Airbyte", "ingestion"),
  makeProfile("AWS Glue", "ingestion"),
  makeProfile("Azure Data Factory", "ingestion"),
  makeProfile("Matillion", "ingestion"),
  // Orchestration
  makeProfile("Apache Airflow", "orchestration"),
  makeProfile("Prefect", "orchestration"),
  makeProfile("Dagster", "orchestration"),
  makeProfile("Argo Workflows", "orchestration"),
  makeProfile("Kestra", "orchestration"),
  // Compute / Transform
  makeProfile("Databricks", "compute"),
  makeProfile("dbt", "compute"),
  makeProfile("Apache Spark", "compute"),
  makeProfile("Apache Flink", "compute"),
  makeProfile("Apache Beam", "compute"),
  makeProfile("PySpark", "compute"),
  // Warehouse / Database
  makeProfile("Snowflake", "warehouse"),
  makeProfile("Google BigQuery", "warehouse"),
  makeProfile("Amazon Redshift", "warehouse"),
  makeProfile("ClickHouse", "warehouse"),
  makeProfile("DuckDB", "warehouse"),
  makeProfile("PostgreSQL", "warehouse"),
  // Table Formats / File Formats
  makeProfile("Delta Lake", "table_format"),
  makeProfile("Apache Iceberg", "table_format"),
  makeProfile("Apache Hudi", "table_format"),
  makeProfile("Apache Parquet", "table_format"),
  makeProfile("Apache Avro", "table_format"),
  // Storage
  makeProfile("Amazon S3", "storage"),
  makeProfile("Google Cloud Storage", "storage"),
  makeProfile("Azure Blob / ADLS", "storage"),
  makeProfile("HDFS", "storage"),
  makeProfile("MinIO", "storage"),
  // Streaming
  makeProfile("Apache Kafka", "streaming"),
  makeProfile("Confluent", "streaming"),
  makeProfile("Amazon Kinesis", "streaming"),
  makeProfile("Kafka Connect", "streaming"),
  makeProfile("Schema Registry", "streaming"),
  // BI / Visualization
  makeProfile("Looker", "bi"),
  makeProfile("Tableau", "bi"),
  makeProfile("Power BI", "bi"),
  makeProfile("Metabase", "bi"),
  makeProfile("Apache Superset", "bi"),
  // Infrastructure
  makeProfile("Docker", "infrastructure"),
  makeProfile("Kubernetes", "infrastructure"),
  makeProfile("Terraform", "infrastructure"),
  makeProfile("Jenkins", "infrastructure"),
  makeProfile("GitHub Actions", "infrastructure"),
];

export function findConnectorProfile(tool: string) {
  const normalized = tool.trim().toLowerCase();

  return CONNECTOR_CATALOG.find(
    (profile) => profile.name.toLowerCase() === normalized
  );
}

export function groupConnectorsByFamily() {
  return CONNECTOR_CATALOG.reduce<Record<ConnectorFamily, ConnectorProfile[]>>(
    (groups, profile) => {
      groups[profile.family].push(profile);
      return groups;
    },
    {
      ingestion: [],
      orchestration: [],
      compute: [],
      warehouse: [],
      table_format: [],
      storage: [],
      streaming: [],
      quality: [],
      bi: [],
      monitoring: [],
      infrastructure: [],
    }
  );
}
