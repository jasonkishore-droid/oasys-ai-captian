import { describe, expect, it } from 'vitest'
import { createHold, gestureMap, pickGesture } from './gestures.js'

describe('gestureMap', () => {
  it('uses the defaults: thumbs up is yes, thumbs down is no', () => {
    const m = gestureMap(undefined)
    expect(m.Thumb_Up).toBe('yes')
    expect(m.Thumb_Down).toBe('no')
    expect(m.Victory).toBe('off')
  })
  it('lets the saved setting win and ignores junk', () => {
    const m = gestureMap({ Victory: 'yes', Thumb_Up: 'off', Open_Palm: 'dance', Wave: 'yes' })
    expect(m.Victory).toBe('yes')
    expect(m.Thumb_Up).toBe('off')
    expect(m.Open_Palm).toBe('off')
    expect(m.Wave).toBeUndefined()
  })
})

describe('pickGesture', () => {
  const map = gestureMap({ Victory: 'yes' })
  const hand = (categoryName, score) => [{ categoryName, score }]
  it('picks the most confident gesture that has a meaning', () => {
    expect(pickGesture([hand('Thumb_Down', 0.7), hand('Victory', 0.9)], map)).toMatchObject({ id: 'Victory', action: 'yes' })
  })
  it('ignores gestures that are off, unsure, or no gesture at all', () => {
    expect(pickGesture([hand('Open_Palm', 0.95)], map)).toBeNull()
    expect(pickGesture([hand('Thumb_Up', 0.4)], map)).toBeNull()
    expect(pickGesture([hand('None', 0.99)], map)).toBeNull()
    expect(pickGesture([], map)).toBeNull()
  })
})

describe('createHold', () => {
  it('fires once after the gesture is held, and not again until it is lowered', () => {
    const h = createHold({ holdMs: 700, releaseMs: 500 })
    expect(h.feed('Thumb_Up', 0).fire).toBe(false)
    expect(h.feed('Thumb_Up', 400).fire).toBe(false)
    expect(h.feed('Thumb_Up', 750).fire).toBe(true)
    expect(h.feed('Thumb_Up', 900).fire).toBe(false)
    expect(h.feed('Thumb_Up', 3000).fire).toBe(false)
    // switching straight to another gesture does not fire either
    expect(h.feed('Thumb_Down', 3100).fire).toBe(false)
    expect(h.feed('Thumb_Down', 4000).fire).toBe(false)
    // lowered, then shown again
    h.feed(null, 4100)
    h.feed(null, 4700)
    expect(h.feed('Thumb_Down', 4800).fire).toBe(false)
    expect(h.feed('Thumb_Down', 5600).fire).toBe(true)
  })
  it('forgives a flicker but restarts when the gesture changes', () => {
    const h = createHold({ holdMs: 700, releaseMs: 500 })
    h.feed('Thumb_Up', 0)
    h.feed(null, 300)
    expect(h.feed('Thumb_Up', 400).fire).toBe(false)
    expect(h.feed('Thumb_Up', 720).fire).toBe(true)
    const g = createHold({ holdMs: 700, releaseMs: 500 })
    g.feed('Thumb_Up', 0)
    g.feed('Victory', 600)
    expect(g.feed('Victory', 800).fire).toBe(false)
    expect(g.feed('Victory', 1350).fire).toBe(true)
  })
})
