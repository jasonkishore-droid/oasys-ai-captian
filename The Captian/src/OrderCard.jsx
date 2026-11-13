// The order popup for the Studio version, which has no screen to draw the cards on.
// Same stages and buttons as the cards on the tablet's screen (three/TabletBot3D.jsx):
//   pending          a round, waiting for the guest's yes (it then goes on the tab and to the kitchen)
//   added            the round was sent to the kitchen; the tab stays open
//   tab              the open tab so far: Close tab & pay, or keep it open
//   payment          closing the tab: cash, UPI or card, then it is billed and paid
//   placed           paid; offer an e-receipt (email box)
//   receipt_confirm  "Send e-receipt to …?": nothing is sent until Yes
//   receipt_sent     done
//   cancelled, problem
import { useEffect, useState } from 'react'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const row = { display: 'flex', justifyContent: 'space-between', gap: 12, fontVariantNumeric: 'tabular-nums' }
const danger = 'var(--danger, #c8392b)'

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

// onAction(tool, args) runs a Greeny ordering tool (same as the guest saying it)
export default function OrderCard({ order, onAction, onClose }) {
  const [email, setEmail] = useState(order.email || '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setEmail(order.email || ''); setBusy(false) }, [order])
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
    const pay = (label, method) => (
      <button key={method} className="btn primary sm" disabled={busy} onClick={() => act('close_tab', { payment_method: method })}>
        {label}
      </button>
    )
    return (
      <div className="note surface order-note" role="alertdialog" aria-label="Close tab and pay">
        <strong>Close tab · How will you pay?</strong>
        <Items order={order} />
        <p>Say “cash”, “UPI” or “card”, or tap one.</p>
        <div className="note-actions">{busy ? <span>Paying…</span> : [pay('Cash', 'cash'), pay('UPI', 'upi'), pay('Card', 'card')]}</div>
      </div>
    )
  }

  if (order.stage === 'placed') {
    return (
      <div className="note surface order-note" role="dialog" aria-label="Paid">
        <strong>✓ Paid · tab closed · {order.bill_no}</strong>
        <p>
          Total {rupees(order.total)}
          {where}
        </p>
        <form
          onSubmit={(e) => { e.preventDefault(); if (typed && !emailBad) act('set_receipt_email', { email: typed }) }}
          style={{ display: 'grid', gap: 4, margin: '8px 0 0', fontSize: 13 }}
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
            style={{
              padding: '8px 10px', borderRadius: 10, font: 'inherit', color: 'inherit', background: 'transparent',
              border: `1px solid ${emailBad ? danger : 'currentColor'}`,
            }}
          />
          {emailBad && <span style={{ color: danger }}>That doesn’t look like an email address.</span>}
          {order.error && <span style={{ color: danger }}>{order.error}</span>}
          {order.printed ? (
            <span>✓ Paper receipt printed</span>
          ) : (
            <button className="btn sm" type="button" disabled={busy} onClick={() => act('print_receipt', { guest_asked: true })}>
              Print paper receipt
            </button>
          )}
          <div className="note-actions">
            <button className="btn primary sm" type="submit" disabled={!typed || emailBad || busy}>Next</button>
            <button className="btn sm" type="button" onClick={onClose}>No thanks</button>
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
        {dismiss}
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
        <button className="btn primary sm" disabled={busy} onClick={() => act('confirm_order', { confirm: true })}>
          {busy ? 'Sending…' : 'Confirm'}
        </button>
        <button className="btn sm" disabled={busy} onClick={() => act('confirm_order', { confirm: false })}>Cancel</button>
      </div>
    </div>
  )
}
