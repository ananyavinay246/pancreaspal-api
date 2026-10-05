# PancreasPal API

PancreasPal is an AI-powered educational companion for newly diagnosed Type 1 diabetes patients. It combines conversation memory, personal health metrics and Retrieval-Augmented Generation (RAG) against trusted and vetted medical sources stored in an Amazon Bedrock Knowledge Base.

## Project Structure

- `main.py` - FastAPI backend application entry point
- `ingest_knowledge_base.py` - Uploads `Gold_Standard.zip` PDFs to S3 and starts a Bedrock Knowledge Base ingestion job
- `rag_service.py` - Retrieves from the Bedrock Knowledge Base and generates answers with Claude on Bedrock
- `patient_service.py` - Patient session markers on disk or S3, DynamoDB conversation memory
- `Dockerfile` - Image for AWS App Runner
- `create_conversation_table.py` - Creates the DynamoDB table used for chat turns
- `create_health_metrics_table.py` - Creates the DynamoDB table for health metric logs
- `health_metrics_service.py` - Validates and stores glucose/insulin/exercise/food/mood entries
- `dashboard_service.py` - Aggregates metrics into Home/Insights payloads and caches `DASHBOARD#days=14` snapshots
- `requirements.txt` - Backend Python dependencies
- `.env.example` - Required AWS / Bedrock / DynamoDB environment variable names
- `pancreaspal-ui/` - React frontend application
- `patient_files/` - Generated patient history text files
- `gold_standard_docs/` - Local unzip of `Gold_Standard.zip` used only as the ingest upload source

## Requirements

- Python 3.12
- Node.js 22+ (for frontend; see `pancreaspal-ui/.mise.toml`)
- pnpm 10.x (via `corepack enable` or `npm install -g pnpm`)
- An AWS account with Amazon Bedrock access
- AWS credentials available to boto3 (environment variables, `AWS_PROFILE`, or `~/.aws/credentials`)

## AWS one-time setup

Do this in the AWS console before running ingest or the API.

1. Choose a region (for example `us-east-1`).
2. In Amazon Bedrock, enable model access for:
   - Embeddings: Amazon Titan Text Embeddings V2 (`amazon.titan-embed-text-v2:0`)
   - Generation: Claude Sonnet 4.5 (copy the model or inference-profile ID from the console)
3. Create a private S3 bucket, for example `pancreaspal-gold-standard`.
4. Create a Bedrock Knowledge Base:
   - Data source: an S3 prefix such as `s3://pancreaspal-gold-standard/gold-standard/`
   - Embeddings: Titan Text Embeddings V2
   - Vector store: S3 Vectors (recommended for a small/dev corpus)
   - Chunking: default semantic or fixed chunking
5. Grant the IAM principal that runs this app permission to:
   - `bedrock:Retrieve`
   - `bedrock:InvokeModel` (and Converse)
   - `s3:PutObject` / `s3:GetObject` on the gold-standard prefix (ingest script)
   - `bedrock:StartIngestionJob` and `bedrock:GetIngestionJob` (ingest script)
   - `dynamodb:Query` and `dynamodb:PutItem` on the conversation table
   - `dynamodb:CreateTable` and `dynamodb:DescribeTable` if you use `create_conversation_table.py`
6. Copy the Knowledge Base ID, data source ID, S3 URI, region, Claude model ID, and DynamoDB table name into `.env`.
7. Create the chat-memory table (once per account/region):

```bash
python create_conversation_table.py
```

## Backend Setup

### 1. Create and activate a Python virtual environment

On Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

On macOS/Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 2. Install backend dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure environment variables

Copy `.env.example` to `.env` in the repository root and fill in:

```env
AWS_REGION=us-east-1
BEDROCK_KNOWLEDGE_BASE_ID=
BEDROCK_DATA_SOURCE_ID=
BEDROCK_S3_URI=s3://pancreaspal-gold-standard/gold-standard/
BEDROCK_MODEL_ID=
DYNAMODB_CONVERSATION_TABLE=pancreaspal-conversations
```

Optional for local S3 patient files (required on App Runner):

```env
PATIENT_FILES_S3_BUCKET=
CORS_ORIGINS=
```

Do not commit `.env`. boto3 uses the default AWS credential chain.

### 4. Prepare the medical source data

Place `Gold_Standard.zip` in the repository root if it is not already present.

### 5. Ingest documents into the Knowledge Base

```bash
python ingest_knowledge_base.py
```

This script will:

- unzip `Gold_Standard.zip` into `gold_standard_docs/`
- upload each PDF to `BEDROCK_S3_URI`
- start a Bedrock Knowledge Base ingestion job
- wait until the job completes

Re-run this script whenever the Gold Standard PDFs change. The Knowledge Base itself is created once in the AWS console.

## Running the Backend

Start the FastAPI server with:

```bash
python3 -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

The backend will be available at:

`http://127.0.0.1:8000`

Startup fails if `BEDROCK_KNOWLEDGE_BASE_ID`, `BEDROCK_MODEL_ID`, `DYNAMODB_CONVERSATION_TABLE`, or `DYNAMODB_HEALTH_METRICS_TABLE` is missing. A local FAISS folder is not required.

## Frontend Setup

The React UI lives in `pancreaspal-ui/`.

### 1. Install frontend dependencies

```bash
cd pancreaspal-ui
corepack enable
pnpm install
```

### 2. Configure frontend environment

Create a `.env.local` file inside `pancreaspal-ui/` (see `.env.example`):

```env
VITE_API_URL=http://127.0.0.1:8000
```

Leave `VITE_API_URL` empty to use the Vite dev proxy to `127.0.0.1:8000`.

### 3. Start the frontend

```bash
pnpm dev
```

The dev server runs at `http://localhost:8443` by default (`vite.config.ts`).

## Quick Setup

If the Gold Standard documents changed, re-ingest:

```bash
python ingest_knowledge_base.py
```

If the Knowledge Base is already ingested and `.env` is configured, start the backend:

```bash
python3 -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Open a new terminal while keeping the old one running, then:

```bash
cd pancreaspal-ui
pnpm dev
```

## Backend API Endpoints

### Health check

```http
GET /
```

Response:

```json
{ "status": "Medical RAG API is running." }
```

### Create patient session

```http
POST /api/v1/patients/init
```

Response:

```json
{ "patient_id": "<uuid>" }
```

The UI stores `patient_id` in the browser and uses it for chat, metrics, and dashboard APIs.

### Append patient history

```http
POST /api/v1/patients/{patient_id}/append
Content-Type: application/json
```

Body:

```json
{ "text": "New clinical note or follow-up information." }
```

### Query patient agent

```http
POST /api/v1/patients/{patient_id}/query
Content-Type: application/json
```

Body:

```json
{
  "query": "What is time in range?",
  "query_mode": "general"
}
```

`query_mode` is optional: `general` (default, educational RAG) or `metrics` (includes a server-built summary of logged metrics; responses describe data only, not personal medical advice).

Response example:

```json
{
  "answer": "...",
  "sources": [
    { "source": "s3://bucket/gold-standard/doc.pdf", "url": null, "title": "doc.pdf" }
  ],
  "query_mode": "general"
}
```

### Health metric logs

Create the table once (same region as `AWS_REGION`):

```bash
python create_health_metrics_table.py
```

Set `DYNAMODB_HEALTH_METRICS_TABLE=pancreaspal-health-metrics` in `.env`.

**Create entry** (`metric_type`: `glucose`, `insulin`, `exercise`, `food`, `mood`):

```http
POST /api/v1/patients/{patient_id}/metrics
Content-Type: application/json
```

Body example (glucose):

```json
{
  "metric_type": "glucose",
  "data": {
    "value": "112",
    "time": "08:30",
    "context": "Fasting",
    "note": ""
  }
}
```

Optional top-level `recorded_at` (ISO-8601). If omitted, the server uses `data.time` on today’s UTC date, or the current time.

**List entries** (newest first):

```http
GET /api/v1/patients/{patient_id}/metrics?metric_type=glucose&limit=50
```

**Smoke test (local API on port 8000):**

```powershell
# Session + glucose log
$base = "http://127.0.0.1:8000"
$pid = (Invoke-RestMethod -Method POST -Uri "$base/api/v1/patients/init").patient_id
$body = @{
  metric_type = "glucose"
  data = @{ value = "112"; time = "08:30"; context = "Fasting"; note = "" }
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method POST -Uri "$base/api/v1/patients/$pid/metrics" -ContentType "application/json" -Body $body
Invoke-RestMethod -Uri "$base/api/v1/patients/$pid/metrics?metric_type=glucose"
```

**Dashboard (cached aggregates for Home / Insights UI):**

Aggregates are computed from metric entries and stored in the same DynamoDB table as a snapshot item (`entry_id` = `DASHBOARD#days=14`). The snapshot is refreshed automatically after each successful `POST .../metrics`.

```http
GET /api/v1/patients/{patient_id}/dashboard?days=14
GET /api/v1/patients/{patient_id}/dashboard?days=14&refresh=true
```

**Conversation history (for History page):**

```http
GET /api/v1/patients/{patient_id}/conversations?limit=50
```

Returns chat turns newest first (`timestamp`, `user_query`, `agent_response`).

**End-to-end (local UI):** Run the API on port 8000 and `pnpm dev` in `pancreaspal-ui` (Vite proxies `/api` to the API). Log metrics from the FAB; Home and Insights read `/dashboard`. After redeploying App Runner, rebuild Amplify with `VITE_API_URL` set to your App Runner URL so production uses the same routes.

## How it works

1. The UI calls `POST /api/v1/patients/init` once per browser to get a `patient_id`. A placeholder chart file is created under `patient_files/<patient_id>.txt` locally, or in S3 when `PATIENT_FILES_S3_BUCKET` is set (used only to validate the session exists).
2. A query searches the Bedrock Knowledge Base with the user's question (Gold Standard docs).
3. Retrieved library excerpts, any optional appended notes, and the last 20 DynamoDB chat turns are sent to Claude on Bedrock.
4. After a successful answer, the new turn is written to DynamoDB.
5. The API returns the answer plus source citations for the UI.

Patient session files are not written to the Knowledge Base. Chat turns persist in DynamoDB. On App Runner, session marker files must live in S3 when the bucket is configured.

## Deploy on AWS (App Runner + Amplify)

Teammates only need the Amplify URL. They do not create a Knowledge Base or configure AWS.

These resources are already in account `402561607513` / `us-east-1`:

- Patient text bucket: `pancreaspal-patient-files-402561607513`
- App Runner instance role: `pancreaspal-apprunner-instance`
- App Runner ECR pull role: `pancreaspal-apprunner-ecr-access`
- ECR repo: `402561607513.dkr.ecr.us-east-1.amazonaws.com/pancreaspal-api`
- Amplify app: `d3cmc7tgu7fkco` (domain `d3cmc7tgu7fkco.amplifyapp.com`, branch `main`)

### 1. Push the API image (needs Docker Desktop)

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/), then from the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File deploy/create-apprunner-service.ps1
```

The script reads `.env` (KB id, model id, table name), builds the `Dockerfile`, pushes to ECR, and creates or updates App Runner service `pancreaspal-api` on port 8080. It sets `PATIENT_FILES_S3_BUCKET` to the patient bucket above.

Copy the printed App Runner URL (`https://xxxx.us-east-1.awsapprunner.com`).

### 2. Host the UI on Amplify

In the Amplify console, open app `pancreaspal-ui` and connect GitHub repo `pancreaspal-api` (app root `pancreaspal-ui`, build from [`amplify.yml`](amplify.yml) — **pnpm** via Corepack). Prefer a Node 22 build image if your Amplify app settings allow it. Set the build environment variable:

```text
VITE_API_URL=https://<apprunner-url>
```

No trailing slash. Redeploy so Vite bakes in the API URL.

The teammate URL is typically `https://main.d3cmc7tgu7fkco.amplifyapp.com`.

### 3. CORS

On the App Runner service, set:

```text
CORS_ORIGINS=https://main.d3cmc7tgu7fkco.amplifyapp.com
```

`http://localhost:3000`, `http://localhost:8443`, and `127.0.0.1` variants are always allowed in code. Set `CORS_ORIGINS` in repo-root `.env` to your Amplify URL, then re-run the deploy script so App Runner picks it up.

`BEDROCK_DATA_SOURCE_ID` and `BEDROCK_S3_URI` are only needed for `ingest_knowledge_base.py` on a laptop, not on App Runner.

The public Amplify URL has no login. Share it only with teammates; do not upload real PHI.

### After you push (manual AWS checklist)

1. Apply the latest [`deploy/apprunner-instance-policy.json`](deploy/apprunner-instance-policy.json) to IAM role `pancreaspal-apprunner-instance` (includes `dynamodb:GetItem` on the health-metrics table for dashboard cache).
2. Ensure DynamoDB table `pancreaspal-health-metrics` exists (`python create_health_metrics_table.py` once per account/region).
3. Push code, then run `deploy/create-apprunner-service.ps1` to rebuild the Docker image and update App Runner env (including `DYNAMODB_HEALTH_METRICS_TABLE` and `CORS_ORIGINS`).
4. In Amplify, set `VITE_API_URL` to your App Runner URL and redeploy the frontend branch.
5. Smoke test: `POST /init` → log a metric → `GET /dashboard` → chat in Learn and Summarize my logs modes.

## Notes and Troubleshooting

- `BEDROCK_KNOWLEDGE_BASE_ID`, `BEDROCK_MODEL_ID`, `DYNAMODB_CONVERSATION_TABLE`, and `DYNAMODB_HEALTH_METRICS_TABLE` must be present in `.env` before starting the backend.
- Create the conversation table with `python create_conversation_table.py` before the first query.
- Create the health metrics table with `python create_health_metrics_table.py` before logging metrics.
- `DYNAMODB_HEALTH_METRICS_TABLE` must be set in `.env` before starting the backend (with the other required vars).
- Enable Bedrock model access in the same region as `AWS_REGION`.
- If `ingest_knowledge_base.py` cannot find `Gold_Standard.zip`, place it in the repository root.
- Check `CORS_ORIGINS` if the hosted frontend cannot call the API.

## Quick test

With the backend running:

```bash
curl http://127.0.0.1:8000/
```

Expected output:

```json
{"status":"Medical RAG API is running."}
```

You can also run:

```bash
python test_claude.py
```

## Development notes

- Backend: `FastAPI`, Amazon Bedrock Knowledge Bases, Claude on Bedrock, DynamoDB chat memory
- Embeddings: Amazon Titan Text Embeddings V2 (configured on the Knowledge Base)
- Frontend: React + Vite + Tailwind CSS

## Useful directories

- `patient_files/` - saved patient text history
- `gold_standard_docs/` - extracted PDFs from `Gold_Standard.zip` (ingest source only)
- `pancreaspal-ui/` - frontend application

---

## License

This project is provided without an explicit license. Add a license file if you plan to share or distribute it.
