"""Persist and query health metric log entries in DynamoDB."""

from __future__ import annotations

import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

METRIC_TYPES = frozenset({"glucose", "insulin", "exercise", "food", "mood"})

REQUIRED_FIELDS: dict[str, tuple[str, ...]] = {
    "glucose": ("value", "time", "context"),
    "insulin": ("units", "type", "insulin", "time"),
    "exercise": ("type", "duration", "intensity", "time"),
    "food": ("description", "carbs", "meal", "time"),
    "mood": ("mood",),
}

NUMERIC_RULES: dict[str, dict[str, tuple[float, float]]] = {
    "glucose": {"value": (20, 400)},
    "insulin": {"units": (0, 30)},
    "exercise": {"duration": (1, 300), "glucose_before": (20, 400)},
    "food": {"carbs": (0, 500), "protein": (0, 200), "fat": (0, 200)},
    "mood": {"mood": (1, 5)},
}

TIME_PATTERN = re.compile(r"^\d{2}:\d{2}$")


class HealthMetricsValidationError(ValueError):
    pass


class HealthMetricsService:
    def __init__(self, table=None):
        if table is not None:
            self._table = table
            return

        region = os.getenv("AWS_REGION", "us-east-1")
        table_name = os.getenv("DYNAMODB_HEALTH_METRICS_TABLE", "").strip()
        if not table_name:
            raise ValueError(
                "DYNAMODB_HEALTH_METRICS_TABLE is not set. Add it to your .env file. See .env.example."
            )

        dynamodb = boto3.resource("dynamodb", region_name=region)
        self._table = dynamodb.Table(table_name)
        logging.info(
            "HealthMetricsService using DynamoDB table %s in region %s",
            table_name,
            region,
        )

    @staticmethod
    def _normalize_data(data: dict[str, Any]) -> dict[str, str]:
        if not isinstance(data, dict):
            raise HealthMetricsValidationError("data must be an object")
        return {str(k): "" if v is None else str(v).strip() for k, v in data.items()}

    def _validate(self, metric_type: str, data: dict[str, str]) -> None:
        if metric_type not in METRIC_TYPES:
            raise HealthMetricsValidationError(
                f"Invalid metric_type '{metric_type}'. Must be one of: {', '.join(sorted(METRIC_TYPES))}."
            )

        for key in REQUIRED_FIELDS[metric_type]:
            if not data.get(key):
                raise HealthMetricsValidationError(f"Missing required field '{key}' for metric_type '{metric_type}'.")

        for key, (lo, hi) in NUMERIC_RULES.get(metric_type, {}).items():
            raw = data.get(key, "")
            if not raw:
                continue
            try:
                value = float(raw)
            except ValueError as exc:
                raise HealthMetricsValidationError(f"Field '{key}' must be a number.") from exc
            if value < lo or value > hi:
                raise HealthMetricsValidationError(
                    f"Field '{key}' must be between {lo} and {hi} (got {value})."
                )

        if metric_type != "mood" and data.get("time") and not TIME_PATTERN.match(data["time"]):
            raise HealthMetricsValidationError("Field 'time' must be in HH:MM format.")

    @staticmethod
    def _resolve_recorded_at(data: dict[str, str], recorded_at: str | None) -> datetime:
        if recorded_at:
            text = recorded_at.strip()
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            try:
                dt = datetime.fromisoformat(text)
            except ValueError as exc:
                raise HealthMetricsValidationError("recorded_at must be a valid ISO-8601 timestamp.") from exc
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)

        time_str = data.get("time", "")
        if time_str and TIME_PATTERN.match(time_str):
            hour, minute = (int(part) for part in time_str.split(":"))
            now = datetime.now(timezone.utc)
            return now.replace(hour=hour, minute=minute, second=0, microsecond=0)

        return datetime.now(timezone.utc)

    @staticmethod
    def _entry_id(metric_type: str, recorded_at: datetime) -> str:
        iso = recorded_at.strftime("%Y-%m-%dT%H:%M:%SZ")
        return f"METRIC#{metric_type}#{iso}#{uuid.uuid4()}"

    def create_entry(
        self,
        patient_id: str,
        metric_type: str,
        data: dict[str, Any],
        recorded_at: str | None = None,
    ) -> dict[str, str]:
        normalized = self._normalize_data(data)
        self._validate(metric_type, normalized)
        recorded_dt = self._resolve_recorded_at(normalized, recorded_at)
        entry_id = self._entry_id(metric_type, recorded_dt)
        created_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        recorded_iso = recorded_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

        self._table.put_item(
            Item={
                "patient_id": patient_id,
                "entry_id": entry_id,
                "metric_type": metric_type,
                "recorded_at": recorded_iso,
                "created_at": created_at,
                "data": normalized,
            }
        )
        logging.info("Stored %s metric entry for patient %s", metric_type, patient_id)
        return {
            "patient_id": patient_id,
            "entry_id": entry_id,
            "metric_type": metric_type,
            "recorded_at": recorded_iso,
        }

    def list_entries(
        self,
        patient_id: str,
        metric_type: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        if limit < 1 or limit > 500:
            raise HealthMetricsValidationError("limit must be between 1 and 500.")

        if metric_type:
            if metric_type not in METRIC_TYPES:
                raise HealthMetricsValidationError(f"Invalid metric_type '{metric_type}'.")
            prefix = f"METRIC#{metric_type}#"
            response = self._table.query(
                KeyConditionExpression=Key("patient_id").eq(patient_id)
                & Key("entry_id").begins_with(prefix),
                ScanIndexForward=False,
                Limit=limit,
            )
        else:
            response = self._table.query(
                KeyConditionExpression=Key("patient_id").eq(patient_id),
                ScanIndexForward=False,
                Limit=limit,
            )

        entries = []
        for item in response.get("Items") or []:
            entry_id = str(item.get("entry_id", ""))
            if not entry_id.startswith("METRIC#"):
                continue
            entries.append(
                {
                    "entry_id": entry_id,
                    "metric_type": item.get("metric_type", ""),
                    "recorded_at": item.get("recorded_at", ""),
                    "created_at": item.get("created_at", ""),
                    "data": item.get("data") or {},
                }
            )
        return entries
