from datetime import datetime
import json
import logging
import os
import uuid
from pathlib import Path

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

# --- Configuration ---
PATIENT_FILES_DIR = Path("patient_files")
MAX_CONVERSATION_TURNS = 20
DEFAULT_S3_PREFIX = "patients/"

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")


def _normalize_prefix(prefix: str) -> str:
    value = (prefix or DEFAULT_S3_PREFIX).strip()
    if not value.endswith("/"):
        value = f"{value}/"
    return value


class PatientService:
    def __init__(self, table=None, s3_client=None):
        region = os.getenv("AWS_REGION", "us-east-1")
        self._bucket = os.getenv("PATIENT_FILES_S3_BUCKET", "").strip()
        self._prefix = _normalize_prefix(os.getenv("PATIENT_FILES_S3_PREFIX", DEFAULT_S3_PREFIX))

        if s3_client is not None:
            self._s3 = s3_client
        elif self._bucket:
            self._s3 = boto3.client("s3", region_name=region)
            logging.info(
                "Patient files stored in s3://%s/%s",
                self._bucket,
                self._prefix,
            )
        else:
            self._s3 = None
            PATIENT_FILES_DIR.mkdir(exist_ok=True)
            logging.info("Patient files stored locally in %s", PATIENT_FILES_DIR)

        if table is not None:
            self._table = table
            return

        table_name = os.getenv("DYNAMODB_CONVERSATION_TABLE", "").strip()
        if not table_name:
            raise ValueError(
                "DYNAMODB_CONVERSATION_TABLE is not set. Add it to your .env file. See .env.example."
            )

        dynamodb = boto3.resource("dynamodb", region_name=region)
        self._table = dynamodb.Table(table_name)
        logging.info(
            "PatientService using DynamoDB table %s in region %s",
            table_name,
            region,
        )

    def _uses_s3(self) -> bool:
        return bool(self._s3 and self._bucket)

    def _object_key(self, patient_id: str) -> str:
        return f"{self._prefix}{patient_id}.txt"

    def _local_path(self, patient_id: str) -> Path:
        return PATIENT_FILES_DIR / f"{patient_id}.txt"

    def _write_history(self, patient_id: str, text: str) -> None:
        if self._uses_s3():
            self._s3.put_object(
                Bucket=self._bucket,
                Key=self._object_key(patient_id),
                Body=text.encode("utf-8"),
                ContentType="text/plain; charset=utf-8",
            )
            return
        path = self._local_path(patient_id)
        path.parent.mkdir(exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def create_patient_session(self) -> str:
        """Create a patient record with empty chart text for chat and metrics."""
        patient_id = str(uuid.uuid4())
        self._write_history(patient_id, "")
        logging.info("Created empty patient session %s", patient_id)
        return patient_id

    def upsert_patient_history(self, patient_id: str, text: str) -> None:
        """Write or replace chart text for a known patient id (e.g. shared demo seed)."""
        self._write_history(patient_id, text)
        logging.info("Upserted patient history for %s (%s bytes)", patient_id, len(text))

    def get_patient_history_text(self, patient_id: str) -> str | None:
        """Reads the full text history from a patient's .txt file."""
        if self._uses_s3():
            try:
                response = self._s3.get_object(
                    Bucket=self._bucket,
                    Key=self._object_key(patient_id),
                )
                return response["Body"].read().decode("utf-8")
            except ClientError as exc:
                code = exc.response.get("Error", {}).get("Code", "")
                # Without s3:ListBucket, missing keys often surface as AccessDenied instead of NoSuchKey.
                if code in {"NoSuchKey", "404", "NotFound", "AccessDenied"}:
                    return None
                raise

        file_path = self._local_path(patient_id)
        if not file_path.exists():
            return None
        return file_path.read_text(encoding="utf-8")

    def append_to_patient_history(self, patient_id: str, new_text: str) -> bool:
        """Appends a new note to the patient's history .txt file."""
        existing = self.get_patient_history_text(patient_id)
        if existing is None:
            return False
        self._write_history(patient_id, f"{existing}\n\n--- Appended Note ---\n{new_text}")
        return True

    def get_conversation_history(self, patient_id: str) -> list[dict]:
        """Retrieve the most recent conversation turns for a patient from DynamoDB."""
        response = self._table.query(
            KeyConditionExpression=Key("patient_id").eq(patient_id),
            ScanIndexForward=False,
            Limit=MAX_CONVERSATION_TURNS,
        )
        items = list(reversed(response.get("Items") or []))
        turns = [
            {
                "user_query": item.get("user_query", ""),
                "agent_response": item.get("agent_response", ""),
                "timestamp": item.get("timestamp", ""),
            }
            for item in items
        ]
        logging.info("Loaded %s conversation turn(s) for patient %s", len(turns), patient_id)
        return turns

    def list_conversation_turns(self, patient_id: str, limit: int = 50) -> list[dict]:
        """List conversation turns newest first (for History UI)."""
        if limit < 1 or limit > 100:
            limit = 50
        response = self._table.query(
            KeyConditionExpression=Key("patient_id").eq(patient_id),
            ScanIndexForward=False,
            Limit=limit,
        )
        turns = []
        for item in response.get("Items") or []:
            turn = {
                "turn_id": item.get("turn_id", ""),
                "timestamp": item.get("timestamp", ""),
                "user_query": item.get("user_query", ""),
                "agent_response": item.get("agent_response", ""),
            }
            detail = item.get("agent_response_detail")
            if detail:
                turn["agent_response_detail"] = detail
            offer = item.get("detail_offer_answer")
            if offer:
                turn["detail_offer_answer"] = offer
            turns.append(turn)
        return turns

    def get_turn(self, patient_id: str, turn_id: str) -> dict | None:
        """Load a single conversation turn by id."""
        response = self._table.get_item(Key={"patient_id": patient_id, "turn_id": turn_id})
        item = response.get("Item")
        if not item:
            return None
        turn = {
            "turn_id": item.get("turn_id", ""),
            "timestamp": item.get("timestamp", ""),
            "user_query": item.get("user_query", ""),
            "agent_response": item.get("agent_response", ""),
        }
        detail = item.get("agent_response_detail")
        if detail:
            turn["agent_response_detail"] = detail
        offer = item.get("detail_offer_answer")
        if offer:
            turn["detail_offer_answer"] = offer
        raw_context = item.get("rag_prompt_context")
        if isinstance(raw_context, str) and raw_context.strip():
            try:
                turn["rag_prompt_context"] = json.loads(raw_context)
            except json.JSONDecodeError:
                logging.warning("Invalid rag_prompt_context JSON for turn %s", turn_id)
        return turn

    def set_turn_detail(self, patient_id: str, turn_id: str, detail_text: str) -> None:
        """Attach an expanded assistant reply to an existing turn."""
        self._table.update_item(
            Key={"patient_id": patient_id, "turn_id": turn_id},
            UpdateExpression="SET agent_response_detail = :detail, detail_offer_answer = :yes",
            ExpressionAttributeValues={":detail": detail_text, ":yes": "yes"},
        )
        logging.info("Stored detail expansion for turn %s patient %s", turn_id, patient_id)

    def set_detail_offer_declined(self, patient_id: str, turn_id: str) -> None:
        """Record that the user declined the optional detail offer."""
        self._table.update_item(
            Key={"patient_id": patient_id, "turn_id": turn_id},
            UpdateExpression="SET detail_offer_answer = :no",
            ExpressionAttributeValues={":no": "no"},
        )
        logging.info("Stored detail offer decline for turn %s patient %s", turn_id, patient_id)

    def add_to_conversation_history(
        self,
        patient_id: str,
        user_query: str,
        agent_response: str,
        rag_prompt_context: dict | None = None,
    ) -> str:
        """Persist a user/assistant turn in DynamoDB. Returns turn_id."""
        timestamp = datetime.now().isoformat()
        turn_id = f"TURN#{timestamp}#{uuid.uuid4()}"
        item: dict = {
            "patient_id": patient_id,
            "turn_id": turn_id,
            "user_query": user_query,
            "agent_response": agent_response,
            "timestamp": timestamp,
        }
        if rag_prompt_context:
            item["rag_prompt_context"] = json.dumps(rag_prompt_context, ensure_ascii=False)
        self._table.put_item(Item=item)
        logging.info("Stored conversation turn for patient %s", patient_id)
        return turn_id
