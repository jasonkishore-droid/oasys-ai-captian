// Hand gestures the camera can read (MediaPipe's gesture recogniser), and what each one means.
// The meaning of each gesture is a setting (Settings > Gestures): 'yes', 'no' or 'off'.

// `id` is the recogniser's category name
export const GESTURES = [
  { id: 'Thumb_Up', label: 'Thumbs up', emoji: '👍' },
  { id: 'Thumb_Down', label: 'Thumbs down', emoji: '👎' },
  { id: 'Victory', label: 'Peace sign', emoji: '✌️' },
  { id: 'Open_Palm', label: 'Open palm', emoji: '✋' },
  { id: 'Closed_Fist', label: 'Fist', emoji: '✊' },
  { id: 'Pointing_Up', label: 'Pointing up', emoji: '☝️' },
  { id: 'ILoveYou', label: 'Love-you sign', emoji: '🤟' },
]

export const GESTURE_ACTIONS = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
  { id: 'off', label: 'Off' },
]

export const DEFAULT_GESTURE_MAP = {
  Thumb_Up: 'yes',
  Thumb_Down: 'no',
  Victory: 'off',
  Open_Palm: 'off',
  Closed_Fist: 'off',
  Pointing_Up: 'off',
  ILoveYou: 'off',
}

// The saved setting over the defaults; anything unknown counts as off.
export function gestureMap(saved) {
  const map = { ...DEFAULT_GESTURE_MAP }
  for (const g of GESTURES) {
    const a = saved?.[g.id]
    if (a === 'yes' || a === 'no' || a === 'off') map[g.id] = a
  }
  return map
}

export const gestureInfo = (id) => GESTURES.find((g) => g.id === id) || null

// The gesture to act on in one frame: the most confident one that has a meaning.
// `hands` is the recogniser's result.gestures: one list of categories per hand.
export function pickGesture(hands, map, minScore = 0.6) {
  let best = null
  for (const hand of hands || []) {
    const c = hand?.[0]
    if (!c || c.score < minScore) continue
    const action = map[c.categoryName]
    if (action !== 'yes' && action !== 'no') continue
    if (!best || c.score > best.score) best = { id: c.categoryName, action, score: c.score }
  }
  return best
}

// A gesture counts once it has been held steadily for `holdMs`; it then has to be taken
// away (for `releaseMs`) before any gesture counts again, so one thumbs-up is one answer.
// feed(id | null, now) returns { id, since, fired } for the gesture being held (or null),
// with `fire: true` on the one frame it goes off.
export function createHold({ holdMs = 700, releaseMs = 500 } = {}) {
  let id = null
  let since = 0
  let fired = false
  let goneAt = 0
  let latched = false // a gesture went off and the hand has not been lowered yet
  return {
    feed(next, now) {
      if (!next) {
        if (!goneAt) goneAt = now
        // a frame or two without the gesture is forgiven (the recogniser flickers)
        if (now - goneAt >= releaseMs) {
          latched = false
          id = null
          fired = false
        }
        return id && now - goneAt < 250 ? { id, since, fired, fire: false } : null
      }
      goneAt = 0
      if (next !== id) {
        id = next
        since = now
        fired = false
      }
      if (latched) return { id, since, fired: true, fire: false }
      if (!fired && now - since >= holdMs) {
        fired = true
        latched = true
        return { id, since, fired, fire: true }
      }
      return { id, since, fired, fire: false }
    },
    reset() {
      id = null
      fired = false
      latched = false
      goneAt = 0
    },
  }
}
