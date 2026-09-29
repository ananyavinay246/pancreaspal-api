import os

from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from dotenv import load_dotenv
load_dotenv()

from rag_service import RAGService
from patient_service import PatientService


def _cors_origins() -> list[str]:
    origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
    extra = os.getenv("CORS_ORIGINS", "")
    for part in extra.split(","):
        origin = part.strip().rstrip("/")
        if origin and origin not in origins:
            origins.append(origin)
    return origins


# Initialize the FastAPI app and services
app = FastAPI(
    title="Pancreas Pal",
    description="An AI-powered clinical co-pilot with conversation memory.",
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
except Exception as e:
    raise RuntimeError(f"FATAL: Failed to initialize services. Application cannot start. Error: {e}")


# --- API Data Models ---
class PatientQueryRequest(BaseModel):
    query: str = Field(..., description="The user's latest question or prompt.")

class AppendHistoryRequest(BaseModel):
    text: str = Field(..., description="The new text note to append to the patient's history.")

class SourceDocument(BaseModel):
    source: str | None
    url: str | None
    title: str | None

class RAGQueryResponse(BaseModel):
    answer: str
    sources: list[SourceDocument]

class AppendHistoryResponse(BaseModel):
    patient_id: str
    info: str

# --- API Endpoints ---

@app.get("/")
def read_root():
    return {"status": "Medical RAG API is running."}

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
    """Query using Bedrock Knowledge Base retrieval and Claude."""
    conversation_history = patient_service.get_conversation_history(patient_id)

    result = rag_service.process_query(
        conversation_history=conversation_history,
        query=request.query
    )

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    patient_service.add_to_conversation_history(patient_id, request.query, result["answer"])

    return result