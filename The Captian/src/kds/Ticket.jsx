import { memo } from 'react'
import { ageSeconds, formatAge, urgency } from './age.js'
import { useNow } from './hooks.js'

const DIET_LABEL = { veg: 'Vegetarian', nonveg: 'Non-vegetarian', egg: 'Contains egg' }
// the stages a ticket goes through, in order
export const STAGES = [
  ['new', 'New'],
  ['preparing', 'Preparing'],
  ['ready', 'Ready'],
  ['served', 'Served'],
]
const hhmm = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })

// one round of an order: a coloured header (its colour is how long it has waited), the dishes, one button
function Ticket({ ticket, fresh, onMove }) {
  const now = useNow() // the shared clock: the timer and the header colour tick together
  const cooking = ticket.status === 'new' || ticket.status === 'preparing'
  const seconds = ageSeconds(ticket.created_at, now)
  const level = cooking ? urgency(seconds) : 'done'
  const place = ticket.table_no ? `Table ${ticket.table_no}` : 'No table'
  const count = ticket.items.reduce((n, i) => n + i.quantity, 0)
  return (
    <article className={`kds-ticket${fresh ? ' fresh' : ''}`} data-level={level} aria-label={`${place}, round ${ticket.round_no}`}>
      <header>
        <div className="top">
          <h3>{place}</h3>
          <time className="age" title={level === 'late' ? 'Waiting over 20 minutes' : level === 'warn' ? 'Waiting over 10 minutes' : undefined}>
            {cooking ? formatAge(seconds) : ticket.status === 'served' ? 'Served' : 'Ready'}
          </time>
        </div>
        <div className="meta">
          <span>#{ticket.id}</span>
          <span>Round {ticket.round_no}</span>
          <span>
            {count} {count === 1 ? 'item' : 'items'}
          </span>
          <span className="at">{hhmm(ticket.created_at)}</span>
        </div>
      </header>
      {ticket.kitchen_note && (
        <p className="note">
          <small>Kitchen note</small>
          {ticket.kitchen_note}
        </p>
      )}
      <ul>
        {ticket.items.map((i, k) => (
          <li key={`${i.dish_id}-${k}`}>
            <span className="qty">{i.quantity}</span>
            <span className="name">
              <i className={`diet ${i.diet || ''}`} role="img" aria-label={DIET_LABEL[i.diet] || 'Diet not set'} />
              {i.name}
            </span>
            {i.note && <span className="req">{i.note}</span>}
          </li>
        ))}
      </ul>
      <label className="stage">
        <span>Status</span>
        <select value={ticket.status} onChange={(e) => onMove(ticket.id, e.target.value)} aria-label={`Status of ${place}, round ${ticket.round_no}`}>
          {STAGES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </article>
  )
}

export default memo(Ticket)
