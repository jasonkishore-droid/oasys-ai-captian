import { useEffect, useId, useRef, useState } from 'react'
import { VOICES } from './lib/voices.js'
import Icon from './icons.jsx'

// Shows whether the Oasys Bay club app answers (checked whenever the switch is turned on).
function OasysStatus({ enabled }) {
  const [state, setState] = useState(null) // null | { ok, text }
  useEffect(() => {
    if (!enabled) return setState(null)
    let live = true
    setState({ ok: null, text: 'Connecting…' })
    fetch('/api/oasys/ping')
      .then(async (r) => {
        const b = await r.json().catch(() => ({}))
        if (live) setState(r.ok ? { ok: true, text: `Connected to ${b.club || 'Oasys Bay'}` } : { ok: false, text: b.error || `Error ${r.status}` })
      })
      .catch(() => live && setState({ ok: false, text: 'Cannot reach the Oasys Bay app' }))
    return () => { live = false }
  }, [enabled])
  if (!state) return null
  const color = state.ok === true ? 'var(--ok, #1f9d55)' : state.ok === false ? 'var(--danger, #c8392b)' : 'inherit'
  return <p className="field-hint" style={{ color, margin: '-4px 0 8px' }}>{state.ok === true ? '● ' : ''}{state.text}</p>
}

// Prints a test page on the restaurant's Bluetooth printer. The printer is reached from the
// Stock Management app's browser tab, so the job is queued there and we wait to hear how it went.
function PrintTest() {
  const [state, setState] = useState(null) // null | { ok: true | false | null, text }
  const busy = state?.ok === null
  const run = async () => {
    setState({ ok: null, text: 'Sending to the printer…' })
    const call = async (path, method) => {
      const r = await fetch(`/api/oasys/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(b.error || `Error ${r.status}`)
      return b
    }
    try {
      const { job_id } = await call('print-test', 'POST')
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        const job = await call(`print-jobs/${job_id}`, 'GET')
        if (job.status === 'printed') return setState({ ok: true, text: 'Test page printed' })
        if (job.status === 'failed') return setState({ ok: false, text: job.error || 'The printer did not print it' })
        if (job.status === 'printing') setState({ ok: null, text: 'Printing…' })
      }
      setState({ ok: false, text: 'No answer. Open the Stock Management app in a browser tab, sign in and connect the printer there.' })
    } catch (e) {
      setState({ ok: false, text: e.message })
    }
  }
  const color = state?.ok === true ? 'var(--ok, #1f9d55)' : state?.ok === false ? 'var(--danger, #c8392b)' : 'inherit'
  return (
    <>
      <div className="field">
        <span className="field-text">
          <span className="field-label">Receipt printer</span>
          <span className="field-hint">Prints through the printer connected in the Stock Management app.</span>
        </span>
        <button className="btn sm" onClick={run} disabled={busy}>
          {busy ? 'Printing…' : 'Print test page'}
        </button>
      </div>
      {state && <p className="field-hint" role="status" style={{ color, margin: '-4px 0 8px' }}>{state.text}</p>}
    </>
  )
}

function Switch({ label, hint, checked, onChange }) {
  const id = useId()
  return (
    <div className="field">
      <label className="field-text" htmlFor={id}>
        <span className="field-label">{label}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </label>
      <span className="switch">
        <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </span>
    </div>
  )
}

function Slider({ label, hint, value, min, max, step, onChange, format }) {
  const id = useId()
  const p = ((value - min) / (max - min)) * 100
  return (
    <div className="slider">
      <div className="slider-top">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format ? format(value) : value}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--p': `${p}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}

function Select({ label, value, onChange, children }) {
  const id = useId()
  return (
    <div className="field">
      <label className="field-text" htmlFor={id}>
        <span className="field-label">{label}</span>
      </label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </div>
  )
}

const LANGUAGES = ['English', 'Hindi', 'Tamil', 'Telugu', 'Malayalam', 'Kannada', 'Bengali', 'Marathi', 'Gujarati', 'Punjabi', 'Urdu', 'Arabic', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Russian', 'Japanese', 'Korean', 'Chinese (Mandarin)', 'Indonesian', 'Turkish', 'Dutch']
const OTHER = '__other'

// Preferred language: Auto lets it follow whoever is speaking; a set language
// sticks (mishearings don't switch it) until someone asks for another. "Other"
// opens a free-text box for any language not in the list; it is applied on
// Enter or when the box loses focus, since each change restarts voice chat.
function Language({ value, onChange }) {
  const id = useId()
  const preset = value === '' || LANGUAGES.includes(value)
  const [other, setOther] = useState(!preset)
  const [draft, setDraft] = useState(preset ? '' : value)
  const commit = () => {
    const v = draft.trim()
    if (v && v !== value) onChange(v)
  }
  return (
    <>
      <div className="field">
        <label className="field-text" htmlFor={id}>
          <span className="field-label">Language</span>
          <span className="field-hint">
            {value ? `Speaks only ${value} unless you ask it to switch` : 'Answers in whatever language you speak'}
          </span>
        </label>
        <select
          id={id}
          className="select"
          value={other ? OTHER : value}
          onChange={(e) => {
            const v = e.target.value
            if (v === OTHER) {
              setOther(true)
              return
            }
            setOther(false)
            onChange(v)
          }}
        >
          <option value="">Auto (match the speaker)</option>
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
          <option value={OTHER}>Other…</option>
        </select>
      </div>
      {other && (
        <div className="field">
          <label className="field-text" htmlFor={`${id}-other`}>
            <span className="field-label">Other language</span>
          </label>
          <input
            id={`${id}-other`}
            className="text-input"
            type="text"
            maxLength={40}
            placeholder="e.g. Swahili"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
          />
        </div>
      )}
    </>
  )
}

function Color({ label, value, onChange }) {
  const id = useId()
  return (
    <div className="field">
      <label className="field-text" htmlFor={id}>
        <span className="field-label">{label}</span>
      </label>
      <span className="swatch">
        <i style={{ background: value }} />
        {value.toUpperCase()}
        <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
    </div>
  )
}

const TABS = [
  { id: 'character', label: 'Character' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'display', label: 'Display' },
]

const pct = (v) => `${Math.round(v * 100)}%`

export default function SettingsPanel({ settings, set, reset, onClose, anchorRef }) {
  const panelRef = useRef(null)
  const [tab, setTab] = useState('character')
  // the app re-renders constantly; keep the latest onClose in a ref so the
  // effect below runs once and never steals focus from a control
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Move focus in on open, give it back to the opener on close, and close on
  // Escape or a click outside.
  useEffect(() => {
    const anchor = anchorRef?.current
    panelRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && closeRef.current()
    const onDown = (e) => {
      if (!panelRef.current?.contains(e.target) && !anchor?.contains(e.target)) closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
      anchor?.focus()
    }
  }, [anchorRef])

  // arrow keys move between tabs
  const onTabKey = (e) => {
    const i = TABS.findIndex((t) => t.id === tab)
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
    if (next === null) return
    e.preventDefault()
    const t = TABS[(next + TABS.length) % TABS.length]
    setTab(t.id)
    document.getElementById(`tab-${t.id}`)?.focus()
  }

  return (
    <div className="sheet surface" role="dialog" aria-label="Settings" tabIndex={-1} ref={panelRef}>
      <header className="sheet-head">
        <h2>Settings</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close settings">
          <Icon name="x" />
        </button>
      </header>

      <div className="tabs" role="tablist" aria-label="Settings sections" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            className="tab"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="sheet-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'character' && (
          <>
            <Select label="Theme" value={settings.theme} onChange={(v) => set('theme', v)}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">Match system</option>
            </Select>
            <Select label="Voice" value={settings.voice} onChange={(v) => set('voice', v)}>
              <option value="">Default</option>
              {VOICES.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} · {v.style}
                </option>
              ))}
            </Select>
            <Language value={settings.language} onChange={(v) => set('language', v)} />
            <Color label="Eye colour" value={settings.eyeColor} onChange={(v) => set('eyeColor', v)} />
            <Color label="Face colour" value={settings.faceColor} onChange={(v) => set('faceColor', v)} />
          </>
        )}

        {tab === 'tracking' && (
          <>
            <Switch
              label="Camera"
              hint="Turn off to stop the camera completely. Nothing is tracked and the camera light goes out."
              checked={settings.cameraOn}
              onChange={(v) => set('cameraOn', v)}
            />
            <p className="group-title">Detection</p>
            <Switch label="Faces" hint="Lock onto a face (YuNet)" checked={settings.yunet} onChange={(v) => set('yunet', v)} />
            <Switch label="People and objects" hint="Detect with YOLO" checked={settings.yolo} onChange={(v) => set('yolo', v)} />
            <Switch label="People only" hint="Ignore objects" checked={settings.onlyPeople} onChange={(v) => set('onlyPeople', v)} />
            <Switch label="Recognise faces" hint="Needed for it to say who you are" checked={settings.recognize} onChange={(v) => set('recognize', v)} />
            <Switch label="Recognise several people" hint="Finds and names everyone in view" checked={settings.multiFace} onChange={(v) => set('multiFace', v)} />
            <Switch
              label="Use graphics card"
              hint="Faster detection through WebGPU. Reload the page after changing."
              checked={settings.gpu}
              onChange={(v) => set('gpu', v)}
            />

            <p className="group-title">Computer</p>
            <Switch
              label="Let the tablet use the mouse"
              hint="During voice chat it can look at the screen, move and click the mouse, type and open tabs on this computer. Push the mouse into a screen corner to stop it."
              checked={settings.desktopControl}
              onChange={(v) => set('desktopControl', v)}
            />

            <p className="group-title">Oasys Bay</p>
            <Switch
              label="Connect to Oasys Bay"
              hint="It can read the club menu and place orders by voice. Orders are billed straight away and taken out of stock."
              checked={settings.oasysOrdering}
              onChange={(v) => set('oasysOrdering', v)}
            />
            <OasysStatus enabled={settings.oasysOrdering} />
            <PrintTest />

            <p className="group-title">Sensitivity</p>
            <Slider
              label="Objects"
              value={settings.objectConf}
              min={0.15}
              max={0.9}
              step={0.05}
              format={(v) => `≥ ${pct(v)}`}
              onChange={(v) => set('objectConf', v)}
            />
            <Slider
              label="Faces"
              value={settings.faceConf}
              min={0.3}
              max={0.95}
              step={0.05}
              format={(v) => `≥ ${pct(v)}`}
              onChange={(v) => set('faceConf', v)}
            />
          </>
        )}

        {tab === 'display' && (
          <>
            <Switch label="Camera preview" checked={settings.showPreview} onChange={(v) => set('showPreview', v)} />
            <Select label="Camera window" value={settings.previewStyle} onChange={(v) => set('previewStyle', v)}>
              <option value="card">Reflective card</option>
              <option value="plain">Plain video with boxes</option>
            </Select>
            <Switch label="Detection boxes" hint="Outline what it sees on the preview" checked={settings.showBoxes} onChange={(v) => set('showBoxes', v)} />
          </>
        )}
      </div>

      <footer className="sheet-foot">
        <button className="btn sm" onClick={reset}>
          Reset to defaults
        </button>
      </footer>
    </div>
  )
}
