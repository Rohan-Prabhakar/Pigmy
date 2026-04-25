from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


Confidence = Literal["low", "medium", "high"]
Severity = Literal["critical", "high", "medium", "low"]
IncidentStatus = Literal["open", "investigating", "monitoring", "resolved"]
AuditEventType = Literal["model_output", "tool_call", "user_action", "system_note"]
ActionType = Literal["retry_job", "run_validation", "create_ticket", "notify_owner"]


class RecommendedAction(BaseModel):
    action: ActionType
    label: str
    safe: bool = True


class IncidentAnalysis(BaseModel):
    summary: str
    likely_root_cause: str
    supporting_evidence: list[str]
    suggested_fix: list[str]
    debug_steps: list[str]
    confidence: Confidence
    recommended_actions: list[RecommendedAction]


class IncidentRecord(BaseModel):
    id: str
    title: str
    pipeline: str
    owner: str
    dataset: str
    job_id: str
    status: IncidentStatus
    severity: Severity
    detected_at: datetime
    summary: str
    tags: list[str] = Field(default_factory=list)


class LogEntry(BaseModel):
    timestamp: datetime
    level: Literal["INFO", "WARN", "ERROR"]
    message: str
    source: str


class MetricPoint(BaseModel):
    dataset: str
    freshness_minutes: int
    row_count: int
    null_rate: float
    collected_at: datetime


class SchemaCheck(BaseModel):
    dataset: str
    name: str
    status: Literal["pass", "warn", "fail"]
    detail: str


class AuditEvent(BaseModel):
    id: str
    incident_id: str | None = None
    type: AuditEventType
    actor: str
    detail: str
    created_at: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)


class TicketPayload(BaseModel):
    title: str
    description: str
    owner: str
    severity: Severity


class IncidentDetailResponse(BaseModel):
    incident: IncidentRecord
    analysis: IncidentAnalysis
    logs: list[LogEntry]
    metrics: list[MetricPoint]
    schema_checks: list[SchemaCheck]
    audit_trail: list[AuditEvent]


class DashboardResponse(BaseModel):
    incidents: list[IncidentRecord]
    audit_trail: list[AuditEvent]


class AnalysisContext(BaseModel):
    incident: IncidentRecord
    logs: list[LogEntry]
    metrics: list[MetricPoint]
    schema_checks: list[SchemaCheck]
    pipeline_status: dict[str, Any]


class AnalyzeRequest(BaseModel):
    incident: IncidentRecord
    question: str | None = None
    context: AnalysisContext


class ChatRequest(BaseModel):
    incident_id: str | None = None
    message: str


class ChatResponse(BaseModel):
    answer: IncidentAnalysis
    audit_event: AuditEvent


class ActionRequest(BaseModel):
    incident_id: str
    action: ActionType


class ActionResponse(BaseModel):
    ok: bool
    result: dict[str, Any]
    audit_event: AuditEvent
