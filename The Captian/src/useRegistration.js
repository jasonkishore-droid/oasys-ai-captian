import { useCallback, useEffect, useRef, useState } from 'react'
import { pcmToBase64 } from './lib/speaker.js'
import { resolveNames } from './lib/wake.js'

const SPEECH_RMS = 0.012
const GOAL_MS = 7000 // enough speech for a good voiceprint
const MIN_MS = 3000 // the least we'll accept
const MAX_WAIT_MS = 16000

const cleanName = (n) => String(n ?? '').trim().replace(/\s+/g, ' ').slice(0, 120)

// Registering a new person by voice command: capture a face photo or a voice
// sample, hold it as `pending` until the name is confirmed (by voice or by the
// buttons on the card), then save it. Nothing is stored before confirmation.
export function useRegistration({ captureFace, addFace, addVoice, removeFace, removeVoice, faces, voices, who, faceSeen }) {
  const [pending, setPending] = useState(null) // { kind, name, status, thumbnail?, seconds? }
  const data = useRef(null) // the captured embedding (face) or audio (voice)
  const voice = useRef(null) // an in-progress voice capture
  const pendingRef = useRef(null)
  pendingRef.current = pending
  // the face saved most recently, so "save my voice too" right after can
  // prefill the same name even before recognition has caught up
  const lastFace = useRef(null) // { name, at }

  const discard = useCallback(() => {
    data.current = null
    voice.current = null
    setPending(null)
  }, [])

  const beginFace = useCallback(
    async (rawName) => {
      const name = cleanName(rawName)
      if (!name) return { ok: false, error: 'I need a name to save this person under.' }
      if (!faceSeen) return { ok: false, error: 'No face is visible. Ask the person to look at the camera.' }
      if (who) return { ok: false, error: `${who} is already registered and is the person on camera.` }
      discard()
      try {
        const { embedding, thumbnail } = await captureFace()
        data.current = { embedding, thumbnail }
        setPending({ kind: 'face', name, status: 'ready', thumbnail })
        return { ok: true, name, photo_taken: true, next: `Ask the user to confirm saving this face as "${name}", then call confirm_pending.` }
      } catch (e) {
        return { ok: false, error: e.message }
      }
    },
    [captureFace, faceSeen, who, discard]
  )

  // The name box is prefilled only with a name we can trust: the registered
  // person the camera sees, or a face saved in the last few minutes. A name the
  // model guessed (often whoever spoke last) is not used; the box stays empty
  // and the name is asked for before saving.
  const beginVoice = useCallback(
    () => {
      const recent = lastFace.current && Date.now() - lastFace.current.at < 3 * 60 * 1000 ? lastFace.current.name : ''
      const name = who || recent
      discard()
      voice.current = { chunks: [], speechMs: 0, startedAt: performance.now(), waiter: null, result: null }
      setPending({ kind: 'voice', name, status: 'recording' })
      return {
        ok: true,
        name: name || null,
        recording: true,
        next: `Tell the person to keep talking naturally for about 8 seconds (they can say anything), then call finish_voice_recording.${name ? '' : ' Nobody registered is on camera, so the name is not known yet: ask for it after the recording.'}`,
      }
    },
    [discard, who]
  )

  // called with every 100 ms mic chunk (16 kHz int16) while the voice chat runs
  const feedPcm = useCallback((pcm) => {
    const v = voice.current
    if (!v || v.result) return
    let sum = 0
    for (let i = 0; i < pcm.length; i++) sum += (pcm[i] / 32768) ** 2
    if (Math.sqrt(sum / pcm.length) > SPEECH_RMS) {
      v.chunks.push(pcm)
      v.speechMs += 100
    }
  }, [])

  const finishVoice = useCallback(
    () =>
      new Promise((resolve) => {
        const v = voice.current
        if (!v) return resolve({ ok: false, error: 'No voice recording is in progress. Call register_voice first.' })
        const check = setInterval(() => {
          const timedOut = performance.now() - v.startedAt > MAX_WAIT_MS
          if (v.speechMs < GOAL_MS && !timedOut) return
          clearInterval(check)
          if (voice.current !== v) return resolve({ ok: false, error: 'The recording was cancelled.' })
          if (v.speechMs < MIN_MS) {
            voice.current = null
            setPending(null)
            return resolve({ ok: false, error: 'I barely heard any speech. Ask the person to speak up and try again.' })
          }
          const all = new Int16Array(v.chunks.reduce((n, c) => n + c.length, 0))
          let at = 0
          for (const c of v.chunks) {
            all.set(c, at)
            at += c.length
          }
          v.result = true
          data.current = { audio: pcmToBase64(all), seconds: v.speechMs / 1000 }
          setPending((p) => p && { ...p, status: 'ready', seconds: v.speechMs / 1000 })
          resolve({
            ok: true,
            seconds: v.speechMs / 1000,
            next: pendingRef.current?.name
              ? `Ask the user to confirm saving this voice as "${pendingRef.current.name}", then call confirm_pending.`
              : 'Ask the person what name to save this voice under (they can also type it in the box on screen), confirm it with them, then call confirm_pending with confirm true and that name.',
          })
        }, 250)
      }),
    []
  )

  // Removing someone's saved face and/or voice. Like saving, it waits for a yes.
  const beginRemove = useCallback(
    (rawName, what = 'both') => {
      const registered = [...new Set([...faces.map((f) => f.name), ...voices.map((v) => v.name)])]
      const { resolved } = resolveNames([rawName], registered)
      if (!resolved.length) return { ok: false, error: `Nobody is registered as "${rawName}".`, registered_users: registered }
      const name = resolved[0]
      const kind = what === 'face' || what === 'voice' ? what : 'both'
      const faceIds = kind === 'voice' ? [] : faces.filter((f) => f.name === name).map((f) => f.id)
      const voiceIds = kind === 'face' ? [] : voices.filter((v) => v.name === name).map((v) => v.id)
      if (!faceIds.length && !voiceIds.length) {
        return { ok: false, error: `${name} has no saved ${kind === 'both' ? 'face or voice' : kind}.` }
      }
      discard()
      data.current = { faceIds, voiceIds }
      // their photo, so it is clear whose data goes (shown even when only the voice is removed)
      const thumbnail = faces.find((f) => f.name === name && f.thumbnail)?.thumbnail
      setPending({ kind: 'remove', name, what: kind, status: 'ready', faces: faceIds.length, voices: voiceIds.length, thumbnail })
      return {
        ok: true,
        name,
        will_delete: { faces: faceIds.length, voices: voiceIds.length },
        next: `Ask the user to confirm deleting ${name}'s ${kind === 'both' ? 'face and voice' : kind}. Only call confirm_pending with confirm true after they say yes.`,
      }
    },
    [faces, voices, discard]
  )

  const setName = useCallback((name) => setPending((p) => p && { ...p, name }), [])

  const confirm = useCallback(
    async (yes, correctedName) => {
      const p = pendingRef.current
      if (!p) return { ok: false, error: 'There is nothing waiting to be saved.' }
      if (!yes) {
        discard()
        return { ok: true, saved: false, discarded: true }
      }
      if (p.status !== 'ready' || !data.current) return { ok: false, error: 'The sample is not finished yet.' }
      const name = cleanName(correctedName) || cleanName(p.name)
      if (!name && p.kind !== 'remove') return { ok: false, error: 'There is no name yet. Ask the person their name, then call confirm_pending again with name.' }
      setPending({ ...p, name, status: 'saving' })
      try {
        if (p.kind === 'remove') {
          for (const id of data.current.faceIds) await removeFace(id)
          for (const id of data.current.voiceIds) await removeVoice(id)
        } else if (p.kind === 'face') {
          await addFace({ name, embedding: data.current.embedding, thumbnail: data.current.thumbnail })
          lastFace.current = { name, at: Date.now() }
        }
        else await addVoice({ name, audio: data.current.audio })
        data.current = null
        voice.current = null
        setPending(null)
        if (p.kind === 'remove') return { ok: true, deleted: true, name: p.name, what: p.what }
        const hasVoice = voices.some((v) => v.name === name)
        const hasFace = faces.some((f) => f.name === name)
        const next =
          p.kind === 'face' && !hasVoice
            ? `Welcome ${name} warmly by name, then ask whether they would also like to save their voice so you can tell them apart by voice too. Only if they say yes, call register_voice with "${name}".`
            : p.kind === 'voice' && !hasFace
            ? `Thank ${name}. They have no saved face yet; if they are on camera, you may offer to save their face too.`
            : `Tell ${name} it is all set, in one short sentence.`
        return { ok: true, saved: true, kind: p.kind, name, next }
      } catch (e) {
        setPending({ ...p, name, status: 'ready' })
        return { ok: false, error: e.message }
      }
    },
    [addFace, addVoice, removeFace, removeVoice, discard, faces, voices]
  )

  // a half-finished recording shouldn't outlive the voice chat
  useEffect(() => () => (voice.current = null), [])

  return { pending, setName, beginRemove, beginFace, beginVoice, feedPcm, finishVoice, confirm, discard }
}
