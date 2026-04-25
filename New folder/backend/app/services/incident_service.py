from __future__ import annotations

from app.db.seed import INCIDENTS
from app.models.schemas import AnalysisContext, IncidentRecord
from app.tools.mock_tools import get_logs, get_pipeline_status, get_recent_metrics, get_schema_checks


def list_incidents() -> list[IncidentRecord]:
    return INCIDENTS


def get_incident(incident_id: str) -> IncidentRecord:
    for incident in INCIDENTS:
        if incident.id == incident_id:
            return incident
    raise KeyError(f"Incident {incident_id} not found")


def build_analysis_context(incident: IncidentRecord) -> AnalysisContext:
    logs = get_logs(incident_id=incident.id, job_id=incident.job_id)
    metrics = get_recent_metrics(incident.dataset)
    schema_checks = get_schema_checks(incident.dataset)
    pipeline_status = get_pipeline_status(incident.job_id)
    return AnalysisContext(
        incident=incident,
        logs=logs,
        metrics=metrics,
        schema_checks=schema_checks,
        pipeline_status=pipeline_status,
    )
