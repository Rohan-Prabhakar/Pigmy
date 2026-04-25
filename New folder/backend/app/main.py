from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.models.schemas import ActionRequest, ActionResponse, ChatRequest, ChatResponse, DashboardResponse, IncidentDetailResponse
from app.services.audit import create_audit_event, list_audit_events
from app.services.incident_service import build_analysis_context, get_incident, list_incidents
from app.services.model_client import analyze_incident
from app.tools.mock_tools import create_incident_ticket, notify_owner, retry_job, run_diagnostic_sql


app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"ok": True, "environment": settings.environment}


@app.get("/api/dashboard", response_model=DashboardResponse)
async def dashboard():
    return DashboardResponse(
        incidents=list_incidents(),
        audit_trail=list_audit_events(),
    )


@app.get("/api/incidents/{incident_id}", response_model=IncidentDetailResponse)
async def incident_detail(incident_id: str):
    try:
        incident = get_incident(incident_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    context = build_analysis_context(incident)
    analysis = await analyze_incident(incident, context)
    audit_event = create_audit_event(
        incident_id=incident_id,
        event_type="model_output",
        actor="model_service",
        detail="Generated incident analysis.",
        metadata={"confidence": analysis.confidence},
    )
    return IncidentDetailResponse(
        incident=incident,
        analysis=analysis,
        logs=context.logs,
        metrics=context.metrics,
        schema_checks=context.schema_checks,
        audit_trail=[audit_event, *list_audit_events(incident_id)],
    )


@app.post("/api/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest):
    incident = get_incident(payload.incident_id or "inc_001")
    context = build_analysis_context(incident)
    analysis = await analyze_incident(incident, context, payload.message)
    audit_event = create_audit_event(
        incident_id=incident.id,
        event_type="model_output",
        actor="model_service",
        detail="Answered operator chat request.",
        metadata={"message": payload.message},
    )
    return ChatResponse(answer=analysis, audit_event=audit_event)


@app.post("/api/actions", response_model=ActionResponse)
async def run_action(payload: ActionRequest):
    incident = get_incident(payload.incident_id)

    if payload.action == "retry_job":
        result = retry_job(incident.job_id)
    elif payload.action == "run_validation":
        result = run_diagnostic_sql(
            f"select count(*) as suspect_rows from {incident.dataset} where 1=1",
            readonly=True,
        )
    elif payload.action == "create_ticket":
        result = create_incident_ticket(
            {
                "title": incident.title,
                "description": incident.summary,
                "owner": incident.owner,
                "severity": incident.severity,
            }
        )
    elif payload.action == "notify_owner":
        result = notify_owner(incident.owner, f"Incident {incident.id} needs review")
    else:
        raise HTTPException(status_code=400, detail="Unsupported action")

    audit_event = create_audit_event(
        incident_id=incident.id,
        event_type="user_action",
        actor="operator",
        detail=f"Triggered action {payload.action}.",
        metadata={"result": result},
    )
    return ActionResponse(ok=True, result=result, audit_event=audit_event)
