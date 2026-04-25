export type ConfidenceLevel = "low" | "medium" | "high";
export type RecommendedActionType =
  | "retry_job"
  | "run_validation"
  | "create_ticket"
  | "notify_owner";

export type IncidentRecord = {
  id: string;
  title: string;
  pipeline: string;
  owner: string;
  dataset: string;
  job_id: string;
  status: "open" | "investigating" | "monitoring" | "resolved";
  severity: "critical" | "high" | "medium" | "low";
  detected_at: string;
  summary: string;
  tags: string[];
};

export type IncidentAnalysis = {
  summary: string;
  likely_root_cause: string;
  supporting_evidence: string[];
  suggested_fix: string[];
  debug_steps: string[];
  confidence: ConfidenceLevel;
  recommended_actions: Array<{
    action: RecommendedActionType;
    label: string;
    safe: boolean;
  }>;
};

export type LogEntry = {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  source: string;
};

export type MetricPoint = {
  dataset: string;
  freshness_minutes: number;
  row_count: number;
  null_rate: number;
  collected_at: string;
};

export type SchemaCheck = {
  dataset: string;
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

export type AuditEvent = {
  id: string;
  incident_id?: string;
  type: "model_output" | "tool_call" | "user_action" | "system_note";
  actor: string;
  detail: string;
  created_at: string;
  metadata?: Record<string, unknown>;
};

export type DashboardResponse = {
  incidents: IncidentRecord[];
  audit_trail: AuditEvent[];
};

export type IncidentDetailResponse = {
  incident: IncidentRecord;
  analysis: IncidentAnalysis;
  logs: LogEntry[];
  metrics: MetricPoint[];
  schema_checks: SchemaCheck[];
  audit_trail: AuditEvent[];
};

export type ChatResponse = {
  answer: IncidentAnalysis;
  audit_event: AuditEvent;
};
