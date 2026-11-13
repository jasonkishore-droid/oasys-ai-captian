// The order popup for the Studio version, which has no screen to draw the cards on.
// Same stages and buttons as the cards on the tablet's screen (three/TabletBot3D.jsx):
//   pending          a round, waiting for the guest's yes (it then goes on the tab and to the kitchen)
//   added            the round was sent to the kitchen; the tab stays open
//   tab              the open tab so far: Close tab & pay, or keep it open
//   payment          closing the tab: cash, UPI or card, then it is billed and paid
//   placed           paid; offer an e-receipt (email box)
//   receipt_confirm  "Send e-receipt to …?": nothing is sent until Yes
//   receipt_sent     e-receipt sent
//   rating           "How was your meal?": 1-5 stars, then what they liked / what could be better (rate_meal)
//   rating_thanks    saved; on 1-2 stars, offer to call a manager
//   cancelled, problem
import { useEffect, useState } from 'react'
import UpiPopup from './UpiPopup.jsx'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const row = { display: 'flex', justifyContent: 'space-between', gap: 12, fontVariantNumeric: 'tabular-nums' }
const danger = 'var(--danger, #c8392b)'
const TAG_LABELS = { food: 'Food', service: 'Service', speed: 'Speed', value: 'Value', ambience: 'Ambience', cleanliness: 'Cleanliness' }

// the item lines, then subtotal / tax and the total
function Items({ order, totalLabel = 'Total', prices = true }) {
  return (
    <div style={{ margin: '8px 0', display: 'grid', gap: 4, textAlign: 'left' }}>
      {(order.lines || []).map((l, i) => (
        <div key={`${l.dish_id}-${i}`}>
          <div style={row}>
            <span>{l.quantity} × {l.name}</span>
            {prices && <span>{rupees(l.line_total)}</span>}
          </div>
          {/* a special request for the kitchen, e.g. "less oil" */}
          {l.note && <div style={{ fontSize: '0.85em', fontStyle: 'italic', opacity: 0.75, paddingLeft: 16 }}>↳ {l.note}</div>}
        </div>
      ))}
      {order.kitchen_note && (
        <div style={{ fontSize: '0.85em', fontStyle: 'italic', opacity: 0.75 }}>Kitchen note: {order.kitchen_note}</div>
      )}
      {prices && (order.tax > 0 || order.service_charge > 0) && (
        <div style={{ ...row, opacity: 0.75, borderTop: '1px dashed currentColor', paddingTop: 4 }}>
          <span>Subtotal</span><span>{rupees(order.subtotal)}</span>
        </div>
      )}
      {prices && order.service_charge > 0 && (
        <div style={{ ...row, opacity: 0.75 }}><span>Service charge</span><span>{rupees(order.service_charge)}</span></div>
      )}
      {prices && order.tax > 0 && (
        <div style={{ ...row, opacity: 0.75 }}><span>Tax ({order.tax_rate}%)</span><span>{rupees(order.tax)}</span></div>
      )}
      {prices && (
        <div style={{ ...row, fontWeight: 700, borderTop: '1px solid currentColor', paddingTop: 4 }}>
          <span>{totalLabel}</span><span>{rupees(order.total)}</span>
        </div>
      )}
    </div>
  )
}

// the payment buttons are icons; hovering one shows its name
const iconProps = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
const PAY_ICON = {
  cash: (
    <svg {...iconProps}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.8" />
      <path d="M6 9.5v.01M18 14.5v.01" strokeWidth="2.4" />
    </svg>
  ),
  upi: (
    <svg {...iconProps}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v.01M14 20h3M20 17v4" />
    </svg>
  ),
  card: (
    <svg {...iconProps}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20M6 15h4" />
    </svg>
  ),
}

// onAction(tool, args) runs a Greeny ordering tool (same as the guest saying it)
export default function OrderCard({ order, onAction, onClose, onBack }) {
  const [email, setEmail] = useState(order.email || '')
  const [busy, setBusy] = useState(false)
  const [qr, setQr] = useState(false) // the UPI "scan to pay" pop-up
  useEffect(() => { setEmail(order.email || ''); setBusy(false); setQr(false) }, [order])
  const typed = email.trim()
  const emailBad = typed !== '' && !EMAIL_RE.test(typed)
  const act = (tool, args) => { setBusy(true); onAction(tool, args) }
  const where = order.table ? ` · ${order.table}` : ''
  const dismiss = <button className="btn sm" style={{ marginTop: 8 }} onClick={onClose}>Dismiss</button>

  if (order.stage === 'cancelled') {
    return (
      <div className="note surface order-note" role="status" aria-label="Round cancelled">
        <strong>Round cancelled</strong>
        <p>Nothing was sent to the kitchen.</p>
        {dismiss}
      </div>
    )
  }

  if (order.stage === 'problem') {
    return (
      <div className="note surface order-note" role="alert" aria-label="Order needs a change">
        <strong>Order needs a change</strong>
        {(order.problems || []).map((p) => <p key={p}>{p}</p>)}
        {dismiss}
      </div>
    )
  }

  if (order.stage === 'added') {
    return (
      <div className="note surface order-note" role="status" aria-label="Sent to the kitchen">
        <strong>✓ Sent to the kitchen</strong>
        <p style={{ opacity: 0.7 }}>Round {order.round || 1}{where}</p>
        <Items order={order} prices={false} />
        <div style={{ ...row, fontWeight: 700, borderTop: '1px solid currentColor', paddingTop: 4, marginBottom: 8 }}>
          <span>Tab so far</span><span>{rupees(order.tab_total)}</span>
        </div>
        <p>Order more anytime. Say “close the tab” to pay.</p>
        <div className="note-actions">
          <button className="btn sm" disabled={busy} onClick={() => act('view_tab', {})}>See tab</button>
          <button className="btn sm" onClick={onClose}>Dismiss</button>
        </div>
      </div>
    )
  }

  if (order.stage === 'tab') {
    const n = order.rounds || 0
    return (
      <div className="note surface order-note" role="dialog" aria-label="Your tab">
        <strong>Your tab{where} · {n} round{n === 1 ? '' : 's'}</strong>
        <Items order={order} totalLabel="So far" />
        <p>The tab stays open while you eat.</p>
        <div className="note-actions">
          <button className="btn primary sm" disabled={busy} onClick={() => act('close_tab', {})}>{busy ? 'Opening…' : 'Close tab & pay'}</button>
          <button className="btn sm" onClick={onClose}>Keep open</button>
        </div>
      </div>
    )
  }

  if (order.stage === 'payment') {
    // Cash and Card close the tab at once; UPI first shows the QR to scan (and closes once they say they have paid)
    const pay = (label, method) => (
      <button
        key={method}
        data-method={method}
        className="btn primary sm pay-btn"
        aria-label={`Pay by ${label}`}
        disabled={busy}
        onClick={() => (method === 'upi' ? setQr(true) : act('close_tab', { payment_method: method }))}
      >
        {PAY_ICON[method]}
        <span className="pay-tip" role="tooltip">{label}</span>
      </button>
    )
    return (
      <div className="note surface order-note" role="alertdialog" aria-label="Close tab and pay">
        <strong>Close tab · How will you pay?</strong>
        <Items order={order} />
        <p>Say “cash”, “UPI” or “card”, or tap one.</p>
        <div className="note-actions">{busy && !qr ? <span>Paying…</span> : [pay('Cash', 'cash'), pay('UPI', 'upi'), pay('Card', 'card')]}</div>
        {qr && (
          <UpiPopup
            amount={order.total}
            note={`${order.table ? `Table ${order.table} ` : ''}tab`.trim()}
            busy={busy}
            onBack={() => setQr(false)}
            onPaid={() => act('close_tab', { payment_method: 'upi' })}
          />
        )}
      </div>
    )
  }

  if (order.stage === 'placed') {
    return (
      <div className="note surface order-note receipt-card" role="dialog" aria-label="Paid">
        <strong>✓ Paid · tab closed · {order.bill_no}</strong>
        <p className="rc-total">
          Total {rupees(order.total)}
          {where}
        </p>
        <form
          className="rc-form"
          onSubmit={(e) => { e.preventDefault(); if (typed && !emailBad) act('set_receipt_email', { email: typed }) }}
        >
          <label htmlFor="oasys-receipt-email">Want an e-receipt?</label>
          <input
            id="oasys-receipt-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={emailBad}
            style={emailBad ? { borderColor: danger } : undefined}
          />
          {emailBad && <span className="rc-error">That doesn’t look like an email address.</span>}
          {order.error && <span className="rc-error" title={order.error}>{order.error}</span>}
          {order.printed ? (
            <span className="rc-done">✓ Paper receipt printed</span>
          ) : (
            <button className="btn sm" type="button" disabled={busy} onClick={() => act('print_receipt', { guest_asked: true })}>
              Print paper receipt
            </button>
          )}
          <div className="note-actions rc-actions">
            <button className="btn primary sm rc-next" type="submit" disabled={!typed || emailBad || busy}>Next</button>
            <button className="btn sm" type="button" onClick={onClose}>‹ Go back</button>
            <button className="btn sm" type="button" disabled={busy} onClick={() => act('rate_meal', {})}>No thanks</button>
          </div>
        </form>
      </div>
    )
  }

  if (order.stage === 'receipt_confirm') {
    return (
      <div className="note surface order-note" role="alertdialog" aria-label="Confirm e-receipt email">
        <strong>Send e-receipt for {order.bill_no} to:</strong>
        <p style={{ fontSize: 18, fontWeight: 700, wordBreak: 'break-all', margin: '8px 0' }}>{order.email}</p>
        <p>Is this address right? Say “yes” or tap below.</p>
        <div className="note-actions">
          <button className="btn primary sm" disabled={busy} onClick={() => act('send_receipt', { confirm: true })}>
            {busy ? 'Sending…' : 'Yes, send'}
          </button>
          <button className="btn sm" disabled={busy} onClick={() => act('send_receipt', { confirm: false })}>Change</button>
        </div>
      </div>
    )
  }

  if (order.stage === 'receipt_sent') {
    return (
      <div className="note surface order-note" role="status" aria-label="E-receipt sent">
        <strong>✓ E-receipt sent · {order.bill_no}</strong>
        <p>Sent to {order.email}</p>
        <button className="btn sm" style={{ marginTop: 8 }} disabled={busy} onClick={() => act('rate_meal', {})}>Done</button>
      </div>
    )
  }

  if (order.stage === 'rating') {
    const stars = order.rating || 0
    const tags = new Set(order.tags || [])
    // the card's taps don't wait on the server, so they don't grey it out
    const pick = (args) => onAction('rating_pick', args)
    return (
      <div className="note surface order-note" role="dialog" aria-label="Rate your meal">
        <strong>How was your meal?</strong>
        <div role="radiogroup" aria-label="Rating" style={{ display: 'flex', gap: 4, margin: '8px 0', fontSize: 30, lineHeight: 1 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={stars === n}
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              onClick={() => pick({ rating: n })}
              style={{ background: 'none', border: 0, padding: 2, cursor: 'pointer', font: 'inherit', color: n <= stars ? '#f5b301' : 'currentColor', opacity: n <= stars ? 1 : 0.4 }}
            >
              {n <= stars ? '★' : '☆'}
            </button>
          ))}
        </div>
        {stars > 0 && (
          <>
            <p style={{ margin: '4px 0' }}>{stars >= 4 ? 'What did you like?' : 'What could be better?'}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {Object.entries(TAG_LABELS).map(([tag, label]) => (
                <button key={tag} className={`btn sm${tags.has(tag) ? ' primary' : ''}`} aria-pressed={tags.has(tag)} onClick={() => pick({ tag })}>
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
        {order.error && <p style={{ color: danger }}>{order.error}</p>}
        <p style={{ opacity: 0.7 }}>Tap the stars, or just tell me. Anything to add? Say it out loud.</p>
        <div className="note-actions">
          <button className="btn primary sm" disabled={!stars || busy} onClick={() => act('rate_meal', { rating: stars, via: 'tap' })}>
            {busy ? 'Saving…' : 'Submit'}
          </button>
          <button className="btn sm" onClick={onClose}>Skip</button>
        </div>
      </div>
    )
  }

  if (order.stage === 'rating_thanks') {
    const low = order.rating <= 2
    return (
      <div className="note surface order-note" role="status" aria-label="Thank you">
        <strong>{low ? 'Sorry it wasn’t better' : 'Thank you!'}</strong>
        <p>{low ? 'Thank you for telling us. A manager can come over to put it right.' : `You rated us ${order.rating} of 5. Hope to see you again soon.`}</p>
        {order.manager_called && <p>✓ A manager has been called to your table.</p>}
        {order.error && <p style={{ color: danger }}>{order.error}</p>}
        <div className="note-actions">
          {low && !order.manager_called && (
            <button className="btn primary sm" disabled={busy} onClick={() => act('call_waiter', { reason: 'other', note: `Guest rated the meal ${order.rating}/5 and would like a manager` })}>
              {busy ? 'Calling…' : 'Call a manager'}
            </button>
          )}
          <button className="btn sm" onClick={onClose}>Close</button>
        </div>
      </div>
    )
  }

  // pending: a round waiting for the guest's yes
  return (
    <div className="note surface order-note" role="alertdialog" aria-label="Confirm round">
      <strong>{order.round ? `Round ${order.round} · Confirm` : 'Confirm order'}{where}</strong>
      <Items order={order} totalLabel="This round" />
      {order.tab_total > 0 && (
        <div style={{ ...row, opacity: 0.7, marginBottom: 6 }}><span>Tab so far</span><span>{rupees(order.tab_total)}</span></div>
      )}
      {(order.problems || []).map((p) => <p key={p} style={{ color: danger }}>{p}</p>)}
      <p>Say “yes” or tap Confirm. It goes on your tab.</p>
      <div className="note-actions">
        {/* back to the menu with the dishes still in the order, to change them: nothing is cancelled or said */}
        {onBack && (
          <button className="btn sm" disabled={busy} onClick={onBack}>
            ‹ Go back
          </button>
        )}
        <button className="btn primary sm" disabled={busy} onClick={() => act('confirm_order', { confirm: true })}>
          {busy ? 'Sending…' : 'Confirm'}
        </button>
        <button className="btn sm" disabled={busy} onClick={() => act('confirm_order', { confirm: false })}>Cancel</button>
      </div>
    </div>
  )
}
