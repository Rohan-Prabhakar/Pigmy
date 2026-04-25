from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from app.db.seed import AUDIT_TRAIL
from app.models.schemas import AuditEvent, AuditEventType


def create_audit_event(
    *,
    incident_id: str | None,
    event_type: AuditEventType,
    actor: str,
    detail: str,
    metadata: dict | None = None,
) -> AuditEvent:
    event = AuditEvent(
        id=f"aud_{uuid4().hex[:8]}",
        incident_id=incident_id,
        type=event_type,
        actor=actor,
        detail=detail,
        created_at=datetime.now(timezone.utc),
        metadata=metadata or {},
    )
    AUDIT_TRAIL.append(event)
    return event


def list_audit_events(incident_id: str | None = None) -> list[AuditEvent]:
    if incident_id is None:
        return list(reversed(AUDIT_TRAIL))
    return [event for event in reversed(AUDIT_TRAIL) if event.incident_id == incident_id]
