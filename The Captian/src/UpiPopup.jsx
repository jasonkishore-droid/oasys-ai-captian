import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'

const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

// the standard upi://pay link every UPI app (GPay, PhonePe, Paytm, BHIM …) reads: payee, exact amount and a note
function upiLink({ upi_id, payee_name, restaurant }, amount, note) {
  const q = new URLSearchParams({ pa: upi_id, pn: (payee_name || restaurant || '').slice(0, 50), cu: 'INR' })
  if (amount > 0) q.set('am', Number(amount).toFixed(2))
  if (note) q.set('tn', note.slice(0, 80))
  return `upi://pay?${q.toString().replace(/\+/g, '%20').replace(/%40/g, '@')}` // keep "@" literal: some UPI apps reject "%40"
}

// the QR as crisp SVG squares (no blur at any size)
function qrPath(text) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  let d = ''
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(y, x)) d += `M${x} ${y}h1v1h-1z`
  return { n, d }
}

// "Scan to pay": a pop-up over the whole screen with the QR for this amount. The guest scans it and pays in
// their own UPI app, then taps "I've paid" (which closes the tab as a UPI payment).
export default function UpiPopup({ amount, note, busy, onBack, onPaid }) {
  const [cfg, setCfg] = useState(null) // null while loading | { enabled, upi_id, payee_name, restaurant } | { error }
  useEffect(() => {
    let live = true
    fetch('/api/oasys/upi')
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`))))
      .then((b) => live && setCfg(b))
      .catch((e) => live && setCfg({ error: e.message }))
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && !busy && onBack()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onBack, busy])

  const link = cfg?.enabled ? upiLink(cfg, amount, note) : ''
  const qr = useMemo(() => {
    try {
      return link ? qrPath(link) : null
    } catch {
      return null
    }
  }, [link])

  return createPortal(
    <div className="upi-pop" role="dialog" aria-modal="true" aria-label="Scan to pay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onBack()}>
      <div className="upi-card">
        <strong>Scan to pay</strong>
        <div className="upi-amount">{rupees(amount)}</div>
        {!cfg && <p className="upi-msg">Loading…</p>}
        {cfg?.error && <p className="upi-msg upi-bad">The payment QR could not be loaded: {cfg.error}</p>}
        {cfg && !cfg.error && !cfg.enabled && <p className="upi-msg upi-bad">UPI payments are not set up yet. Please ask the staff, or pay another way.</p>}
        {qr && (
          <>
            <svg className="upi-qr" viewBox={`-2 -2 ${qr.n + 4} ${qr.n + 4}`} role="img" aria-label={`UPI QR code for ${rupees(amount)}`} shapeRendering="crispEdges">
              <rect x="-2" y="-2" width={qr.n + 4} height={qr.n + 4} fill="#fff" />
              <path d={qr.d} fill="#000" />
            </svg>
            <p className="upi-msg">Open any UPI app, scan this code and pay.{cfg.payee_name ? ` Paying ${cfg.payee_name}.` : ''}</p>
          </>
        )}
        <div className="upi-actions">
          <button type="button" className="btn sm" disabled={busy} onClick={onBack}>
            ‹ Back
          </button>
          {qr && (
            <button type="button" className="btn primary sm" disabled={busy} onClick={onPaid}>
              {busy ? 'Closing tab…' : 'I’ve paid'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
