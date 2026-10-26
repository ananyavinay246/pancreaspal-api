import logging
import os
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

from patient_service import PatientService

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

DEFAULT_TABLE_NAME = "pancreaspal-user-patients"


class UserPatientService:
    """Maps Cognito user sub to application patient_id."""

    def __init__(self, patient_service: PatientService):
        region = os.getenv("AWS_REGION", "us-east-1")
        table_name = (os.getenv("DYNAMODB_USER_PATIENTS_TABLE") or DEFAULT_TABLE_NAME).strip()
        self._table = boto3.resource("dynamodb", region_name=region).Table(table_name)
        self._patient_service = patient_service

    def get_patient_id(self, cognito_sub: str) -> str | None:
        response = self._table.get_item(Key={"cognito_sub": cognito_sub})
        item = response.get("Item")
        if not item:
            return None
        patient_id = item.get("patient_id")
        return str(patient_id) if patient_id else None

    def get_or_create_patient_for_sub(self, cognito_sub: str, email: str | None) -> str:
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
