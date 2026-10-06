import React, { useState, useEffect } from "react"
import {
  queryPatient,
  createMetric,
  listConversations,
  PatientApiError,
  type ConversationTurn,
  type QueryMode,
  type SourceDocument,
} from "./lib/api/patientApi"
import type {
  GlucoseInsightsBlock,
  InsulinInsightsBlock,
  ExerciseDay,
  FoodDayCarbs,
  MealDot,
  ExerciseSessionChart,
  ExerciseGlucoseImpactRow,
  TopFoodItem,
  MoodVsGlucoseRow,
} from "./lib/api/dashboardTypes"
import { DashboardProvider, useDashboard } from "./lib/dashboardContext"
import { ensurePatientId } from "./lib/patientSession"

const SHOW_DEMO_BANNER =
  import.meta.env.VITE_SHOW_DEMO_BANNER === "true" ||
  import.meta.env.VITE_SHOW_DEMO_BANNER === "1" ||
  Boolean((import.meta.env.VITE_DEMO_PATIENT_ID ?? "").trim())

const METRIC_REQUIRED: Record<string, string[]> = {
  glucose: ["value", "time", "context"],
  insulin: ["units", "type", "insulin", "time"],
  exercise: ["type", "duration", "intensity", "time"],
  food: ["description", "carbs", "meal", "time"],
  mood: ["mood"],
}

const CHAT_ERROR_MESSAGE =
  "Sorry, I could not get a response. Please try again."

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  sage: "#7FA68C",
  dustyBlue: "#8BA7BE",
  accent: "#D4956A",
  lavender: "#A99BBE",
  rose: "#C49090",
  card: "#FFFFFF",
  bg: "#F8F5F1",
  muted: "#9B968E",
  border: "#E8E3DC",
  fg: "#3D3830",
  fgSoft: "#5C574F",
}

// ─── Shared: Badge ────────────────────────────────────────────────────────────
type BadgeVariant = "sage" | "blue" | "accent" | "lavender" | "rose" | "neutral"
const badgeStyles: Record<BadgeVariant, { bg: string; text: string }> = {
  sage: { bg: "#E8F2EC", text: "#4D8062" },
  blue: { bg: "#E3EDF6", text: "#4A7A9B" },
  accent: { bg: "#FAE8D8", text: "#A85F35" },
  lavender: { bg: "#EDE9F5", text: "#6B5A8E" },
  rose: { bg: "#F5E8E8", text: "#8E4F4F" },
  neutral: { bg: "#F2EDE8", text: "#7A746C" },
}
function Badge({
  label,
  variant = "neutral",
  dot,
}: {
  label: string
  variant?: BadgeVariant
  dot?: boolean
}) {
  const s = badgeStyles[variant]
  return (
    <span
      style={{ backgroundColor: s.bg, color: s.text }}
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-700 leading-none tracking-wide whitespace-nowrap"
    >
      {dot && (
        <span
          style={{ backgroundColor: s.text }}
          className="w-1.5 h-1.5 rounded-full shrink-0"
        />
      )}
      {label}
    </span>
  )
}

// ─── Pancreas icon ────────────────────────────────────────────────────────────
// ─── Nav ──────────────────────────────────────────────────────────────────────
function Nav({ page, setPage }: { page: string; setPage: (p: string) => void }) {
  const links = ["Home", "History", "Insights"]
  return (
    <header
      style={{ backgroundColor: T.card, borderBottom: `1px solid ${T.border}` }}
      className="sticky top-0 z-20 w-full"
    >
      <div className="max-w-6xl mx-auto px-8 flex items-center justify-between h-14">
        <div className="flex items-center gap-2.5">
          <img
            src="https://img.icons8.com/?size=160&id=r6wPlJYCWM3W&format=png"
            alt="pancreas"
            style={{ width: 28, height: 28, objectFit: "contain" }}
          />
          <span
            style={{ color: T.fg }}
            className="font-800 text-base tracking-tight"
          >
            Pancreas Pal
          </span>
        </div>
        <nav className="flex items-center gap-1">
          {links.map((l) => (
            <button
              key={l}
              onClick={() => setPage(l)}
              style={{
                color: page === l ? T.sage : T.muted,
                backgroundColor: page === l ? T.sage + "15" : "transparent",
              }}
              className="px-3.5 py-1.5 rounded-lg text-xs font-700 tracking-wide transition-colors duration-150 cursor-pointer"
            >
              {l}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              backgroundColor: T.sage + "30",
              border: `2px solid ${T.sage}`,
            }}
            className="flex items-center justify-center"
          >
            <span style={{ color: T.sage, fontSize: 13 }} className="font-800">
              M
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}

// ─── Glucose Sparkline ────────────────────────────────────────────────────────
function GlucoseSparkline({ readings }: { readings: number[] }) {
  const glucoseReadings =
    readings.length >= 2 ? readings : readings.length === 1 ? [readings[0], readings[0]] : [100, 100]
  const W = 200,
    H = 52
  const PAD = { t: 6, r: 4, b: 6, l: 4 }
  const min = 80,
    max = 180
  const toY = (v: number) =>
    PAD.t + (H - PAD.t - PAD.b) * (1 - (v - min) / (max - min))
  const toX = (i: number) =>
    PAD.l + (i / (glucoseReadings.length - 1)) * (W - PAD.l - PAD.r)
  const pts = glucoseReadings.map((v, i) => ({ x: toX(i), y: toY(v) }))
  let path = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const cx = (pts[i].x - pts[i - 1].x) / 2
    path += ` C ${pts[i - 1].x + cx} ${pts[i - 1].y} ${pts[i].x - cx} ${pts[i].y} ${pts[i].x} ${pts[i].y}`
  }
  const fill = path + ` L ${pts[pts.length - 1].x} ${H} L ${pts[0].x} ${H} Z`
  const LOW = toY(70),
    HIGH = toY(140)
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={T.dustyBlue} stopOpacity="0.2" />
          <stop offset="100%" stopColor={T.dustyBlue} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <rect
        x={PAD.l}
        y={HIGH}
        width={W - PAD.l - PAD.r}
        height={LOW - HIGH}
        fill="#E8F2EC"
        opacity={0.7}
      />
      <path d={fill} fill="url(#sg)" />
      <path
        d={path}
        fill="none"
        stroke={T.dustyBlue}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle
        cx={pts[pts.length - 1].x}
        cy={pts[pts.length - 1].y}
        r={3.5}
        fill={T.dustyBlue}
        stroke="white"
        strokeWidth={1.5}
      />
    </svg>
  )
}

// ─── Insulin Bars ─────────────────────────────────────────────────────────────
function InsulinBars({ events }: { events: number[] }) {
  const insulinEvents = events.length ? events : Array(12).fill(0)
  const W = 200,
    H = 52,
    max = Math.max(6, ...insulinEvents, 1)
  const barW = 10,
    gap = (W - insulinEvents.length * barW) / (insulinEvents.length + 1)
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      {insulinEvents.map((v, i) => {
        const x = gap + i * (barW + gap)
        const bh = v > 0 ? (v / max) * (H - 10) : 0
        return v > 0 ? (
          <rect
            key={i}
            x={x}
            y={H - bh - 4}
            width={barW}
            height={bh}
            rx={4}
            fill={T.sage}
            opacity={0.75}
          />
        ) : null
      })}
    </svg>
  )
}

// ─── Meal Dots ────────────────────────────────────────────────────────────────
function MealDots({ meals }: { meals: MealDot[] }) {
  const W = 200,
    H = 52
  const maxCarbs = Math.max(...meals.map((m) => m.carbs), 1)
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      <line
        x1={10}
        y1={H / 2}
        x2={W - 10}
        y2={H / 2}
        stroke={T.border}
        strokeWidth={1.5}
        strokeDasharray="3 3"
      />
      {meals.map((m, i) => {
        const x = 10 + m.t * (W - 20)
        const r = 8 + (m.carbs / maxCarbs) * 8
        return (
          <g key={i}>
            <circle cx={x} cy={H / 2} r={r} fill={T.accent} opacity={0.18} />
            <circle cx={x} cy={H / 2} r={5} fill={T.accent} opacity={0.85} />
            <text
              x={x}
              y={H / 2 + 4}
              textAnchor="middle"
              fontSize={7}
              fill="white"
              fontFamily="Nunito,sans-serif"
              fontWeight="800"
            >
              {m.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Exercise Bars ────────────────────────────────────────────────────────────
function ExerciseBars({
  minutesToday,
  sessions,
}: {
  minutesToday: number
  sessions: ExerciseSessionChart[]
}) {
  const W = 200,
    H = 52
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      {sessions.map((s, i) => {
        const bx = 10 + s.x * (W - 20)
        const bw = s.w * (W - 20)
        const bh = s.intensity * (H - 16)
        return (
          <g key={i}>
            <rect
              x={bx}
              y={(H - bh) / 2}
              width={bw}
              height={bh}
              rx={6}
              fill={T.lavender}
              opacity={0.3}
            />
            <rect
              x={bx}
              y={(H - bh) / 2}
              width={bw}
              height={bh * 0.35}
              rx={6}
              fill={T.lavender}
              opacity={0.7}
            />
          </g>
        )
      })}
      <text
        x={W / 2}
        y={H - 4}
        textAnchor="middle"
        fontSize={8}
        fill={T.muted}
        fontFamily="Nunito,sans-serif"
        fontWeight="600"
      >
        {minutesToday > 0 ? `${Math.round(minutesToday)} min active` : "No activity yet"}
      </text>
    </svg>
  )
}

// ─── Metric Mini-Card ─────────────────────────────────────────────────────────
function MiniMetricCard({
  label,
  value,
  unit,
  sublabel,
  icon,
  color,
  chart,
  badge,
  chartHeight = 56,
  onClick,
}: {
  label: string
  value: string
  unit: string
  sublabel: string
  icon: string
  color: string
  chart: React.ReactNode
  badge?: { label: string; variant: BadgeVariant }
  chartHeight?: number
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        backgroundColor: T.card,
        borderRadius: 16,
        boxShadow: "0 2px 14px rgba(61,56,48,0.07), 0 1px 3px rgba(61,56,48,0.04)",
      }}
      className="p-5 flex flex-col gap-3 hover:shadow-lg transition-all duration-200 cursor-pointer group"
    >
      {/* Label row — icon + name, badge wraps below on overflow */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span
            style={{ backgroundColor: color + "22" }}
            className="w-7 h-7 rounded-xl flex items-center justify-center text-sm shrink-0"
          >
            {icon}
          </span>
          <span
            style={{ color: T.muted }}
            className="text-xs font-700 tracking-widest uppercase leading-none"
          >
            {label}
          </span>
        </div>
        {badge && (
          <div>
            <Badge label={badge.label} variant={badge.variant} dot />
          </div>
        )}
      </div>
      <div className="flex items-end gap-1.5">
        <span
          style={{ color: T.fg, lineHeight: 1 }}
          className="text-3xl font-800 tabular-nums"
        >
          {value}
        </span>
        {unit && (
          <span style={{ color: T.muted }} className="text-xs font-600 mb-0.5">
            {unit}
          </span>
        )}
      </div>
      <div style={{ height: chartHeight }}>{chart}</div>
      <div className="flex items-center justify-between">
        <p style={{ color: T.muted }} className="text-xs font-500 leading-relaxed">{sublabel}</p>
        {onClick && (
          <span style={{ color, opacity: 0 }} className="text-xs font-700 shrink-0 ml-2 transition-opacity duration-150 group-hover:opacity-100">
            View →
          </span>
        )}
      </div>
    </div>
  )
}

// ─── AI Ask Card ──────────────────────────────────────────────────────────────
const suggestions = [
  "Why did I spike after lunch?",
  "How was my range this week?",
  "When do I usually go low?",
]
function AskCard({ onSubmit }: { onSubmit: (q: string, mode: QueryMode) => void }) {
  const [val, setVal] = useState("")
  const [focused, setFocused] = useState(false)
  const [mode, setMode] = useState<QueryMode>("general")

  const submit = () => {
    const q = val.trim()
    if (q) { setVal(""); onSubmit(q, mode) }
  }

  return (
    <div style={{ backgroundColor: T.card, borderRadius: 18, boxShadow: "0 2px 16px rgba(61,56,48,0.08), 0 1px 4px rgba(61,56,48,0.05)" }}
      className="p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span style={{ backgroundColor: T.sage + "20", fontSize: 16 }}
          className="w-9 h-9 rounded-xl flex items-center justify-center">✦</span>
        <div className="flex-1 min-w-0">
          <p style={{ color: T.fg }} className="text-sm font-700">Ask anything</p>
          <p style={{ color: T.muted }} className="text-xs font-500">
            {mode === "general"
              ? "Learn from trusted sources — lifestyle-focused education"
              : "Summarize your logs — facts only, not medical advice"}
          </p>
        </div>
      </div>
      <div
        style={{ backgroundColor: T.bg, borderRadius: 10, padding: 3, display: "inline-flex", gap: 3, alignSelf: "flex-start" }}
      >
        {(
          [
            { id: "general" as const, label: "Learn" },
            { id: "metrics" as const, label: "Summarize my logs" },
          ] as const
        ).map((opt) => {
          const active = mode === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setMode(opt.id)}
              style={{
                backgroundColor: active ? T.card : "transparent",
                color: active ? T.fg : T.muted,
                boxShadow: active ? "0 1px 4px rgba(61,56,48,0.08)" : "none",
                borderRadius: 8,
                padding: "6px 12px",
                fontFamily: "Nunito,sans-serif",
              }}
              className="text-xs font-700 cursor-pointer border-0"
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      <div style={{ backgroundColor: T.bg, borderRadius: 12, border: `1.5px solid ${focused ? T.sage : T.border}`, transition: "border-color 0.15s ease", boxShadow: focused ? `0 0 0 3px ${T.sage}18` : "none" }}
        className="flex items-center gap-3 px-4 py-3">
        <input value={val} onChange={e => setVal(e.target.value)}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onKeyDown={e => e.key === "Enter" && submit()}
          placeholder="Ask about your glucose, insulin, meals, or patterns…"
          style={{ color: T.fg, backgroundColor: "transparent", outline: "none", flex: 1, fontFamily: "Nunito,sans-serif" }}
          className="text-sm font-500 placeholder:text-[#B8B2AA]" />
        <button onClick={submit}
          style={{ backgroundColor: val.trim() ? T.sage : T.border, transition: "background-color 0.15s ease" }}
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 cursor-pointer">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 7h10M7 2l5 5-5 5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map(s => (
          <button key={s} onClick={() => { setVal(s) }}
            style={{ backgroundColor: T.bg, color: T.fgSoft, border: `1px solid ${T.border}` }}
            className="px-3 py-1.5 rounded-full text-xs font-600 cursor-pointer hover:border-[#C8C1B8] transition-colors duration-150">
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Mood Calendar Mini-Chart ─────────────────────────────────────────────────
// 5 mood levels: 1=low, 2=tired, 3=ok, 4=good, 5=great
const moodColors: Record<number, string> = {
  0: T.border, // no entry
  1: "#C49090", // rose — low
  2: "#C4AE90", // warm tan — tired
  3: "#BEC4A0", // muted olive — ok
  4: "#A8C4A0", // soft green — good
  5: "#7FA68C", // sage — great
}
const moodLabels: Record<number, string> = {
  0: "—",
  1: "Low",
  2: "Tired",
  3: "Okay",
  4: "Good",
  5: "Great",
}

function MoodCalendarChart({
  monthFull,
  startOffset,
}: {
  monthFull: number[]
  startOffset: number
}) {
  const [hov, setHov] = useState<number | null>(null)
  const today = new Date().getDate()
  const daysInMonth = monthFull.length
  const totalCells = 35
  const cells = Array.from({ length: totalCells }, (_, i) => {
    const dayNum = i - startOffset + 1
    if (dayNum < 1 || dayNum > daysInMonth) return null
    const mood = monthFull[dayNum - 1] ?? 0
    return { dayNum, mood: dayNum <= today ? mood : 0 }
  })
  const dayLabels = ["S", "M", "T", "W", "T", "F", "S"]

  return (
    <div style={{ width: "100%" }}>
      {/* Day-of-week headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 3,
          marginBottom: 4,
        }}
      >
        {dayLabels.map((d, i) => (
          <div
            key={i}
            style={{
              fontSize: 8,
              fontWeight: 600,
              color: T.muted,
              textAlign: "center",
            }}
          >
            {d}
          </div>
        ))}
      </div>
      {/* Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 3,
          position: "relative",
        }}
      >
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} />
          const isHov = hov === cell.dayNum
          return (
            <div key={i} style={{ position: "relative" }}>
              <div
                style={{
                  width: "100%",
                  aspectRatio: "1",
                  borderRadius: 4,
                  backgroundColor: moodColors[cell.mood],
                  opacity: cell.mood === 0 ? 0.4 : 1,
                  cursor: cell.mood > 0 ? "pointer" : "default",
                  transform: isHov ? "scale(1.2)" : "scale(1)",
                  transition: "transform 0.12s ease",
                  boxShadow: isHov
                    ? `0 2px 8px ${moodColors[cell.mood]}88`
                    : "none",
                }}
                onMouseEnter={() => cell.mood > 0 && setHov(cell.dayNum)}
                onMouseLeave={() => setHov(null)}
              />
              {isHov && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 4px)",
                    left: "50%",
                    transform: "translateX(-50%)",
                    backgroundColor: T.fg,
                    borderRadius: 6,
                    padding: "3px 6px",
                    whiteSpace: "nowrap",
                    zIndex: 10,
                    fontSize: 9,
                    color: "white",
                    fontWeight: 700,
                    fontFamily: "Nunito,sans-serif",
                    pointerEvents: "none",
                  }}
                >
                  {moodLabels[cell.mood]}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Journey Cards ────────────────────────────────────────────────────────────
const journeyMonths = [
  {
    label: "Month 1",
    sublabel: "Getting oriented",
    color: T.dustyBlue,
    bg: "#EAF0F6",
    accent: "#4A7A9B",
    questions: [
      "Why does my blood sugar spike after breakfast?",
      "What is a good target range to aim for?",
      "How do I count carbs in a home-cooked meal?",
      "What does it feel like when I go low?",
    ],
  },
  {
    label: "Month 3",
    sublabel: "Finding patterns",
    color: T.sage,
    bg: "#EAF2ED",
    accent: "#4D8062",
    questions: [
      "Am I seeing patterns in my readings?",
      "How does exercise affect my insulin needs?",
      "Why do I sometimes go low overnight?",
      "Is my Time in Range improving?",
    ],
  },
  {
    label: "Month 6",
    sublabel: "Dialing it in",
    color: T.accent,
    bg: "#F6EDE3",
    accent: "#A85F35",
    questions: [
      "What's my average Time in Range this month?",
      "How has my A1C trend changed over 6 months?",
      "Which week was my most consistent?",
      "What's different about my best days?",
    ],
  },
]

function JourneyCard({
  month,
  index,
}: {
  month: typeof journeyMonths[0]
  index: number
}) {
  return (
    <div
      style={{
        backgroundColor: month.bg,
        borderRadius: 20,
        border: `1.5px solid ${month.color}30`,
        flex: 1,
        transform: `rotate(${[-0.8, 0, 0.8][index]}deg)`,
        boxShadow: `0 4px 24px rgba(61,56,48,0.09), 0 1px 4px rgba(61,56,48,0.05)`,
        transition: "transform 0.2s ease, box-shadow 0.2s ease",
      }}
      className="p-6 flex flex-col gap-5 cursor-pointer hover:shadow-xl"
      onMouseEnter={(e) =>
        (e.currentTarget.style.transform = "rotate(0deg) scale(1.01)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.transform = `rotate(${[-0.8, 0, 0.8][index]}deg)`)
      }
    >
      <div>
        <p
          style={{ color: month.accent }}
          className="text-xs font-700 tracking-widest uppercase mb-1"
        >
          {month.sublabel}
        </p>
        <h3
          style={{ color: T.fg }}
          className="text-2xl font-800 tracking-tight"
        >
          {month.label}
        </h3>
      </div>
      <div style={{ height: 1, backgroundColor: month.color + "30" }} />
      <div className="flex flex-col gap-2.5">
        <p
          style={{ color: month.accent }}
          className="text-xs font-700 uppercase tracking-wider"
        >
          Questions to explore
        </p>
        {month.questions.map((q, i) => (
          <div
            key={i}
            style={{
              backgroundColor: "white",
              borderRadius: 10,
              border: `1px solid ${month.color}25`,
            }}
            className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-all duration-150"
            onMouseEnter={(e) =>
              (e.currentTarget.style.borderColor = month.color + "55")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.borderColor = month.color + "25")
            }
          >
            <span
              style={{ color: month.color }}
              className="text-xs leading-none shrink-0"
            >
              ✦
            </span>
            <p
              style={{ color: T.fgSoft }}
              className="text-xs font-600 leading-snug"
            >
              {q}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── FAB ──────────────────────────────────────────────────────────────────────
function FAB() {
  const [open, setOpen] = useState(false)
  const [activeModal, setActiveModal] = useState<string | null>(null)
  const actions = [
    { icon: "✦", label: "Glucose",  metricId: "glucose",  color: T.dustyBlue },
    { icon: "◎", label: "Insulin",  metricId: "insulin",  color: T.sage },
    { icon: "◑", label: "Meal",     metricId: "food",     color: T.accent },
    { icon: "◐", label: "Exercise", metricId: "exercise", color: T.lavender },
    { icon: "◇", label: "Mood",     metricId: "mood",     color: T.rose },
  ]
  return (
    <>
      {activeModal && <LogModal metricId={activeModal} onClose={() => setActiveModal(null)} />}
      <div className="flex items-center gap-3 justify-end">
        {open && (
          <div className="flex items-center gap-2">
            {actions.map((a) => (
              <button
                key={a.label}
                onClick={() => { setOpen(false); setActiveModal(a.metricId) }}
                style={{ backgroundColor: a.color + "18", color: a.color, border: `1.5px solid ${a.color}44` }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-700 cursor-pointer transition-all duration-150"
              >
                <span className="text-sm leading-none">{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>
        )}
      <button
        onClick={() => setOpen(!open)}
        style={{
          backgroundColor: open ? T.fgSoft : T.sage,
          boxShadow: open
            ? "0 4px 20px rgba(61,56,48,0.25)"
            : "0 4px 20px rgba(127,166,140,0.4)",
          transform: open ? "rotate(45deg)" : "rotate(0deg)",
          transition: "all 0.2s ease",
        }}
        className="w-12 h-12 rounded-full flex items-center justify-center cursor-pointer"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path
            d="M9 3v12M3 9h12"
            stroke="white"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      </div>
    </>
  )
}

function DemoBanner() {
  const { dashboard } = useDashboard()
  if (!SHOW_DEMO_BANNER && dashboard?.has_any_metrics) return null
  if (!SHOW_DEMO_BANNER) return null
  return (
    <div className="flex justify-center pt-3">
      <span style={{
        backgroundColor: "#C0392B",
        border: "1px solid #96281B",
        color: "#FFFFFF",
        borderRadius: 20,
        padding: "6px 16px",
        boxShadow: "0 2px 10px rgba(192,57,43,0.35)",
      }} className="text-xs font-600 italic">
        ✦ This is a demo user
      </span>
    </div>
  )
}

// ─── Home Page ────────────────────────────────────────────────────────────────
function HomePage({
  onAsk,
  onInsight,
}: {
  onAsk: (q: string, mode: QueryMode) => void
  onInsight: (section: string) => void
}) {
  const { dashboard, loading } = useDashboard()
  const home = dashboard?.home
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })
  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"

  const glucoseVal =
    home?.glucose.value != null ? String(Math.round(home.glucose.value)) : "—"
  const insulinVal =
    home != null ? String(home.insulin.total_units) : "—"
  const foodVal = home != null ? String(Math.round(home.food.carbs_today)) : "—"
  const exerciseVal =
    home != null ? String(Math.round(home.exercise.minutes_today)) : "—"
  const moodVal = home?.mood.label && home.mood.value > 0 ? home.mood.label : "—"

  return (
    <main className="max-w-6xl mx-auto px-8 pt-3 pb-10 flex flex-col gap-10">
      <DemoBanner />
      {loading && !dashboard && (
        <p style={{ color: T.muted }} className="text-sm font-500">Loading your dashboard…</p>
      )}
      {/* ── Greeting ──────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div className="flex flex-col gap-1">
          <p style={{ color: T.muted }} className="text-sm font-600">
            {today}
          </p>
          <h1
            style={{ color: T.fg, lineHeight: 1.15 }}
            className="text-4xl font-800 tracking-tight"
          >
            {greeting}, Maya.
          </h1>
          <p style={{ color: T.muted }} className="text-sm font-500 mt-1">
            Here's how your day is looking so far.
          </p>
        </div>
      </div>

      {/* ── AI Ask Card ───────────────────────────────────────────────── */}
      <AskCard onSubmit={onAsk} />

      {/* ── Metric Cards + FAB ────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 16,
          }}
        >
          <MiniMetricCard
            label="Glucose"
            value={glucoseVal}
            unit="mg/dL"
            sublabel={home?.glucose.sublabel ?? "Log a reading to get started"}
            icon="✦"
            color={T.dustyBlue}
            chart={<GlucoseSparkline readings={home?.glucose.sparkline ?? []} />}
            badge={
              home?.glucose.in_range
                ? { label: "In Range", variant: "blue" }
                : home?.glucose.value != null
                  ? { label: "Check level", variant: "accent" }
                  : undefined
            }
            onClick={() => onInsight("glucose")}
          />
          <MiniMetricCard
            label="Insulin"
            value={insulinVal}
            unit="u total"
            sublabel={home?.insulin.sublabel ?? "No doses logged today"}
            icon="◎"
            color={T.sage}
            chart={<InsulinBars events={home?.insulin.intraday_bolus ?? []} />}
            badge={
              home && home.insulin.bolus_count > 0
                ? { label: "On track", variant: "sage" }
                : undefined
            }
            onClick={() => onInsight("insulin")}
          />
          <MiniMetricCard
            label="Meals"
            value={foodVal}
            unit="g carbs"
            sublabel={home?.food.sublabel ?? "No meals logged today"}
            icon="◑"
            color={T.accent}
            chart={<MealDots meals={home?.food.meals_today ?? []} />}
            onClick={() => onInsight("food")}
          />
          <MiniMetricCard
            label="Exercise"
            value={exerciseVal}
            unit="min"
            sublabel={home?.exercise.sublabel ?? "No activity logged today"}
            icon="◐"
            color={T.lavender}
            chart={
              <ExerciseBars
                minutesToday={home?.exercise.minutes_today ?? 0}
                sessions={home?.exercise.sessions_today ?? []}
              />
            }
            badge={
              home && home.exercise.minutes_today >= 30
                ? { label: "Goal met", variant: "lavender" }
                : undefined
            }
            onClick={() => onInsight("exercise")}
          />
          <MiniMetricCard
            label="Mood"
            value={moodVal}
            unit=""
            sublabel={
              home
                ? `${home.mood.month_label} · ${home.mood.days_logged_month} days logged`
                : "Log how you feel"
            }
            icon="◇"
            color={T.rose}
            chartHeight={96}
            chart={
              <MoodCalendarChart
                monthFull={home?.mood.month_full ?? []}
                startOffset={home?.mood.start_offset ?? 0}
              />
            }
            onClick={() => onInsight("mood")}
          />
        </div>
        <div className="flex justify-end">
          <FAB />
        </div>
      </div>

      {/* ── Journey Calendar Section ───────────────────────────────────── */}
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2
            style={{ color: T.fg }}
            className="text-xl font-800 tracking-tight"
          >
            Your journey, month by month
          </h2>
          <p style={{ color: T.muted }} className="text-sm font-500">
            Questions evolve as you learn. Here are some worth asking at each
            stage.
          </p>
        </div>
        <div className="flex gap-5 items-start">
          {journeyMonths.map((m, i) => (
            <JourneyCard key={m.label} month={m} index={i} />
          ))}
        </div>
      </div>
    </main>
  )
}

// ─── Conversation data ────────────────────────────────────────────────────────
type Message = { role: "user" | "ai"; text: string }
type Conversation = {
  id: string
  title: string
  preview: string
  date: string
  dateGroup: string
  tag: { label: string; variant: BadgeVariant }
  messages: Message[]
}

function formatTurnDate(iso: string): { display: string; group: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return { display: iso, group: "Earlier" }
  }
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((startToday.getTime() - startThat.getTime()) / 86400000)
  let group = "Earlier"
  if (diffDays === 0) group = "Today"
  else if (diffDays === 1) group = "Yesterday"
  else if (diffDays < 7) group = "This week"
  const display = d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
  return { display, group }
}

function turnToConversation(turn: ConversationTurn, index: number): Conversation {
  const title =
    turn.user_query.length > 72 ? `${turn.user_query.slice(0, 72)}…` : turn.user_query
  const preview =
    turn.agent_response.length > 80
      ? `${turn.agent_response.slice(0, 80)}…`
      : turn.agent_response
  const { display, group } = formatTurnDate(turn.timestamp)
  return {
    id: turn.turn_id || `turn-${index}`,
    title,
    preview,
    date: display,
    dateGroup: group,
    tag: { label: "Chat", variant: "neutral" },
    messages: [
      { role: "user", text: turn.user_query },
      { role: "ai", text: turn.agent_response },
    ],
  }
}

async function fetchChatAnswer(
  question: string,
  queryMode: QueryMode = "general",
): Promise<{ text: string; sources?: SourceDocument[] }> {
  try {
    const patientId = await ensurePatientId()
    const result = await queryPatient(patientId, question, queryMode)
    const sources = result.sources.filter(
      (s) => Boolean(s.title || s.source || s.url),
    )
    return {
      text: result.answer,
      sources: sources.length > 0 ? sources : undefined,
    }
  } catch (err) {
    console.error("Query failed:", err)
    return { text: CHAT_ERROR_MESSAGE }
  }
}

function ChatSourceLinks({ sources }: { sources: SourceDocument[] }) {
  if (sources.length === 0) return null
  return (
    <p style={{ color: T.muted }} className="text-xs font-500 px-1 leading-snug">
      Sources:{" "}
      {sources.map((s, idx) => {
        const label = s.title || s.source || "Document"
        return (
          <React.Fragment key={`${label}-${idx}`}>
            {idx > 0 && " · "}
            {s.url ? (
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: T.sage, textDecoration: "underline", fontWeight: 600 }}
              >
                {label}
              </a>
            ) : (
              label
            )}
          </React.Fragment>
        )
      })}
    </p>
  )
}

// ─── History Page ─────────────────────────────────────────────────────────────
function HistoryPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [searchFocused, setSearchFocused] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [thinking, setThinking] = useState(false)
  const [composeError, setComposeError] = useState<string | null>(null)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)

  const loadConversations = React.useCallback(async (selectNewest = false) => {
    const patientId = await ensurePatientId()
    const turns = await listConversations(patientId)
    const mapped = turns.map(turnToConversation)
    setConversations(mapped)
    if (selectNewest) {
      setActiveId(mapped[0]?.id ?? null)
    } else {
      setActiveId((prev) => {
        if (prev && mapped.some((c) => c.id === prev)) return prev
        return mapped[0]?.id ?? null
      })
    }
    return mapped
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setLoadError(null)
      try {
        await loadConversations(false)
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof PatientApiError ? err.message : "Could not load history.",
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadConversations])

  const handleFollowUp = async (text: string) => {
    if (!activeId || thinking) return
    setComposeError(null)
    setThinking(true)
    const priorActiveId = activeId
    setConversations((prev) =>
      prev.map((c) =>
        c.id === priorActiveId
          ? { ...c, messages: [...c.messages, { role: "user", text }] }
          : c,
      ),
    )
    try {
      const { text: answer } = await fetchChatAnswer(text)
      if (answer === CHAT_ERROR_MESSAGE) {
        setComposeError(CHAT_ERROR_MESSAGE)
        await loadConversations(false)
        return
      }
      setConversations((prev) =>
        prev.map((c) =>
          c.id === priorActiveId
            ? { ...c, messages: [...c.messages, { role: "ai", text: answer }] }
            : c,
        ),
      )
      await loadConversations(true)
    } catch (err) {
      setComposeError(
        err instanceof PatientApiError ? err.message : "Could not send message.",
      )
      await loadConversations(false)
    } finally {
      setThinking(false)
    }
  }

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [activeId, conversations, thinking])

  const filtered = search.trim()
    ? conversations.filter(
        (c) =>
          c.title.toLowerCase().includes(search.toLowerCase()) ||
          c.preview.toLowerCase().includes(search.toLowerCase()),
      )
    : conversations

  // Group by dateGroup
  const groups: Record<string, Conversation[]> = {}
  for (const c of filtered) {
    if (!groups[c.dateGroup]) groups[c.dateGroup] = []
    groups[c.dateGroup].push(c)
  }
  const groupOrder = ["Today", "Yesterday", "This week", "Earlier"]

  const active = conversations.find((c) => c.id === activeId) ?? filtered[0]

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-8 py-10">
        <p style={{ color: T.muted }} className="text-sm font-500">Loading conversation history…</p>
      </div>
    )
  }
  if (loadError) {
    return (
      <div className="max-w-6xl mx-auto px-8 py-10">
        <p style={{ color: T.rose }} className="text-sm font-600">{loadError}</p>
      </div>
    )
  }

  return (
    <div
      style={{
        height: "calc(100dvh - 56px)",
        display: "flex",
        overflow: "hidden",
      }}
    >
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside
        style={{
          width: 300,
          borderRight: `1px solid ${T.border}`,
          backgroundColor: T.card,
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        {/* Sidebar header */}
        <div
          style={{
            borderBottom: `1px solid ${T.border}`,
            padding: "16px 16px 12px",
          }}
        >
          <p style={{ color: T.fg }} className="text-sm font-800 mb-3">
            Conversation History
          </p>
          {/* Search */}
          <div
            style={{
              backgroundColor: T.bg,
              borderRadius: 10,
              border: `1.5px solid ${searchFocused ? T.sage : T.border}`,
              transition: "border-color 0.15s ease",
              boxShadow: searchFocused ? `0 0 0 3px ${T.sage}15` : "none",
            }}
            className="flex items-center gap-2 px-3 py-2"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <circle
                cx="6"
                cy="6"
                r="4.5"
                stroke={T.muted}
                strokeWidth="1.5"
              />
              <path
                d="M9.5 9.5l2.5 2.5"
                stroke={T.muted}
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="Search conversations…"
              style={{
                backgroundColor: "transparent",
                outline: "none",
                fontFamily: "Nunito,sans-serif",
                color: T.fg,
                flex: 1,
              }}
              className="text-xs font-500 placeholder:text-[#C0BAB2]"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{ color: T.muted, lineHeight: 1 }}
                className="text-xs cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Conversation list */}
        <div style={{ overflowY: "auto", flex: 1, padding: "8px 8px" }}>
          {Object.keys(groups).length === 0 && (
            <p
              style={{ color: T.muted }}
              className="text-xs font-500 text-center py-8"
            >
              {conversations.length === 0
                ? "No chats yet. Ask a question from Home to start."
                : "No conversations found."}
            </p>
          )}
          {groupOrder
            .filter((g) => groups[g]?.length)
            .map((group) => (
              <div key={group} className="mb-2">
                <p
                  style={{ color: T.muted }}
                  className="text-xs font-700 uppercase tracking-widest px-3 py-2"
                >
                  {group}
                </p>
                {groups[group].map((c) => {
                  const isActive = c.id === activeId
                  return (
                    <button
                      key={c.id}
                      onClick={() => setActiveId(c.id)}
                      style={{
                        backgroundColor: isActive
                          ? T.sage + "14"
                          : "transparent",
                        borderRadius: 10,
                        border: `1.5px solid ${
                          isActive ? T.sage + "40" : "transparent"
                        }`,
                        width: "100%",
                        textAlign: "left",
                        transition: "all 0.15s ease",
                      }}
                      className="flex flex-col gap-1 px-3 py-2.5 mb-0.5 cursor-pointer hover:bg-[#F2EDE8] transition-colors duration-150"
                      onMouseEnter={(e) => {
                        if (!isActive)
                          e.currentTarget.style.backgroundColor = "#F2EDE8"
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive)
                          e.currentTarget.style.backgroundColor = "transparent"
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          style={{ color: isActive ? T.fg : T.fgSoft }}
                          className="text-xs font-700 leading-snug line-clamp-1 flex-1"
                        >
                          {c.title}
                        </span>
                        <Badge label={c.tag.label} variant={c.tag.variant} />
                      </div>
                      <p
                        style={{ color: T.muted }}
                        className="text-xs font-500 leading-snug line-clamp-2"
                      >
                        {c.preview}
                      </p>
                      <p
                        style={{ color: T.muted }}
                        className="text-xs font-500 mt-0.5 opacity-70"
                      >
                        {c.date}
                      </p>
                    </button>
                  )
                })}
              </div>
            ))}
        </div>
      </aside>

      {/* ── Conversation view ────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          backgroundColor: T.bg,
        }}
      >
        {!active ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <p style={{ color: T.muted }} className="text-sm font-500">
              Select a conversation or start a new chat from Home.
            </p>
          </div>
        ) : (
          <>
        {/* Conversation header */}
        <div
          style={{
            backgroundColor: T.card,
            borderBottom: `1px solid ${T.border}`,
            padding: "14px 28px",
          }}
          className="flex items-center justify-between shrink-0"
        >
          <div className="flex items-center gap-3">
            <span
              style={{ backgroundColor: T.sage + "20" }}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-sm"
            >
              ✦
            </span>
            <div>
              <p
                style={{ color: T.fg }}
                className="text-sm font-800 leading-tight"
              >
                {active.title}
              </p>
              <p style={{ color: T.muted }} className="text-xs font-500">
                {active.date}
              </p>
            </div>
          </div>
          <Badge label={active.tag.label} variant={active.tag.variant} dot />
        </div>

        {/* Messages */}
        <div
          style={{ flex: 1, overflowY: "auto", padding: "28px 28px 8px" }}
          className="flex flex-col gap-5"
        >
          {active.messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-3 ${
                msg.role === "user" ? "flex-row-reverse" : "flex-row"
              }`}
            >
              {/* Avatar */}
              {msg.role === "ai" ? (
                <div
                  style={{ backgroundColor: T.sage + "20", flexShrink: 0 }}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm mt-0.5"
                >
                  ✦
                </div>
              ) : (
                <div
                  style={{
                    backgroundColor: T.sage + "30",
                    border: `2px solid ${T.sage}`,
                    flexShrink: 0,
                  }}
                  className="w-8 h-8 rounded-full flex items-center justify-center mt-0.5"
                >
                  <span
                    style={{ color: T.sage, fontSize: 12 }}
                    className="font-800"
                  >
                    M
                  </span>
                </div>
              )}
              {/* Bubble */}
              <div
                style={{
                  maxWidth: "68%",
                  backgroundColor: msg.role === "ai" ? T.card : T.sage,
                  borderRadius:
                    msg.role === "ai"
                      ? "4px 16px 16px 16px"
                      : "16px 4px 16px 16px",
                  boxShadow:
                    msg.role === "ai"
                      ? "0 1px 6px rgba(61,56,48,0.07)"
                      : "0 2px 10px rgba(127,166,140,0.28)",
                  padding: "12px 16px",
                }}
              >
                {msg.text.split("\n\n").map((para, j) => (
                  <p
                    key={j}
                    style={{ color: msg.role === "ai" ? T.fg : "white" }}
                    className={`text-sm font-500 leading-relaxed ${
                      j > 0 ? "mt-3" : ""
                    }`}
                  >
                    {para.split("\n").map((line, k) => (
                      <span key={k}>
                        {line.startsWith("**") && line.endsWith("**") ? (
                          <strong>{line.slice(2, -2)}</strong>
                        ) : line.startsWith("• ") || line.match(/^\d\./) ? (
                          <span
                            style={{
                              display: "block",
                              paddingLeft: "0.75em",
                              textIndent: "-0.75em",
                            }}
                          >
                            {line}
                          </span>
                        ) : line.startsWith("---") ? (
                          <span
                            style={{
                              display: "block",
                              borderTop: "1px solid rgba(255,255,255,0.2)",
                              margin: "8px 0",
                            }}
                          />
                        ) : (
                          line
                        )}
                        {k < para.split("\n").length - 1 && <br />}
                      </span>
                    ))}
                  </p>
                ))}
              </div>
            </div>
          ))}
          {thinking && (
            <p style={{ color: T.muted }} className="text-xs font-600 italic px-1">
              Thinking…
            </p>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Reply input */}
        <div style={{ padding: "16px 28px 20px", backgroundColor: T.bg }}>
          {composeError && (
            <p style={{ color: T.rose }} className="text-xs font-600 mb-2">{composeError}</p>
          )}
          <ConversationInput
            onSubmit={(t) => void handleFollowUp(t)}
            disabled={thinking}
          />
        </div>
          </>
        )}
      </div>
    </div>
  )
}

function ConversationInput({
  onSubmit,
  disabled = false,
}: {
  onSubmit: (text: string) => void
  disabled?: boolean
}) {
  const [val, setVal] = useState("")
  const [focused, setFocused] = useState(false)

  const submit = () => {
    const text = val.trim()
    if (!text || disabled) return
    setVal("")
    onSubmit(text)
  }

  return (
    <div
      style={{
        backgroundColor: T.card,
        borderRadius: 14,
        border: `1.5px solid ${focused ? T.sage : T.border}`,
        boxShadow: focused
          ? `0 0 0 3px ${T.sage}15`
          : "0 1px 6px rgba(61,56,48,0.06)",
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
      }}
      className="flex items-center gap-3 px-4 py-3"
    >
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        disabled={disabled}
        placeholder="Ask a follow-up or start a new thought…"
        style={{
          color: T.fg,
          backgroundColor: "transparent",
          outline: "none",
          fontFamily: "Nunito,sans-serif",
          flex: 1,
        }}
        className="text-sm font-500 placeholder:text-[#C0BAB2]"
      />
      <button
        style={{
          backgroundColor: val.trim() ? T.sage : T.border,
          transition: "background-color 0.15s ease",
          borderRadius: 9,
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
        className="cursor-pointer disabled:opacity-60"
        onClick={submit}
        disabled={disabled || !val.trim()}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M2 7h10M7 2l5 5-5 5"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}

const moodColors2: Record<number, string> = {
  0: T.border,
  1: "#C49090",
  2: "#C4AE90",
  3: "#BEC4A0",
  4: "#A8C4A0",
  5: T.sage,
}
const moodLabels2: Record<number, string> = {
  0: "—",
  1: "Low",
  2: "Tired",
  3: "Okay",
  4: "Good",
  5: "Great",
}

// ─── Insights shared primitives ───────────────────────────────────────────────
function StatCard({
  label,
  value,
  unit,
  sub,
  color,
}: {
  label: string
  value: string
  unit?: string
  sub?: string
  color?: string
}) {
  return (
    <div
      style={{
        backgroundColor: T.card,
        borderRadius: 14,
        boxShadow: "0 1px 8px rgba(61,56,48,0.07)",
      }}
      className="p-4 flex flex-col gap-1"
    >
      <p
        style={{ color: T.muted }}
        className="text-xs font-700 uppercase tracking-widest"
      >
        {label}
      </p>
      <div className="flex items-end gap-1 mt-1">
        <span
          style={{ color: color ?? T.fg, lineHeight: 1 }}
          className="text-3xl font-800 tabular-nums"
        >
          {value}
        </span>
        {unit && (
          <span style={{ color: T.muted }} className="text-xs font-600 mb-0.5">
            {unit}
          </span>
        )}
      </div>
      {sub && (
        <p style={{ color: T.muted }} className="text-xs font-500 mt-0.5">
          {sub}
        </p>
      )}
    </div>
  )
}

// ─── Log Modal ────────────────────────────────────────────────────────────────
type LogField = {
  key: string
  label: string
  type: "number" | "text" | "select" | "range" | "time"
  unit?: string
  placeholder?: string
  options?: string[]
  min?: number
  max?: number
  step?: number
}

const LOG_FIELDS: Record<string, { title: string; icon: string; color: string; fields: LogField[] }> = {
  glucose: {
    title: "Log Glucose Reading",
    icon: "✦",
    color: T.dustyBlue,
    fields: [
      { key: "value",   label: "Blood glucose",  type: "number", unit: "mg/dL", placeholder: "e.g. 112", min: 20, max: 400 },
      { key: "time",    label: "Time of reading", type: "time" },
      { key: "context", label: "Context",         type: "select", options: ["Fasting", "Before meal", "After meal", "Before exercise", "After exercise", "Bedtime", "Other"] },
      { key: "note",    label: "Note (optional)", type: "text", placeholder: "Anything worth remembering…" },
    ],
  },
  insulin: {
    title: "Log Insulin Dose",
    icon: "◎",
    color: T.sage,
    fields: [
      { key: "units",  label: "Units",      type: "number", unit: "u",     placeholder: "e.g. 4.5", min: 0, max: 30, step: 0.5 },
      { key: "type",   label: "Dose type",  type: "select", options: ["Bolus — meal", "Bolus — correction", "Basal", "Other"] },
      { key: "insulin",label: "Insulin",    type: "select", options: ["Humalog (lispro)", "Novolog (aspart)", "Apidra (glulisine)", "Lantus (glargine)", "Tresiba (degludec)", "Other"] },
      { key: "time",   label: "Time given", type: "time" },
      { key: "note",   label: "Note (optional)", type: "text", placeholder: "e.g. pre-bolused 15 min early" },
    ],
  },
  exercise: {
    title: "Log Exercise",
    icon: "◐",
    color: T.lavender,
    fields: [
      { key: "type",     label: "Activity type", type: "select", options: ["Walk", "Run", "Cycle", "Swim", "Yoga", "Strength training", "Stretch", "Hike", "Other"] },
      { key: "duration", label: "Duration",      type: "number", unit: "min", placeholder: "e.g. 30", min: 1, max: 300 },
      { key: "intensity",label: "Intensity",     type: "select", options: ["Light", "Moderate", "Vigorous"] },
      { key: "time",     label: "Start time",    type: "time" },
      { key: "glucose_before", label: "Glucose before (optional)", type: "number", unit: "mg/dL", placeholder: "e.g. 128", min: 20, max: 400 },
      { key: "note",     label: "Note (optional)", type: "text", placeholder: "How did it feel?" },
    ],
  },
  food: {
    title: "Log a Meal",
    icon: "◑",
    color: T.accent,
    fields: [
      { key: "description", label: "What did you eat?", type: "text", placeholder: "e.g. oats with blueberries and almond butter" },
      { key: "carbs",   label: "Estimated carbs", type: "number", unit: "g",   placeholder: "e.g. 62", min: 0, max: 500 },
      { key: "meal",    label: "Meal",            type: "select", options: ["Breakfast", "Lunch", "Dinner", "Snack"] },
      { key: "time",    label: "Time",            type: "time" },
      { key: "protein", label: "Protein (optional)", type: "number", unit: "g", placeholder: "e.g. 18", min: 0, max: 200 },
      { key: "fat",     label: "Fat (optional)",     type: "number", unit: "g", placeholder: "e.g. 12", min: 0, max: 200 },
      { key: "note",    label: "Note (optional)",    type: "text", placeholder: "e.g. restaurant meal, harder to estimate" },
    ],
  },
  mood: {
    title: "Log Your Mood",
    icon: "◇",
    color: T.rose,
    fields: [
      { key: "mood",   label: "How are you feeling?", type: "range", min: 1, max: 5, step: 1 },
      { key: "energy", label: "Energy level",         type: "select", options: ["Very low", "Low", "Moderate", "High", "Very high"] },
      { key: "sleep",  label: "Sleep last night",     type: "select", options: ["Poor", "Restless", "OK", "Good", "Great"] },
      { key: "stress", label: "Stress today",         type: "select", options: ["Very low", "Low", "Moderate", "High", "Very high"] },
      { key: "note",   label: "Note (optional)",      type: "text", placeholder: "Anything affecting how you feel today?" },
    ],
  },
}

const MOOD_SCALE = ["", "Low", "Tired", "Okay", "Good", "Great"]

function LogModal({ metricId, onClose }: { metricId: string; onClose: () => void }) {
  const { refetch } = useDashboard()
  const config = LOG_FIELDS[metricId]
  const now = new Date()
  const defaultTime = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    config.fields.forEach(f => { init[f.key] = f.type === "time" ? defaultTime : f.type === "range" ? "3" : "" })
    return init
  })
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const set = (key: string, val: string) => setValues(v => ({ ...v, [key]: val }))

  const save = async () => {
    setSaveError(null)
    const required = METRIC_REQUIRED[metricId] ?? []
    for (const key of required) {
      if (!values[key]?.trim()) {
        setSaveError(`Please fill in ${key}.`)
        return
      }
    }
    const data: Record<string, string> = {}
    for (const [k, v] of Object.entries(values)) {
      if (v.trim()) data[k] = v.trim()
    }
    setSaving(true)
    try {
      const patientId = await ensurePatientId()
      await createMetric(patientId, { metric_type: metricId, data })
      await refetch(true)
      setSubmitted(true)
    } catch (err) {
      setSaveError(
        err instanceof PatientApiError ? err.message : "Could not save entry. Try again.",
      )
    } finally {
      setSaving(false)
    }
  }

  if (submitted) {
    return (
      <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(61,56,48,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}
        onClick={onClose}>
        <div style={{ backgroundColor: T.card, borderRadius: 20, padding: "40px 32px", maxWidth: 360, width: "90%", textAlign: "center", boxShadow: "0 8px 40px rgba(61,56,48,0.18)" }}
          onClick={e => e.stopPropagation()}>
          <div style={{ backgroundColor: config.color + "20", width: 56, height: 56, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 22 }}>
            {config.icon}
          </div>
          <p style={{ color: T.fg }} className="text-base font-800 mb-2">Logged!</p>
          <p style={{ color: T.muted }} className="text-sm font-500 mb-6">Your {metricId} entry has been saved.</p>
          <button onClick={onClose} style={{ backgroundColor: config.color, color: "white", borderRadius: 12, padding: "10px 28px" }}
            className="text-sm font-700 cursor-pointer">Done</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(61,56,48,0.35)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ backgroundColor: T.card, borderRadius: 20, width: "100%", maxWidth: 480, maxHeight: "90dvh", overflowY: "auto", boxShadow: "0 8px 48px rgba(61,56,48,0.18)" }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ borderBottom: `1px solid ${T.border}`, padding: "18px 24px 14px" }} className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span style={{ backgroundColor: config.color + "20", fontSize: 15 }}
              className="w-8 h-8 rounded-xl flex items-center justify-center">{config.icon}</span>
            <p style={{ color: T.fg }} className="text-sm font-800">{config.title}</p>
          </div>
          <button onClick={onClose} style={{ color: T.muted, fontSize: 18, lineHeight: 1 }} className="cursor-pointer hover:text-[#3D3830] transition-colors">✕</button>
        </div>

        {/* Fields */}
        <div className="flex flex-col gap-4 p-6">
          {config.fields.map(f => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <label style={{ color: T.fgSoft }} className="text-xs font-700">{f.label}</label>

              {f.type === "select" && (
                <select value={values[f.key]} onChange={e => set(f.key, e.target.value)}
                  style={{ backgroundColor: T.bg, border: `1.5px solid ${T.border}`, borderRadius: 10, color: values[f.key] ? T.fg : T.muted, fontFamily: "Nunito,sans-serif", outline: "none" }}
                  className="px-3 py-2.5 text-sm font-500 cursor-pointer">
                  <option value="" disabled>Select…</option>
                  {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              )}

              {(f.type === "number" || f.type === "text" || f.type === "time") && (
                <div style={{ backgroundColor: T.bg, border: `1.5px solid ${T.border}`, borderRadius: 10, display: "flex", alignItems: "center", overflow: "hidden" }}>
                  <input type={f.type} value={values[f.key]} onChange={e => set(f.key, e.target.value)}
                    placeholder={f.placeholder ?? ""}
                    min={f.min} max={f.max} step={f.step}
                    style={{ flex: 1, backgroundColor: "transparent", outline: "none", color: T.fg, fontFamily: "Nunito,sans-serif", padding: "10px 12px" }}
                    className="text-sm font-500 placeholder:text-[#C0BAB2]" />
                  {f.unit && <span style={{ color: T.muted, paddingRight: 12 }} className="text-xs font-600 shrink-0">{f.unit}</span>}
                </div>
              )}

              {f.type === "range" && (
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between">
                    {MOOD_SCALE.slice(1).map((label, i) => (
                      <button key={i} onClick={() => set(f.key, String(i + 1))}
                        style={{
                          backgroundColor: values[f.key] === String(i + 1) ? T.rose : T.bg,
                          color: values[f.key] === String(i + 1) ? "white" : T.muted,
                          border: `1.5px solid ${values[f.key] === String(i + 1) ? T.rose : T.border}`,
                          borderRadius: 10, padding: "8px 0", flex: 1, margin: "0 3px",
                          transition: "all 0.15s ease",
                        }}
                        className="text-xs font-700 cursor-pointer">{label}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {saveError && (
          <p style={{ color: T.rose, padding: "0 24px" }} className="text-xs font-600">{saveError}</p>
        )}
        {/* Footer */}
        <div style={{ borderTop: `1px solid ${T.border}`, padding: "14px 24px" }} className="flex gap-3 justify-end">
          <button onClick={onClose} disabled={saving} style={{ backgroundColor: T.bg, color: T.fgSoft, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 20px" }}
            className="text-sm font-700 cursor-pointer">Cancel</button>
          <button onClick={() => void save()} disabled={saving}
            style={{ backgroundColor: config.color, color: "white", borderRadius: 12, padding: "10px 24px", boxShadow: `0 4px 14px ${config.color}44`, opacity: saving ? 0.7 : 1 }}
            className="text-sm font-700 cursor-pointer">{saving ? "Saving…" : "Save entry"}</button>
        </div>
      </div>
    </div>
  )
}

// ─── InsightSection (with Log button) ─────────────────────────────────────────
function InsightSection({
  id,
  icon,
  label,
  color,
  children,
}: {
  id: string
  icon: string
  label: string
  color: string
  children: React.ReactNode
}) {
  const [modalOpen, setModalOpen] = useState(false)
  return (
    <section id={id} className="flex flex-col gap-5" style={{ scrollMarginTop: 72 }}>
      <div className="flex items-center justify-between pb-3" style={{ borderBottom: `2px solid ${color}30` }}>
        <div className="flex items-center gap-3">
          <span style={{ backgroundColor: color + "20", fontSize: 16 }}
            className="w-9 h-9 rounded-xl flex items-center justify-center">{icon}</span>
          <h2 style={{ color: T.fg }} className="text-lg font-800 tracking-tight">{label}</h2>
        </div>
        <button onClick={() => setModalOpen(true)}
          style={{ backgroundColor: color + "15", color, border: `1.5px solid ${color}40`, borderRadius: 10, padding: "6px 14px", transition: "all 0.15s ease" }}
          className="flex items-center gap-1.5 text-xs font-700 cursor-pointer"
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = color + "28" }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = color + "15" }}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Log {label}
        </button>
      </div>
      {children}
      {modalOpen && <LogModal metricId={id} onClose={() => setModalOpen(false)} />}
    </section>
  )
}

// ─── Glucose section ──────────────────────────────────────────────────────────
function GlucoseInsights({ data }: { data: GlucoseInsightsBlock }) {
  const glucoseDailyAvg = data.daily_avg
  const glucoseDailyLow = data.daily_low
  const glucoseDailyHigh = data.daily_high
  const tirData = data.tir
  const dateLabels = data.date_labels
  const W = 640,
    H = 180
  const PAD = { t: 16, r: 16, b: 28, l: 42 }
  const n = glucoseDailyAvg.length
  const nDiv = Math.max(n - 1, 1)
  const CMIN = 60,
    CMAX = 210
  const iW = W - PAD.l - PAD.r,
    iH = H - PAD.t - PAD.b
  const toY = (v: number) => PAD.t + iH * (1 - (v - CMIN) / (CMAX - CMIN))
  const toX = (i: number) => PAD.l + (i / nDiv) * iW
  const pts = glucoseDailyAvg.map((v, i) => ({ x: toX(i), y: toY(v || CMIN) }))
  let avgPath = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const cx = (pts[i].x - pts[i - 1].x) / 2
    avgPath += ` C ${pts[i - 1].x + cx} ${pts[i - 1].y} ${pts[i].x - cx} ${pts[i].y} ${pts[i].x} ${pts[i].y}`
  }
  // Range band area
  let bandTop = `M ${toX(0)} ${toY(glucoseDailyHigh[0])}`
  for (let i = 1; i < n; i++) {
    const cx = (toX(i) - toX(i - 1)) / 2
    bandTop += ` C ${toX(i - 1) + cx} ${toY(glucoseDailyHigh[i - 1])} ${toX(i) - cx} ${toY(glucoseDailyHigh[i])} ${toX(i)} ${toY(glucoseDailyHigh[i])}`
  }
  let bandPath = bandTop
  for (let i = n - 1; i >= 0; i--) {
    const cx = i > 0 ? (toX(i) - toX(i - 1)) / 2 : 0
    if (i === n - 1) bandPath += ` L ${toX(i)} ${toY(glucoseDailyLow[i])}`
    else
      bandPath += ` C ${toX(i + 1) - cx} ${toY(glucoseDailyLow[i + 1])} ${toX(i) + cx} ${toY(glucoseDailyLow[i])} ${toX(i)} ${toY(glucoseDailyLow[i])}`
  }
  bandPath += " Z"

  const [hov, setHov] = useState<number | null>(null)
  const labelTicks = [0, 3, 6, 13].filter((i) => i < n)

  return (
    <div className="flex flex-col gap-4">
      {/* Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        <StatCard
          label="Avg Glucose"
          value={data.summary.avg_glucose ? String(data.summary.avg_glucose) : "—"}
          unit="mg/dL"
          sub="Past 14 days"
          color={T.dustyBlue}
        />
        <StatCard
          label="Time in Range"
          value={String(data.summary.tir_pct)}
          unit="%"
          sub="70–140 mg/dL"
          color={T.sage}
        />
        <StatCard
          label="Std Deviation"
          value={data.summary.std_dev ? String(data.summary.std_dev) : "—"}
          unit="mg/dL"
          sub="Variability"
        />
        <StatCard
          label="Est. A1C"
          value={data.summary.est_a1c ? String(data.summary.est_a1c) : "—"}
          unit="%"
          sub="Estimated only"
          color={T.accent}
        />
      </div>

      {/* TIR stacked bar */}
      <div
        style={{
          backgroundColor: T.card,
          borderRadius: 14,
          boxShadow: "0 1px 8px rgba(61,56,48,0.07)",
        }}
        className="p-5"
      >
        <p style={{ color: T.fg }} className="text-sm font-700 mb-1">
          Time in Range breakdown
        </p>
        <p style={{ color: T.muted }} className="text-xs font-500 mb-4">
          Past 14 days · target band 70–140 mg/dL
        </p>
        <div className="flex rounded-xl overflow-hidden" style={{ height: 28 }}>
          <div
            style={{ width: `${tirData.low}%`, backgroundColor: T.dustyBlue }}
            className="flex items-center justify-center"
          >
            <span className="text-white text-xs font-700">{tirData.low}%</span>
          </div>
          <div
            style={{ width: `${tirData.inRange}%`, backgroundColor: T.sage }}
            className="flex items-center justify-center"
          >
            <span className="text-white text-xs font-700">
              {tirData.inRange}%
            </span>
          </div>
          <div
            style={{ width: `${tirData.high}%`, backgroundColor: T.accent }}
            className="flex items-center justify-center"
          >
            <span className="text-white text-xs font-700">{tirData.high}%</span>
          </div>
        </div>
        <div className="flex gap-5 mt-3">
          {[
            { color: T.dustyBlue, label: "Low (<70)", pct: tirData.low },
            { color: T.sage, label: "In Range (70–140)", pct: tirData.inRange },
            { color: T.accent, label: "High (>140)", pct: tirData.high },
          ].map((l) => (
            <span
              key={l.label}
              className="flex items-center gap-1.5 text-xs font-600"
              style={{ color: T.muted }}
            >
              <span
                style={{ backgroundColor: l.color }}
                className="w-2.5 h-2.5 rounded-full"
              />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {/* 14-day trend chart */}
      <div
        style={{
          backgroundColor: T.card,
          borderRadius: 14,
          boxShadow: "0 1px 8px rgba(61,56,48,0.07)",
        }}
        className="p-5"
      >
        <p style={{ color: T.fg }} className="text-sm font-700 mb-0.5">
          14-day glucose trend
        </p>
        <div className="flex items-center gap-4 mb-4">
          <span className="flex items-center gap-1.5 text-xs font-500" style={{ color: T.muted }}>
            <span style={{ display: "inline-block", width: 12, height: 10, borderRadius: 2, backgroundColor: T.sage, opacity: 0.7 }} />
            Target range (70–140)
          </span>
          <span className="flex items-center gap-1.5 text-xs font-500" style={{ color: T.muted }}>
            <span style={{ display: "inline-block", width: 12, height: 10, borderRadius: 2, backgroundColor: T.dustyBlue, opacity: 0.5 }} />
            Daily low–high spread
          </span>
          <span className="flex items-center gap-1.5 text-xs font-500" style={{ color: T.muted }}>
            <span style={{ display: "inline-block", width: 14, height: 2.5, borderRadius: 2, backgroundColor: T.dustyBlue }} />
            Daily average
          </span>
        </div>
        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          style={{ overflow: "visible" }}
          onMouseLeave={() => setHov(null)}
        >
          <defs>
            <linearGradient id="gig" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={T.dustyBlue} stopOpacity="0.28" />
              <stop offset="100%" stopColor={T.dustyBlue} stopOpacity="0.06" />
            </linearGradient>
          </defs>
          {[70, 100, 140, 180].map((v) => (
            <g key={v}>
              <line
                x1={PAD.l}
                x2={PAD.l + iW}
                y1={toY(v)}
                y2={toY(v)}
                stroke={v === 70 || v === 140 ? T.sage + "55" : T.border}
                strokeWidth={v === 70 || v === 140 ? 1 : 0.8}
                strokeDasharray={v === 70 || v === 140 ? "0" : "3 4"}
              />
              <text
                x={PAD.l - 8}
                y={toY(v) + 4}
                textAnchor="end"
                fontSize={9}
                fill={v === 70 || v === 140 ? T.sage : T.muted}
                fontFamily="Nunito,sans-serif"
                fontWeight={v === 70 || v === 140 ? "700" : "500"}
              >
                {v}
              </text>
            </g>
          ))}
          {/* Target range band — green */}
          <rect
            x={PAD.l}
            y={toY(140)}
            width={iW}
            height={toY(70) - toY(140)}
            fill={T.sage}
            opacity={0.18}
          />
          {/* Daily low–high spread band — blue */}
          <path d={bandPath} fill="url(#gig)" />
          <path
            d={avgPath}
            fill="none"
            stroke={T.dustyBlue}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          {pts.map((p, i) => (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r={14}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHov(i)}
              />
              <circle
                cx={p.x}
                cy={p.y}
                r={hov === i ? 5.5 : 3.5}
                fill={T.dustyBlue}
                stroke="white"
                strokeWidth={1.5}
                style={{ transition: "r 0.12s ease", pointerEvents: "none" }}
              />
              {hov === i && (
                <g>
                  <rect
                    x={p.x - 36}
                    y={p.y - 38}
                    width={72}
                    height={26}
                    rx={7}
                    fill={T.fg}
                  />
                  <text
                    x={p.x}
                    y={p.y - 21}
                    textAnchor="middle"
                    fontSize={10}
                    fill="white"
                    fontFamily="Nunito,sans-serif"
                    fontWeight="700"
                  >
                    {glucoseDailyAvg[i]} mg/dL
                  </text>
                </g>
              )}
            </g>
          ))}
          {labelTicks.map((i) => (
            <text
              key={i}
              x={toX(i)}
              y={H - 4}
              textAnchor="middle"
              fontSize={9}
              fill={T.muted}
              fontFamily="Nunito,sans-serif"
              fontWeight="600"
            >
              {dateLabels[i] ?? ""}
            </text>
          ))}
        </svg>
      </div>
    </div>
  )
}

// ─── Insulin section ──────────────────────────────────────────────────────────
function InsulinInsights({ data }: { data: InsulinInsightsBlock }) {
  const insulinTDD = data.tdd
  const insulinBolus = data.bolus
  const insulinBasal = data.basal
  const dayLabels = data.day_labels
  const [hov, setHov] = useState<number | null>(null)
  const maxTDD = Math.max(...insulinTDD, 1)
  const W = 480,
    H = 160
  const PAD = { t: 16, r: 16, b: 28, l: 42 }
  const iW = W - PAD.l - PAD.r,
    iH = H - PAD.t - PAD.b
  const barW = (iW / insulinTDD.length) * 0.55
  const gap = iW / insulinTDD.length
  const toY = (v: number) => PAD.t + iH * (1 - v / (maxTDD + 2))
  const toX = (i: number) => PAD.l + i * gap + gap * 0.225
  const yLines = [5, 10, 15, 20]

  return (
    <div className="flex flex-col gap-4">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        <StatCard
          label="Avg Daily Dose"
          value={data.summary.avg_tdd ? String(data.summary.avg_tdd) : "—"}
          unit="u/day"
          sub="Past 7 days"
          color={T.sage}
        />
        <StatCard
          label="Avg Bolus"
          value={
            insulinBolus.length
              ? String(
                  Math.round(
                    (insulinBolus.reduce((a, b) => a + b, 0) / insulinBolus.length) * 10,
                  ) / 10,
                )
              : "—"
          }
          unit="u/day"
          sub="Meal + correction"
        />
        <StatCard
          label="Avg Basal"
          value={
            insulinBasal.length
              ? String(
                  Math.round(
                    (insulinBasal.reduce((a, b) => a + b, 0) / insulinBasal.length) * 10,
                  ) / 10,
                )
              : "—"
          }
          unit="u/day"
          sub="Background"
          color={T.dustyBlue}
        />
        <StatCard
          label="7-day Total"
          value={String(Math.round(insulinTDD.reduce((a, b) => a + b, 0) * 10) / 10)}
          unit="u"
          sub="All doses"
        />
      </div>

      <div
        style={{
          backgroundColor: T.card,
          borderRadius: 14,
          boxShadow: "0 1px 8px rgba(61,56,48,0.07)",
        }}
        className="p-5"
      >
        <p style={{ color: T.fg }} className="text-sm font-700 mb-0.5">
          Daily insulin — 7-day view
        </p>
        <p style={{ color: T.muted }} className="text-xs font-500 mb-4">
          Stacked: bolus (darker) + basal (lighter)
        </p>
        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          style={{ overflow: "visible" }}
          onMouseLeave={() => setHov(null)}
        >
          {yLines.map((v) => (
            <g key={v}>
              <line
                x1={PAD.l}
                x2={PAD.l + iW}
                y1={toY(v)}
                y2={toY(v)}
                stroke={T.border}
                strokeWidth={0.8}
                strokeDasharray="3 4"
              />
              <text
                x={PAD.l - 8}
                y={toY(v) + 4}
                textAnchor="end"
                fontSize={9}
                fill={T.muted}
                fontFamily="Nunito,sans-serif"
                fontWeight="500"
              >
                {v}u
              </text>
            </g>
          ))}
          {insulinTDD.map((_, i) => {
            const bh = iH * (insulinBolus[i] / (maxTDD + 2))
            const bsh = iH * (insulinBasal[i] / (maxTDD + 2))
            const x = toX(i)
            const isHov = hov === i
            return (
              <g
                key={i}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHov(i)}
                onMouseLeave={() => setHov(null)}
              >
                {/* Basal */}
                <rect
                  x={x}
                  y={toY(insulinTDD[i])}
                  width={barW}
                  height={bsh}
                  rx={0}
                  fill={T.dustyBlue}
                  opacity={isHov ? 0.7 : 0.45}
                />
                {/* Bolus */}
                <rect
                  x={x}
                  y={toY(insulinBolus[i])}
                  width={barW}
                  height={bh}
                  rx={0}
                  fill={T.sage}
                  opacity={isHov ? 0.95 : 0.75}
                />
                {/* Full bar rounded top */}
                <rect
                  x={x}
                  y={toY(insulinTDD[i])}
                  width={barW}
                  height={4}
                  rx={3}
                  fill={T.dustyBlue}
                  opacity={isHov ? 0.7 : 0.45}
                />
                <text
                  x={x + barW / 2}
                  y={H - 6}
                  textAnchor="middle"
                  fontSize={9}
                  fill={T.muted}
                  fontFamily="Nunito,sans-serif"
                  fontWeight="600"
                >
                  {dayLabels[i] ?? ""}
                </text>
                {isHov && (() => {
                  const tipW = 72
                  const cx = x + barW / 2
                  const tipX = Math.min(Math.max(cx - tipW / 2, PAD.l), PAD.l + iW - tipW)
                  return (
                    <g>
                      <rect
                        x={tipX}
                        y={toY(insulinTDD[i]) - 36}
                        width={tipW}
                        height={26}
                        rx={7}
                        fill={T.fg}
                      />
                      <text
                        x={tipX + tipW / 2}
                        y={toY(insulinTDD[i]) - 19}
                        textAnchor="middle"
                        fontSize={10}
                        fill="white"
                        fontFamily="Nunito,sans-serif"
                        fontWeight="700"
                      >
                        {insulinTDD[i]}u total
                      </text>
                    </g>
                  )
                })()}
              </g>
            )
          })}
        </svg>
        <div className="flex gap-5 mt-2">
          <span
            className="flex items-center gap-1.5 text-xs font-600"
            style={{ color: T.muted }}
          >
            <span
              style={{ backgroundColor: T.sage }}
              className="w-2.5 h-2.5 rounded-full"
            />
            Bolus
          </span>
          <span
            className="flex items-center gap-1.5 text-xs font-600"
            style={{ color: T.muted }}
          >
            <span
              style={{ backgroundColor: T.dustyBlue }}
              className="w-2.5 h-2.5 rounded-full"
            />
            Basal
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Exercise section ─────────────────────────────────────────────────────────
function ExerciseInsights({
  days,
  dayLabels,
  glucoseImpact,
}: {
  days: ExerciseDay[]
  dayLabels: string[]
  glucoseImpact: ExerciseGlucoseImpactRow[]
}) {
  const exerciseDays = days
  const [hov, setHov] = useState<number | null>(null)
  const maxMin = Math.max(...exerciseDays.map((d) => d.min), 10)
  const W = 480,
    H = 160
  const PAD = { t: 16, r: 16, b: 28, l: 42 }
  const iW = W - PAD.l - PAD.r,
    iH = H - PAD.t - PAD.b
  const barW = (iW / exerciseDays.length) * 0.5
  const gap = iW / exerciseDays.length
  const toY = (v: number) => PAD.t + iH * (1 - v / (maxMin + 10))
  const toX = (i: number) => PAD.l + i * gap + gap * 0.25
  const typeColor: Record<string, string> = {
    Walk: T.sage,
    Cycle: T.dustyBlue,
    Stretch: T.lavender,
    Hike: T.accent,
  }
  const activeDays = exerciseDays.filter((d) => d.min > 0).length
  const totalMin = exerciseDays.reduce((a, d) => a + d.min, 0)
  const avgActive =
    activeDays > 0 ? Math.round(totalMin / activeDays) : 0
  const longest = Math.max(...exerciseDays.map((d) => d.min), 0)

  return (
    <div className="flex flex-col gap-4">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        <StatCard
          label="Active Days"
          value={String(activeDays)}
          unit="/ 7"
          sub="This week"
          color={T.lavender}
        />
        <StatCard label="Total Time" value={String(totalMin)} unit="min" sub="This week" />
        <StatCard
          label="Avg / Day"
          value={String(avgActive)}
          unit="min"
          sub="Active days only"
          color={T.sage}
        />
        <StatCard
          label="Longest Session"
          value={String(longest)}
          unit="min"
          sub="This week"
        />
      </div>

      <div
        style={{
          backgroundColor: T.card,
          borderRadius: 14,
          boxShadow: "0 1px 8px rgba(61,56,48,0.07)",
        }}
        className="p-5"
      >
        <p style={{ color: T.fg }} className="text-sm font-700 mb-0.5">
          Activity this week
        </p>
        <p style={{ color: T.muted }} className="text-xs font-500 mb-4">
          Minutes per session · color by activity type
        </p>
        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          style={{ overflow: "visible" }}
          onMouseLeave={() => setHov(null)}
        >
          {[30, 60].map((v) => (
            <g key={v}>
              <line
                x1={PAD.l}
                x2={PAD.l + iW}
                y1={toY(v)}
                y2={toY(v)}
                stroke={T.border}
                strokeWidth={0.8}
                strokeDasharray="3 4"
              />
              <text
                x={PAD.l - 8}
                y={toY(v) + 4}
                textAnchor="end"
                fontSize={9}
                fill={T.muted}
                fontFamily="Nunito,sans-serif"
                fontWeight="500"
              >
                {v}m
              </text>
            </g>
          ))}
          {exerciseDays.map((d, i) => {
            const x = toX(i)
            const bh = d.min > 0 ? iH * (d.min / (maxMin + 10)) : 0
            const color = typeColor[d.type] ?? T.border
            const isHov = hov === i
            return (
              <g
                key={i}
                style={{ cursor: d.min > 0 ? "pointer" : "default" }}
                onMouseEnter={() => d.min > 0 && setHov(i)}
                onMouseLeave={() => setHov(null)}
              >
                {d.min > 0 ? (
                  <rect
                    x={x}
                    y={toY(d.min)}
                    width={barW}
                    height={bh}
                    rx={6}
                    fill={color}
                    opacity={isHov ? 0.9 : 0.65}
                  />
                ) : (
                  <rect
                    x={x + barW / 2 - 2}
                    y={PAD.t + iH - 8}
                    width={4}
                    height={8}
                    rx={2}
                    fill={T.border}
                    opacity={0.5}
                  />
                )}
                <text
                  x={x + barW / 2}
                  y={H - 6}
                  textAnchor="middle"
                  fontSize={9}
                  fill={T.muted}
                  fontFamily="Nunito,sans-serif"
                  fontWeight="600"
                >
                  {dayLabels[i] ?? ""}
                </text>
                {isHov && d.min > 0 && (() => {
                  const tipW = 96
                  const cx = x + barW / 2
                  const tipX = Math.min(Math.max(cx - tipW / 2, PAD.l), PAD.l + iW - tipW)
                  return (
                    <g>
                      <rect
                        x={tipX}
                        y={toY(d.min) - 36}
                        width={tipW}
                        height={26}
                        rx={7}
                        fill={T.fg}
                      />
                      <text
                        x={tipX + tipW / 2}
                        y={toY(d.min) - 19}
                        textAnchor="middle"
                        fontSize={10}
                        fill="white"
                        fontFamily="Nunito,sans-serif"
                        fontWeight="700"
                      >
                        {d.min} min · {d.type}
                      </text>
                    </g>
                  )
                })()}
              </g>
            )
          })}
        </svg>
        <div className="flex flex-wrap gap-4 mt-2">
          {Object.entries(typeColor).map(([k, c]) => (
            <span
              key={k}
              className="flex items-center gap-1.5 text-xs font-600"
              style={{ color: T.muted }}
            >
              <span
                style={{ backgroundColor: c }}
                className="w-2.5 h-2.5 rounded-full"
              />
              {k}
            </span>
          ))}
        </div>
      </div>

      {glucoseImpact.length > 0 && (
        <div
          style={{
            backgroundColor: T.card,
            borderRadius: 14,
            boxShadow: "0 1px 8px rgba(61,56,48,0.07)",
          }}
          className="p-5"
        >
          <p style={{ color: T.fg }} className="text-sm font-700 mb-1">
            Effect on glucose
          </p>
          <p style={{ color: T.muted }} className="text-xs font-500 mb-4">
            Self-reported glucose before sessions vs. readings in the 2 hours after
          </p>
          <div className="flex flex-col gap-3">
            {glucoseImpact.map((row) => {
              const color = typeColor[row.type] ?? T.lavender
              const before = row.before
              const after = row.after
              return (
                <div key={row.type} className="flex items-center gap-4">
                  <span
                    style={{ color: T.fgSoft, minWidth: 60 }}
                    className="text-xs font-700"
                  >
                    {row.type}
                  </span>
                  <div className="flex items-center gap-2 flex-1">
                    <span
                      style={{ color: T.muted }}
                      className="text-xs font-500 tabular-nums w-16 text-right"
                    >
                      {before != null ? `${before} mg/dL` : "—"}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: 6,
                        backgroundColor: T.bg,
                        borderRadius: 4,
                        overflow: "hidden",
                      }}
                    >
                      {before != null && (
                        <div
                          style={{
                            width: `${(before / 200) * 100}%`,
                            height: "100%",
                            backgroundColor: color,
                            opacity: 0.4,
                            borderRadius: 4,
                          }}
                        />
                      )}
                    </div>
                    <svg width="20" height="10" viewBox="0 0 20 10">
                      <path
                        d="M0 5h16M12 1l4 4-4 4"
                        stroke={T.muted}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        fill="none"
                      />
                    </svg>
                    <div
                      style={{
                        flex: 1,
                        height: 6,
                        backgroundColor: T.bg,
                        borderRadius: 4,
                        overflow: "hidden",
                      }}
                    >
                      {after != null && (
                        <div
                          style={{
                            width: `${(after / 200) * 100}%`,
                            height: "100%",
                            backgroundColor: color,
                            opacity: 0.8,
                            borderRadius: 4,
                          }}
                        />
                      )}
                    </div>
                    <span
                      style={{ color: color }}
                      className="text-xs font-700 tabular-nums w-16"
                    >
                      {after != null ? `${after} mg/dL` : "—"}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Food section ─────────────────────────────────────────────────────────────
function FoodInsights({
  carbsByDay,
  dayLabels,
  topFoods,
}: {
  carbsByDay: FoodDayCarbs[]
  dayLabels: string[]
  topFoods: TopFoodItem[]
}) {
  const foodCarbs = carbsByDay
  const [hov, setHov] = useState<number | null>(null)
  const maxCarbs = Math.max(...foodCarbs.map((d) => d.total), 1)
  const W = 480,
    H = 160
  const PAD = { t: 16, r: 16, b: 28, l: 42 }
  const iW = W - PAD.l - PAD.r,
    iH = H - PAD.t - PAD.b
  const barW = (iW / foodCarbs.length) * 0.55
  const gap = iW / foodCarbs.length
  const toY = (v: number) => PAD.t + iH * (1 - v / (maxCarbs + 20))
  const toX = (i: number) => PAD.l + i * gap + gap * 0.225

  return (
    <div className="flex flex-col gap-4">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        <StatCard
          label="Avg Daily Carbs"
          value={
            foodCarbs.length
              ? String(
                  Math.round(
                    foodCarbs.reduce((a, d) => a + d.total, 0) / foodCarbs.length,
                  ),
                )
              : "—"
          }
          unit="g"
          sub="Past 7 days"
          color={T.accent}
        />
        <StatCard
          label="7-day Total"
          value={String(Math.round(foodCarbs.reduce((a, d) => a + d.total, 0)))}
          unit="g"
          sub="All meals"
        />
        <StatCard
          label="Peak Day"
          value={String(Math.round(maxCarbs))}
          unit="g"
          sub="Highest daily total"
        />
        <StatCard
          label="Snack Carbs"
          value={String(Math.round(foodCarbs.reduce((a, d) => a + (d.s ?? 0), 0)))}
          unit="g"
          sub="This week"
          color={T.lavender}
        />
      </div>

      <div
        style={{
          backgroundColor: T.card,
          borderRadius: 14,
          boxShadow: "0 1px 8px rgba(61,56,48,0.07)",
        }}
        className="p-5"
      >
        <p style={{ color: T.fg }} className="text-sm font-700 mb-0.5">
          Daily carbs — 7-day view
        </p>
        <p style={{ color: T.muted }} className="text-xs font-500 mb-4">
          Stacked: breakfast · lunch · dinner
        </p>
        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          style={{ overflow: "visible" }}
          onMouseLeave={() => setHov(null)}
        >
          {[50, 100, 150, 200].map((v) => (
            <g key={v}>
              <line
                x1={PAD.l}
                x2={PAD.l + iW}
                y1={toY(v)}
                y2={toY(v)}
                stroke={T.border}
                strokeWidth={0.8}
                strokeDasharray="3 4"
              />
              <text
                x={PAD.l - 8}
                y={toY(v) + 4}
                textAnchor="end"
                fontSize={9}
                fill={T.muted}
                fontFamily="Nunito,sans-serif"
                fontWeight="500"
              >
                {v}g
              </text>
            </g>
          ))}
          {foodCarbs.map((d, i) => {
            const x = toX(i)
            const isHov = hov === i
            const bottom = PAD.t + iH
            const dH = iH * (d.d / (maxCarbs + 20))
            const lH = iH * (d.l / (maxCarbs + 20))
            const bH = iH * (d.b / (maxCarbs + 20))
            const dY = bottom - dH
            const lY = dY - lH
            const bY = lY - bH
            return (
              <g
                key={i}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHov(i)}
                onMouseLeave={() => setHov(null)}
              >
                <rect
                  x={x}
                  y={dY}
                  width={barW}
                  height={dH}
                  fill={T.dustyBlue}
                  opacity={isHov ? 0.8 : 0.55}
                  rx={0}
                />
                <rect
                  x={x}
                  y={lY}
                  width={barW}
                  height={lH}
                  fill={T.sage}
                  opacity={isHov ? 0.8 : 0.6}
                />
                <rect
                  x={x}
                  y={bY}
                  width={barW}
                  height={bH}
                  fill={T.accent}
                  opacity={isHov ? 0.9 : 0.7}
                  rx={0}
                />
                <text
                  x={x + barW / 2}
                  y={H - 6}
                  textAnchor="middle"
                  fontSize={9}
                  fill={T.muted}
                  fontFamily="Nunito,sans-serif"
                  fontWeight="600"
                >
                  {dayLabels[i] ?? ""}
                </text>
                {isHov && (() => {
                  const tipW = 72
                  const cx = x + barW / 2
                  const tipX = Math.min(Math.max(cx - tipW / 2, PAD.l), PAD.l + iW - tipW)
                  return (
                    <g>
                      <rect
                        x={tipX}
                        y={bY - 36}
                        width={tipW}
                        height={26}
                        rx={7}
                        fill={T.fg}
                      />
                      <text
                        x={tipX + tipW / 2}
                        y={bY - 19}
                        textAnchor="middle"
                        fontSize={10}
                        fill="white"
                        fontFamily="Nunito,sans-serif"
                        fontWeight="700"
                      >
                        {d.total}g total
                      </text>
                    </g>
                  )
                })()}
              </g>
            )
          })}
        </svg>
        <div className="flex gap-5 mt-2">
          {[
            { c: T.accent, l: "Breakfast" },
            { c: T.sage, l: "Lunch" },
            { c: T.dustyBlue, l: "Dinner" },
          ].map((x) => (
            <span
              key={x.l}
              className="flex items-center gap-1.5 text-xs font-600"
              style={{ color: T.muted }}
            >
              <span
                style={{ backgroundColor: x.c }}
                className="w-2.5 h-2.5 rounded-full"
              />
              {x.l}
            </span>
          ))}
        </div>
      </div>

      {/* Top foods */}
      <div
        style={{
          backgroundColor: T.card,
          borderRadius: 14,
          boxShadow: "0 1px 8px rgba(61,56,48,0.07)",
        }}
        className="p-5"
      >
        <p style={{ color: T.fg }} className="text-sm font-700 mb-4">
          Most-logged foods this week
        </p>
        {topFoods.length === 0 ? (
          <p style={{ color: T.muted }} className="text-xs font-500">
            Log meals to see your frequent foods.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-8 gap-y-2.5">
            {topFoods.map((f) => (
              <div
                key={f.name}
                className="flex items-center justify-between gap-3 py-1.5"
                style={{ borderBottom: `1px solid ${T.border}` }}
              >
                <div>
                  <p style={{ color: T.fg }} className="text-xs font-700">
                    {f.name}
                  </p>
                  <p style={{ color: T.muted }} className="text-xs font-500">
                    {f.meal ? `${f.meal} · ` : ""}
                    {f.carbs_avg > 0 ? `~${f.carbs_avg}g carbs` : "carbs not logged"}
                  </p>
                </div>
                <span
                  style={{ color: T.muted }}
                  className="text-xs font-600 tabular-nums shrink-0"
                >
                  ×{f.count}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Mood section ─────────────────────────────────────────────────────────────
function MoodInsights({
  monthFull,
  startOffset,
  monthYear,
  daysLogged,
  moodVsGlucose,
}: {
  monthFull: number[]
  startOffset: number
  monthYear: string
  daysLogged: number
  moodVsGlucose: MoodVsGlucoseRow[]
}) {
  const MOOD_FULL = monthFull
  const [hov, setHov] = useState<number | null>(null)
  const logged = MOOD_FULL.filter((v) => v > 0)
  const avg =
    logged.length > 0
      ? (logged.reduce((a, b) => a + b, 0) / logged.length).toFixed(1)
      : "—"
  const dist = [1, 2, 3, 4, 5].map((v) => ({
    v,
    count: MOOD_FULL.filter((x) => x === v).length,
  }))
  const daysInMonth = MOOD_FULL.length
  const cells = Array.from({ length: 35 }, (_, i) => {
    const day = i - startOffset + 1
    return day >= 1 && day <= daysInMonth ? { day, mood: MOOD_FULL[day - 1] ?? 0 } : null
  })
  const dayHeaders = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const monthLabel = monthYear
    ? new Date(`${monthYear}-01T12:00:00Z`).toLocaleString("en-US", { month: "long" })
    : "This month"

  return (
    <div className="flex flex-col gap-4">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        <StatCard
          label="Days Logged"
          value={String(daysLogged)}
          unit={`/ ${daysInMonth}`}
          sub={monthLabel}
          color={T.rose}
        />
        <StatCard
          label="Avg Mood"
          value={avg}
          unit="/ 5"
          sub="Logged days only"
          color={T.sage}
        />
        <StatCard
          label="Great Days"
          value={String(dist[4].count)}
          unit="days"
          sub="Mood 5 / Great"
        />
        <StatCard
          label="Low Days"
          value={String(dist[0].count + dist[1].count)}
          sub="Low or Tired"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Full month calendar */}
        <div
          style={{
            backgroundColor: T.card,
            borderRadius: 14,
            boxShadow: "0 1px 8px rgba(61,56,48,0.07)",
          }}
          className="p-5"
        >
          <p style={{ color: T.fg }} className="text-sm font-700 mb-0.5">
            {monthLabel} mood calendar
          </p>
          <p style={{ color: T.muted }} className="text-xs font-500 mb-4">
            Hover a day to see its mood · empty = not yet logged
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 4,
              marginBottom: 6,
            }}
          >
            {dayHeaders.map((d) => (
              <div
                key={d}
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: T.muted,
                  textAlign: "center",
                }}
              >
                {d}
              </div>
            ))}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 4,
              position: "relative",
            }}
          >
            {cells.map((cell, i) => {
              if (!cell) return <div key={i} />
              const isHov = hov === cell.day
              return (
                <div key={i} style={{ position: "relative" }}>
                  <div
                    style={{
                      width: "100%",
                      aspectRatio: "1",
                      borderRadius: 5,
                      backgroundColor: moodColors2[cell.mood],
                      opacity: cell.mood === 0 ? 0.35 : 1,
                      cursor: cell.mood > 0 ? "pointer" : "default",
                      transform: isHov ? "scale(1.18)" : "scale(1)",
                      transition: "transform 0.12s ease",
                      boxShadow: isHov
                        ? `0 2px 8px ${moodColors2[cell.mood]}88`
                        : "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    onMouseEnter={() => cell.mood > 0 && setHov(cell.day)}
                    onMouseLeave={() => setHov(null)}
                  >
                    <span
                      style={{
                        fontSize: 8,
                        color: "white",
                        fontWeight: 700,
                        opacity: cell.mood > 0 ? 0.9 : 0,
                      }}
                    >
                      {cell.day}
                    </span>
                  </div>
                  {isHov && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: "calc(100% + 5px)",
                        left: "50%",
                        transform: "translateX(-50%)",
                        backgroundColor: T.fg,
                        borderRadius: 6,
                        padding: "3px 7px",
                        whiteSpace: "nowrap",
                        zIndex: 10,
                        fontSize: 9,
                        color: "white",
                        fontWeight: 700,
                        fontFamily: "Nunito,sans-serif",
                        pointerEvents: "none",
                      }}
                    >
                      {moodLabels2[cell.mood]}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {/* Legend */}
          <div className="flex items-center gap-3 mt-4 flex-wrap">
            {[1, 2, 3, 4, 5].map((v) => (
              <span
                key={v}
                className="flex items-center gap-1.5 text-xs font-600"
                style={{ color: T.muted }}
              >
                <span
                  style={{
                    backgroundColor: moodColors2[v],
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    display: "inline-block",
                  }}
                />
                {moodLabels2[v]}
              </span>
            ))}
          </div>
        </div>

        {/* Distribution + correlation */}
        <div className="flex flex-col gap-4">
          <div
            style={{
              backgroundColor: T.card,
              borderRadius: 14,
              boxShadow: "0 1px 8px rgba(61,56,48,0.07)",
            }}
            className="p-5 flex flex-col gap-3"
          >
            <p style={{ color: T.fg }} className="text-sm font-700">
              Mood distribution
            </p>
            {dist.map(({ v, count }) => (
              <div key={v} className="flex items-center gap-3">
                <span
                  style={{ color: T.fgSoft, minWidth: 46 }}
                  className="text-xs font-700"
                >
                  {moodLabels2[v]}
                </span>
                <div
                  style={{
                    flex: 1,
                    backgroundColor: T.bg,
                    borderRadius: 4,
                    height: 8,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width:
                        logged.length > 0
                          ? `${(count / logged.length) * 100}%`
                          : "0%",
                      height: "100%",
                      backgroundColor: moodColors2[v],
                      borderRadius: 4,
                    }}
                  />
                </div>
                <span
                  style={{ color: T.muted, minWidth: 32, textAlign: "right" }}
                  className="text-xs font-600 tabular-nums"
                >
                  {count}d
                </span>
              </div>
            ))}
          </div>

          <div
            style={{
              backgroundColor: T.card,
              borderRadius: 14,
              boxShadow: "0 1px 8px rgba(61,56,48,0.07)",
            }}
            className="p-5"
          >
            <p style={{ color: T.fg }} className="text-sm font-700 mb-3">
              Mood vs. glucose
            </p>
            {moodVsGlucose.length === 0 ? (
              <p style={{ color: T.muted }} className="text-xs font-500">
                Log mood and glucose on the same day to see patterns here.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-2.5">
                  {moodVsGlucose.map((row) => (
                    <div key={row.mood} className="flex items-center gap-3">
                      <span
                        style={{ color: T.fgSoft, minWidth: 46 }}
                        className="text-xs font-700"
                      >
                        {row.label}
                      </span>
                      <div
                        style={{
                          flex: 1,
                          backgroundColor: T.bg,
                          borderRadius: 4,
                          height: 7,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${(row.avg_glucose / 160) * 100}%`,
                            height: "100%",
                            backgroundColor: moodColors2[row.mood] ?? T.muted,
                            borderRadius: 4,
                          }}
                        />
                      </div>
                      <span
                        style={{
                          color: T.muted,
                          minWidth: 60,
                          textAlign: "right",
                        }}
                        className="text-xs font-600 tabular-nums"
                      >
                        {row.avg_glucose} mg/dL
                      </span>
                    </div>
                  ))}
                </div>
                <p
                  style={{ color: T.muted }}
                  className="text-xs font-500 mt-3 leading-relaxed"
                >
                  Averages on days when both mood and glucose were logged — for
                  your awareness, not medical advice.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Insights Page ────────────────────────────────────────────────────────────
const INSIGHT_SECTIONS = [
  { id: "glucose", icon: "✦", label: "Glucose", color: T.dustyBlue },
  { id: "insulin", icon: "◎", label: "Insulin", color: T.sage },
  { id: "exercise", icon: "◐", label: "Exercise", color: T.lavender },
  { id: "food", icon: "◑", label: "Food", color: T.accent },
  { id: "mood", icon: "◇", label: "Mood", color: T.rose },
]

function InsightsPage({ initialSection }: { initialSection?: string }) {
  const { dashboard, loading, error } = useDashboard()
  const [active, setActive] = useState(initialSection ?? "glucose")

  React.useEffect(() => {
    if (initialSection) {
      setTimeout(() => {
        document.getElementById(initialSection)?.scrollIntoView({ behavior: "smooth", block: "start" })
      }, 80)
    }
  }, [initialSection])

  const scrollTo = (id: string) => {
    setActive(id)
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  if (loading && !dashboard) {
    return (
      <div className="max-w-6xl mx-auto px-8 py-10">
        <p style={{ color: T.muted }} className="text-sm font-500">Loading insights…</p>
      </div>
    )
  }
  if (error && !dashboard) {
    return (
      <div className="max-w-6xl mx-auto px-8 py-10">
        <p style={{ color: T.rose }} className="text-sm font-600">{error}</p>
      </div>
    )
  }
  const ins = dashboard!.insights

  return (
    <div className="max-w-6xl mx-auto px-8 py-10 flex gap-8">
      {/* ── Left sticky nav ───────────────────────────────────────── */}
      <aside style={{ width: 180, flexShrink: 0 }}>
        <div
          style={{ position: "sticky", top: 80 }}
          className="flex flex-col gap-1"
        >
          <p
            style={{ color: T.muted }}
            className="text-xs font-700 uppercase tracking-widest mb-3 px-3"
          >
            Sections
          </p>
          {INSIGHT_SECTIONS.map((s) => {
            const isActive = active === s.id
            return (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                style={{
                  backgroundColor: isActive ? s.color + "14" : "transparent",
                  borderLeft: `3px solid ${isActive ? s.color : "transparent"}`,
                  color: isActive ? s.color : T.muted,
                  transition: "all 0.15s ease",
                  textAlign: "left",
                }}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-r-xl cursor-pointer w-full"
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = T.bg
                }}
                onMouseLeave={(e) => {
                  if (!isActive)
                    e.currentTarget.style.backgroundColor = "transparent"
                }}
              >
                <span style={{ fontSize: 14 }}>{s.icon}</span>
                <span className="text-sm font-700">{s.label}</span>
              </button>
            )
          })}
        </div>
      </aside>

      {/* ── Main scrollable content ───────────────────────────────── */}
      <main className="flex-1 min-w-0 flex flex-col gap-12 pb-20">
        {/* Page title */}
        <div className="flex flex-col gap-1">
          <h1
            style={{ color: T.fg }}
            className="text-3xl font-800 tracking-tight"
          >
            Insights
          </h1>
          <p style={{ color: T.muted }} className="text-sm font-500">
            A closer look at your patterns — past 7–14 days.
          </p>
        </div>

        <InsightSection
          id="glucose"
          icon="✦"
          label="Glucose"
          color={T.dustyBlue}
        >
          <GlucoseInsights data={ins.glucose} />
        </InsightSection>

        <InsightSection id="insulin" icon="◎" label="Insulin" color={T.sage}>
          <InsulinInsights data={ins.insulin} />
        </InsightSection>

        <InsightSection
          id="exercise"
          icon="◐"
          label="Exercise"
          color={T.lavender}
        >
          <ExerciseInsights
            days={ins.exercise.days}
            dayLabels={ins.exercise.day_labels}
            glucoseImpact={ins.exercise.glucose_impact ?? []}
          />
        </InsightSection>

        <InsightSection id="food" icon="◑" label="Food" color={T.accent}>
          <FoodInsights
            carbsByDay={ins.food.carbs_by_day}
            dayLabels={ins.food.day_labels}
            topFoods={ins.food.top_foods ?? []}
          />
        </InsightSection>

        <InsightSection id="mood" icon="◇" label="Mood" color={T.rose}>
          <MoodInsights
            monthFull={ins.mood.month_full}
            startOffset={ins.mood.start_offset}
            monthYear={ins.mood.month_year}
            daysLogged={ins.mood.days_logged}
            moodVsGlucose={ins.mood.mood_vs_glucose ?? []}
          />
        </InsightSection>
      </main>
    </div>
  )
}

// ─── Active Chat Page ─────────────────────────────────────────────────────────
type ChatMessage = {
  role: "user" | "ai"
  text: string
  ts: string
  sources?: SourceDocument[]
}

function ActiveChatPage({
  initialQuestion,
  queryMode,
  onQueryModeChange,
  onBack,
}: {
  initialQuestion: string
  queryMode: QueryMode
  onQueryModeChange: (mode: QueryMode) => void
  onBack: () => void
}) {
  const now = () => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "user", text: initialQuestion, ts: now() },
  ])
  const [input, setInput] = useState("")
  const [focused, setFocused] = useState(false)
  const [thinking, setThinking] = useState(true)
  const bottomRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, thinking])

  React.useEffect(() => {
    const modeForInitial = queryMode
    let cancelled = false
    void (async () => {
      const { text, sources } = await fetchChatAnswer(initialQuestion, modeForInitial)
      if (cancelled) return
      setMessages((prev) => [...prev, { role: "ai", text, ts: now(), sources }])
      setThinking(false)
    })()
    return () => {
      cancelled = true
    }
    // Only re-fetch when a new chat starts; mode toggles apply to follow-ups only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion])

  const send = () => {
    const q = input.trim()
    if (!q || thinking) return
    setInput("")
    setMessages(prev => [...prev, { role: "user", text: q, ts: now() }])
    setThinking(true)
    void (async () => {
      const { text, sources } = await fetchChatAnswer(q, queryMode)
      setMessages(prev => [...prev, { role: "ai", text, ts: now(), sources }])
      setThinking(false)
    })()
  }

  const followUps =
    queryMode === "metrics"
      ? [
          "Summarize my glucose this week",
          "What did I log yesterday?",
          "How many days did I exercise?",
          "What were my most logged meals?",
        ]
      : [
          "Tell me more about that",
          "What should I do differently?",
          "How does this compare to last week?",
          "Is this something to mention to my doctor?",
        ]

  const modeLabel = queryMode === "metrics" ? "Summarize logs" : "Learn"

  return (
    <div style={{ height: "calc(100dvh - 56px)", display: "flex", flexDirection: "column", maxWidth: 760, margin: "0 auto", width: "100%" }}>

      {/* Header */}
      <div style={{ backgroundColor: T.card, borderBottom: `1px solid ${T.border}`, padding: "12px 24px" }}
        className="flex items-center gap-3 shrink-0">
        <button onClick={onBack}
          style={{ backgroundColor: T.bg, border: `1px solid ${T.border}`, color: T.fgSoft, borderRadius: 10, padding: "6px 12px" }}
          className="flex items-center gap-1.5 text-xs font-700 cursor-pointer hover:border-[#C8C1B8] transition-colors shrink-0">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M8 1L3 6l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Home
        </button>
        <div style={{ width: 1, height: 20, backgroundColor: T.border }} />
        <span style={{ backgroundColor: T.sage + "20" }} className="w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0">✦</span>
        <div className="min-w-0 flex-1">
          <p style={{ color: T.fg }} className="text-sm font-700 truncate">{initialQuestion}</p>
          <p style={{ color: T.muted }} className="text-xs font-500">
            {modeLabel} · {queryMode === "metrics" ? "Summaries only — not medical advice" : "Educational · Today"}
          </p>
        </div>
        <div
          style={{ backgroundColor: T.bg, borderRadius: 8, padding: 2, display: "flex", gap: 2, flexShrink: 0 }}
        >
          {(
            [
              { id: "general" as const, label: "Learn" },
              { id: "metrics" as const, label: "Logs" },
            ] as const
          ).map((opt) => {
            const active = queryMode === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onQueryModeChange(opt.id)}
                style={{
                  backgroundColor: active ? T.card : "transparent",
                  color: active ? T.fg : T.muted,
                  borderRadius: 6,
                  padding: "4px 10px",
                  fontFamily: "Nunito,sans-serif",
                }}
                className="text-xs font-700 cursor-pointer border-0"
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "28px 24px 8px" }} className="flex flex-col gap-5">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            {msg.role === "ai" ? (
              <div style={{ backgroundColor: T.sage + "20", flexShrink: 0 }}
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm mt-0.5">✦</div>
            ) : (
              <div style={{ backgroundColor: T.sage + "30", border: `2px solid ${T.sage}`, flexShrink: 0 }}
                className="w-8 h-8 rounded-full flex items-center justify-center mt-0.5">
                <span style={{ color: T.sage, fontSize: 12 }} className="font-800">M</span>
              </div>
            )}
            <div className="flex flex-col gap-1" style={{ maxWidth: "72%", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={{
                backgroundColor: msg.role === "ai" ? T.card : T.sage,
                borderRadius: msg.role === "ai" ? "4px 16px 16px 16px" : "16px 4px 16px 16px",
                boxShadow: msg.role === "ai" ? "0 1px 6px rgba(61,56,48,0.07)" : "0 2px 10px rgba(127,166,140,0.28)",
                padding: "12px 16px",
              }}>
                {msg.text.split("\n\n").map((para, j) => (
                  <p key={j} style={{ color: msg.role === "ai" ? T.fg : "white" }}
                    className={`text-sm font-500 leading-relaxed ${j > 0 ? "mt-3" : ""}`}>
                    {para}
                  </p>
                ))}
              </div>
              {msg.role === "ai" && msg.sources && msg.sources.length > 0 && (
                <ChatSourceLinks sources={msg.sources} />
              )}
              <span style={{ color: T.muted }} className="text-xs font-500 px-1">{msg.ts}</span>
            </div>
          </div>
        ))}

        {/* Thinking indicator */}
        {thinking && (
          <div className="flex gap-3">
            <div style={{ backgroundColor: T.sage + "20" }} className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0">✦</div>
            <div style={{ backgroundColor: T.card, borderRadius: "4px 16px 16px 16px", padding: "14px 18px", boxShadow: "0 1px 6px rgba(61,56,48,0.07)" }}
              className="flex items-center gap-1.5">
              {[0, 1, 2].map(i => (
                <span key={i} style={{ backgroundColor: T.muted, width: 6, height: 6, borderRadius: "50%", display: "inline-block",
                  animation: "bounce 1.2s ease-in-out infinite", animationDelay: `${i * 0.2}s` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Follow-up chips */}
      {!thinking && messages.length <= 2 && (
        <div style={{ padding: "0 24px 12px" }} className="flex flex-wrap gap-2">
          {followUps.map(f => (
            <button key={f} onClick={() => { setInput(f) }}
              style={{ backgroundColor: T.card, color: T.fgSoft, border: `1px solid ${T.border}`, borderRadius: 20 }}
              className="px-3 py-1.5 text-xs font-600 cursor-pointer hover:border-[#C8C1B8] transition-colors">
              {f}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: "12px 24px 20px", backgroundColor: T.bg, borderTop: `1px solid ${T.border}` }}>
        <div style={{ backgroundColor: T.card, borderRadius: 14, border: `1.5px solid ${focused ? T.sage : T.border}`,
          boxShadow: focused ? `0 0 0 3px ${T.sage}15` : "0 1px 6px rgba(61,56,48,0.06)", transition: "all 0.15s ease" }}
          className="flex items-center gap-3 px-4 py-3">
          <input value={input} onChange={e => setInput(e.target.value)}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            onKeyDown={e => e.key === "Enter" && send()}
            placeholder="Ask a follow-up…"
            style={{ color: T.fg, backgroundColor: "transparent", outline: "none", fontFamily: "Nunito,sans-serif", flex: 1 }}
            className="text-sm font-500 placeholder:text-[#C0BAB2]" />
          <button onClick={send}
            style={{ backgroundColor: input.trim() && !thinking ? T.sage : T.border, transition: "background-color 0.15s ease",
              borderRadius: 9, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            className="cursor-pointer">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7h10M7 2l5 5-5 5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <style>{`@keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }`}</style>
    </div>
  )
}

// ─── Footer + Disclaimer ──────────────────────────────────────────────────────
function DisclaimerModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, backgroundColor: "rgba(61,56,48,0.45)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ backgroundColor: T.card, borderRadius: 20, width: "100%", maxWidth: 480, boxShadow: "0 8px 48px rgba(61,56,48,0.2)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ borderBottom: `1px solid ${T.border}`, padding: "18px 24px 14px" }} className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span style={{ backgroundColor: "#C0392B18", fontSize: 15 }} className="w-8 h-8 rounded-xl flex items-center justify-center">⚠</span>
            <p style={{ color: T.fg }} className="text-sm font-800">Medical Disclaimer</p>
          </div>
          <button onClick={onClose} style={{ color: T.muted, fontSize: 18, lineHeight: 1 }} className="cursor-pointer">✕</button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 p-6">
          <p style={{ color: T.fg }} className="text-sm font-500 leading-relaxed">
            The information provided by Pancreas Pal is for <strong>educational purposes only</strong> and does not constitute medical advice.
          </p>
          <p style={{ color: T.fg }} className="text-sm font-500 leading-relaxed">
            It is not a substitute for the professional judgment of a licensed healthcare provider. Always consult a qualified physician for health concerns.
          </p>
          <div style={{ backgroundColor: "#C0392B0F", border: "1px solid #C0392B30", borderRadius: 12, padding: "12px 16px" }}>
            <p style={{ color: "#96281B" }} className="text-sm font-700 leading-relaxed">
              In an emergency, call your local emergency services (e.g., 911) or go to the nearest emergency room immediately.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div style={{ borderTop: `1px solid ${T.border}`, padding: "14px 24px" }} className="flex justify-end">
          <button onClick={onClose}
            style={{ backgroundColor: T.sage, color: "white", borderRadius: 12, padding: "10px 24px", boxShadow: "0 4px 14px rgba(127,166,140,0.35)" }}
            className="text-sm font-700 cursor-pointer">
            Understood
          </button>
        </div>
      </div>
    </div>
  )
}

function AppFooter() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <footer style={{ borderTop: `1px solid ${T.border}` }} className="mt-4 py-6">
        <div className="flex items-center justify-center gap-1.5">
          <p style={{ color: T.muted }} className="text-center text-xs font-500">
            Pancreas Pal · For self-reflection, not medical advice
          </p>
          <span style={{ color: T.border }}>·</span>
          <button
            onClick={() => setOpen(true)}
            style={{ color: T.muted, borderBottom: `1px dashed ${T.border}` }}
            className="text-xs font-600 cursor-pointer hover:text-[#7A746C] transition-colors"
          >
            Disclaimer
          </button>
        </div>
      </footer>
      {open && <DisclaimerModal onClose={() => setOpen(false)} />}
    </>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────
function AppShell() {
  const [page, setPage] = useState("Home")
  const [chatQuery, setChatQuery] = useState<string | null>(null)
  const [chatMode, setChatMode] = useState<QueryMode>("general")
  const [insightSection, setInsightSection] = useState<string | undefined>(undefined)

  const handleAsk = (q: string, mode: QueryMode) => {
    setChatMode(mode)
    setChatQuery(q)
    setPage("Chat")
  }

  const handleNavChange = (p: string) => {
    setChatQuery(null)
    if (p !== "Insights") setInsightSection(undefined)
    setPage(p)
  }

  const handleInsight = (section: string) => {
    setInsightSection(section)
    setPage("Insights")
  }

  const showFooter = page !== "History" && page !== "Chat"

  return (
    <div style={{ backgroundColor: T.bg, fontFamily: "Nunito, system-ui, sans-serif", minHeight: "100dvh" }}>
      <Nav page={page === "Chat" ? "Home" : page} setPage={handleNavChange} />
      {page === "Home"     && <HomePage onAsk={handleAsk} onInsight={handleInsight} />}
      {page === "Chat" && chatQuery && (
        <ActiveChatPage
          key={chatQuery}
          initialQuestion={chatQuery}
          queryMode={chatMode}
          onQueryModeChange={setChatMode}
          onBack={() => handleNavChange("Home")}
        />
      )}
      {page === "History"  && <><DemoBanner /><HistoryPage /></>}
      {page === "Insights" && <><DemoBanner /><InsightsPage initialSection={insightSection} /></>}
      {showFooter && <AppFooter />}
    </div>
  )
}

export default function App() {
  return (
    <DashboardProvider>
      <AppShell />
    </DashboardProvider>
  )
}
