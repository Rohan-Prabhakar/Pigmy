from __future__ import annotations

from datetime import datetime, timezone

from app.db.seed import LOGS_BY_INCIDENT, METRICS_BY_DATASET, SCHEMA_CHECKS_BY_DATASET
from app.services.audit import create_audit_event


def get_logs(incident_id: str | None = None, job_id: str | None = None):
    logs = LOGS_BY_INCIDENT.get(incident_id or "", [])
    create_audit_event(
        incident_id=incident_id,
        event_type="tool_call",
        actor="backend",
        detail="Fetched logs from mock tool layer.",
        metadata={"tool": "get_logs", "job_id": job_id},
    )
    return logs


def get_pipeline_status(job_id: str):
    status = {
        "job_id": job_id,
        "state": "degraded" if "revenue" in job_id else "running_with_warnings",
        "last_run_started_at": datetime.now(timezone.utc).isoformat(),
        "retry_count": 3 if "revenue" in job_id else 1,
    }
    create_audit_event(
        incident_id=None,
        event_type="tool_call",
        actor="backend",
        detail="Fetched pipeline status from mock tool layer.",
        metadata={"tool": "get_pipeline_status", "job_id": job_id},
    )
    return status


def run_diagnostic_sql(query: str, readonly: bool = True):
    normalized = " ".join(query.split())
    result = {
        "readonly": readonly,
        "query": normalized,
        "rows": [
            {"sample_dimension": "booking_net_amount", "null_rows": 2183},
            {"sample_dimension": "customer_id", "duplicate_rows": 248},
        ],
    }
    create_audit_event(
        incident_id=None,
        event_type="tool_call",
        actor="backend",
        detail="Executed diagnostic SQL in readonly mode.",
        metadata={"tool": "run_diagnostic_sql", "readonly": readonly},
    )
    return result


def get_schema_checks(dataset: str):
    checks = SCHEMA_CHECKS_BY_DATASET.get(dataset, [])
    create_audit_event(
        incident_id=None,
        event_type="tool_call",
        actor="backend",
        detail="Fetched schema checks from mock tool layer.",
        metadata={"tool": "get_schema_checks", "dataset": dataset},
    )
    return checks


def get_recent_metrics(dataset: str):
    metrics = METRICS_BY_DATASET.get(dataset, [])
    create_audit_event(
        incident_id=None,
        event_type="tool_call",
        actor="backend",
        detail="Fetched recent dataset metrics from mock tool layer.",
        metadata={"tool": "get_recent_metrics", "dataset": dataset},
    )
    return metrics


def retry_job(job_id: str):
    return {"job_id": job_id, "status": "accepted", "message": "Mock retry queued safely."}


def create_incident_ticket(payload: dict):
    return {"ticket_id": "TCK-1042", "status": "created", "payload": payload}


def notify_owner(owner_id: str, message: str):
    return {"owner_id": owner_id, "status": "sent", "message": message}
