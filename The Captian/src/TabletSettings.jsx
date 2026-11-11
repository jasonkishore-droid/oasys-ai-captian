import { useEffect, useRef, useState } from 'react'
import Icon from './icons.jsx'
import { checkPrinter, printTestPage } from './printerTest.js'
import GestureRows from './GestureSettings.jsx'

const VERSIONS = [
  { id: 'tablet', label: 'Tablet', hint: 'The tablet on its stand, orders on its screen' },
  { id: 'studio', label: 'Studio', hint: 'Greeny’s ceramic head, orders as popups' },
]

const step = (v, max) => Math.round(Math.max(0.4, Math.min(max, v)) * 100) / 100

// The gear on the screen-only view: pick which version of Greeny is shown, and how big.
// Printer: test the connection, or print a test page; the result shows under the buttons
function PrinterCheck() {
  const [state, setState] = useState(null) // null | { ok: true | false | null, text }
  const busy = state?.ok === null
  const run = async (test) => {
    setState({ ok: null, text: 'Checking…' })
    setState(await test((text) => setState({ ok: null, text })))
  }
  const kind = state?.ok === true ? 'ok' : state?.ok === false ? 'bad' : 'wait'
  return (
    <>
      <div className="tablet-menu-title tablet-size-title">Printer</div>
      <div className="tablet-printer">
        <button type="button" disabled={busy} onClick={() => run(checkPrinter)}>Test connection</button>
        <button type="button" disabled={busy} onClick={() => run(printTestPage)}>Print test page</button>
      </div>
      {state && (
        <p className={`tablet-printer-status ${kind}`} role="status">
          {state.text}
        </p>
      )}
    </>
  )
}

export default function TabletSettings({ version, onVersion, size = 1, maxSize = 1, onSize, table = '', onTable, printer = false, gestures = null }) {
  const [open, setOpen] = useState(false)
  const [gesturesOpen, setGesturesOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => !box.current?.contains(e.target) && setOpen(false)
    const esc = (e) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false))
    document.addEventListener('pointerdown', away)
    window.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', esc, true)
    }
  }, [open])

  return (
    <div className="tablet-settings" ref={box}>
      <button
        className="tablet-inventory tablet-gear"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Settings"
        title="Settings"
      >
        <Icon name="gear" size={18} />
      </button>
      {open && (
        <div className="tablet-menu" role="radiogroup" aria-label="Version">
          <div className="tablet-menu-title">Version</div>
          {VERSIONS.map((v) => (
            <button
              key={v.id}
              role="radio"
              aria-checked={version === v.id}
              className={version === v.id ? 'on' : ''}
              onClick={() => {
                onVersion(v.id)
                setOpen(false)
              }}
            >
              <span className="tablet-menu-check" aria-hidden="true" />
              <span>
                <strong>{v.label}</strong>
                <small>{v.hint}</small>
              </span>
            </button>
          ))}
          <label className="tablet-menu-title tablet-size-title" htmlFor="tablet-size">
            Size <span>{Math.round(size * 100)}%</span>
          </label>
          <div className="tablet-size">
            <button type="button" aria-label="Smaller" onClick={() => onSize(step(size - 0.05, maxSize))}>−</button>
            <input
              id="tablet-size"
              type="range"
              min={0.4}
              max={maxSize}
              step={0.05}
              value={size}
              onChange={(e) => onSize(Number(e.target.value))}
            />
            <button type="button" aria-label="Bigger" onClick={() => onSize(step(size + 0.05, maxSize))}>+</button>
          </div>
          {onTable && (
            <>
              <label className="tablet-menu-title tablet-size-title" htmlFor="tablet-table">Table</label>
              <input
                id="tablet-table"
                className="tablet-table"
                value={table}
                maxLength={20}
                placeholder="e.g. T4"
                onChange={(e) => onTable(e.target.value.trimStart())}
              />
            </>
          )}
          {gestures && (
            <>
              <div className="tablet-menu-title tablet-size-title">
                Hand gestures
                <label className="tablet-gesture-on">
                  <input type="checkbox" checked={gestures.on} onChange={(e) => gestures.onToggle(e.target.checked)} /> {gestures.on ? 'On' : 'Off'}
                </label>
              </div>
              {gestures.on && (
                <button type="button" className="tablet-size-reset" aria-expanded={gesturesOpen} onClick={() => setGesturesOpen((o) => !o)}>
                  {gesturesOpen ? 'Hide gestures' : 'Choose what each gesture means'}
                </button>
              )}
              {gestures.on && gesturesOpen && (
                <div className="tablet-gestures">
                  <GestureRows saved={gestures.map} onChange={gestures.onMap} rowClass="tablet-gesture" selectClass="tablet-gesture-select" />
                </div>
              )}
            </>
          )}
          {printer && <PrinterCheck />}
          {size !== 1 && (
            <button type="button" className="tablet-size-reset" onClick={() => onSize(1)}>Reset size</button>
          )}
        </div>
      )}
    </div>
  )
}
