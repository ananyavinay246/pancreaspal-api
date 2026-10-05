export type TirBreakdown = {
  inRange: number
  high: number
  low: number
}

export type GlucoseSummary = {
  avg_glucose: number
  tir_pct: number
  std_dev: number
  est_a1c: number
}

export type GlucoseInsightsBlock = {
  daily_avg: number[]
  daily_low: number[]
  daily_high: number[]
  date_labels: string[]
  tir: TirBreakdown
  summary: GlucoseSummary
}

export type InsulinInsightsBlock = {
  tdd: number[]
  bolus: number[]
  basal: number[]
  day_labels: string[]
  summary: { avg_tdd: number }
}

export type ExerciseDay = {
  min: number
  type: string
}

export type FoodDayCarbs = {
  total: number
  b: number
  l: number
  d: number
  s?: number
}

export type MealDot = {
  t: number
  carbs: number
  label: string
}

export type ExerciseSessionChart = {
  x: number
  w: number
  intensity: number
}

export type HomeGlucose = {
  value: number | null
  sparkline: number[]
  in_range: boolean
  sublabel: string
}

export type HomeInsulin = {
  total_units: number
  bolus_count: number
  intraday_bolus: number[]
  sublabel: string
}

export type HomeFood = {
  carbs_today: number
  meals_today: MealDot[]
  sublabel: string
}

export type HomeExercise = {
  minutes_today: number
  sessions_today: ExerciseSessionChart[]
  week_minutes: number[]
  sublabel: string
}

export type HomeMood = {
  label: string
  value: number
  days_logged_month: number
  month_full: number[]
  start_offset: number
  month_label: string
}

export type HomeBlock = {
  glucose: HomeGlucose
  insulin: HomeInsulin
  food: HomeFood
  exercise: HomeExercise
  mood: HomeMood
}

export type TopFoodItem = {
  name: string
  count: number
  carbs_avg: number
  meal: string
}

export type ExerciseGlucoseImpactRow = {
  type: string
  before: number | null
  after: number | null
  session_count: number
}

export type MoodVsGlucoseRow = {
  mood: number
  label: string
  avg_glucose: number
  day_count: number
}

export type InsightsBlock = {
  glucose: GlucoseInsightsBlock
  insulin: InsulinInsightsBlock
  exercise: {
    days: ExerciseDay[]
    day_labels: string[]
    glucose_impact: ExerciseGlucoseImpactRow[]
  }
  food: {
    carbs_by_day: FoodDayCarbs[]
    day_labels: string[]
    top_foods: TopFoodItem[]
  }
  mood: {
    month_full: number[]
    start_offset: number
    month_year: string
    days_logged: number
    mood_vs_glucose: MoodVsGlucoseRow[]
  }
}

export type DashboardPayload = {
  generated_at: string
  days: number
  has_any_metrics: boolean
  home: HomeBlock
  insights: InsightsBlock
}

export type CreateMetricInput = {
  metric_type: string
  data: Record<string, string>
  recorded_at?: string
}

export type CreateMetricResult = {
  patient_id: string
  entry_id: string
  metric_type: string
  recorded_at: string
}

export type ConversationTurn = {
  turn_id?: string
  timestamp: string
  user_query: string
  agent_response: string
}
