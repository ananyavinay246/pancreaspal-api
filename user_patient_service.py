import logging
import os
import re
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

from patient_service import PatientService

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

DEFAULT_TABLE_NAME = "pancreaspal-user-patients"
DISPLAY_NAME_MAX_LEN = 64
_DISPLAY_NAME_RE = re.compile(r"[\x00-\x1f\x7f]")


def normalize_display_name(raw: str) -> str:
    name = " ".join((raw or "").strip().split())
    if not name:
        raise ValueError("Display name is required.")
    if len(name) > DISPLAY_NAME_MAX_LEN:
        raise ValueError(f"Display name must be at most {DISPLAY_NAME_MAX_LEN} characters.")
    if _DISPLAY_NAME_RE.search(name):
        raise ValueError("Display name contains invalid characters.")
    return name


class UserPatientService:
    """Maps Cognito user sub to application patient_id."""

    def __init__(self, patient_service: PatientService):
        region = os.getenv("AWS_REGION", "us-east-1")
        table_name = (os.getenv("DYNAMODB_USER_PATIENTS_TABLE") or DEFAULT_TABLE_NAME).strip()
        self._table = boto3.resource("dynamodb", region_name=region).Table(table_name)
        self._patient_service = patient_service

    def get_item(self, cognito_sub: str) -> dict | None:
        response = self._table.get_item(Key={"cognito_sub": cognito_sub})
        return response.get("Item")

    def get_patient_id(self, cognito_sub: str) -> str | None:
        item = self.get_item(cognito_sub)
        if not item:
            return None
        patient_id = item.get("patient_id")
        return str(patient_id) if patient_id else None

    def get_display_name(self, cognito_sub: str) -> str | None:
        item = self.get_item(cognito_sub)
        if not item:
            return None
        name = item.get("display_name")
        if not name:
            return None
        text = str(name).strip()
        return text or None

    def set_display_name(self, cognito_sub: str, display_name: str) -> str:
        name = normalize_display_name(display_name)
        try:
            self._table.update_item(
                Key={"cognito_sub": cognito_sub},
                UpdateExpression="SET display_name = :n, updated_at = :u",
                ConditionExpression="attribute_exists(cognito_sub)",
                ExpressionAttributeValues={
                    ":n": name,
                    ":u": datetime.now().isoformat(),
                },
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                raise ValueError("User profile not found.") from exc
            raise
        return name

    def get_or_create_patient_for_sub(
        self,
        cognito_sub: str,
        email: str | None,
        display_name: str | None = None,
    ) -> str:
        existing = self.get_patient_id(cognito_sub)
        if existing:
            return existing

        patient_id = self._patient_service.create_patient_session()
        item = {
            "cognito_sub": cognito_sub,
            "patient_id": patient_id,
            "created_at": datetime.now().isoformat(),
        }
        if email:
            item["email"] = email
        if display_name:
            try:
                item["display_name"] = normalize_display_name(display_name)
            except ValueError:
                pass

        try:
            self._table.put_item(
                Item=item,
                ConditionExpression="attribute_not_exists(cognito_sub)",
            )
            logging.info("Linked Cognito sub to new patient %s", patient_id)
            return patient_id
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            raced = self.get_patient_id(cognito_sub)
            if raced:
                return raced
            raise
