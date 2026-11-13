import { useEffect, useState } from 'react'
import OrderCard from './OrderCard.jsx'

const OUT_MS = 380

// The Studio version's order card: it slides in on the left while the head glides to the
// right (the .order-open class on .app), and slides out again before it goes away.
export default function StudioOrder({ order, onAction, onClose, onOpen, onBack, inMenu = false }) {
  const [shown, setShown] = useState(order)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (order) {
      setShown(order)
      setLeaving(false)
      return undefined
    }
    if (!shown) return undefined
    setLeaving(true)
    const t = setTimeout(() => (setShown(null), setLeaving(false)), OUT_MS)
    return () => clearTimeout(t)
  }, [order]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onOpen?.(!!order), [order, onOpen])
  if (!shown) return null
  return (
    <div className={`studio-order${leaving ? ' leaving' : ''}${inMenu ? ' in-menu' : ''}`}>
      <OrderCard order={shown} onAction={onAction} onClose={onClose} onBack={onBack} />
    </div>
  )
}
