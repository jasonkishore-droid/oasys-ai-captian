import { GESTURES, GESTURE_ACTIONS, gestureMap } from './lib/gestures.js'

// One row per hand gesture, each with what it means (Yes / No / Off).
// `saved` is settings.gestureMap; onChange gets the whole new map.
export default function GestureRows({ saved, onChange, disabled = false, rowClass = 'field', selectClass = 'select' }) {
  const map = gestureMap(saved)
  return GESTURES.map((g) => (
    <div className={rowClass} key={g.id}>
      <label className="field-text" htmlFor={`gesture-${g.id}`}>
        <span className="field-label">
          <span className="gesture-emoji" aria-hidden="true">{g.emoji}</span> {g.label}
        </span>
      </label>
      <select
        id={`gesture-${g.id}`}
        className={selectClass}
        value={map[g.id]}
        disabled={disabled}
        onChange={(e) => onChange({ ...map, [g.id]: e.target.value })}
      >
        {GESTURE_ACTIONS.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
    </div>
  ))
}
