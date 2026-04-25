from __future__ import annotations

import httpx

from app.core.config import settings
from app.db.seed import ANALYSIS_BY_INCIDENT
from app.models.schemas import AnalysisContext, IncidentAnalysis, IncidentRecord


async def analyze_incident(
    incident: IncidentRecord,
    context: AnalysisContext,
    question: str | None = None,
) -> IncidentAnalysis:
    payload = {
        "incident": incident.model_dump(mode="json"),
        "question": question,
        "context": context.model_dump(mode="json"),
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(f"{settings.model_service_url}/analyze", json=payload)
            response.raise_for_status()
            data = response.json()
            return IncidentAnalysis(**data)
    except Exception:
        return ANALYSIS_BY_INCIDENT[incident.id]
