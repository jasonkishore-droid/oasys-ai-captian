import { useEffect, useState } from 'react'

export const DEFAULTS = {
  // models
  yolo: true,
  yunet: true,
  recognize: true,
  multiFace: true, // recognise everyone in view, not just the nearest face
  desktopControl: false, // let Greeny move this computer's real mouse and keyboard (voice tools)
  oasysOrdering: false, // connect to the Oasys Bay club app: read the menu and place orders by voice
  tableNo: '', // the table this bot sits on, e.g. "T4": its open tab (the dining session) is kept under it
  gpu: false, // run the detection models on the GPU (WebGPU) when the browser has one; reload to apply
  voice: '', // '' = the server's GEMINI_LIVE_VOICE
  language: '', // '' = auto (answers in whatever language you speak); otherwise it sticks to this one unless asked to switch
  // look
  botSize: 1, // how big the bot is drawn: 1 = the normal size (the tablet's screen tops out at 1, the Studio head at 1.3)
  avatar: 'tablet', // 'tablet' (the tablet on its stand, cards on its screen) or 'studio' (Greeny's ceramic head, cards as popups)
  eyeColor: '#2f7bff', // the eyes and mouth on the tablet's screen
  faceColor: '#eef1f6', // the tablet's aluminium body
  // detection
  objectConf: 0.4,
  faceConf: 0.6,
  onlyPeople: false,
  cameraOn: true, // false stops the camera completely (no tracking, no light)
  facing: 'user', // 'user' (front camera) or 'environment' (rear camera), where the device has both
  // hand gestures
  gestures: true, // answer yes / no questions with a hand gesture shown to the camera
  gestureMap: {}, // what each gesture means, over the defaults in lib/gestures.js: { Victory: 'yes', ... }
  // display
  theme: 'dark', // 'dark', 'light' or 'system' (follows the OS)
  showPreview: true,
  previewStyle: 'card', // 'card' (a metal card that reflects the camera) or 'plain' (the video, with boxes)
  showBoxes: true,
}

const KEY = 'ai-captain-settings'

// The page theme goes on <html data-theme="dark|light"> so tokens.css can swap
// the palette; 'system' follows prefers-color-scheme and keeps following it.
const darkQuery = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : null
const resolveTheme = (t) => (t === 'light' || t === 'dark' ? t : darkQuery?.matches === false ? 'light' : 'dark')
export function applyTheme(theme) {
  const t = resolveTheme(theme)
  document.documentElement.dataset.theme = t
  document.documentElement.style.colorScheme = t
  return t
}
// apply the saved theme before the first render, so pages that don't use settings are themed too
try {
  applyTheme(JSON.parse(localStorage.getItem(KEY) || '{}').theme || DEFAULTS.theme)
} catch {
  applyTheme(DEFAULTS.theme)
}

// the resolved theme ('dark' | 'light'), updating live when 'system' and the OS flips
export function useTheme(theme) {
  const [t, setT] = useState(() => resolveTheme(theme))
  useEffect(() => {
    const update = () => setT(applyTheme(theme))
    update()
    if (theme !== 'system' || !darkQuery) return
    darkQuery.addEventListener('change', update)
    return () => darkQuery.removeEventListener('change', update)
  }, [theme])
  return t
}

// Settings live in localStorage so they survive reloads; storage can throw
// (private windows, blocked site data), so every access is guarded.
export function useSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
    } catch {
      return DEFAULTS
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
      /* ignore */
    }
  }, [settings])

  const set = (key, value) => setSettings((s) => ({ ...s, [key]: value }))
  const reset = () => setSettings(DEFAULTS)
  return [settings, set, reset]
}
