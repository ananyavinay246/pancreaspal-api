from datetime import datetime
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
                if exc.response.get("Error", {}).get("Code") in {"NoSuchKey", "404"}:
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

    def add_to_conversation_history(self, patient_id: str, user_query: str, agent_response: str) -> None:
        """Persist a user/assistant turn in DynamoDB."""
        timestamp = datetime.now().isoformat()
        turn_id = f"TURN#{timestamp}#{uuid.uuid4()}"
        self._table.put_item(
            Item={
                "patient_id": patient_id,
                "turn_id": turn_id,
                "user_query": user_query,
                "agent_response": agent_response,
                "timestamp": timestamp,
            }
        )
        logging.info("Stored conversation turn for patient %s", patient_id)
