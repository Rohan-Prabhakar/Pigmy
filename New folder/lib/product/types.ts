import type { AuthMethod, StoredConnection } from "@/lib/connectors/credentials";
import type {
  ConnectorAction,
  ConnectorFamily,
  ExecutionKind,
  PipelineIdentifierResult,
  PipelineInspectionStep,
} from "@/lib/connectors/types";

export type AdapterHealth = "healthy" | "warning" | "error" | "unknown";

export type ConnectionTestResult = {
  testedAt: string;
  ok: boolean;
  status: AdapterHealth;
  summary: string;
  details: string[];
};

export type AdapterSurfaceSnapshot = {
  surface: string;
  count?: number;
  summary: string;
  evidence: string[];
};

export type AdapterSnapshot = {
  connectionId: string;
  tool: string;
  adapterId: string;
  family: ConnectorFamily;
  lastTestResult?: ConnectionTestResult;
  metadataSyncedAt?: string;
  health: AdapterHealth;
  surfaces: AdapterSurfaceSnapshot[];
  diagnostics: {
    freshnessMinutes?: number;
    rowCount?: number;
    nullRate?: number;
    lastValidationStatus?: "pass" | "warn" | "fail" | "unknown";
  };
  pipeline?: PipelineIdentifierResult;
  activity: string[];
};

export type StoredConnectionRecord = StoredConnection & {
  adapterId: string;
  docsUrl?: string;
  secretRef: string;
  secret?: string;
  notes?: string;
  lastTestResult?: ConnectionTestResult;
  metadataSyncStatus?: "idle" | "fresh" | "stale" | "error";
  metadataSyncedAt?: string;
  adapterHealth: AdapterHealth;
};

export type OverviewMetricCard = {
  id: string;
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn" | "critical";
};

export type OverviewSummary = {
  metrics: OverviewMetricCard[];
  connectionHealth: Array<{
    connectionId: string;
    tool: string;
    status: AdapterHealth;
    lastTestAt?: string;
    lastSyncAt?: string;
  }>;
  recentActivity: string[];
  latestValidation: string[];
  graphCoverage: {
    nodes: number;
    confirmed: number;
    inferred: number;
  };
  qualityBreakdown: {
    pass: number;
    warn: number;
    fail: number;
  };
  severityBreakdown: Record<QualitySeverity, number>;
};

export type QualitySeverity = "SEV-1" | "SEV-2" | "SEV-3" | "SEV-4";

export type QualityRuleCondition = {
  metric: "freshness" | "row_count" | "null_rate" | "schema" | "custom";
  operator: ">" | "<" | ">=" | "<=" | "=" | "contains";
  threshold: string;
};

export type QualityRuleDraft = {
  assumptions: string[];
  evidence: string[];
  generatedSql?: string;
  generatedScript?: string;
};

export type QualityRule = {
  ruleId: string;
  title: string;
  description: string;
  tool: string;
  targetScope: string;
  frequency: "Every run" | "Hourly" | "Daily" | "Before refresh" | "After refresh";
  severity: QualitySeverity;
  status: "draft" | "approved" | "disabled";
  conditions: QualityRuleCondition[];
  generatedDsl: Record<string, unknown>;
  draft: QualityRuleDraft;
  citations: Citation[];
  createdAt: string;
  updatedAt: string;
};

export type QualityRun = {
  runId: string;
  ruleId: string;
  status: "pass" | "warn" | "fail";
  severity: QualitySeverity;
  triggerSource: "manual" | "assistant" | "schedule";
  adapterId: string;
  evidence: string[];
  citations: Citation[];
  executedAt: string;
};

export type QualityAlert = {
  alertId: string;
  ruleId: string;
  title: string;
  severity: QualitySeverity;
  status: "open" | "acknowledged" | "resolved";
  detail: string;
  createdAt: string;
  mailDeliveredAt?: string;
};

export type MailRecipientPolicy = {
  recipient: string;
  notifyAtOrAbove: QualitySeverity;
};

export type MailSettings = {
  host: string;
  port: number;
  username: string;
  passwordSecretRef?: string;
  sender: string;
  enabled: boolean;
  recipients: MailRecipientPolicy[];
};

export type SettingsState = {
  modelRouting: {
    fastModel: string;
    deepModel: string;
    redHerringModel: string;
  };
  retrieval: {
    enabled: boolean;
    strategy: "hybrid";
    topK: number;
  };
  auditRetentionDays: number;
  approvals: {
    requireApprovalFor: ConnectorAction[];
  };
  mail: MailSettings;
};

export type KnowledgeDocument = {
  documentId: string;
  title: string;
  sourceType: "uploaded" | "workspace" | "sft_corpus";
  text: string;
  tags: string[];
  tool?: string;
  ruleId?: string;
  dataset?: string;
  owner?: string;
  createdAt: string;
};

export type KnowledgeChunk = {
  chunkId: string;
  documentId: string;
  text: string;
  tags: string[];
};

export type Citation = {
  documentId: string;
  title: string;
  excerpt: string;
  score: number;
};

export type RetrievedContext = {
  query: string;
  citations: Citation[];
};

export type AssistantToolCall = {
  toolCallId: string;
  threadId: string;
  tool: string;
  action: ConnectorAction | "retrieve" | "draft_rule";
  executionKind: ExecutionKind | "retrieval";
  status: "planned" | "completed" | "failed";
  summary: string;
  createdAt: string;
};

export type AssistantApproval = {
  approvalId: string;
  threadId: string;
  action: string;
  target: string;
  approved: boolean;
  createdAt: string;
};

export type AssistantCommandRun = {
  runId: string;
  threadId: string;
  connectionId?: string;
  tool: string;
  action: ConnectorAction;
  status: "planned" | "completed" | "failed";
  resultSummary: string;
  executedAt: string;
};

export type AssistantMessageRecord = {
  messageId: string;
  role: "assistant" | "user";
  text: string;
  createdAt: string;
  metadata?: {
    model?: string;
    commandProposals?: Array<{
      tool: string;
      family: ConnectorFamily;
      action: ConnectorAction;
      target?: string;
      rationale: string;
      approvalRequired: boolean;
      generatedQuery?: string;
    }>;
    executionResult?: {
      summary: string;
      evidence?: string[];
      rows?: Record<string, unknown>[];
      live: boolean;
      tool: string;
      action: string;
    };
    redHerring?: string;
    citations?: Citation[];
    toolCalls?: AssistantToolCall[];
    confidence?: "low" | "medium" | "high";
    grounded?: boolean;
  };
};

export type AssistantThread = {
  threadId: string;
  title: string;
  selectedConnectionId?: string;
  createdAt: string;
  updatedAt: string;
  messages: AssistantMessageRecord[];
};

export type AssistantStore = {
  threads: AssistantThread[];
  approvals: AssistantApproval[];
  commandRuns: AssistantCommandRun[];
};

export type QualityStore = {
  rules: QualityRule[];
  runs: QualityRun[];
  alerts: QualityAlert[];
};

export type AuditEventRecord = {
  eventId: string;
  type:
    | "connection_saved"
    | "connection_tested"
    | "snapshot_synced"
    | "rule_drafted"
    | "rule_approved"
    | "quality_run"
    | "alert_sent"
    | "assistant_message"
    | "command_run";
  detail: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type AdapterContext = {
  connection: StoredConnectionRecord;
  snapshot?: AdapterSnapshot;
};

export type AdapterTestResponse = ConnectionTestResult & {
  adapterId: string;
};

export type AdapterInspectResponse = {
  adapterId: string;
  surfaces: AdapterSurfaceSnapshot[];
  activity: string[];
  inspectionPlan: PipelineInspectionStep[];
};
