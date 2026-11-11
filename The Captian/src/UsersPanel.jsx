import { useEffect, useMemo } from 'react'
import CircularCarousel from './CircularCarousel.jsx'

// Everyone Greeny knows, on a turning wheel at the right edge of the screen.
// Opened by the show_users voice tool; closed with the button, Escape, or
// "hide the users".

// a plain tile with the person's initial, for people who only have a voice saved
export function initialTile(name) {
  const letter = (name.trim()[0] || '?').toUpperCase()
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>` +
    `<rect width='240' height='240' fill='#262626'/>` +
    `<text x='120' y='148' font-family='-apple-system,Segoe UI,Arial,sans-serif' font-size='110' font-weight='600' text-anchor='middle' fill='#a3a3a3'>${letter.replace(/[<&>]/g, '')}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export function usersToItems(faces, voices, hereNames = []) {
  const people = new Map()
  for (const f of faces) {
    const p = people.get(f.name) || { name: f.name, thumbnail: null, face: false, voice: false }
    p.face = true
    p.thumbnail = p.thumbnail || f.thumbnail || null
    people.set(f.name, p)
  }
  for (const v of voices) {
    const p = people.get(v.name) || { name: v.name, thumbnail: null, face: false, voice: false }
    p.voice = true
    people.set(v.name, p)
  }
  return [...people.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({
      src: p.thumbnail || initialTile(p.name),
      alt: p.name,
      title: p.name,
      subtitle: [p.face && 'Face', p.voice && 'Voice', hereNames.includes(p.name) && 'here now'].filter(Boolean).join(' · '),
    }))
}

export default function UsersPanel({ faces, voices, hereNames, onClose }) {
  const items = useMemo(() => usersToItems(faces, voices, hereNames), [faces, voices, hereNames])

  useEffect(() => {
    const on = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])

  return (
    <aside className="users-panel surface" aria-label="Everyone Greeny knows">
      <header>
        <strong>People</strong>
        <span className="muted">{items.length}</span>
        <button className="btn sm" onClick={onClose} aria-label="Close people">
          Close
        </button>
      </header>
      {items.length ? (
        <CircularCarousel
          items={items}
          preset="wheel"
          intro="rise"
          cardWidth={190}
          aspectRatio={1}
          speed={10}
          captions
          fadeColor="#141414"
        />
      ) : (
        <p className="users-empty">Nobody is saved yet. Use Add face to introduce someone.</p>
      )}
    </aside>
  )
}
