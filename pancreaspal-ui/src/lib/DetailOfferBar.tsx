type DetailOfferBarProps = {
  onYes: () => void
  onNo: () => void
  disabled?: boolean
  cardBg: string
  fg: string
  muted: string
  border: string
  sage: string
}

export function DetailOfferBar({
  onYes,
  onNo,
  disabled = false,
  cardBg,
  fg,
  muted,
  border,
  sage,
}: DetailOfferBarProps) {
  return (
    <div
      style={{
        backgroundColor: cardBg,
        border: `1px solid ${border}`,
        borderRadius: 12,
        padding: '10px 14px',
        marginBottom: 10,
      }}
      className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between"
    >
      <p style={{ color: fg }} className="text-sm font-600">
        Would you like to go into more detail?
      </p>
      <div className="flex gap-2 shrink-0">
        <button
          type="button"
          disabled={disabled}
          onClick={onNo}
          style={{
            color: muted,
            border: `1px solid ${border}`,
            borderRadius: 8,
            padding: '6px 14px',
            fontFamily: 'Nunito,sans-serif',
            opacity: disabled ? 0.6 : 1,
          }}
          className="text-xs font-700 cursor-pointer bg-transparent"
        >
          No
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onYes}
          style={{
            backgroundColor: sage,
            color: 'white',
            borderRadius: 8,
            padding: '6px 14px',
            fontFamily: 'Nunito,sans-serif',
            opacity: disabled ? 0.6 : 1,
          }}
          className="text-xs font-700 cursor-pointer border-0"
        >
          Yes
        </button>
      </div>
    </div>
  )
}
