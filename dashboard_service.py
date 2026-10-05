"""Aggregate health metrics into dashboard payloads and cache snapshots in DynamoDB."""

from __future__ import annotations

import json
import logging
import math
import os
from calendar import monthrange
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

MOOD_LABELS = {
    0: "—",
    1: "Low",
    2: "Tired",
    3: "Okay",
    4: "Good",
    5: "Great",
}

MEAL_KEYS = {
    "Breakfast": "b",
    "Lunch": "l",
    "Dinner": "d",
    "Snack": "s",
}


def _snapshot_entry_id(days: int) -> str:
    return f"DASHBOARD#days={days}"


def _dynamo_safe(value: Any) -> Any:
    """Convert floats to Decimal for DynamoDB put_item (boto3 rejects float)."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: _dynamo_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_dynamo_safe(v) for v in value]
    return value


def _from_dynamo(value: Any) -> Any:
    """Convert Decimals from DynamoDB reads back to JSON-friendly numbers."""
    if isinstance(value, Decimal):
        if value % 1 == 0:
            return int(value)
        return float(value)
    if isinstance(value, dict):
        return {k: _from_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_from_dynamo(v) for v in value]
    return value


def _parse_recorded_at(raw: str) -> datetime | None:
    if not raw:
        return None
    text = raw.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_float(raw: str) -> float | None:
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _is_basal(dose_type: str) -> bool:
    return "basal" in (dose_type or "").lower()


def _meal_label(meal: str) -> str:
    m = (meal or "").strip()
    if m == "Breakfast":
        return "B"
    if m == "Lunch":
        return "L"
    if m == "Dinner":
        return "D"
    if m == "Snack":
        return "S"
    return m[:1].upper() if m else "?"


def _date_range(end: date, count: int) -> list[date]:
    return [end - timedelta(days=(count - 1 - i)) for i in range(count)]


def _format_short_date(d: date) -> str:
    return f"{d.strftime('%b')} {d.day}"


def _weekday_labels(dates: list[date]) -> list[str]:
    return [d.strftime("%a") for d in dates]


def _compute_top_foods(food_entries: list[dict[str, Any]], window_start: date) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in food_entries:
        if entry["_day"] < window_start:
            continue
        desc = (entry.get("data", {}).get("description") or "").strip()
        if not desc:
            continue
        groups[desc.lower()].append(entry)

    ranked: list[dict[str, Any]] = []
    for items in groups.values():
        display = (items[0].get("data", {}).get("description") or "").strip()
        carbs_vals = [
            c
            for c in (_parse_float(i.get("data", {}).get("carbs", "")) for i in items)
            if c is not None
        ]
        carbs_avg = round(sum(carbs_vals) / len(carbs_vals), 1) if carbs_vals else 0.0
        meals = [i.get("data", {}).get("meal", "") for i in items if i.get("data", {}).get("meal")]
        meal = Counter(meals).most_common(1)[0][0] if meals else ""
        ranked.append(
            {
                "name": display,
                "count": len(items),
                "carbs_avg": carbs_avg,
                "meal": meal,
            }
        )
    ranked.sort(key=lambda row: row["count"], reverse=True)
    return ranked[:6]


def _compute_exercise_glucose_impact(
    exercise_entries: list[dict[str, Any]],
    glucose_entries: list[dict[str, Any]],
    window_start: date,
) -> list[dict[str, Any]]:
    """Descriptive self-reported correlation; not clinical analysis."""
    glucose_points = sorted(
        [
            (g["_dt"], _parse_float(g.get("data", {}).get("value", "")))
            for g in glucose_entries
            if g["_day"] >= window_start
        ],
        key=lambda pair: pair[0],
    )
    by_type: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for ex in exercise_entries:
        if ex["_day"] < window_start:
            continue
        activity_type = (ex.get("data", {}).get("type") or "").strip()
        if not activity_type:
            continue
        session_start = ex["_dt"]
        before = _parse_float(ex.get("data", {}).get("glucose_before", ""))
        window_end = session_start + timedelta(hours=2)
        after_vals: list[float] = []
        for dt, val in glucose_points:
            if val is None:
                continue
            if dt.date() == session_start.date() and session_start < dt <= window_end:
                after_vals.append(val)
        after_avg = sum(after_vals) / len(after_vals) if after_vals else None
        by_type[activity_type].append({"before": before, "after": after_avg})

    rows: list[dict[str, Any]] = []
    for activity_type, sessions in by_type.items():
        before_vals = [s["before"] for s in sessions if s["before"] is not None]
        after_vals = [s["after"] for s in sessions if s["after"] is not None]
        before_mean = round(sum(before_vals) / len(before_vals), 1) if before_vals else None
        after_mean = round(sum(after_vals) / len(after_vals), 1) if after_vals else None
        if before_mean is None and after_mean is None:
            continue
        rows.append(
            {
                "type": activity_type,
                "before": before_mean,
                "after": after_mean,
                "session_count": len(sessions),
            }
        )
    return rows


def _compute_mood_vs_glucose(
    mood_entries: list[dict[str, Any]],
    glucose_entries: list[dict[str, Any]],
    today: date,
    lookback_days: int = 30,
) -> list[dict[str, Any]]:
    start = today - timedelta(days=lookback_days - 1)
    mood_by_day: dict[date, int] = {}
    for entry in mood_entries:
        day = entry["_day"]
        if day < start or day > today:
            continue
        mood_val = _parse_float(entry.get("data", {}).get("mood", ""))
        if mood_val is not None:
            mood_by_day[day] = int(round(mood_val))

    glucose_by_day: dict[date, list[float]] = defaultdict(list)
    for entry in glucose_entries:
        day = entry["_day"]
        if day < start or day > today:
            continue
        val = _parse_float(entry.get("data", {}).get("value", ""))
        if val is not None:
            glucose_by_day[day].append(val)

    buckets: dict[int, list[float]] = defaultdict(list)
    for day, mood in mood_by_day.items():
        day_glucose = glucose_by_day.get(day, [])
        if not day_glucose:
            continue
        buckets[mood].append(sum(day_glucose) / len(day_glucose))

    rows: list[dict[str, Any]] = []
    for mood in range(1, 6):
        avgs = buckets.get(mood, [])
        if not avgs:
            continue
        rows.append(
            {
                "mood": mood,
                "label": MOOD_LABELS.get(mood, "—"),
                "avg_glucose": round(sum(avgs) / len(avgs), 1),
                "day_count": len(avgs),
            }
        )
    return rows


class DashboardService:
    def __init__(self, table=None, metrics_service=None):
        self._metrics_service = metrics_service
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

    def _load_metric_entries(self, patient_id: str, limit: int = 500) -> list[dict[str, Any]]:
        if self._metrics_service is not None:
            raw = self._metrics_service.list_entries(patient_id=patient_id, limit=limit)
        else:
            response = self._table.query(
                KeyConditionExpression=Key("patient_id").eq(patient_id),
                ScanIndexForward=False,
                Limit=limit,
            )
            raw = []
            for item in response.get("Items") or []:
                entry_id = item.get("entry_id", "")
                if not str(entry_id).startswith("METRIC#"):
                    continue
                raw.append(
                    {
                        "entry_id": entry_id,
                        "metric_type": item.get("metric_type", ""),
                        "recorded_at": item.get("recorded_at", ""),
                        "data": item.get("data") or {},
                    }
                )
        return [e for e in raw if str(e.get("entry_id", "")).startswith("METRIC#")]

    def compute_dashboard(self, patient_id: str, days: int = 14) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        today = now.date()
        entries = self._load_metric_entries(patient_id)
        has_any = len(entries) > 0

        by_type: dict[str, list[dict]] = defaultdict(list)
        for entry in entries:
            mt = entry.get("metric_type") or ""
            dt = _parse_recorded_at(entry.get("recorded_at", ""))
            if dt is None:
                continue
            by_type[mt].append({**entry, "_dt": dt, "_day": dt.date()})

        glucose_days = _date_range(today, days)
        insulin_days = _date_range(today, 7)
        food_days = _date_range(today, 7)
        exercise_days = _date_range(today, 7)

        # --- Glucose ---
        glucose_entries = by_type.get("glucose", [])
        window_start = glucose_days[0]
        glucose_in_window = [g for g in glucose_entries if g["_day"] >= window_start]

        daily_values: dict[date, list[float]] = defaultdict(list)
        all_values: list[float] = []
        for g in glucose_in_window:
            val = _parse_float(g.get("data", {}).get("value", ""))
            if val is None:
                continue
            daily_values[g["_day"]].append(val)
            all_values.append(val)

        daily_avg: list[float] = []
        daily_low: list[float] = []
        daily_high: list[float] = []
        for d in glucose_days:
            vals = daily_values.get(d, [])
            if vals:
                daily_avg.append(round(sum(vals) / len(vals), 1))
                daily_low.append(round(min(vals), 1))
                daily_high.append(round(max(vals), 1))
            else:
                daily_avg.append(0.0)
                daily_low.append(0.0)
                daily_high.append(0.0)

        tir = {"inRange": 0, "high": 0, "low": 0}
        if all_values:
            in_r = sum(1 for v in all_values if 70 <= v <= 140)
            hi = sum(1 for v in all_values if v > 140)
            lo = sum(1 for v in all_values if v < 70)
            n = len(all_values)
            tir = {
                "inRange": round(100 * in_r / n),
                "high": round(100 * hi / n),
                "low": round(100 * lo / n),
            }

        avg_glucose = round(sum(all_values) / len(all_values), 1) if all_values else 0.0
        std_dev = 0.0
        if len(all_values) > 1:
            mean = sum(all_values) / len(all_values)
            variance = sum((v - mean) ** 2 for v in all_values) / len(all_values)
            std_dev = round(math.sqrt(variance), 1)
        est_a1c = round((avg_glucose + 46.7) / 28.7, 1) if all_values else 0.0

        glucose_sorted = sorted(glucose_entries, key=lambda x: x["_dt"])
        sparkline: list[float] = []
        for g in glucose_sorted[-12:]:
            v = _parse_float(g.get("data", {}).get("value", ""))
            if v is not None:
                sparkline.append(round(v, 1))

        latest_glucose = sparkline[-1] if sparkline else None
        glucose_in_range = latest_glucose is not None and 70 <= latest_glucose <= 140

        # --- Insulin ---
        insulin_entries = by_type.get("insulin", [])
        insulin_by_day: dict[date, list[dict]] = defaultdict(list)
        for ins in insulin_entries:
            insulin_by_day[ins["_day"]].append(ins)

        tdd_list: list[float] = []
        bolus_list: list[float] = []
        basal_list: list[float] = []
        for d in insulin_days:
            day_total = day_bolus = day_basal = 0.0
            for ins in insulin_by_day.get(d, []):
                units = _parse_float(ins.get("data", {}).get("units", "")) or 0.0
                day_total += units
                if _is_basal(ins.get("data", {}).get("type", "")):
                    day_basal += units
                else:
                    day_bolus += units
            tdd_list.append(round(day_total, 1))
            bolus_list.append(round(day_bolus, 1))
            basal_list.append(round(day_basal, 1))

        today_insulin = insulin_by_day.get(today, [])
        today_insulin_sorted = sorted(today_insulin, key=lambda x: x["_dt"])
        intraday_bolus: list[float] = []
        bolus_count = 0
        today_total_units = 0.0
        for ins in today_insulin_sorted:
            units = _parse_float(ins.get("data", {}).get("units", "")) or 0.0
            today_total_units += units
            if not _is_basal(ins.get("data", {}).get("type", "")):
                bolus_count += 1
                intraday_bolus.append(round(units, 1))
        while len(intraday_bolus) < 12:
            intraday_bolus.append(0.0)
        intraday_bolus = intraday_bolus[:12]

        avg_tdd = round(sum(tdd_list) / len(tdd_list), 1) if any(tdd_list) else 0.0

        # --- Food ---
        food_entries = by_type.get("food", [])
        food_by_day: dict[date, list[dict]] = defaultdict(list)
        for f in food_entries:
            food_by_day[f["_day"]].append(f)

        food_carbs: list[dict[str, float]] = []
        for d in food_days:
            b = l = dd = s = 0.0
            for f in food_by_day.get(d, []):
                carbs = _parse_float(f.get("data", {}).get("carbs", "")) or 0.0
                meal = f.get("data", {}).get("meal", "")
                key = MEAL_KEYS.get(meal, "")
                if key == "b":
                    b += carbs
                elif key == "l":
                    l += carbs
                elif key == "d":
                    dd += carbs
                elif key == "s":
                    s += carbs
            total = b + l + dd + s
            food_carbs.append({"total": round(total, 1), "b": round(b, 1), "l": round(l, 1), "d": round(dd, 1), "s": round(s, 1)})

        today_food = sorted(food_by_day.get(today, []), key=lambda x: x["_dt"])
        today_carbs = sum(_parse_float(f.get("data", {}).get("carbs", "")) or 0.0 for f in today_food)
        meals_today = []
        for f in today_food:
            dt = f["_dt"]
            t_frac = (dt.hour * 60 + dt.minute) / (24 * 60)
            carbs = _parse_float(f.get("data", {}).get("carbs", "")) or 0.0
            meals_today.append(
                {
                    "t": round(t_frac, 3),
                    "carbs": round(carbs, 1),
                    "label": _meal_label(f.get("data", {}).get("meal", "")),
                }
            )

        # --- Exercise ---
        exercise_entries = by_type.get("exercise", [])
        exercise_by_day: dict[date, list[dict]] = defaultdict(list)
        for ex in exercise_entries:
            exercise_by_day[ex["_day"]].append(ex)

        exercise_days_data: list[dict[str, Any]] = []
        week_minutes: list[float] = []
        for d in exercise_days:
            sessions = exercise_by_day.get(d, [])
            total_min = 0.0
            dominant_type = ""
            best_dur = -1.0
            for ex in sessions:
                dur = _parse_float(ex.get("data", {}).get("duration", "")) or 0.0
                total_min += dur
                if dur > best_dur:
                    best_dur = dur
                    dominant_type = ex.get("data", {}).get("type", "")
            exercise_days_data.append({"min": round(total_min), "type": dominant_type})
            week_minutes.append(round(total_min))

        today_ex = exercise_by_day.get(today, [])
        today_ex_min = sum(_parse_float(ex.get("data", {}).get("duration", "")) or 0.0 for ex in today_ex)
        today_sessions = []
        for ex in sorted(today_ex, key=lambda x: x["_dt"]):
            dur = _parse_float(ex.get("data", {}).get("duration", "")) or 0.0
            intensity_map = {"Light": 0.35, "Moderate": 0.6, "Vigorous": 0.85}
            intensity = intensity_map.get(ex.get("data", {}).get("intensity", ""), 0.5)
            dt = ex["_dt"]
            t_frac = (dt.hour * 60 + dt.minute) / (24 * 60)
            w = min(0.35, max(0.1, dur / 120))
            today_sessions.append({"x": round(t_frac, 3), "w": round(w, 3), "intensity": intensity})

        # --- Mood ---
        mood_entries = by_type.get("mood", [])
        year, month = today.year, today.month
        days_in_month = monthrange(year, month)[1]
        month_full = [0] * days_in_month
        for m in mood_entries:
            if m["_day"].year == year and m["_day"].month == month:
                mood_val = _parse_float(m.get("data", {}).get("mood", ""))
                if mood_val is not None:
                    idx = m["_day"].day - 1
                    month_full[idx] = int(round(mood_val))

        days_logged = sum(1 for v in month_full if v > 0)
        latest_mood = 0
        for m in sorted(mood_entries, key=lambda x: x["_dt"], reverse=True):
            if m["_day"].year == year and m["_day"].month == month:
                mv = _parse_float(m.get("data", {}).get("mood", ""))
                if mv is not None:
                    latest_mood = int(round(mv))
                    break
        mood_label = MOOD_LABELS.get(latest_mood, "—")
        start_offset = date(year, month, 1).weekday()
        # Python weekday: Mon=0 — UI uses Sun-first grid; match App.tsx startOffset for Sept (Tuesday=2)
        # date.weekday() Mon=0 -> Sun-first offset: (weekday + 1) % 7
        start_offset_sun = (date(year, month, 1).weekday() + 1) % 7

        glucose_date_labels = [_format_short_date(d) for d in glucose_days]

        top_foods = _compute_top_foods(by_type.get("food", []), food_days[0])
        glucose_impact = _compute_exercise_glucose_impact(
            by_type.get("exercise", []),
            by_type.get("glucose", []),
            exercise_days[0],
        )
        mood_vs_glucose = _compute_mood_vs_glucose(
            by_type.get("mood", []),
            by_type.get("glucose", []),
            today,
        )

        payload: dict[str, Any] = {
            "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "days": days,
            "has_any_metrics": has_any,
            "home": {
                "glucose": {
                    "value": latest_glucose,
                    "sparkline": sparkline,
                    "in_range": glucose_in_range,
                    "sublabel": "Latest reading" if latest_glucose else "No readings yet",
                },
                "insulin": {
                    "total_units": round(today_total_units, 1),
                    "bolus_count": bolus_count,
                    "intraday_bolus": intraday_bolus,
                    "sublabel": f"{bolus_count} boluses today" if bolus_count else "No doses logged today",
                },
                "food": {
                    "carbs_today": round(today_carbs, 1),
                    "meals_today": meals_today,
                    "sublabel": "Today's meals" if meals_today else "No meals logged today",
                },
                "exercise": {
                    "minutes_today": round(today_ex_min),
                    "sessions_today": today_sessions,
                    "week_minutes": week_minutes,
                    "sublabel": f"{round(today_ex_min)} min today" if today_ex_min else "No activity logged today",
                },
                "mood": {
                    "label": mood_label,
                    "value": latest_mood,
                    "days_logged_month": days_logged,
                    "month_full": month_full,
                    "start_offset": start_offset_sun,
                    "month_label": today.strftime("%B %Y"),
                },
            },
            "insights": {
                "glucose": {
                    "daily_avg": daily_avg,
                    "daily_low": daily_low,
                    "daily_high": daily_high,
                    "date_labels": glucose_date_labels,
                    "tir": tir,
                    "summary": {
                        "avg_glucose": avg_glucose,
                        "tir_pct": tir["inRange"],
                        "std_dev": std_dev,
                        "est_a1c": est_a1c,
                    },
                },
                "insulin": {
                    "tdd": tdd_list,
                    "bolus": bolus_list,
                    "basal": basal_list,
                    "day_labels": _weekday_labels(insulin_days),
                    "summary": {"avg_tdd": avg_tdd},
                },
                "exercise": {
                    "days": exercise_days_data,
                    "day_labels": _weekday_labels(exercise_days),
                    "glucose_impact": glucose_impact,
                },
                "food": {
                    "carbs_by_day": food_carbs,
                    "day_labels": _weekday_labels(food_days),
                    "top_foods": top_foods,
                },
                "mood": {
                    "month_full": month_full,
                    "start_offset": start_offset_sun,
                    "month_year": f"{year}-{month:02d}",
                    "days_logged": days_logged,
                    "mood_vs_glucose": mood_vs_glucose,
                },
            },
        }
        return payload

    def _put_snapshot(self, patient_id: str, days: int, payload: dict[str, Any]) -> None:
        entry_id = _snapshot_entry_id(days)
        self._table.put_item(
            Item={
                "patient_id": patient_id,
                "entry_id": entry_id,
                "metric_type": "dashboard",
                "recorded_at": payload.get("generated_at", ""),
                "payload": _dynamo_safe(payload),
            }
        )

    def _get_snapshot(self, patient_id: str, days: int) -> dict[str, Any] | None:
        entry_id = _snapshot_entry_id(days)
        try:
            response = self._table.get_item(Key={"patient_id": patient_id, "entry_id": entry_id})
        except ClientError:
            return None
        item = response.get("Item")
        if not item:
            return None
        payload = item.get("payload")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                return None
        if not isinstance(payload, dict):
            return None
        if payload.get("days") != days:
            return None
        return _from_dynamo(payload)

    def refresh_dashboard(self, patient_id: str, days: int = 14) -> dict[str, Any]:
        payload = self.compute_dashboard(patient_id, days=days)
        try:
            self._put_snapshot(patient_id, days, payload)
        except ClientError as exc:
            logging.warning("Failed to write dashboard snapshot for %s: %s", patient_id, exc)
        return payload

    def get_dashboard(self, patient_id: str, days: int = 14, refresh: bool = False) -> dict[str, Any]:
        if refresh:
            return self.refresh_dashboard(patient_id, days=days)
        cached = self._get_snapshot(patient_id, days)
        if cached is not None:
            return _patch_insight_defaults(cached)
        return self.refresh_dashboard(patient_id, days=days)

    def build_metrics_context(self, patient_id: str, days: int = 14) -> tuple[str, bool]:
        payload = self.get_dashboard(patient_id, days=days, refresh=False)
        if not payload.get("has_any_metrics"):
            return "", False
        text = _format_metrics_context_for_chat(payload).strip()
        if not text:
            return "", False
        return text, True


def _format_metrics_context_for_chat(payload: dict[str, Any]) -> str:
    lines: list[str] = []
    generated = payload.get("generated_at") or "unknown"
    window_days = payload.get("days", 14)
    lines.append(f"Snapshot time: {generated}. Window: {window_days} days where noted.")

    home = payload.get("home") or {}
    glucose_home = home.get("glucose") or {}
    if glucose_home.get("value") is not None:
        in_range = "in typical range" if glucose_home.get("in_range") else "outside typical range"
        lines.append(f"Latest glucose: {glucose_home['value']} mg/dL ({in_range}).")
    sparkline = glucose_home.get("sparkline") or []
    if sparkline:
        lines.append(f"Recent glucose readings (oldest to newest): {', '.join(str(v) for v in sparkline)}.")

    insulin_home = home.get("insulin") or {}
    lines.append(
        f"Insulin today: {insulin_home.get('total_units', 0)} units total, "
        f"{insulin_home.get('bolus_count', 0)} bolus doses logged."
    )

    food_home = home.get("food") or {}
    lines.append(f"Food today: {food_home.get('carbs_today', 0)} g carbs logged.")
    meals = food_home.get("meals_today") or []
    if meals:
        meal_bits = [
            f"{m.get('label', 'meal')} ~{m.get('carbs', 0)}g at hour {m.get('t', 0)}"
            for m in meals[:8]
        ]
        lines.append("Today's meals: " + "; ".join(meal_bits) + ".")

    exercise_home = home.get("exercise") or {}
    week_min = exercise_home.get("week_minutes") or []
    if week_min:
        lines.append(
            f"Exercise: {exercise_home.get('minutes_today', 0)} min today; "
            f"minutes by day this week (oldest to newest): {', '.join(str(v) for v in week_min)}."
        )
    else:
        lines.append(f"Exercise today: {exercise_home.get('minutes_today', 0)} minutes logged.")

    mood_home = home.get("mood") or {}
    if mood_home.get("value", 0) > 0:
        lines.append(
            f"Latest mood: {mood_home.get('label')} ({mood_home.get('value')}/5). "
            f"Days with mood logged this month: {mood_home.get('days_logged_month', 0)}."
        )

    insights = payload.get("insights") or {}
    gl_ins = insights.get("glucose") or {}
    gl_sum = gl_ins.get("summary") or {}
    if gl_sum:
        lines.append(
            f"Glucose aggregates: avg {gl_sum.get('avg_glucose')} mg/dL, "
            f"time in range {gl_sum.get('tir_pct')}%, estimated A1c {gl_sum.get('est_a1c')}, "
            f"std dev {gl_sum.get('std_dev')}."
        )
    daily_avg = gl_ins.get("daily_avg") or []
    date_labels = gl_ins.get("date_labels") or []
    if daily_avg and date_labels:
        day_pairs = [
            f"{date_labels[i]} avg {daily_avg[i]}"
            for i in range(min(len(daily_avg), len(date_labels)))
            if daily_avg[i]
        ]
        if day_pairs:
            lines.append("Daily average glucose by day: " + "; ".join(day_pairs) + ".")

    ins_ins = insights.get("insulin") or {}
    ins_sum = ins_ins.get("summary") or {}
    if ins_sum.get("avg_tdd") is not None:
        lines.append(f"Average total daily insulin (recent week): {ins_sum.get('avg_tdd')} units.")

    food_ins = insights.get("food") or {}
    carbs_by_day = food_ins.get("carbs_by_day") or []
    day_labels = food_ins.get("day_labels") or []
    if carbs_by_day:
        totals = [d.get("total", 0) for d in carbs_by_day]
        if totals:
            avg_carbs = round(sum(totals) / len(totals), 1)
            lines.append(f"Food (7d): average daily carbs {avg_carbs} g.")
        if day_labels and len(day_labels) == len(carbs_by_day):
            carb_pairs = [
                f"{day_labels[i]} {carbs_by_day[i].get('total', 0)}g"
                for i in range(len(carbs_by_day))
            ]
            lines.append("Daily carb totals: " + "; ".join(carb_pairs) + ".")
    top_foods = food_ins.get("top_foods") or []
    if top_foods:
        food_lines = [
            f"{f.get('name')} (logged {f.get('count')}x, avg carbs {f.get('carbs_avg')}g, meal {f.get('meal') or 'n/a'})"
            for f in top_foods[:6]
        ]
        lines.append("Most frequent foods (7d): " + "; ".join(food_lines) + ".")

    ex_ins = insights.get("exercise") or {}
    ex_days = ex_ins.get("days") or []
    ex_labels = ex_ins.get("day_labels") or []
    if ex_days and ex_labels:
        ex_pairs = [
            f"{ex_labels[i]} {ex_days[i].get('min', 0)}min {ex_days[i].get('type') or 'rest'}"
            for i in range(min(len(ex_days), len(ex_labels)))
        ]
        lines.append("Exercise by day (7d): " + "; ".join(ex_pairs) + ".")
    glucose_impact = ex_ins.get("glucose_impact") or []
    if glucose_impact:
        impact_lines = [
            f"{r.get('type')}: before {r.get('before')} / after {r.get('after')} mg/dL "
            f"({r.get('session_count')} sessions, self-reported correlation)"
            for r in glucose_impact
        ]
        lines.append("Exercise glucose patterns (descriptive): " + "; ".join(impact_lines) + ".")

    mood_ins = insights.get("mood") or {}
    mood_vs = mood_ins.get("mood_vs_glucose") or []
    if mood_vs:
        mv_lines = [
            f"mood {r.get('label')}: avg glucose {r.get('avg_glucose')} over {r.get('day_count')} days"
            for r in mood_vs
        ]
        lines.append("Days with both mood and glucose logged: " + "; ".join(mv_lines) + ".")

    return "\n".join(lines)


def _patch_insight_defaults(payload: dict[str, Any]) -> dict[str, Any]:
    """Back-fill insight arrays on older cached snapshots."""
    insights = payload.get("insights")
    if not isinstance(insights, dict):
        return payload
    exercise = insights.get("exercise")
    if isinstance(exercise, dict):
        exercise.setdefault("glucose_impact", [])
    food = insights.get("food")
    if isinstance(food, dict):
        food.setdefault("top_foods", [])
    mood = insights.get("mood")
    if isinstance(mood, dict):
        mood.setdefault("mood_vs_glucose", [])
    return payload
