import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './icons.jsx'
import { useLive } from './useLive.js'
import { useFaces } from './useFaces.js'
import { useVoices } from './useVoices.js'
import TabletBot3D from './three/TabletBot3D.jsx'
import StudioAvatar from './StudioAvatar.jsx'
import StudioOrder from './StudioOrder.jsx'
import MenuCarousel, { findSection, loadMenuSections } from './MenuCarousel.jsx'
import { useHeadTurn } from './useHeadTurn.js'
import { sceneScale } from './lib/detection.js'
import CameraCard from './CameraCard.jsx'
import TabletCam from './TabletCam.jsx'
import TabletSettings from './TabletSettings.jsx'
import TabletInventory, { TabletPrinter } from './TabletInventory.jsx'
import TabletTab from './TabletTab.jsx'
import PhotoCard from './PhotoCard.jsx'
import { downloadPhoto, photoName, savePhoto, snapshot } from './lib/photo.js'
import { cursorArt } from './lib/cursorArt.js'
import UsersPanel from './UsersPanel.jsx'
import UserCard from './UserCard.jsx'
import Transcript from './Transcript.jsx'
import { createToolRunner } from './tools.js'
import { useRegistration } from './useRegistration.js'
import { useTimers } from './useTimers.js'
import { chime } from './lib/beep.js'
import { PendingCard } from './FacesWindow.jsx'
import { describePolicy, mayWake } from './lib/wake.js'
import { useSpeaker } from './useSpeaker.js'
import { AddFaceWindow, ManageFacesWindow, RecordVoiceWindow } from './FacesWindow.jsx'
import SettingsPanel from './SettingsPanel.jsx'
import { useSettings, useTheme } from './settings.js'
import { usePersonTracker } from './usePersonTracker.js'
import { useGestures } from './useGestures.js'
import { gestureInfo, gestureMap } from './lib/gestures.js'

// stable color per class so each object type keeps its box color
function labelColor(cls) {
  return cls === 0 ? '#ededed' : `hsl(${(cls * 47) % 360} 40% 68%)`
}

const BLOCKED = new Set(['denied', 'nocamera', 'error'])

// The Captain: the page is just what is on the tablet's screen (Greeny's face and the order
// cards), with no 3D scene and none of the controls. That is the default here; the full
// AI Captain view (3D table, dock, settings) is at #full, reached with Escape.
const FULL_HASH = '#full'
const TAB_KEY = 'captain.tab' // the open tab's session id on this device
const isTabletOnly = () => window.location.hash !== FULL_HASH
// #studio opens the Studio version (the ceramic head from Greeny) on its own, whatever the setting says
const STUDIO_HASH = '#studio'
const hashStudio = () => window.location.hash === STUDIO_HASH

// The Studio head is sized to the window, leaving room around it.
function useSceneScale(on) {
  const get = () => sceneScale(window.innerWidth, window.innerHeight, 760) * 0.72
  const [scale, setScale] = useState(get)
  useEffect(() => {
    if (!on) return undefined
    const resize = () => setScale(get())
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [on])
  return scale
}

function statusText(status, target, fps, who, accel) {
  if (status.state !== 'tracking') return status.message
  if (!target) return 'Tracking · nothing detected'
  const what = target.face ? (who ? `face locked · ${who}` : 'face locked') : `${target.objects[0]?.label ?? 'object'} found`
  return `Tracking · ${what}${fps ? ` · ${fps} fps${accel === 'gpu' ? ' · GPU' : ''}` : ''}`
}

const HELP = {
  denied: 'Allow camera access in your browser’s site settings, then try again. Meanwhile the eyes follow your mouse.',
  nocamera: 'Connect a camera and try again. Meanwhile the eyes follow your mouse.',
  error: 'The eyes follow your mouse until this is fixed.',
}

// AI Captain: the tablet bot on a round dining table (TabletBot3D), with the
// voice chat, camera tracking, face and voice recognition and the tools
// (Oasys Bay ordering, photos, timers, people, the computer's mouse).
export default function App() {
  const [mouse, setMouse] = useState(null)
  const [settings, set, reset] = useSettings()
  const theme = useTheme(settings.theme)
  const [panelOpen, setPanelOpen] = useState(false)
  const gearRef = useRef(null)
  const [tabletOnly, setTabletOnly] = useState(isTabletOnly)
  const [studioHash, setStudioHash] = useState(hashStudio)
  useEffect(() => {
    const onHash = () => (setTabletOnly(isTabletOnly()), setStudioHash(hashStudio()))
    const onKey = (e) => {
      if (e.key === 'Escape' && isTabletOnly()) history.replaceState(null, '', window.location.pathname + window.location.search + FULL_HASH), onHash()
    }
    window.addEventListener('hashchange', onHash)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  const openTabletTab = () => window.open(window.location.pathname + window.location.search, '_blank', 'noopener')
  const facesApi = useFaces()
  const { videoRef, target, status, fps, accel, retry, identity, identities, captureFace: capture, stream: camStream } = usePersonTracker(settings, facesApi.faces)
  // a soft white flash when a photo or a face sample is taken
  const [flash, setFlash] = useState(0)
  const captureFace = useCallback(
    () =>
      capture().then((shot) => {
        setFlash(Date.now())
        return shot
      }),
    [capture]
  )
  useEffect(() => {
    if (!flash) return undefined
    const t = setTimeout(() => setFlash(0), 450)
    return () => clearTimeout(t)
  }, [flash])

  // take_photo: a short countdown, then the whole camera frame. The photo
  // waits in a card until it is downloaded, saved to the folder, or closed.
  const [photo, setPhoto] = useState(null) // { url, name, saved, saving, downloaded, error }
  const [desktopAsk, setDesktopAsk] = useState(false) // a mouse tool was refused: offer to switch it on
  const [countdown, setCountdown] = useState(0)
  const photoRef = useRef(null)
  photoRef.current = photo
  const takePhoto = useCallback(
    async (delay = 3) => {
      for (let n = Math.round(Math.max(0, Math.min(10, delay))); n > 0; n--) {
        setCountdown(n)
        await new Promise((r) => setTimeout(r, 1000))
      }
      setCountdown(0)
      const url = snapshot(videoRef.current, settings.facing !== 'environment')
      if (!url) throw new Error('The camera is not ready.')
      setFlash(Date.now())
      const next = { url, name: photoName() }
      setPhoto(next)
      return next
    },
    [videoRef, settings.facing]
  )
  const downloadCurrent = useCallback(() => {
    const p = photoRef.current
    if (!p) return false
    downloadPhoto(p.url, p.name)
    setPhoto((q) => q && { ...q, downloaded: true })
    return true
  }, [])
  const saveCurrent = useCallback(async () => {
    const p = photoRef.current
    if (!p) throw new Error('There is no photo to save.')
    setPhoto((q) => q && { ...q, saving: true, error: null })
    try {
      const { path: where } = await savePhoto(p.url, p.name)
      setPhoto((q) => q && { ...q, saving: false, saved: where })
      return where
    } catch (e) {
      setPhoto((q) => q && { ...q, saving: false, error: e.message })
      throw e
    }
  }, [])
  const nameOf = (id) => facesApi.faces.find((f) => f.id === id)?.name ?? ''
  const who = identity ? nameOf(identity.id) : '' // the main face
  // everyone recognised in view (the main face first), without repeats
  const names = [...new Set([who, ...identities.map(nameOf)].filter(Boolean))]
  const everyone = names.join(' and ')
  const voices = useVoices()
  const voiceId = useSpeaker()
  const toolCtx = useRef(null)
  const runTool = useMemo(() => createToolRunner(toolCtx), [])
  if (import.meta.env.DEV) window.__runTool = runTool // lets the tools be tried from the console
  const faceSeenNow = !!target?.face
  const registration = useRegistration({
    captureFace,
    addFace: facesApi.add,
    addVoice: voices.add,
    removeFace: facesApi.remove,
    removeVoice: voices.remove,
    faces: facesApi.faces,
    voices: voices.voices,
    who,
    faceSeen: faceSeenNow,
  })
  const feedMic = registration.feedPcm
  const feedSpeaker = voiceId.feed
  const onPcm = useCallback(
    (pcm) => {
      feedSpeaker(pcm)
      feedMic(pcm)
    },
    [feedSpeaker, feedMic]
  )
  const live = useLive({ face: everyone, speaker: voiceId.speaker, onPcm, voice: settings.voice, language: settings.language, character: 'greeny', onToolCall: runTool })
  const liveOn = live.state === 'live'

  // small messages that fade away (timers, reminders)
  const [toasts, setToasts] = useState([])
  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const pushToast = useCallback(
    (text) => {
      const id = Math.random().toString(36).slice(2)
      setToasts((t) => [...t, { id, text }])
      setTimeout(() => dismissToast(id), 20000)
    },
    [dismissToast]
  )
  // Order card: { stage: 'pending'|'added'|'tab'|'payment'|'placed'|'receipt_confirm'|'receipt_sent'|'cancelled'|'problem', ... }
  // (set by the ordering tools)
  const [order, setOrder] = useState(null)
  useEffect(() => {
    // cards waiting for an answer stay; the rest close by themselves
    const wait = { problem: 30000, added: 12000, tab: 45000, placed: 120000, receipt_sent: 20000, cancelled: 20000 }[order?.stage]
    if (!wait) return
    const t = setTimeout(() => setOrder(null), wait)
    return () => clearTimeout(t)
  }, [order])
  // The menu card carousel: { sections, ask: { name, at } } while it is on screen
  const [menu, setMenu] = useState(null)
  const showMenu = useCallback(async (section) => {
    if (section === null) {
      setMenu(null)
      return { ok: true }
    }
    try {
      const sections = await loadMenuSections()
      if (!sections.length) return { ok: false, error: 'The menu is empty right now.' }
      const i = findSection(sections, section)
      const at = sections[Math.max(0, i)].title
      setMenu({ sections, ask: { name: at, at: Date.now() } })
      return { ok: true, section: at, matched: i >= 0, sections: sections.map((s) => s.title) }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }, [])
  // The menu stays open while the guest orders (it closes only when they say so): the order card
  // then sits in a column on its left as a popup, also on the tablet, whose screen the menu covers.

  // The table's open tab: this dining session's rounds, paid once at the end. Its id is kept so a
  // reload carries on with the same tab; the server has the rounds.
  const [tab, setTabState] = useState(null)
  const tabRef = useRef(null)
  const setTab = useCallback((t) => {
    tabRef.current = t
    setTabState(t)
    try {
      if (t?.session_id) localStorage.setItem(TAB_KEY, String(t.session_id))
      else localStorage.removeItem(TAB_KEY)
    } catch { /* private window: the tab is still found by table number */ }
  }, [])
  useEffect(() => {
    if (!settings.oasysOrdering) return
    let id = null
    try {
      id = localStorage.getItem(TAB_KEY)
    } catch { /* ignore */ }
    const table = String(settings.tableNo || '').trim()
    const q = id ? `session_id=${encodeURIComponent(id)}` : table ? `table_no=${encodeURIComponent(table)}` : ''
    if (!q) return
    fetch(`/api/oasys/tab?${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setTab(b.tab?.status === 'open' ? b.tab : null))
      .catch(() => {})
  }, [settings.oasysOrdering, settings.tableNo, setTab])
  const showTab = useCallback(() => {
    const t = tabRef.current
    if (!t) return
    setOrder({
      stage: 'tab', lines: t.lines, table: t.table_no, rounds: t.rounds.length,
      subtotal: t.subtotal, tax: t.tax, tax_rate: t.tax_rate, service_charge: t.service_charge, total: t.total,
    })
  }, [])

  // A button tapped on the order card: run the same tool the guest would trigger by voice, then tell Greeny
  const orderAction = useCallback(
    async (tool, args, gesture) => {
      const r = await runTool(tool, args)
      const what = {
        confirm_order: args.confirm ? 'tapped Confirm on the order card (send this round to the kitchen)' : 'tapped Cancel on the order card',
        close_tab: args.payment_method ? `tapped ${args.payment_method} on the bill to pay and close the tab` : 'tapped "Close tab & pay" on the tab card',
        view_tab: 'tapped the tab to see what they have ordered',
        set_receipt_email: `typed ${args.email} for the e-receipt on the card; the card now asks them to confirm the address`,
        send_receipt: args.confirm ? 'tapped "Yes, send" for the e-receipt' : 'tapped Change: the e-receipt address was wrong',
        print_receipt: 'tapped "Print paper receipt" on the card',
      }[tool]
      // answered with a hand gesture instead of a tap
      if (gesture) return live.say(`[App] The guest answered ${args.confirm ? 'yes' : 'no'} with a ${gesture} hand gesture (the same as if they ${what}). Result: ${JSON.stringify(r)}. Respond briefly.`)
      live.say(`[App] The guest ${what}. Result: ${JSON.stringify(r)}. Respond briefly.`)
    },
    [runTool, live.say]
  )
  const liveRef = useRef(null)
  liveRef.current = { on: liveOn, say: live.say }
  const timers = useTimers({
    onFire: ({ label }) => {
      chime()
      pushToast(`Timer done: ${label}`)
      liveRef.current?.say?.(`[App] The timer "${label}" has just finished. Tell the user it is done, in one short sentence.`)
    },
  })
  const { reset: resetSpeaker } = voiceId
  useEffect(() => {
    if (!liveOn) resetSpeaker()
  }, [liveOn, resetSpeaker])
  const appRef = useRef(null)
  const lookRef = useRef(null)
  const [profileName, setProfileName] = useState(null) // one person's card, opened by the show_user tool
  const [usersOpen, setUsersOpen] = useState(false) // the people wheel, opened by the show_users tool
  const [win, setWin] = useState(null) // null | 'add' | 'manage' | 'record'
  const addRef = useRef(null)
  const manageRef = useRef(null)
  const cameraOn = settings.cameraOn !== false

  useEffect(() => {
    const onMove = (e) => setMouse({ x: e.clientX, y: e.clientY })
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // Mood: startled when a face shows up (or comes back after a nap), happy
  // while it sees one, drowsy after 3 s without a face and fast asleep after 7 s.
  // It only dozes off while the camera is tracking faces and no voice chat is on.
  const faceSeen = !!target?.face
  // Wake rule set by the set_wake_policy tool: only some people may wake it. It
  // is "armed" once nobody who could wake it has been in view for 2 s, so the
  // person who says "go to sleep" doesn't wake it again by sitting there.
  const [policy, setPolicy] = useState(null) // null | { users, anyRegistered }
  const [armed, setArmed] = useState(true)
  const [sleepRequested, setSleepRequested] = useState(false)
  // A saved person heard speaking counts as present even when their face is not
  // in view (they stepped aside, turned away, or the camera is off).
  const heard = liveOn && voiceId.speaker?.name ? voiceId.speaker.name : ''
  const heardUnseen = heard && !names.includes(heard) ? heard : ''
  const eligible =
    (faceSeen && (names.length ? names.some((n) => mayWake(policy, n)) : mayWake(policy, ''))) ||
    (!!heardUnseen && mayWake(policy, heardUnseen))
  useEffect(() => {
    if (armed || eligible) return
    const t = setTimeout(() => setArmed(true), 2000)
    return () => clearTimeout(t)
  }, [armed, eligible])
  const awakeFace = eligible && armed
  const sleepable = status.state === 'tracking' && settings.yunet && !liveOn
  const [stage, setStage] = useState(0) // 0 awake, 1 drowsy, 2 asleep
  const [startled, setStartled] = useState(false)
  const stageRef = useRef(0)
  const everSeen = useRef(false)
  useEffect(() => {
    if (!sleepable || awakeFace) {
      if (awakeFace && (stageRef.current > 0 || !everSeen.current)) {
        setStartled(true)
        setTimeout(() => setStartled(false), 700)
      }
      if (awakeFace) everSeen.current = true
      stageRef.current = 0
      setStage(0)
      return
    }
    const t1 = setTimeout(() => stageRef.current < 1 && ((stageRef.current = 1), setStage(1)), 3000)
    const t2 = setTimeout(() => ((stageRef.current = 2), setStage(2)), 7000)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [awakeFace, sleepable])

  let mood = 'idle'
  if (startled) mood = 'surprised'
  else if (awakeFace) mood = 'happy'
  else if (stage === 2) mood = 'asleep'
  else if (stage === 1) mood = 'sleepy'
  else if (target) mood = 'curious'
  // a feeling the avatar was asked to show (show_emotion) wins over the automatic mood
  const [emotion, setEmotionState] = useState(null)
  const emotionTimer = useRef(0)
  const showEmotion = useCallback((m, seconds) => {
    setEmotionState(m)
    clearTimeout(emotionTimer.current)
    emotionTimer.current = setTimeout(() => setEmotionState(null), seconds * 1000)
  }, [])
  if (emotion && mood !== 'asleep') mood = emotion
  const asleep = mood === 'asleep'

  // greet_on_arrival: when a registered person comes back after being away a
  // while, ask the model to say hello. Needs a voice chat to be running.
  const greetRef = useRef(false)
  const seenAt = useRef({})
  useEffect(() => {
    const present = heardUnseen ? [...names, heardUnseen] : names
    if (!present.length) return
    const now = Date.now()
    const arrived = []
    for (const n of present) {
      const prev = seenAt.current[n]
      seenAt.current[n] = now
      if (!prev || now - prev > 20000) arrived.push(n)
    }
    if (greetRef.current && liveRef.current?.on && arrived.length) {
      liveRef.current.say(`[App] ${arrived.join(' and ')} just arrived in front of the camera. Greet them by name, in one short warm sentence.`)
    }
    const id = setInterval(() => present.forEach((n) => (seenAt.current[n] = Date.now())), 4000)
    return () => clearInterval(id)
  }, [everyone, heardUnseen]) // eslint-disable-line react-hooks/exhaustive-deps

  // A stranger walks in: once an unrecognised face has stayed in view for a
  // couple of seconds (long enough for recognition to settle), ask the model to
  // greet them and offer to save them. Asked once per visit: it resets only
  // after no stranger has been in view for a while, and is held back while
  // asleep, while a save is already in progress, or while it is talking.
  const strangerNow = faceSeen && settings.recognize && (target?.people?.length ? target.people.some((p) => !p.id) : !who)
  const strangerSince = useRef(0)
  const strangerGone = useRef(0)
  const strangerAsked = useRef(false)
  const regBusy = !!registration.pending
  const talkingRef = useRef(false)
  talkingRef.current = live.speaking
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      if (!strangerNow) {
        strangerSince.current = 0
        if (!strangerGone.current) strangerGone.current = now
        if (now - strangerGone.current > 30000) strangerAsked.current = false
        return
      }
      strangerGone.current = 0
      if (!strangerSince.current) strangerSince.current = now
      if (strangerAsked.current || regBusy || asleep || talkingRef.current) return
      if (now - strangerSince.current < 2500 || !liveRef.current?.on) return
      strangerAsked.current = true
      const others = names.length ? ` (${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} also here; you know them)` : ''
      liveRef.current.say(
        `[App] Someone you do not recognise has just come into view${others}. Greet the newcomer warmly and naturally, in your preferred language, as a friendly stranger (never guess a name). Then, in the same breath, ask if they would like you to remember them, and if so what their name is. Keep it to one or two short sentences, then wait. If they say yes and give a name, call register_face with that name and confirm it as usual. If they decline, say that is fine and do not ask again.`
      )
    }, 500)
    return () => clearInterval(id)
  }, [strangerNow, regBusy, asleep]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tools ask for sleep: say goodnight first, then end the chat and doze off.
  const endLive = live.end
  const speakingNow = live.speaking
  useEffect(() => {
    if (!sleepRequested || speakingNow) return
    const t = setTimeout(() => {
      stageRef.current = 2
      setStage(2)
      endLive()
      setSleepRequested(false)
    }, 4000)
    return () => clearTimeout(t)
  }, [sleepRequested, speakingNow, endLive])

  // Hand gestures: a gesture held up to the camera answers whatever is waiting for a yes or
  // no (a card on screen first, otherwise the question Greeny just asked aloud). Which
  // gesture means what is a setting (Settings > Gestures).
  const gestureMeaning = useMemo(() => gestureMap(settings.gestureMap), [settings.gestureMap])
  const awaitingAnswer = !!registration.pending || desktopAsk || order?.stage === 'pending' || order?.stage === 'receipt_confirm'
  const gestureBusy = useRef(false)
  const onGesture = async (action, id) => {
    if (gestureBusy.current) return
    const yes = action === 'yes'
    const label = gestureInfo(id)?.label.toLowerCase() || 'hand'
    gestureBusy.current = true
    try {
      if (registration.pending) {
        const r = await registration.confirm(yes)
        live.say(`[App] The guest answered ${yes ? 'yes' : 'no'} with a ${label} hand gesture to the save / delete card on screen. Result: ${JSON.stringify(r)}. Respond briefly.`)
      } else if (desktopAsk) {
        setDesktopAsk(false)
        if (yes) {
          set('desktopControl', true)
          live.say('[App] The user switched on mouse control with a hand gesture. Carry on with what they asked, starting with see_screen.')
        }
      } else if (order?.stage === 'pending') await orderAction('confirm_order', { confirm: yes }, label)
      else if (order?.stage === 'receipt_confirm') await orderAction('send_receipt', { confirm: yes }, label)
      else if (liveOn) {
        live.say(
          `[App] The guest just showed a ${label} hand gesture to the camera, which means "${yes ? 'yes' : 'no'}". If you asked them a yes-or-no question a moment ago, take that as their answer and carry on. Otherwise do not reply to this note.`
        )
      }
    } finally {
      gestureBusy.current = false
    }
  }
  const gestures = useGestures({
    videoRef,
    enabled: settings.gestures !== false && cameraOn && status.state === 'tracking' && (awaitingAnswer || liveOn) && Object.values(gestureMeaning).some((a) => a !== 'off'),
    map: gestureMeaning,
    onAction: onGesture,
  })
  const heldGesture = gestures.held && gestureInfo(gestures.held.id)

  // what the tools can see and do (always the latest state)
  toolCtx.current = {
    users: () => {
      const names = new Map()
      for (const f of facesApi.faces) names.set(f.name, { name: f.name, has_face: true, has_voice: false })
      for (const v of voices.voices) names.set(v.name, { ...(names.get(v.name) || { name: v.name, has_face: false }), has_voice: true })
      return [...names.values()]
    },
    onCamera: () => who,
    strangerOnCamera: () => faceSeen && (target?.people?.some((p) => !p.id) ?? !who),
    speaker: () => voiceId.speaker?.name || '',
    state: () => ['awake', 'drowsy', 'asleep'][stageRef.current] || 'awake',
    policy: () => policy,
    setPolicy: (p) => {
      setPolicy(p)
      setArmed(!p)
    },
    sleepSoon: () => {
      setArmed(false)
      setSleepRequested(true)
    },
    wake: () => {
      setSleepRequested(false)
      setArmed(true)
      stageRef.current = 0
      setStage(0)
    },
    setSetting: set,
    registration,
    showEmotion,
    showUsers: setUsersOpen,
    showUser: setProfileName,
    camera: () => cameraOn && status.state === 'tracking',
    takePhoto,
    downloadPhoto: downloadCurrent,
    savePhoto: saveCurrent,
    closePhoto: () => setPhoto(null),
    // everything that pops up over the face; returns what was open
    closePopups: () => {
      const open = [
        photo && 'photo',
        profileName && 'person card',
        usersOpen && 'people wheel',
        win && 'window',
        panelOpen && 'settings',
        desktopAsk && 'mouse permission',
        order && 'order card',
        toasts.length > 0 && 'notifications',
        registration.pending && 'pending save or delete (cancelled)',
      ].filter(Boolean)
      setPhoto(null)
      setProfileName(null)
      setUsersOpen(false)
      setWin(null)
      setPanelOpen(false)
      setDesktopAsk(false)
      setOrder(null)
      setToasts([])
      if (registration.pending) registration.confirm(false)
      return open
    },
    desktopAllowed: () => !!settings.desktopControl,
    oasysConnected: () => !!settings.oasysOrdering,
    showOrder: setOrder,
    showMenu,
    tab: () => tabRef.current,
    setTab,
    tableNo: () => String(settings.tableNo || '').trim(),
    askDesktop: () => setDesktopAsk(true),
    faceColor: () => faceColor,
    cursorArt: () => cursorArt(faceColor, eyeColor),
    showImage: live.sendImage,
    hasPhoto: () => !!photoRef.current,
    setGreet: (on) => (greetRef.current = on),
    timers,
  }

  // Webcam is mirrored: a person on the camera's right is on the viewer's left.
  // With nothing in view, it follows the mouse.
  const watching = target ? { x: (1 - target.x) * window.innerWidth, y: target.y * window.innerHeight } : mouse

  // the tablet turns toward the person; asleep, it nods forward
  lookRef.current = asleep ? { x: window.innerWidth / 2, y: window.innerHeight } : watching

  const pct = (v) => `${Math.max(0, Math.min(100, v * 100))}%`
  // boxes are in video coordinates; the front camera's preview is mirrored, so flip x
  const rear = settings.facing === 'environment'
  const boxStyle = (b, color) => ({
    left: pct(rear ? b.x : 1 - b.x - b.w),
    top: pct(b.y),
    width: pct(Math.min(b.w, 1 - Math.max(0, b.x))),
    height: pct(Math.min(b.h, 1 - Math.max(0, b.y))),
    '--box': color,
  })

  // two versions: the tablet on its stand (three.js), or the Studio head (2D, from Greeny)
  const studio = studioHash || settings.avatar === 'studio'
  const scale = useSceneScale(studio)
  // the size setting; the tablet's screen already fills the page, so it only shrinks
  const botSize = Math.max(0.4, Math.min(studio ? 1.3 : 1, Number(settings.botSize) || 1))
  useHeadTurn(appRef, lookRef, studio)
  // the menu stays open while ordering, so with it open the order card is a popup beside it
  const orderAsPopup = studio || !!menu
  const faceColor = settings.faceColor
  const eyeColor = settings.eyeColor
  const showCam = settings.showPreview && cameraOn
  const cardPreview = settings.previewStyle !== 'plain' // the metal card, or the plain video with boxes
  // loading, connecting or waiting for a reply: the screen breathes
  const busyNow = status.state === 'loading' || status.state === 'camera' || live.state === 'connecting' || live.thinking
  const dot = BLOCKED.has(status.state) ? 'bad' : status.state === 'tracking' ? 'ok' : status.state === 'off' ? '' : 'wait'

  return (
    <div
      ref={appRef}
      className={`app${rear ? ' rear' : ''}${tabletOnly ? ' tablet-only' : ''}${studio ? ' studio' : ''}${studio && order ? ' order-open' : ''}`}
      style={{ '--face': faceColor, '--iris': eyeColor, '--s': scale * botSize, '--bot-size': botSize }}
    >
      {orderAsPopup && <StudioOrder order={order} onAction={orderAction} onClose={() => setOrder(null)} />}
      {studio && (
        <>
          <div className="studio-floor" />
          <div className="head">
            <StudioAvatar
              look={watching}
              mood={mood}
              mouthMood={live.speaking ? 'talking' : mood}
              contact={awakeFace ? 0.9 : 0}
              expression={1}
              levelRef={live.levelRef}
            />
          </div>
        </>
      )}
      {/* every stage of an order is drawn on the tablet's screen */}
      {!studio && <TabletBot3D
        bill={orderAsPopup ? null : order}
        onOrderAction={orderAction}
        onClose={() => setOrder(null)}
        mood={mood}
        speaking={live.speaking}
        busy={busyNow}
        levelRef={live.levelRef}
        lookRef={lookRef}
        eyeColor={eyeColor}
        faceColor={faceColor}
        theme={theme}
        scene={tabletOnly ? 'screen' : 'table'}
      />}
      {flash > 0 && <div key={flash} className="photo-flash" aria-hidden="true" />}
      {menu && <MenuCarousel sections={menu.sections} section={menu.ask} withOrder={!!order} onClose={() => setMenu(null)} />}

      {/* tablet-only view: a single tap starts the voice chat (browsers need a gesture before audio plays) */}
      {tabletOnly && (live.state === 'off' || live.state === 'error') && (
        <button className="tablet-start" onClick={live.toggle} aria-label="Start voice chat">
          <Icon name="mic" size={26} />
          <span>Tap to talk to Greeny</span>
        </button>
      )}

      {/* tablet-only view: a live webcam window, and mute / stop talking while chatting */}
      {tabletOnly && (
        <div className="tablet-badges">
          <TabletSettings
            version={studio ? 'studio' : 'tablet'}
            size={botSize}
            maxSize={studio ? 1.3 : 1}
            onSize={(v) => set('botSize', v)}
            table={settings.tableNo || ''}
            onTable={(v) => set('tableNo', v)}
            printer={!!settings.oasysOrdering}
            gestures={{
              on: settings.gestures !== false,
              map: settings.gestureMap,
              onToggle: (v) => set('gestures', v),
              onMap: (m) => set('gestureMap', m),
            }}
            onVersion={(v) => {
              set('avatar', v)
              // #studio forces the Studio version, so leave it when picking another one
              if (hashStudio() && v !== 'studio') history.replaceState(null, '', window.location.pathname + window.location.search), setStudioHash(false)
            }}
          />
          <TabletInventory
            enabled={!!settings.oasysOrdering}
            onChange={(on) => {
              set('oasysOrdering', on)
              if (on) live.say('[App] The inventory is now connected. You can read the menu and take orders. Do not reply to this note.')
            }}
          />
          {settings.oasysOrdering && <TabletPrinter />}
          {settings.oasysOrdering && (
            <button className="tablet-inventory" onClick={() => showMenu('')} aria-label="Show the menu card">
              Menu
            </button>
          )}
          {settings.oasysOrdering && tab && <TabletTab tab={tab} onOpen={showTab} />}
        </div>
      )}
      {tabletOnly && cameraOn && <TabletCam stream={camStream} mirror={!rear} who={everyone} />}
      {tabletOnly && liveOn && (
        <div className="tablet-controls" role="toolbar" aria-label="Voice chat">
          <button onClick={live.toggleMute} aria-pressed={live.muted} aria-label={live.muted ? 'Unmute microphone' : 'Mute microphone'}>
            <Icon name={live.muted ? 'mic-off' : 'mic'} size={20} />
            <span>{live.muted ? 'Unmute' : 'Mute'}</span>
          </button>
          <button onClick={live.stopTalking} disabled={!live.speaking} aria-label="Stop talking">
            <Icon name="stop" size={20} />
            <span>Stop talking</span>
          </button>
          <button className="end-call" onClick={live.end} aria-label="End call">
            <Icon name="phone-off" size={20} />
            <span>End call</span>
          </button>
        </div>
      )}

      {asleep && (
        <div className="zzz" aria-hidden="true">
          <span>z</span>
          <span>z</span>
          <span>Z</span>
        </div>
      )}


      <div className="stack">
        <div className="status surface" role="status" aria-live="polite">
          <span className={`dot ${dot}`} aria-hidden="true" />
          {live.state === 'connecting'
            ? live.message
            : asleep && policy
              ? `Asleep \u00b7 ${describePolicy(policy)}`
              : statusText(status, target, fps, everyone, accel)}
        </div>

        {liveOn && voiceId.speaker && (
          <div
            className={`status surface${voiceId.speaker.name && who && voiceId.speaker.name !== who ? ' warn' : ''}`}
            role="status"
          >
            {voiceId.speaker.name ? `${voiceId.speaker.name} is speaking` : 'Unrecognised voice'}
            {voiceId.speaker.name && who && voiceId.speaker.name !== who ? ` \u00b7 not ${who}` : ''}
          </div>
        )}
      </div>

      {/* a gesture in view: it fills while held, then shows the answer it gave */}
      {heldGesture && (
        <div
          key={gestures.held.id}
          className={`gesture-chip ${gestures.held.action}${gestures.held.fired ? ' fired' : ''}`}
          style={{ '--hold': `${gestures.holdMs}ms` }}
          role="status"
        >
          <span className="gesture-emoji" aria-hidden="true">{heldGesture.emoji}</span>
          <span>{gestures.held.fired ? (gestures.held.action === 'yes' ? 'Yes' : 'No') : `Hold for ${gestures.held.action}`}</span>
        </div>
      )}

      {countdown > 0 && (
        <div key={countdown} className="photo-count" aria-live="assertive">
          {countdown}
        </div>
      )}

      {(toasts.length > 0 || BLOCKED.has(status.state) || live.state === 'error' || registration.pending || photo || desktopAsk) && (
        <div className={`popups${registration.pending ? ' dim' : ''}`}>
          {registration.pending && (
            <PendingCard
              pending={registration.pending}
              onName={registration.setName}
              onConfirm={(yes) => registration.confirm(yes)}
            />
          )}
          {photo && !registration.pending && (
            <PhotoCard
              photo={photo}
              onDownload={downloadCurrent}
              onSave={() => saveCurrent().catch(() => {})}
              onClose={() => setPhoto(null)}
            />
          )}
          {desktopAsk && (
            <div className="note surface" role="alertdialog" aria-label="Allow mouse control">
              <strong>Let it use the mouse?</strong>
              <p>
                It can look at this screen, move and click the mouse, type and open tabs. Push the mouse into a screen corner to stop
                it. You can switch it off again in Settings.
              </p>
              <div className="note-actions">
                <button
                  className="btn primary sm"
                  onClick={() => {
                    set('desktopControl', true)
                    setDesktopAsk(false)
                    live.say('[App] The user switched on mouse control. Carry on with what they asked, starting with see_screen.')
                  }}
                >
                  Allow
                </button>
                <button className="btn sm" onClick={() => setDesktopAsk(false)}>
                  Not now
                </button>
              </div>
            </div>
          )}
          {toasts.map((t) => (
            <div key={t.id} className="note surface" role="status">
              <strong>{t.text}</strong>
              <button className="btn sm" style={{ marginTop: 8 }} onClick={() => dismissToast(t.id)}>
                Dismiss
              </button>
            </div>
          ))}

          {BLOCKED.has(status.state) && (
            <div className="note surface" role="alert">
              <strong>{status.message}</strong>
              <p>{HELP[status.state]}</p>
              <button className="btn sm" onClick={retry}>
                Try again
              </button>
            </div>
          )}

          {live.state === 'error' && (
            <div className="note surface" role="alert">
              <strong>Voice chat unavailable</strong>
              <p>{live.message}</p>
              <button className="btn sm" onClick={live.toggle}>
                Try again
              </button>
            </div>
          )}
        </div>
      )}

      {liveOn && <Transcript lines={live.transcript} shifted={usersOpen} name={voiceId.speaker?.name || who} max={tabletOnly ? 160 : 0} />}

      {usersOpen && (
        <UsersPanel faces={facesApi.faces} voices={voices.voices} hereNames={names} onClose={() => setUsersOpen(false)} />
      )}

      {profileName && (
        <UserCard
          person={{
            name: profileName,
            thumbnail: facesApi.faces.find((f) => f.name === profileName)?.thumbnail,
            face: facesApi.faces.some((f) => f.name === profileName),
            voice: voices.voices.some((v) => v.name === profileName),
          }}
          here={names.includes(profileName) || heardUnseen === profileName}
          accent={settings.faceColor}
          onClose={() => setProfileName(null)}
        />
      )}

      {showCam && cardPreview && (
        <CameraCard
          stream={camStream}
          mirror={!rear}
          who={everyone}
          faceSeen={!!target?.face}
          people={target?.people}
          nameOf={nameOf}
          showBoxes={settings.showBoxes}
          tracking={status.state === 'tracking'}
          fps={fps}
          tint={faceColor}
        />
      )}

      {/* the tracker reads this video, so it stays in the page even when hidden */}
      <figure className="preview surface" style={{ display: showCam && !cardPreview ? 'block' : 'none' }}>
        <video ref={videoRef} muted playsInline aria-label="Camera preview" />
        {settings.showBoxes &&
          target?.objects.map((o, i) => (
            <div key={i} className="bbox" style={boxStyle(o, labelColor(o.cls))}>
              <span>
                {o.label} {Math.round(o.score * 100)}%
              </span>
            </div>
          ))}
        {settings.showBoxes &&
          target?.people?.map((p, i) => (
            <div key={`f${i}`} className="bbox is-face" style={boxStyle(p, p.id ? '#43c59e' : '#e2ad4b')}>
              <span>{p.id ? nameOf(p.id) : 'unknown'}</span>
            </div>
          ))}
      </figure>

      {win === 'add' && (
        <AddFaceWindow
          videoRef={videoRef}
          captureFace={captureFace}
          onSave={facesApi.add}
          onClose={() => setWin(null)}
          anchorRef={addRef}
          hasFace={!!target?.face}
        />
      )}
      {win === 'manage' && (
        <ManageFacesWindow
          faces={facesApi.faces}
          error={facesApi.error}
          rename={facesApi.rename}
          remove={facesApi.remove}
          recognisedId={identity?.id}
          voices={voices}
          speakerName={voiceId.speaker?.name}
          onRecord={() => setWin('record')}
          onAdd={() => setWin('add')}
          onClose={() => setWin(null)}
          anchorRef={manageRef}
        />
      )}

      {win === 'record' && (
        <RecordVoiceWindow
          names={[...new Set([...facesApi.faces.map((f) => f.name), ...voices.voices.map((v) => v.name)])]}
          onSave={voices.add}
          onClose={() => setWin('manage')}
          anchorRef={manageRef}
        />
      )}

      {panelOpen && (
        <SettingsPanel
          settings={settings}
          set={set}
          reset={reset}
          anchorRef={gearRef}
          onClose={() => setPanelOpen(false)}
        />
      )}

      <nav className="dock surface" aria-label="Controls">
        <button
          className="icon-btn dock-btn"
          onClick={() => set('cameraOn', !cameraOn)}
          aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
          aria-pressed={cameraOn}
          data-tip={cameraOn ? 'Turn camera off' : 'Turn camera on'}
        >
          <Icon name={cameraOn ? 'video' : 'video-off'} />
        </button>
        <button
          className="icon-btn dock-btn"
          onClick={() => {
            set('cameraOn', true)
            set('facing', rear ? 'user' : 'environment')
          }}
          aria-label={rear ? 'Use front camera' : 'Use rear camera'}
          data-tip={rear ? 'Use front camera' : 'Use rear camera'}
        >
          <Icon name="flip" />
        </button>
        <span className="dock-sep" role="separator" />
        <button ref={addRef} className="icon-btn dock-btn" onClick={() => {
            set('cameraOn', true) // adding a face needs the camera
            setWin('add')
          }}
          aria-label="Add face" data-tip="Add face">
          <Icon name="user-plus" />
        </button>
        <button ref={manageRef} className="icon-btn dock-btn" onClick={() => setWin('manage')} aria-label="People" data-tip="People">
          <Icon name="users" />
        </button>
        <span className="dock-sep" role="separator" />
        <button
          className="icon-btn dock-btn"
          onClick={live.toggle}
          aria-label={live.state === 'off' || live.state === 'error' ? 'Start voice chat' : 'End voice chat'}
          aria-pressed={live.state === 'live' || live.state === 'connecting'}
          data-tip={live.state === 'live' || live.state === 'connecting' ? 'End voice chat' : 'Talk'}
          data-state={live.state === 'live' ? 'live' : live.state === 'connecting' ? 'wait' : live.state === 'error' ? 'bad' : undefined}
        >
          <Icon name="mic" />
        </button>
        {liveOn && (
          <>
            <button
              className="icon-btn dock-btn"
              onClick={live.toggleMute}
              aria-label={live.muted ? 'Unmute microphone' : 'Mute microphone'}
              aria-pressed={live.muted}
              data-tip={live.muted ? 'Unmute' : 'Mute'}
              data-state={live.muted ? 'bad' : undefined}
            >
              <Icon name={live.muted ? 'mic-off' : 'mic'} />
            </button>
            <button
              className="icon-btn dock-btn"
              onClick={live.stopTalking}
              disabled={!live.speaking}
              aria-label="Stop talking"
              data-tip="Stop talking"
            >
              <Icon name="stop" />
            </button>
          </>
        )}
        <button className="icon-btn dock-btn" onClick={openTabletTab} aria-label="Open tablet-only view in a new tab" data-tip="Tablet-only view (new tab)">
          <Icon name="tablet" />
        </button>
        <button
          ref={gearRef}
          className="icon-btn dock-btn"
          onClick={() => setPanelOpen((v) => !v)}
          aria-label="Settings"
          aria-expanded={panelOpen}
          data-tip="Settings"
        >
          <Icon name="sliders" />
        </button>
      </nav>
    </div>
  )
}
