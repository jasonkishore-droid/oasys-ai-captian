import { memo } from 'react'
import { ageSeconds, formatAge } from './age.js'
import { useNow, useWaiterName } from './hooks.js'

// what the guest asked for (the reasons the call_waiter tool and the tablet button use)
const REASON = {
  help: ['Needs help', 'The guest would like someone to come over'],
  water: ['Water', 'Drinking water for the table'],
  bill: ['Bill, please', 'Ready to pay'],
  cutlery: ['Cutlery', 'Spoons, forks or napkins'],
  clean: ['Clean the table', 'The table needs wiping or clearing'],
  other: ['Something else', 'See the note'],
}

// how long a call may wait before it turns amber and then red
const WARN_S = 60
const LATE_S = 180
const SUFFIXES = ['anna', 'akka', 'sir', 'madam']

// "On duty": the waiter saves their name (and a suffix) once on this device. "On my way" sends it with the call,
// so the guest's tablet and Greeny can say who is coming.
function OnDuty({ duty }) {
  const { name, suffix, full, setName, setSuffix } = duty
  return (
    <section className="on-duty" aria-label="On duty">
      <div className="od-head">
        <strong>On duty</strong>
        <span className={`od-saved${full ? ' on' : ''}`}>{full ? '✓ Saved on this device' : 'Not set'}</span>
      </div>
      <div className="od-fields">
        <label>
          <span>Your name</span>
          <input value={name} maxLength={24} placeholder="e.g. Ravi" autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>Suffix</span>
          <input value={suffix} maxLength={14} placeholder="e.g. anna" autoComplete="off" onChange={(e) => setSuffix(e.target.value)} />
        </label>
      </div>
      <div className="od-chips" role="group" aria-label="Quick suffixes">
        {SUFFIXES.map((s) => (
          <button key={s} type="button" aria-pressed={suffix.trim().toLowerCase() === s} onClick={() => setSuffix(suffix.trim().toLowerCase() === s ? '' : s)}>
            {s}
          </button>
        ))}
      </div>
      <p className="od-preview">
        {full ? (
          <>
            The guest will hear: <em>“{full} is on the way.”</em>
          </>
        ) : (
          'Enter your name so the guest knows who is coming.'
        )}
      </p>
    </section>
  )
}

const Call = memo(function Call({ call, fresh, canAnswer, by, onAck, onDone }) {
  const now = useNow()
  const seconds = ageSeconds(call.created_at, now)
  const coming = call.status === 'acknowledged'
  const level = coming ? 'coming' : seconds >= LATE_S ? 'late' : seconds >= WARN_S ? 'warn' : 'new'
  const [name, hint] = REASON[call.reason] || REASON.other
  const who = call.acknowledged_by && call.acknowledged_by !== 'Kitchen screen' ? call.acknowledged_by : ''
  return (
    <article className={`wc${fresh ? ' fresh' : ''}`} data-level={level} aria-label={`Table ${call.table_no} is calling: ${name}`}>
      <div className="wc-table">
        <small>Table</small>
        <strong style={{ fontSize: String(call.table_no).length <= 2 ? 34 : String(call.table_no).length === 3 ? 28 : 21 }}>{call.table_no}</strong>
      </div>
      <div className="wc-main">
        <div className="wc-top">
          <h3>{name}</h3>
          <time>{formatAge(seconds)}</time>
        </div>
        <p className="wc-hint">{hint}</p>
        <div className="wc-chips">
          {call.note && <span className="wc-note">“{call.note}”</span>}
          {call.repeats > 0 && <span className="wc-again">Called again ×{call.repeats}</span>}
          <span className="wc-source">{call.source === 'voice' ? 'By voice' : 'By button'}</span>
        </div>
        <p className="wc-state">{coming ? `${who || 'A waiter'} is on the way` : 'Waiting for a waiter'}</p>
      </div>
      <div className="wc-action">
        {coming ? (
          <button type="button" className="done" onClick={() => onDone(call.id)}>
            Done
          </button>
        ) : (
          <button type="button" className="go" disabled={!canAnswer} title={canAnswer ? undefined : 'Enter your name above first'} onClick={() => onAck(call.id, by)}>
            On my way
          </button>
        )}
        {!coming && !canAnswer && <small>Enter your name first</small>}
      </div>
    </article>
  )
})

export default function WaiterCalls({ calls, loaded, fresh, onAck, onDone }) {
  const duty = useWaiterName()
  return (
    <div className="wc-page">
      <OnDuty duty={duty} />
      {!loaded ? (
        <p className="kds-empty">Loading waiter calls…</p>
      ) : !calls.length ? (
        <p className="kds-empty">No tables are calling. A call appears here the moment a guest taps Call waiter.</p>
      ) : (
        <div className="wc-list">
          {calls.map((c) => (
            <Call key={c.id} call={c} fresh={fresh.has(c.id)} canAnswer={!!duty.full} by={duty.full} onAck={onAck} onDone={onDone} />
          ))}
        </div>
      )}
    </div>
  )
}
