import logging
import os
from typing import Literal

from fastapi.middleware.cors import CORSMiddleware
from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from dotenv import load_dotenv
load_dotenv()

from auth import (
    AuthUser,
    auth_enabled,
    authorize_patient_id,
    get_optional_user,
    get_required_user,
)
from rag_service import NO_METRICS_DATA_ANSWER, RAGService
from patient_service import PatientService
from health_metrics_service import HealthMetricsService, HealthMetricsValidationError
from dashboard_service import DashboardService
from user_patient_service import UserPatientService


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
    user_patient_service = UserPatientService(patient_service)
    health_metrics_service = HealthMetricsService()
    dashboard_service = DashboardService(metrics_service=health_metrics_service)
except Exception as e:
    raise RuntimeError(f"FATAL: Failed to initialize services. Application cannot start. Error: {e}")


def _access_patient(
    patient_id: str,
    user: AuthUser | None = Depends(get_optional_user),
) -> str:
    authorized = authorize_patient_id(patient_id, user, user_patient_service)
    _require_patient(authorized)
    return authorized


# --- API Data Models ---
class PatientQueryRequest(BaseModel):
    query: str = Field(..., description="The user's latest question or prompt.")
    query_mode: Literal["general", "metrics"] = Field(
        default="general",
        description="general: educational RAG chat; metrics: summarize logged data without personal advice.",
    )
    response_detail: Literal["concise", "detailed"] = Field(
        default="concise",
        description="concise: brief first answer; detailed: in-depth (normally via expand endpoint).",
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
    turn_id: str | None = None


class ExpandTurnRequest(BaseModel):
    query_mode: Literal["general", "metrics"] = Field(
        default="general",
        description="Must match the mode used for the original question.",
    )


class ExpandTurnResponse(BaseModel):
    answer: str
    sources: list[SourceDocument]
    query_mode: Literal["general", "metrics"] = "general"
    turn_id: str

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
    agent_response_detail: str | None = None
    detail_offer_answer: Literal["yes", "no"] | None = None


class ListConversationsResponse(BaseModel):
    turns: list[ConversationTurn]


class MeResponse(BaseModel):
    email: str | None
    patient_id: str
    is_demo: bool = False

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
    if auth_enabled():
        raise HTTPException(
            status_code=403,
            detail="Anonymous session creation is disabled. Use the demo patient or sign in.",
        )
    patient_id = patient_service.create_patient_session()
    return {"patient_id": patient_id}


@app.get("/api/v1/me", response_model=MeResponse)
async def get_current_user_profile(user: AuthUser = Depends(get_required_user)):
    """Return the signed-in user's linked patient_id (creates one on first login)."""
    if not auth_enabled():
        raise HTTPException(status_code=501, detail="Authentication is not enabled on this server.")
    patient_id = user_patient_service.get_or_create_patient_for_sub(user.sub, user.email)
    return MeResponse(email=user.email, patient_id=patient_id, is_demo=False)


@app.post("/api/v1/patients/{patient_id}/append", response_model=AppendHistoryResponse)
async def append_to_history(
    request: AppendHistoryRequest,
    patient_id: str = Depends(_access_patient),
):
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
async def query_patient_agent(
    request: PatientQueryRequest,
    patient_id: str = Depends(_access_patient),
):
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
            turn_id = patient_service.add_to_conversation_history(
                patient_id, request.query, answer
            )
            return RAGQueryResponse(
                answer=answer, sources=[], query_mode="metrics", turn_id=turn_id
            )

    result = rag_service.process_query(
        patient_history=patient_history,
        conversation_history=conversation_history,
        query=request.query,
        query_mode=request.query_mode,
        metrics_context=metrics_context,
        response_detail=request.response_detail,
    )

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    turn_id = patient_service.add_to_conversation_history(
        patient_id,
        request.query,
        result["answer"],
        rag_prompt_context=result.get("rag_prompt_context"),
    )

    return RAGQueryResponse(
        answer=result["answer"],
        sources=result.get("sources") or [],
        query_mode=result.get("query_mode", request.query_mode),
        turn_id=turn_id,
    )


@app.post(
    "/api/v1/patients/{patient_id}/conversations/{turn_id}/expand",
    response_model=ExpandTurnResponse,
)
async def expand_conversation_turn(
    turn_id: str,
    request: ExpandTurnRequest,
    patient_id: str = Depends(_access_patient),
):
    """Generate a detailed follow-up for an existing concise turn."""
    turn = patient_service.get_turn(patient_id, turn_id)
    if turn is None:
        raise HTTPException(status_code=404, detail="Conversation turn not found.")

    existing_detail = turn.get("agent_response_detail")
    if existing_detail:
        return ExpandTurnResponse(
            answer=existing_detail,
            sources=[],
            query_mode=request.query_mode,
            turn_id=turn_id,
        )

    stored_context = turn.get("rag_prompt_context")
    if stored_context:
        result = rag_service.expand_from_stored_context(
            stored_context,
            prior_answer=turn["agent_response"],
        )
    else:
        logging.warning(
            "Expand without stored RAG context for turn %s; falling back to full retrieve.",
            turn_id,
        )
        patient_history = patient_service.get_patient_history_text(patient_id)
        if patient_history is None:
            raise HTTPException(status_code=404, detail=f"Patient with ID '{patient_id}' not found.")

        conversation_history = patient_service.get_conversation_history(patient_id)
        metrics_context: str | None = None
        if request.query_mode == "metrics":
            metrics_context, has_metrics = dashboard_service.build_metrics_context(
                patient_id, days=14
            )
            if not has_metrics:
                raise HTTPException(
                    status_code=422,
                    detail="No metrics available to expand this summary.",
                )

        result = rag_service.process_query(
            patient_history=patient_history,
            conversation_history=conversation_history,
            query=turn["user_query"],
            query_mode=request.query_mode,
            metrics_context=metrics_context,
            response_detail="detailed",
            prior_answer=turn["agent_response"],
        )

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    patient_service.set_turn_detail(patient_id, turn_id, result["answer"])

    return ExpandTurnResponse(
        answer=result["answer"],
        sources=result.get("sources") or [],
        query_mode=result.get("query_mode", request.query_mode),
        turn_id=turn_id,
    )


@app.post("/api/v1/patients/{patient_id}/conversations/{turn_id}/decline-detail")
async def decline_conversation_detail(
    turn_id: str,
    patient_id: str = Depends(_access_patient),
):
    """Record that the user declined the optional in-depth follow-up."""
    turn = patient_service.get_turn(patient_id, turn_id)
    if turn is None:
        raise HTTPException(status_code=404, detail="Conversation turn not found.")
    if turn.get("agent_response_detail"):
        raise HTTPException(status_code=409, detail="Detail was already generated for this turn.")
    if turn.get("detail_offer_answer") == "no":
        return {"turn_id": turn_id, "detail_offer_answer": "no"}
    patient_service.set_detail_offer_declined(patient_id, turn_id)
    return {"turn_id": turn_id, "detail_offer_answer": "no"}


@app.post(
    "/api/v1/patients/{patient_id}/metrics",
    response_model=CreateMetricResponse,
)
async def create_health_metric(
    request: CreateMetricRequest,
    patient_id: str = Depends(_access_patient),
):
    """Log a health metric entry (glucose, insulin, exercise, food, mood)."""
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
    days: int = Query(14, ge=7, le=30),
    refresh: bool = Query(False, description="Force recompute and update cache"),
    patient_id: str = Depends(_access_patient),
):
    """Return cached dashboard aggregates for Home and Insights (refreshed on each new metric log)."""
    payload = dashboard_service.get_dashboard(patient_id, days=days, refresh=refresh)
    return payload


@app.get(
    "/api/v1/patients/{patient_id}/metrics",
    response_model=ListMetricsResponse,
)
async def list_health_metrics(
    metric_type: str | None = Query(None, description="Filter by metric type"),
    limit: int = Query(100, ge=1, le=500),
    patient_id: str = Depends(_access_patient),
):
    """List health metric entries for a patient, newest first."""
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
    limit: int = Query(50, ge=1, le=100),
    patient_id: str = Depends(_access_patient),
):
    """List stored chat turns for the patient, newest first."""
    turns = patient_service.list_conversation_turns(patient_id, limit=limit)
    return {"turns": turns}