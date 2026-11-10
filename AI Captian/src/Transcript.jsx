import { useEffect, useState } from 'react'

// What is being said, live and streaming. Your words appear on the left as you
// speak them, Greeny's on the right as it replies. A line fades in when it
// starts and fades out a moment after its last word. Both sit at the vertical
// centre, clear of the camera preview. Only shown during a voice chat.
const HOLD = { you: 3500, greeny: 6000 } // ms a line stays after its last word

function Slot({ line, side, label }) {
  const [out, setOut] = useState(false)
  useEffect(() => {
    if (!line) return undefined
    setOut(false)
    const t = setTimeout(() => setOut(true), HOLD[line.who])
    return () => clearTimeout(t) // every new word restarts the countdown
  }, [line?.id, line?.text]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!line) return null
  return (
    <div className={`transcript-side ${side}`}>
      <p key={line.id} className={`line ${line.who}${out ? ' out' : ''}`} aria-hidden={out}>
        <span>{label}</span>
        {line.text}
      </p>
    </div>
  )
}

export default function Transcript({ lines, shifted, name }) {
  const lastOf = (who) => [...lines].reverse().find((l) => l.who === who) || null
  return (
    <aside className={`transcript${shifted ? ' shifted' : ''}`} aria-label="Conversation" aria-live="polite">
      <Slot line={lastOf('you')} side="left" label={name || 'You'} />
      <Slot line={lastOf('greeny')} side="right" label="Greeny" />
    </aside>
  )
}
