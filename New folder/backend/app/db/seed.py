from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.models.schemas import AuditEvent, IncidentAnalysis, IncidentRecord, LogEntry, MetricPoint, SchemaCheck


NOW = datetime.now(timezone.utc)

INCIDENTS = [
    IncidentRecord(
        id="inc_001",
        title="Revenue dashboard stale after overnight sync",
        pipeline="Revenue core",
        owner="owner_finops",
        dataset="analytics.revenue_daily",
        job_id="airflow.revenue_hourly",
        status="investigating",
        severity="high",
        detected_at=NOW - timedelta(minutes=42),
        summary="The executive dashboard stopped refreshing after the 08:00 warehouse load.",
        tags=["freshness", "warehouse", "dashboard"],
    ),
    IncidentRecord(
        id="inc_002",
        title="Schema test failure on customer dimension",
        pipeline="Customer 360",
        owner="owner_growth",
        dataset="mart.dim_customer",
        job_id="dbt.customer_dim",
        status="open",
        severity="medium",
        detected_at=NOW - timedelta(hours=2, minutes=8),
        summary="A dbt uniqueness test is failing on the customer key after a new source ingest.",
        tags=["schema", "dbt", "quality"],
    ),
]

ANALYSIS_BY_INCIDENT = {
    "inc_001": IncidentAnalysis(
        summary="The stale dashboard is most likely caused by a failed warehouse transform after ingestion completed successfully.",
        likely_root_cause="The dbt revenue transform stalled because a new upstream column introduced null values into a required cast, leaving the downstream reporting table unrefreshed.",
        supporting_evidence=[
            "Airflow reported the ingestion task as successful but the transform task retried three times.",
            "Warehouse logs show a cast failure on column `booking_net_amount`.",
            "Freshness for analytics.revenue_daily is 129 minutes while upstream raw tables are current within 8 minutes.",
        ],
        suggested_fix=[
            "Patch the dbt model to safely cast null booking values.",
            "Backfill the failed transform step and then refresh downstream reporting extracts.",
        ],
        debug_steps=[
            "Inspect the most recent transform logs for the failing cast statement.",
            "Run a readonly SQL sample to count nulls in the new revenue column.",
            "Rerun validation checks before retrying the production job.",
        ],
        confidence="high",
        recommended_actions=[
            {"action": "run_validation", "label": "Run validation suite", "safe": True},
            {"action": "retry_job", "label": "Retry transform job", "safe": True},
            {"action": "notify_owner", "label": "Notify pipeline owner", "safe": True},
        ],
    ),
    "inc_002": IncidentAnalysis(
        summary="A new ingest likely introduced duplicate customer IDs into the model input.",
        likely_root_cause="The latest customer sync changed merge behavior and now emits duplicate natural keys before deduplication.",
        supporting_evidence=[
            "The dbt uniqueness test started failing immediately after the latest source sync.",
            "Null rate stayed normal while row count jumped 14% in one load.",
            "Schema checks passed, which suggests a data-shape issue rather than a schema drift issue.",
        ],
        suggested_fix=[
            "Inspect the merge logic in the source staging model.",
            "Add a temporary deduplication guard before the dimension build.",
        ],
        debug_steps=[
            "Run a readonly duplicate count grouped by customer_id.",
            "Compare the latest source batch row count against the 7-day median.",
        ],
        confidence="medium",
        recommended_actions=[
            {"action": "run_validation", "label": "Rerun dbt tests", "safe": True},
            {"action": "create_ticket", "label": "Create incident ticket", "safe": True},
        ],
    ),
}

LOGS_BY_INCIDENT = {
    "inc_001": [
        LogEntry(timestamp=NOW - timedelta(minutes=39), level="INFO", message="Ingestion completed for raw.revenue_events", source="fivetran"),
        LogEntry(timestamp=NOW - timedelta(minutes=34), level="WARN", message="Retrying task transform_revenue_prod after cast failure", source="airflow"),
        LogEntry(timestamp=NOW - timedelta(minutes=33), level="ERROR", message="Numeric value '' is not recognized while casting booking_net_amount", source="snowflake"),
    ],
    "inc_002": [
        LogEntry(timestamp=NOW - timedelta(hours=2), level="INFO", message="dbt test unique_dim_customer_customer_id started", source="dbt"),
        LogEntry(timestamp=NOW - timedelta(hours=1, minutes=58), level="ERROR", message="Found 248 duplicate rows violating uniqueness", source="dbt"),
    ],
}

METRICS_BY_DATASET = {
    "analytics.revenue_daily": [
        MetricPoint(dataset="analytics.revenue_daily", freshness_minutes=129, row_count=128409, null_rate=0.021, collected_at=NOW - timedelta(minutes=2)),
        MetricPoint(dataset="analytics.revenue_daily", freshness_minutes=122, row_count=128400, null_rate=0.019, collected_at=NOW - timedelta(minutes=12)),
    ],
    "mart.dim_customer": [
        MetricPoint(dataset="mart.dim_customer", freshness_minutes=15, row_count=2423811, null_rate=0.004, collected_at=NOW - timedelta(minutes=6)),
        MetricPoint(dataset="mart.dim_customer", freshness_minutes=14, row_count=2124110, null_rate=0.004, collected_at=NOW - timedelta(hours=1)),
    ],
}

SCHEMA_CHECKS_BY_DATASET = {
    "analytics.revenue_daily": [
        SchemaCheck(dataset="analytics.revenue_daily", name="not_null_booking_net_amount", status="fail", detail="2,183 null values in latest partition"),
        SchemaCheck(dataset="analytics.revenue_daily", name="accepted_values_currency", status="pass", detail="All values within expected enum"),
    ],
    "mart.dim_customer": [
        SchemaCheck(dataset="mart.dim_customer", name="unique_customer_id", status="fail", detail="248 duplicate keys detected"),
        SchemaCheck(dataset="mart.dim_customer", name="not_null_customer_id", status="pass", detail="No null customer ids found"),
    ],
}

AUDIT_TRAIL = [
    AuditEvent(
        id="aud_001",
        incident_id="inc_001",
        type="system_note",
        actor="system",
        detail="Incident created from freshness monitor.",
        created_at=NOW - timedelta(minutes=41),
        metadata={"detector": "freshness_monitor"},
    ),
    AuditEvent(
        id="aud_002",
        incident_id="inc_001",
        type="tool_call",
        actor="backend",
        detail="Fetched logs, metrics, and schema checks for incident analysis.",
        created_at=NOW - timedelta(minutes=4),
        metadata={"tools": ["get_logs", "get_recent_metrics", "get_schema_checks"]},
    ),
]
