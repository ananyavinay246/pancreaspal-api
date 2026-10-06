"""Seed the shared demo patient in S3, DynamoDB metrics, chat history, and dashboard cache.

Run from repo root with AWS credentials and .env configured (same as the API):

    python seed_demo_patient.py

Safe to re-run: clears existing data for the demo patient id first.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

import boto3
from boto3.dynamodb.conditions import Key
from dotenv import load_dotenv

from dashboard_service import DashboardService
from demo_patient import DEMO_CHART_TEXT, DEMO_PATIENT_ID
from health_metrics_service import HealthMetricsService
from patient_service import PatientService

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")


def _clear_patient_items(table, patient_id: str, sort_key: str) -> int:
    deleted = 0
    while True:
        response = table.query(
            KeyConditionExpression=Key("patient_id").eq(patient_id),
            ProjectionExpression=f"patient_id, {sort_key}",
            Limit=25,
        )
        items = response.get("Items") or []
        if not items:
            break
        with table.batch_writer() as batch:
            for item in items:
                batch.delete_item(
                    Key={"patient_id": patient_id, sort_key: item[sort_key]}
                )
                deleted += 1
    return deleted


def _seed_metrics(metrics: HealthMetricsService, patient_id: str) -> None:
    now = datetime.now(timezone.utc)
    glucose_pattern = [
        (7, 15, "98", "fasting"),
        (12, 30, "142", "after lunch"),
        (18, 45, "118", "before dinner"),
    ]
    meals = [
        (8, 0, "Oatmeal with berries", "42", "Breakfast"),
        (12, 15, "Turkey sandwich", "38", "Lunch"),
        (19, 0, "Salmon and rice", "45", "Dinner"),
    ]
    bolus = [(8, 5, "4.5", "Humalog"), (12, 20, "3.0", "Humalog"), (19, 5, "4.0", "Humalog")]
    basal = [(23, 0, "14", "Lantus")]

    for day_offset in range(14):
        day = now - timedelta(days=13 - day_offset)
        jitter = (day_offset % 5) * 3

        for hour, minute, value, context in glucose_pattern:
            adjusted = str(int(value) + jitter - 6)
            recorded = day.replace(hour=hour, minute=minute, second=0, microsecond=0)
            metrics.create_entry(
                patient_id=patient_id,
                metric_type="glucose",
                data={
                    "value": adjusted,
                    "time": f"{hour:02d}:{minute:02d}",
                    "context": context,
                },
                recorded_at=recorded.strftime("%Y-%m-%dT%H:%M:%SZ"),
            )

        if day_offset % 2 == 0:
            for hour, minute, desc, carbs, meal in meals[:2 if day_offset % 4 else 3]:
                recorded = day.replace(hour=hour, minute=minute, second=0, microsecond=0)
                metrics.create_entry(
                    patient_id=patient_id,
                    metric_type="food",
                    data={
                        "description": desc,
                        "carbs": carbs,
                        "meal": meal,
                        "time": f"{hour:02d}:{minute:02d}",
                    },
                    recorded_at=recorded.strftime("%Y-%m-%dT%H:%M:%SZ"),
                )

        for hour, minute, units, insulin_type in bolus[:2 if day_offset % 3 else 3]:
            recorded = day.replace(hour=hour, minute=minute, second=0, microsecond=0)
            metrics.create_entry(
                patient_id=patient_id,
                metric_type="insulin",
                data={
                    "units": units,
                    "type": "bolus",
                    "insulin": insulin_type,
                    "time": f"{hour:02d}:{minute:02d}",
                },
                recorded_at=recorded.strftime("%Y-%m-%dT%H:%M:%SZ"),
            )

        recorded = day.replace(hour=23, minute=0, second=0, microsecond=0)
        metrics.create_entry(
            patient_id=patient_id,
            metric_type="insulin",
            data={
                "units": basal[0][2],
                "type": "basal",
                "insulin": basal[0][3],
                "time": "23:00",
            },
            recorded_at=recorded.strftime("%Y-%m-%dT%H:%M:%SZ"),
        )

        if day_offset in (1, 3, 5, 8, 10, 12):
            recorded = day.replace(hour=17, minute=30, second=0, microsecond=0)
            metrics.create_entry(
                patient_id=patient_id,
                metric_type="exercise",
                data={
                    "type": "Walk",
                    "duration": "35" if day_offset % 2 == 0 else "25",
                    "intensity": "moderate",
                    "time": "17:30",
                    "glucose_before": str(110 + jitter),
                },
                recorded_at=recorded.strftime("%Y-%m-%dT%H:%M:%SZ"),
            )

        mood_val = str(3 + (day_offset % 3))
        recorded = day.replace(hour=21, minute=0, second=0, microsecond=0)
        metrics.create_entry(
            patient_id=patient_id,
            metric_type="mood",
            data={"mood": mood_val},
            recorded_at=recorded.strftime("%Y-%m-%dT%H:%M:%SZ"),
        )


def _seed_conversations(patients: PatientService, patient_id: str) -> None:
    pairs = [
        (
            "What is time in range for glucose?",
            "Time in range (TIR) is the percentage of glucose readings that fall within a target band, "
            "often 70–180 mg/dL for many adults with diabetes. It complements A1C by showing day-to-day stability.",
        ),
        (
            "Why might I see a rise after lunch?",
            "Post-meal rises often reflect carbohydrate intake, timing of rapid-acting insulin, and meal composition. "
            "Logging carbs and glucose pairs helps you spot patterns—this demo data includes sample lunch entries for that.",
        ),
    ]
    for user_query, agent_response in pairs:
        patients.add_to_conversation_history(patient_id, user_query, agent_response)


def main() -> None:
    region = os.getenv("AWS_REGION", "us-east-1")
    conv_table_name = os.getenv("DYNAMODB_CONVERSATION_TABLE", "").strip()
    metrics_table_name = os.getenv("DYNAMODB_HEALTH_METRICS_TABLE", "").strip()
    if not conv_table_name or not metrics_table_name:
        raise SystemExit("Set DYNAMODB_CONVERSATION_TABLE and DYNAMODB_HEALTH_METRICS_TABLE in .env")

    if not os.getenv("PATIENT_FILES_S3_BUCKET", "").strip():
        raise SystemExit(
            "Set PATIENT_FILES_S3_BUCKET in .env so App Runner can resolve the demo patient "
            "(same bucket as on App Runner, e.g. pancreaspal-patient-files-402561607513)."
        )

    dynamodb = boto3.resource("dynamodb", region_name=region)
    conv_table = dynamodb.Table(conv_table_name)
    metrics_table = dynamodb.Table(metrics_table_name)

    logging.info("Clearing prior demo data for %s", DEMO_PATIENT_ID)
    n_conv = _clear_patient_items(conv_table, DEMO_PATIENT_ID, "turn_id")
    n_metrics = _clear_patient_items(metrics_table, DEMO_PATIENT_ID, "entry_id")
    logging.info("Deleted %s conversation item(s), %s health-metrics item(s)", n_conv, n_metrics)

    patient_service = PatientService()
    patient_service.upsert_patient_history(DEMO_PATIENT_ID, DEMO_CHART_TEXT)

    metrics_service = HealthMetricsService()
    _seed_metrics(metrics_service, DEMO_PATIENT_ID)
    _seed_conversations(patient_service, DEMO_PATIENT_ID)

    dashboard = DashboardService(metrics_service=metrics_service)
    dashboard.refresh_dashboard(DEMO_PATIENT_ID, days=14)
    logging.info(
        "Demo patient ready. Set Amplify VITE_DEMO_PATIENT_ID=%s and redeploy the UI.",
        DEMO_PATIENT_ID,
    )


if __name__ == "__main__":
    main()
