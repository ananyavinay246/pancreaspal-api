import { DetailOfferBar } from './DetailOfferBar'

export type DetailChoice = 'pending' | 'yes' | 'no'

type DetailThreadBannerProps = {
  choice: DetailChoice
  onYes?: () => void
  onNo?: () => void
  disabled?: boolean
  cardBg: string
  fg: string
  muted: string
  border: string
  sage: string
}

export function DetailThreadBanner({
  choice,
  onYes,
  onNo,
  disabled,
  cardBg,
  fg,
  muted,
  border,
  sage,
}: DetailThreadBannerProps) {
  if (choice === 'pending' && onYes && onNo) {
    return (
      <div className="w-full max-w-md mx-auto">
        <DetailOfferBar
          onYes={onYes}
          onNo={onNo}
          disabled={disabled}
          cardBg={cardBg}
          fg={fg}
          muted={muted}
          border={border}
          sage={sage}
        />
      </div>
    )
  }

  const label =
    choice === 'yes'
      ? 'You asked for more detail.'
      : 'You chose not to get more detail.'

  return (
    <div
      style={{
        backgroundColor: cardBg,
        border: `1px solid ${border}`,
        borderRadius: 10,
        padding: '8px 14px',
      }}
      className="w-full max-w-md mx-auto text-center"
    >
      <p style={{ color: muted }} className="text-xs font-600">
        Would you like to go into more detail?{' '}
        <span style={{ color: choice === 'yes' ? sage : fg }} className="font-700">
          {choice === 'yes' ? 'Yes' : 'No'}
        </span>
      </p>
      {choice === 'yes' && (
        <p style={{ color: fg }} className="text-xs font-600 mt-1">
          {label}
        </p>
      )}
    </div>
  )
}
