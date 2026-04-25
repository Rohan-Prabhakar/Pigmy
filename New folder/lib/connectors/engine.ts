import {
  CONNECTOR_CATALOG,
  findConnectorProfile,
  groupConnectorsByFamily,
} from "./catalog";
import { getConnectionGuidance } from "./connection-guidance";
import type { StoredConnection } from "./credentials";
import type {
  CommandEnvelope,
  ConnectorActionRequest,
  ConnectorConnection,
  ConnectorConnectionRequest,
  ConnectorDiscoveryNode,
  ConnectorDiscoveryResult,
  PipelineIdentifierEdge,
  PipelineInspectionStep,
  PipelineIdentifierNode,
  PipelineIdentifierResult,
  ConnectorProfile,
} from "./types";

function createConnectionId(tool: string, workspaceId?: string) {
  const suffix = workspaceId ? workspaceId.slice(0, 8) : "local";
  return `${tool.toLowerCase().replace(/\s+/g, "-")}-${suffix}`;
}

function buildDiscoveryNodes(profile: ConnectorProfile): ConnectorDiscoveryNode[] {
  const familyPriority = [
    profile.family,
    profile.family === "warehouse" ? "orchestration" : "warehouse",
    profile.family === "orchestration" ? "compute" : "streaming",
  ] as const;

  return familyPriority.map((family, index) => ({
    id: `${profile.name.toLowerCase().replace(/\s+/g, "-")}-${family}`,
    label: `${family.replace("_", " ")} layer`,
    family,
    confidence: Math.max(0.45, 0.9 - index * 0.15),
  }));
}

function inferExecutionKind(profile: ConnectorProfile, action: ConnectorActionRequest["action"]): CommandEnvelope["executionKind"] {
  if (profile.family === "warehouse") return "sql";
  if (profile.family === "infrastructure") return "cli";
  if (profile.family === "streaming" || profile.family === "monitoring") return "http";
  return "api";
}

function buildCommand(profile: ConnectorProfile, action: ConnectorActionRequest["action"], target?: string): CommandEnvelope {
  const capability = profile.defaultCapabilities.find((item) => item.action === action);
  const executionKind = capability?.executionKind ?? inferExecutionKind(profile, action);
  const requiresApproval = capability?.requiresApproval ?? action !== "discover";

  const command = [
    `adapter=${profile.adapterId}`,
    `tool=${profile.name}`,
    `action=${action}`,
    target ? `target=${target}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    tool: profile.name,
    family: profile.family,
    action,
    executionKind,
    command,
    requiresApproval,
    risk: requiresApproval ? "medium" : "low",
    notes:
      capability?.description ??
      "This adapter uses a shared connector plan. Wire a real executor before enabling destructive actions.",
    target,
  };
}

export function connectTool(request: ConnectorConnectionRequest): ConnectorDiscoveryResult {
  const profile = findConnectorProfile(request.tool);
  if (!profile) {
    throw new Error(`Unsupported connector: ${request.tool}`);
  }

  const connection: ConnectorConnection = {
    connectionId: createConnectionId(profile.name, request.workspaceId),
    tool: profile.name,
    family: profile.family,
    status: "connected",
    connectedAt: new Date().toISOString(),
    target: request.target,
  };

  return {
    connection,
    discovered: buildDiscoveryNodes(profile),
    nextActions: profile.defaultCapabilities,
  };
}

export function planConnectorAction(request: ConnectorActionRequest) {
  const profile = findConnectorProfile(request.tool);
  if (!profile) {
    throw new Error(`Unsupported connector: ${request.tool}`);
  }

  const guidance = getConnectionGuidance(profile.name, profile.family);
  if (!guidance.availableActions.includes(request.action)) {
    throw new Error(
      `${request.action} is not enabled for ${profile.name} until this connector blueprint supports it`
    );
  }

  return buildCommand(profile, request.action, request.target);
}

export function listConnectorCatalog() {
  return {
    grouped: groupConnectorsByFamily(),
    total: CONNECTOR_CATALOG.length,
  };
}

function makePipelineNode(
  id: string,
  tool: string,
  label: string,
  region: PipelineIdentifierNode["region"],
  confidence: number,
  inferredFrom: string[],
  status: PipelineIdentifierNode["status"] = "discovered",
  authHint?: string
): PipelineIdentifierNode {
  return { id, tool, label, region, confidence, inferredFrom, status, authHint };
}

function addEdge(
  edges: PipelineIdentifierEdge[],
  from: string,
  to: string,
  label: string,
  confidence: number
) {
  edges.push({ from, to, label, confidence });
}

function safeHostname(value?: string) {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function regionFromFamily(
  family: StoredConnection["family"]
): PipelineIdentifierNode["region"] {
  switch (family) {
    case "ingestion":
      return "ingestion";
    case "orchestration":
      return "orchestration";
    case "compute":
      return "transform";
    case "warehouse":
      return "warehouse";
    case "table_format":
      return "warehouse";
    case "storage":
      return "source";
    case "streaming":
      return "streaming";
    case "quality":
      return "quality";
    case "bi":
      return "bi";
    case "monitoring":
      return "monitoring";
    case "infrastructure":
      return "infrastructure";
  }
}

function makeInspectionStep(
  id: string,
  tool: string,
  surface: string,
  purpose: string,
  executionKind: PipelineInspectionStep["executionKind"],
  readonly: boolean,
  commandPreview: string
): PipelineInspectionStep {
  return {
    id,
    tool,
    surface,
    purpose,
    executionKind,
    readonly,
    commandPreview,
  };
}

const regionOrder: PipelineIdentifierNode["region"][] = [
  "source",
  "ingestion",
  "streaming",
  "orchestration",
  "transform",
  "warehouse",
  "quality",
  "bi",
  "monitoring",
  "reverse_etl",
  "infrastructure",
];

function normalizeIdPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function nodeIdForConnection(connection: StoredConnection) {
  return `saved-${normalizeIdPart(connection.tool)}-${normalizeIdPart(connection.connectionId)}`;
}

function mergeSavedConnections(
  baseResult: PipelineIdentifierResult,
  connections: StoredConnection[]
): PipelineIdentifierResult {
  if (!connections.length) {
    return baseResult;
  }

  const relevantConnections = connections
    .filter((connection) => connection.status === "connected")
    .sort(
      (left, right) =>
        regionOrder.indexOf(regionFromFamily(left.family)) -
        regionOrder.indexOf(regionFromFamily(right.family))
    );

  if (!relevantConnections.length) {
    return baseResult;
  }

  if (relevantConnections.length === 1) {
    const onlyConnection = relevantConnections[0];
    const anchorRegion = regionFromFamily(onlyConnection.family);
    const baseAnchorNode =
      baseResult.nodes.find((node) => node.region === anchorRegion) ??
      baseResult.nodes.find((node) => node.inferredFrom.includes("saved connection")) ??
      null;
    const savedAnchorNode = baseAnchorNode
      ? {
          ...baseAnchorNode,
          tool: onlyConnection.tool,
          label: onlyConnection.label || onlyConnection.tool,
          confidence: 0.98,
          inferredFrom: ["saved connection"],
          status: "connected" as const,
          authHint: undefined,
        }
      : makePipelineNode(
          nodeIdForConnection(onlyConnection),
          onlyConnection.tool,
          onlyConnection.label || onlyConnection.tool,
          anchorRegion,
          0.98,
          ["saved connection"],
          "connected"
        );
    const inferredNodes = baseResult.nodes.filter(
      (node) => !node.inferredFrom.includes("saved connection")
    );
    const inferredEdges = baseResult.edges.filter(
      (edge) =>
        inferredNodes.some((node) => node.id === edge.from) ||
        inferredNodes.some((node) => node.id === edge.to)
    );

    if (!inferredNodes.length) {
      return {
        ...baseResult,
        pipelineLabel: onlyConnection.tool,
        confidence: 0.96,
        nodes: [savedAnchorNode],
        edges: [],
        evidence: [
          `Showing only the saved anchor ${onlyConnection.tool} until more components are connected.`,
          ...baseResult.evidence,
        ],
      };
    }

    return {
      ...baseResult,
      pipelineLabel: baseResult.pipelineLabel,
      confidence: Math.max(baseResult.confidence, 0.84),
      nodes: [savedAnchorNode, ...inferredNodes],
      edges: inferredEdges,
      evidence: [
        `Showing ${onlyConnection.tool} as the live anchor plus ${inferredNodes.length} discovered component${inferredNodes.length === 1 ? "" : "s"} that still need direct auth or confirmation.`,
        ...baseResult.evidence,
      ],
    };
  }

  const mergedNodes: PipelineIdentifierNode[] = [];
  const mergedEdges: PipelineIdentifierEdge[] = [];
  const seenRegions = new Set<PipelineIdentifierNode["region"]>();

  for (const connection of relevantConnections) {
    const region = regionFromFamily(connection.family);
    if (seenRegions.has(region)) {
      continue;
    }
    seenRegions.add(region);

    mergedNodes.push(
      makePipelineNode(
        nodeIdForConnection(connection),
        connection.tool,
        connection.label || connection.tool,
        region,
        connection.connectionId === baseResult.anchorConnectionId ? 0.98 : 0.9,
        ["saved connection"],
        "connected"
      )
    );
  }

  if (mergedNodes.length >= 2) {
    for (let index = 0; index < mergedNodes.length - 1; index += 1) {
      const current = mergedNodes[index];
      const next = mergedNodes[index + 1];
      addEdge(mergedEdges, current.id, next.id, "connected flow", 0.86);
    }
  }

  const bridgeNodes = baseResult.nodes.filter(
    (node) => !seenRegions.has(node.region)
  );

  return {
    ...baseResult,
    pipelineLabel:
      mergedNodes.length > 1
        ? `${mergedNodes.map((node) => node.tool).join(" -> ")}`
        : baseResult.pipelineLabel,
    confidence: Math.max(baseResult.confidence, mergedNodes.length > 1 ? 0.88 : 0.72),
    nodes: [...mergedNodes, ...bridgeNodes],
    edges: mergedEdges.length ? [...mergedEdges, ...baseResult.edges] : baseResult.edges,
    evidence: [
      ...baseResult.evidence,
      `Used ${mergedNodes.length} saved connection${mergedNodes.length === 1 ? "" : "s"} to replace generic layer placeholders with actual tools.`,
    ],
  };
}

function detectFromSnowflake(connection: StoredConnection): PipelineIdentifierResult {
  const details = connection.details ?? {};
  const pipelineLabel = connection.label || connection.tool;
  const databaseName = details.database || "<database>";
  const inspectionPlan: PipelineInspectionStep[] = [
    makeInspectionStep(
      "snowflake-stages",
      "Snowflake",
      "Stages",
      "Identify external and internal stages that point back to source storage or ingest paths.",
      "sql",
      true,
      `SHOW STAGES IN DATABASE ${databaseName};`
    ),
    makeInspectionStep(
      "snowflake-pipes",
      "Snowflake",
      "Pipes",
      "Find Snowpipe ingestion paths and infer upstream storage or connector-managed loads.",
      "sql",
      true,
      `SHOW PIPES IN DATABASE ${databaseName};`
    ),
    makeInspectionStep(
      "snowflake-tables",
      "Snowflake",
      "Tables and views",
      "Map core datasets, schemas, and downstream marts that define the warehouse layer.",
      "sql",
      true,
      `SHOW TABLES IN DATABASE ${databaseName};`
    ),
    makeInspectionStep(
      "snowflake-streams-tasks",
      "Snowflake",
      "Streams and tasks",
      "Detect internal orchestration and CDC-style flows inside the warehouse.",
      "sql",
      true,
      `SHOW STREAMS IN DATABASE ${databaseName}; SHOW TASKS IN DATABASE ${databaseName};`
    ),
    makeInspectionStep(
      "snowflake-query-history-clients",
      "Snowflake",
      "Client and query history",
      "Use query history and client metadata to infer downstream tools like BI or orchestration clients touching the warehouse.",
      "sql",
      true,
      "SELECT user_name, client_application_id, query_tag, query_text FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY WHERE start_time >= DATEADD('day', -7, CURRENT_TIMESTAMP());"
    ),
    makeInspectionStep(
      "snowflake-integrations",
      "Snowflake",
      "Storage and notification integrations",
      "Find connected apps and cloud resources referenced by integration objects.",
      "sql",
      true,
      "SHOW STORAGE INTEGRATIONS; SHOW API INTEGRATIONS; SHOW NOTIFICATION INTEGRATIONS;"
    ),
  ];

  const nodes: PipelineIdentifierNode[] = [
    makePipelineNode(
      "warehouse",
      "Snowflake",
      connection.label || connection.tool,
      "warehouse",
      0.96,
      ["saved connection"],
      "connected"
    ),
    makePipelineNode(
      "bi",
      "Looker",
      "Looker",
      "bi",
      0.72,
      [
        "Snowflake query history and client metadata can confirm BI clients before authentication is added",
        "Warehouse-side evidence suggests a downstream BI consumer",
      ],
      "auth_required",
      "Discovered from warehouse-side evidence. Add Looker auth to inspect dashboards, models, and schedules directly."
    ),
  ];

  const edges: PipelineIdentifierEdge[] = [];
  addEdge(edges, "warehouse", "bi", "serves", 0.74);

  return {
    anchorConnectionId: connection.connectionId,
    anchorTool: connection.tool,
    pipelineLabel,
    confidence: 0.79,
    nodes,
    edges,
    evidence: [
      `Anchor tool ${connection.tool} is stored as a warehouse connection.`,
      details.database
        ? `Database ${details.database} suggests a central analytics warehouse.`
        : "Warehouse account details suggest a central storage layer.",
      "Snowflake pipeline discovery should read stages, pipes, tables, tasks, streams, query history, and integration objects before finalizing the graph.",
      "Downstream BI tools can often be inferred from QUERY_HISTORY client metadata and should be tagged as requiring auth until a direct BI connection is saved.",
    ],
    inspectionPlan,
  };
}

function detectFromAirflow(connection: StoredConnection): PipelineIdentifierResult {
  const details = connection.details ?? {};
  const pipelineLabel = safeHostname(details.base_url)
    ? `${safeHostname(details.base_url)} orchestration graph`
    : "Airflow-centered pipeline";
  const inspectionPlan: PipelineInspectionStep[] = [
    makeInspectionStep(
      "airflow-dags",
      "Apache Airflow",
      "DAG inventory",
      "List DAGs and identify the workflows that define the pipeline boundary.",
      "api",
      true,
      "GET /api/v1/dags"
    ),
    makeInspectionStep(
      "airflow-tasks",
      "Apache Airflow",
      "Task definitions",
      "Inspect operators and task ids to infer warehouses, transforms, and downstream systems.",
      "api",
      true,
      "GET /api/v1/dags/{dag_id}/tasks"
    ),
    makeInspectionStep(
      "airflow-connections",
      "Apache Airflow",
      "Connection references",
      "Read referenced connection ids so adjacent tools can be identified from the orchestrator.",
      "api",
      true,
      "Parse connection ids from task definitions and DAG code"
    ),
    makeInspectionStep(
      "airflow-runs-logs",
      "Apache Airflow",
      "Run history and logs",
      "Confirm which tasks call external systems and where failures cluster.",
      "api",
      true,
      "GET /api/v1/dags/{dag_id}/dagRuns and task logs"
    ),
  ];

  const nodes: PipelineIdentifierNode[] = [
    makePipelineNode("source-apps", "Source systems", "Source systems", "source", 0.52, ["orchestration usually fans in upstream data sources"]),
    makePipelineNode("ingestion", "Fivetran", "Fivetran", "ingestion", 0.64, ["Airflow often coordinates post-ingest work"]),
    makePipelineNode("orchestration", "Apache Airflow", "Apache Airflow", "orchestration", 0.97, ["saved connection"]),
    makePipelineNode("transform", "dbt", "dbt", "transform", 0.83, ["Airflow commonly triggers transform steps"]),
    makePipelineNode("warehouse", "Snowflake", "Snowflake", "warehouse", 0.72, ["transform tasks often target a warehouse"]),
    makePipelineNode("bi", "Looker", "Looker", "bi", 0.59, ["downstream dashboards likely depend on orchestrated data products"]),
  ];

  const edges: PipelineIdentifierEdge[] = [];
  addEdge(edges, "source-apps", "ingestion", "feeds", 0.54);
  addEdge(edges, "ingestion", "orchestration", "signals ready", 0.62);
  addEdge(edges, "orchestration", "transform", "triggers", 0.88);
  addEdge(edges, "transform", "warehouse", "writes", 0.82);
  addEdge(edges, "warehouse", "bi", "serves", 0.68);

  return {
    anchorConnectionId: connection.connectionId,
    anchorTool: connection.tool,
    pipelineLabel,
    confidence: 0.77,
    nodes,
    edges,
    evidence: [
      `Anchor tool ${connection.tool} is stored as orchestration.`,
      details.base_url
        ? `Base URL ${details.base_url} indicates an Airflow control plane endpoint.`
        : "Airflow endpoint details indicate a scheduler/webserver connection.",
      "Airflow pipeline discovery should read DAGs, tasks, connection ids, and run logs before finalizing the graph.",
    ],
    inspectionPlan,
  };
}

function detectFromFivetran(connection: StoredConnection): PipelineIdentifierResult {
  const details = connection.details ?? {};
  const pipelineLabel = details.group_id
    ? `Fivetran group ${details.group_id} pipeline`
    : "Fivetran-centered pipeline";
  const inspectionPlan: PipelineInspectionStep[] = [
    makeInspectionStep(
      "fivetran-connectors",
      "Fivetran",
      "Connector inventory",
      "List all connectors to identify upstream apps and source families in scope.",
      "api",
      true,
      "GET /v1/connectors"
    ),
    makeInspectionStep(
      "fivetran-destinations",
      "Fivetran",
      "Destination metadata",
      "Determine the landing warehouse and destination schemas for the pipeline.",
      "api",
      true,
      "GET /v1/destinations"
    ),
    makeInspectionStep(
      "fivetran-schemas",
      "Fivetran",
      "Schema config",
      "Map source objects to warehouse tables and infer downstream transform entry points.",
      "api",
      true,
      "GET /v1/connectors/{connector_id}/schemas"
    ),
    makeInspectionStep(
      "fivetran-sync-history",
      "Fivetran",
      "Sync history",
      "Use recent sync state to understand active paths and failure hotspots.",
      "api",
      true,
      "GET /v1/connectors/{connector_id}/sync-history"
    ),
  ];

  const nodes: PipelineIdentifierNode[] = [
    makePipelineNode("source-apps", "Source systems", "Source systems", "source", 0.73, ["EL connector implies upstream operational sources"]),
    makePipelineNode("ingestion", "Fivetran", "Fivetran", "ingestion", 0.96, ["saved connection"]),
    makePipelineNode("warehouse", "Snowflake", "Snowflake", "warehouse", 0.8, ["Fivetran usually lands in a warehouse destination"]),
    makePipelineNode("transform", "dbt", "dbt", "transform", 0.74, ["warehouse destinations are commonly transformed downstream"]),
    makePipelineNode("bi", "Looker", "Looker", "bi", 0.61, ["analytics warehouse usually feeds reporting"]),
  ];

  const edges: PipelineIdentifierEdge[] = [];
  addEdge(edges, "source-apps", "ingestion", "syncs from", 0.82);
  addEdge(edges, "ingestion", "warehouse", "loads into", 0.89);
  addEdge(edges, "warehouse", "transform", "modeled by", 0.73);
  addEdge(edges, "transform", "bi", "served to", 0.63);

  return {
    anchorConnectionId: connection.connectionId,
    anchorTool: connection.tool,
    pipelineLabel,
    confidence: 0.78,
    nodes,
    edges,
    evidence: [
      `Anchor tool ${connection.tool} is stored as ingestion.`,
      details.group_id
        ? `Saved group id ${details.group_id} suggests connector-based source grouping.`
        : "Saved Fivetran credentials imply connector-managed ingestion.",
      "Fivetran pipeline discovery should read connectors, destinations, schemas, and sync history before finalizing the graph.",
    ],
    inspectionPlan,
  };
}

function detectFromKafka(connection: StoredConnection): PipelineIdentifierResult {
  const details = connection.details ?? {};
  const pipelineLabel = details.bootstrap_servers
    ? `Kafka streaming pipeline for ${details.bootstrap_servers}`
    : "Kafka-centered pipeline";
  const inspectionPlan: PipelineInspectionStep[] = [
    makeInspectionStep(
      "kafka-topics",
      "Apache Kafka",
      "Topic inventory",
      "Identify the event streams that define the core data backbone.",
      "http",
      true,
      "Describe topics via admin client"
    ),
    makeInspectionStep(
      "kafka-consumers",
      "Apache Kafka",
      "Consumer groups",
      "Map downstream processors and sinks consuming from the broker.",
      "http",
      true,
      "List consumer groups and lag"
    ),
    makeInspectionStep(
      "kafka-connect",
      "Kafka Connect",
      "Connector inventory",
      "Find source and sink connectors that bridge Kafka to warehouses or apps.",
      "http",
      true,
      "GET /connectors"
    ),
    makeInspectionStep(
      "kafka-schema-registry",
      "Schema Registry",
      "Subject inventory",
      "Use registered schemas to infer producing systems and data domains.",
      "http",
      true,
      "GET /subjects"
    ),
  ];

  const nodes: PipelineIdentifierNode[] = [
    makePipelineNode("source-apps", "Source systems", "Source producers", "source", 0.71, ["streaming anchor implies event producers"]),
    makePipelineNode("streaming", "Apache Kafka", "Apache Kafka", "streaming", 0.97, ["saved connection"]),
    makePipelineNode("compute", "Spark Structured Streaming", "Spark Structured Streaming", "transform", 0.74, ["Kafka commonly feeds stream processors"]),
    makePipelineNode("warehouse", "Snowflake", "Snowflake", "warehouse", 0.63, ["stream outputs often land in analytics storage"]),
    makePipelineNode("monitoring", "Grafana", "Grafana", "monitoring", 0.58, ["lag and consumer health are typically monitored"]),
  ];

  const edges: PipelineIdentifierEdge[] = [];
  addEdge(edges, "source-apps", "streaming", "publishes events", 0.83);
  addEdge(edges, "streaming", "compute", "consumed by", 0.76);
  addEdge(edges, "compute", "warehouse", "materializes to", 0.61);
  addEdge(edges, "streaming", "monitoring", "observed by", 0.55);

  return {
    anchorConnectionId: connection.connectionId,
    anchorTool: connection.tool,
    pipelineLabel,
    confidence: 0.74,
    nodes,
    edges,
    evidence: [
      `Anchor tool ${connection.tool} is stored as streaming.`,
      details.bootstrap_servers
        ? `Bootstrap servers ${details.bootstrap_servers} identify a broker cluster.`
        : "Kafka connection metadata indicates a broker-based event pipeline.",
      "Kafka pipeline discovery should read topics, consumer groups, connectors, and schema registry subjects before finalizing the graph.",
    ],
    inspectionPlan,
  };
}

function detectFallback(connection: StoredConnection): PipelineIdentifierResult {
  const nodes: PipelineIdentifierNode[] = [
    makePipelineNode(
      "anchor",
      connection.tool,
      connection.tool,
      regionFromFamily(connection.family),
      0.95,
      ["saved connection"]
    ),
    makePipelineNode("adjacent-1", "Adjacent upstream", "Upstream layer", "source", 0.5, ["generic fallback from anchor family"]),
    makePipelineNode("adjacent-2", "Adjacent downstream", "Downstream layer", "bi", 0.46, ["generic fallback from anchor family"]),
  ];

  const edges: PipelineIdentifierEdge[] = [];
  addEdge(edges, "adjacent-1", "anchor", "feeds", 0.48);
  addEdge(edges, "anchor", "adjacent-2", "serves", 0.44);

  return {
    anchorConnectionId: connection.connectionId,
    anchorTool: connection.tool,
    pipelineLabel: `${connection.tool} anchored pipeline`,
    confidence: 0.52,
    nodes,
    edges,
    evidence: [
      `Used fallback detection because ${connection.tool} does not yet have a dedicated pipeline detector.`,
      "The result is based on connector family adjacency rather than tool-specific metadata parsing.",
    ],
    inspectionPlan: [
      makeInspectionStep(
        "generic-anchor",
        connection.tool,
        "Anchor metadata",
        "Read the anchor tool's core metadata surfaces before inferring adjacent systems.",
        connection.family === "warehouse"
          ? "sql"
          : connection.family === "infrastructure"
            ? "cli"
            : "api",
        true,
        "Inspect connector-native metadata surfaces"
      ),
    ],
  };
}

export function identifyPipelineFromConnection(
  connection: StoredConnection,
  allConnections: StoredConnection[] = [connection]
): PipelineIdentifierResult {
  const tool = connection.tool.trim().toLowerCase();
  let result: PipelineIdentifierResult;
  if (tool === "snowflake") {
    result = detectFromSnowflake(connection);
  } else if (tool === "apache airflow") {
    result = detectFromAirflow(connection);
  } else if (tool === "fivetran") {
    result = detectFromFivetran(connection);
  } else if (tool === "apache kafka") {
    result = detectFromKafka(connection);
  } else {
    result = detectFallback(connection);
  }

  return mergeSavedConnections(result, allConnections);
}
