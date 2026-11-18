import { useEffect, useRef, useState } from 'react'
import loaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import binaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import { createHold, pickGesture } from './lib/gestures.js'

const HOLD_MS = 700 // how long a gesture is held before it counts

// The recogniser (hand landmarks + gesture classifier) is loaded the first time it is
// needed, once per page; the model file is served from /models like the others.
let recognizerPromise
function loadRecognizer() {
  if (!recognizerPromise) {
    recognizerPromise = import('@mediapipe/tasks-vision')
      .then(({ GestureRecognizer }) =>
        GestureRecognizer.createFromOptions(
          { wasmLoaderPath: loaderUrl, wasmBinaryPath: binaryUrl },
          { baseOptions: { modelAssetPath: '/models/gesture_recognizer.task', delegate: 'CPU' }, runningMode: 'VIDEO', numHands: 2 }
        )
      )
      .catch((e) => {
        recognizerPromise = undefined
        throw e
      })
  }
  return recognizerPromise
}

// Watches the camera's video for hand gestures while `enabled`. A gesture that has a
// meaning in `map` ({ Thumb_Up: 'yes', ... }) and is held for a moment calls
// onAction('yes' | 'no', gestureId) once; the hand has to be lowered before the next one.
//
// Returns { state: 'off' | 'loading' | 'ready' | 'error', held }, where `held` is
// null or { id, action, fired } for the gesture in view (for the on-screen hint).
export function useGestures({ videoRef, enabled, map, onAction }) {
  const [state, setState] = useState('off')
  const [held, setHeld] = useState(null)
  const mapRef = useRef(map)
  mapRef.current = map
  const actionRef = useRef(onAction)
  actionRef.current = onAction

  useEffect(() => {
    if (!enabled) {
      setState('off')
      setHeld(null)
      return undefined
    }
    let stopped = false
    let timer = 0
    const hold = createHold({ holdMs: HOLD_MS })
    let shown = '' // what `held` currently says, so state is only set when it changes
    const show = (h) => {
      const key = h ? `${h.id}:${h.fired}` : ''
      if (key === shown) return
      shown = key
      setHeld(h ? { id: h.id, action: mapRef.current[h.id], fired: h.fired } : null)
    }

    setState('loading')
    loadRecognizer().then(
      (recognizer) => {
        if (stopped) return
        setState('ready')
        let lastTs = 0
        const tick = () => {
          if (stopped) return
          let handSeen = false
          const video = videoRef.current
          if (video && video.videoWidth && !video.paused && !document.hidden) {
            try {
              // timestamps must keep increasing
              const ts = Math.max(lastTs + 1, Math.round(performance.now()))
              lastTs = ts
              const result = recognizer.recognizeForVideo(video, ts)
              handSeen = result.gestures.length > 0
              const g = pickGesture(result.gestures, mapRef.current)
              const h = hold.feed(g ? g.id : null, performance.now())
              show(h)
              if (h?.fire) actionRef.current?.(mapRef.current[h.id], h.id)
            } catch (e) {
              console.warn('[gestures] a frame could not be read:', e)
            }
          } else {
            hold.reset()
            show(null)
          }
          // look more often while a hand is in view
          timer = setTimeout(tick, handSeen ? 90 : 220)
        }
        tick()
      },
      (e) => {
        console.warn('Hand gestures unavailable:', e)
        if (!stopped) setState('error')
      }
    )
    return () => {
      stopped = true
      clearTimeout(timer)
      setHeld(null)
    }
  }, [enabled, videoRef])

  return { state, held, holdMs: HOLD_MS }
}
