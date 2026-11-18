import { useEffect, useRef, useState } from 'react'

// The "i" button on the tablet's top bar: the inventory and printer status badges live inside it,
// so the bar stays tidy. They load (and the printer is polled) only while it is open.
export default function TabletInfo({ children }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)

  useEffect(() => {
    if (!open) return
    const away = (e) => box.current && !box.current.contains(e.target) && setOpen(false)
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', away)
    window.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="tablet-settings" ref={box}>
      <button
        type="button"
        className="tablet-inventory tablet-gear"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Connections: inventory and printer"
        title="Inventory and printer"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" />
          <path d="M12 11v6" />
          <circle cx="12" cy="7.5" r="0.6" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="tablet-info-panel" role="group" aria-label="Connections">
          {children}
        </div>
      )}
    </div>
  )
}
