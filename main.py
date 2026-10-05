import logging
import os
from typing import Literal

from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from dotenv import load_dotenv
load_dotenv()

from rag_service import NO_METRICS_DATA_ANSWER, RAGService
from patient_service import PatientService
from health_metrics_service import HealthMetricsService, HealthMetricsValidationError
from dashboard_service import DashboardService


def _cors_origins() -> list[str]:
    origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8443",
        "http://127.0.0.1:8443",
    ]
    extra = os.getenv("CORS_ORIGINS", "")
    for part in extra.split(","):
        origin = part.strip().rstrip("/")
        if origin and origin not in origins:
            origins.append(origin)
    return origins


# Initialize the FastAPI app and services
app = FastAPI(
    title="Pancreas Pal",
    description="An AI-powered clinical co-pilot with conversation memory and health metrics.",
    version="3.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

try:
    rag_service = RAGService()
    patient_service = PatientService()
    health_metrics_service = HealthMetricsService()
    dashboard_service = DashboardService(metrics_service=health_metrics_service)
except Exception as e:
    raise RuntimeError(f"FATAL: Failed to initialize services. Application cannot start. Error: {e}")


# --- API Data Models ---
class PatientQueryRequest(BaseModel):
    query: str = Field(..., description="The user's latest question or prompt.")
    query_mode: Literal["general", "metrics"] = Field(
        default="general",
        description="general: educational RAG chat; metrics: summarize logged data without personal advice.",
    )

class AppendHistoryRequest(BaseModel):
    text: str = Field(..., description="The new text note to append to the patient's history.")

class SourceDocument(BaseModel):
    source: str | None
    url: str | None
    title: str | None

class RAGQueryResponse(BaseModel):
    answer: str
    sources: list[SourceDocument]
    query_mode: Literal["general", "metrics"] = "general"

class AppendHistoryResponse(BaseModel):
    patient_id: str
    info: str

class PatientInitResponse(BaseModel):
    patient_id: str

class CreateMetricRequest(BaseModel):
    metric_type: str = Field(..., description="glucose, insulin, exercise, food, or mood")
    data: dict[str, str] = Field(..., description="Form field values from the UI")
    recorded_at: str | None = Field(None, description="Optional ISO-8601 timestamp")

class CreateMetricResponse(BaseModel):
    patient_id: str
    entry_id: str
    metric_type: str
    recorded_at: str

class MetricEntry(BaseModel):
    entry_id: str
    metric_type: str
    recorded_at: str
    created_at: str
    data: dict[str, str]

class ListMetricsResponse(BaseModel):
    entries: list[MetricEntry]


class TirBreakdown(BaseModel):
    inRange: int
    high: int
    low: int


class GlucoseSummary(BaseModel):
    avg_glucose: float
    tir_pct: int
    std_dev: float
    est_a1c: float


class GlucoseInsightsBlock(BaseModel):
    daily_avg: list[float]
    daily_low: list[float]
    daily_high: list[float]
    date_labels: list[str]
    tir: TirBreakdown
    summary: GlucoseSummary


class InsulinInsightsBlock(BaseModel):
    tdd: list[float]
    bolus: list[float]
    basal: list[float]
    day_labels: list[str]
    summary: dict[str, float]


class ExerciseDay(BaseModel):
    min: int
    type: str


class FoodDayCarbs(BaseModel):
    total: float
    b: float
    l: float
    d: float
    s: float = 0.0


class MealDot(BaseModel):
    t: float
    carbs: float
    label: str


class ExerciseSessionChart(BaseModel):
    x: float
    w: float
    intensity: float


class HomeGlucose(BaseModel):
    value: float | None = None
    sparkline: list[float]
    in_range: bool
    sublabel: str


class HomeInsulin(BaseModel):
    total_units: float
    bolus_count: int
    intraday_bolus: list[float]
    sublabel: str


class HomeFood(BaseModel):
    carbs_today: float
    meals_today: list[MealDot]
    sublabel: str


class HomeExercise(BaseModel):
    minutes_today: float
    sessions_today: list[ExerciseSessionChart]
    week_minutes: list[float]
    sublabel: str


class HomeMood(BaseModel):
    label: str
    value: int
    days_logged_month: int
    month_full: list[int]
    start_offset: int
    month_label: str


class HomeBlock(BaseModel):
    glucose: HomeGlucose
    insulin: HomeInsulin
    food: HomeFood
    exercise: HomeExercise
    mood: HomeMood


class TopFoodItem(BaseModel):
    name: str
    count: int
    carbs_avg: float
    meal: str


class ExerciseGlucoseImpactRow(BaseModel):
    type: str
    before: float | None = None
    after: float | None = None
    session_count: int


class MoodVsGlucoseRow(BaseModel):
    mood: int
    label: str
    avg_glucose: float
    day_count: int


class ExerciseInsightsBlock(BaseModel):
    days: list[ExerciseDay]
    day_labels: list[str]
    glucose_impact: list[ExerciseGlucoseImpactRow] = []


class FoodInsightsBlock(BaseModel):
    carbs_by_day: list[FoodDayCarbs]
    day_labels: list[str]
    top_foods: list[TopFoodItem] = []


class MoodInsightsBlock(BaseModel):
    month_full: list[int]
    start_offset: int
    month_year: str
    days_logged: int
    mood_vs_glucose: list[MoodVsGlucoseRow] = []


class InsightsBlock(BaseModel):
    glucose: GlucoseInsightsBlock
    insulin: InsulinInsightsBlock
    exercise: ExerciseInsightsBlock
    food: FoodInsightsBlock
    mood: MoodInsightsBlock


class DashboardResponse(BaseModel):
    generated_at: str
    days: int
    has_any_metrics: bool
    home: HomeBlock
    insights: InsightsBlock


class ConversationTurn(BaseModel):
    turn_id: str | None = None
    timestamp: str
    user_query: str
    agent_response: str


class ListConversationsResponse(BaseModel):
    turns: list[ConversationTurn]

# --- API Endpoints ---

def _require_patient(patient_id: str) -> None:
    if patient_service.get_patient_history_text(patient_id) is None:
        raise HTTPException(status_code=404, detail=f"Patient with ID '{patient_id}' not found.")

@app.get("/")
def read_root():
    return {"status": "Medical RAG API is running."}

@app.post("/api/v1/patients/init", response_model=PatientInitResponse)
async def init_patient_session():
    """Create a patient session (empty chart text; chat uses KB + conversation memory)."""
    patient_id = patient_service.create_patient_session()
    return {"patient_id": patient_id}


@app.post("/api/v1/patients/{patient_id}/append", response_model=AppendHistoryResponse)
async def append_to_history(patient_id: str, request: AppendHistoryRequest):
    """
    Appends a new text note to an existing patient's history.
    """
    success = patient_service.append_to_patient_history(patient_id, request.text)
    if not success:
        raise HTTPException(status_code=404, detail=f"Patient with ID '{patient_id}' not found.")

    return {
        "patient_id": patient_id,
        "info": "The patient's history has been successfully updated."
    }

@app.post("/api/v1/patients/{patient_id}/query", response_model=RAGQueryResponse)
async def query_patient_agent(patient_id: str, request: PatientQueryRequest):
    """Query patient agent using Bedrock Knowledge Base retrieval and Claude."""
    patient_history = patient_service.get_patient_history_text(patient_id)
    if patient_history is None:
        raise HTTPException(status_code=404, detail=f"Patient with ID '{patient_id}' not found.")

    conversation_history = patient_service.get_conversation_history(patient_id)

    metrics_context: str | None = None
    if request.query_mode == "metrics":
        metrics_context, has_metrics = dashboard_service.build_metrics_context(patient_id, days=14)
        if not has_metrics:
            answer = NO_METRICS_DATA_ANSWER
            patient_service.add_to_conversation_history(patient_id, request.query, answer)
            return RAGQueryResponse(answer=answer, sources=[], query_mode="metrics")

    result = rag_service.process_query(
        patient_history=patient_history,
        conversation_history=conversation_history,
        query=request.query,
        query_mode=request.query_mode,
        metrics_context=metrics_context,
    )

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    patient_service.add_to_conversation_history(patient_id, request.query, result["answer"])

    return RAGQueryResponse(
        answer=result["answer"],
        sources=result.get("sources") or [],
        query_mode=result.get("query_mode", request.query_mode),
    )


@app.post(
    "/api/v1/patients/{patient_id}/metrics",
    response_model=CreateMetricResponse,
)
async def create_health_metric(patient_id: str, request: CreateMetricRequest):
    """Log a health metric entry (glucose, insulin, exercise, food, mood)."""
    _require_patient(patient_id)
    try:
        result = health_metrics_service.create_entry(
            patient_id=patient_id,
            metric_type=request.metric_type,
            data=request.data,
            recorded_at=request.recorded_at,
        )
    except HealthMetricsValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        dashboard_service.refresh_dashboard(patient_id)
    except Exception as exc:
        logging.warning("Dashboard refresh after metric create failed: %s", exc)
    return result


@app.get(
    "/api/v1/patients/{patient_id}/dashboard",
    response_model=DashboardResponse,
)
async def get_patient_dashboard(
    patient_id: str,
    days: int = Query(14, ge=7, le=30),
    refresh: bool = Query(False, description="Force recompute and update cache"),
):
    """Return cached dashboard aggregates for Home and Insights (refreshed on each new metric log)."""
    _require_patient(patient_id)
    payload = dashboard_service.get_dashboard(patient_id, days=days, refresh=refresh)
    return payload


@app.get(
    "/api/v1/patients/{patient_id}/metrics",
    response_model=ListMetricsResponse,
)
async def list_health_metrics(
    patient_id: str,
    metric_type: str | None = Query(None, description="Filter by metric type"),
    limit: int = Query(100, ge=1, le=500),
):
    """List health metric entries for a patient, newest first."""
    _require_patient(patient_id)
    try:
        entries = health_metrics_service.list_entries(
            patient_id=patient_id,
            metric_type=metric_type,
            limit=limit,
        )
    except HealthMetricsValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"entries": entries}


@app.get(
    "/api/v1/patients/{patient_id}/conversations",
    response_model=ListConversationsResponse,
)
async def list_patient_conversations(
    patient_id: str,
    limit: int = Query(50, ge=1, le=100),
):
    """List stored chat turns for the patient, newest first."""
    _require_patient(patient_id)
    turns = patient_service.list_conversation_turns(patient_id, limit=limit)
    return {"turns": turns}