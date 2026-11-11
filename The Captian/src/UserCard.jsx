import { useEffect } from 'react'
import ProfileCard from './ProfileCard.jsx'
import { initialTile } from './UsersPanel.jsx'

// One person's card, popped up in front of everything. Opened by the show_user
// voice tool ("show me Sam"); closed with the button, Escape, or a click outside.
export default function UserCard({ person, here, accent, onClose }) {
  useEffect(() => {
    const on = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])

  const saved = [person.face && 'Face', person.voice && 'Voice'].filter(Boolean).join(' · ')
  return (
    <div className="user-pop" role="dialog" aria-label={`${person.name}'s card`} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <ProfileCard
          name={person.name}
          title={saved ? `${saved} saved` : 'Known person'}
          handle={person.name.toLowerCase().replace(/\s+/g, '')}
          status={here ? 'Here now' : 'Not in view'}
          statusColor={here ? '#22c55e' : '#8a8a93'}
          avatarUrl={person.thumbnail || initialTile(person.name)}
          backdropColor={accent}
          contactText="Close"
          contactIcon={false}
          onContactClick={onClose}
          holo={0.8}
          glare={0.5}
          tiltStrength={12}
          parallax={8}
          radius={18}
          intro
          theme="dark"
        />
      </div>
    </div>
  )
}
