export type ConnectorFamily =
  | "ingestion"
  | "orchestration"
  | "compute"
  | "warehouse"
  | "table_format"
  | "storage"
  | "streaming"
  | "quality"
  | "bi"
  | "monitoring"
  | "infrastructure";

export type ConnectorAction =
  | "discover"
  | "inspect"
  | "test_connection"
  | "fetch_metadata"
  | "fetch_logs"
  | "query"
  | "run"
  | "trigger"
  | "refresh"
  | "pause"
  | "resume"
  | "restart"
  | "rebuild"
  | "validate"
  | "deploy";

export type ExecutionKind = "api" | "cli" | "sdk" | "sql" | "http" | "none";

export type ConnectorCapability = {
  action: ConnectorAction;
  executionKind: ExecutionKind;
  requiresApproval: boolean;
  description: string;
};

export type ConnectorProfile = {
  name: string;
  family: ConnectorFamily;
  supportLevel: "deep" | "medium" | "basic";
  adapterId: string;
  defaultCapabilities: ConnectorCapability[];
  notes?: string;
};

export type ConnectorConnectionRequest = {
  tool: string;
  workspaceId?: string;
  target?: string;
  credentials?: Record<string, string>;
  dryRun?: boolean;
};

export type ConnectorConnection = {
  connectionId: string;
  tool: string;
  family: ConnectorFamily;
  status: "connected" | "disconnected" | "error";
  connectedAt: string;
  target?: string;
};

export type ConnectorDiscoveryNode = {
  id: string;
  label: string;
  family: ConnectorFamily;
  confidence: number;
};

export type PipelineNodeRegion =
  | "source"
  | "ingestion"
  | "streaming"
  | "orchestration"
  | "transform"
  | "warehouse"
  | "quality"
  | "bi"
  | "monitoring"
  | "reverse_etl"
  | "infrastructure";

export type PipelineIdentifierNode = {
  id: string;
  label: string;
  tool: string;
  region: PipelineNodeRegion;
  confidence: number;
  inferredFrom: string[];
  status?: "connected" | "discovered" | "auth_required";
  authHint?: string;
};

export type PipelineIdentifierEdge = {
  from: string;
  to: string;
  label: string;
  confidence: number;
};

export type PipelineInspectionStep = {
  id: string;
  tool: string;
  surface: string;
  purpose: string;
  executionKind: ExecutionKind;
  readonly: boolean;
  commandPreview: string;
};

export type PipelineIdentifierResult = {
  anchorConnectionId: string;
  anchorTool: string;
  pipelineLabel: string;
  confidence: number;
  nodes: PipelineIdentifierNode[];
  edges: PipelineIdentifierEdge[];
  evidence: string[];
  inspectionPlan: PipelineInspectionStep[];
};

export type ConnectorDiscoveryResult = {
  connection: ConnectorConnection;
  discovered: ConnectorDiscoveryNode[];
  nextActions: ConnectorCapability[];
};

export type ConnectorActionRequest = {
  connectionId: string;
  tool: string;
  action: ConnectorAction;
  target?: string;
  parameters?: Record<string, string>;
  dryRun?: boolean;
};

export type CommandEnvelope = {
  tool: string;
  family: ConnectorFamily;
  action: ConnectorAction;
  executionKind: ExecutionKind;
  command: string;
  requiresApproval: boolean;
  risk: "low" | "medium" | "high";
  notes: string;
  target?: string;
};
