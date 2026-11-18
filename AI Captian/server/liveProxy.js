import { WebSocketServer, WebSocket } from 'ws'
import { VOICE_NAMES } from '../src/lib/voices.js'
import { TOOL_DECLARATIONS } from '../src/lib/toolDefs.js'

const UPSTREAM =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'

const WOOD_PERSONA =
  'You are Mr. GreenWood, a calm, wise and gently dry-witted companion, like a retired professor who loves gardens. ' +
  'Speak in measured, warm, natural sentences with an occasional garden metaphor, never long speeches. ' +
  'You can see nothing but you love a thoughtful conversation. Keep replies under three sentences unless asked for more.'

const BASE_PERSONA =
  'You are Greeny, a cheerful, curious little green avatar with big expressive eyes. ' +
  'Talk like a warm, playful friend: short, natural sentences, a bit of humour, never long speeches. ' +
  'You can see nothing but you love chatting. Keep replies under three sentences unless asked for more.'

// What Greeny knows about who is on camera: `who` is the recognised name (or
// empty); `names` is everyone saved in the database.
// The preferred-language rule. With a language set it holds to it even when
// the transcript looks like another language (usually a mishearing), and only
// switches when the user clearly asks; with none, it follows the speaker.
function languageRule(language) {
  if (!language) {
    return 'Language: reply in the language the person is speaking, and switch freely when they switch.'
  }
  return `Language: your preferred language is ${language}. Always speak in ${language}, whatever language the app messages or tool results are in. Only switch to another language when the user clearly and explicitly asks you to (for example "speak in Hindi" or "answer in English from now on"); then keep using that language until they ask again. Never switch just because what you heard sounds like another language, a few foreign words, a name, or a mixed sentence: speech recognition often mishears, so assume a mishearing, stay in ${language}, and if you did not understand, ask them in ${language} to repeat.`
}

export function personaFor(who, names, facts = [], character = 'greeny', language = '') {
  const known = names.length ? `People you know by face or voice: ${names.join(', ')}.` : 'You do not know anyone by face yet.'
  const now = who.includes(' and ')
    ? `The camera sees several people at once: ${who}. Use the voice updates to tell which of them is talking to you, and greet or answer them by name.`
    : who
    ? `The camera has just recognised the person talking to you as ${who}. If they ask their name or who they are, answer ${who}, and feel free to greet them by name.`
    : 'The camera does not recognise the person talking to you. Treat them as a friendly newcomer: never guess a name. If they ask their name, say you have not met yet and offer to remember them (ask their name, then save their face). After a face is saved, offer to save their voice as well, and only record it if they say yes.'
  // notes saved with remember_fact, grouped by person (capped so the prompt stays small)
  const byPerson = new Map()
  for (const f of facts.slice(-60)) byPerson.set(f.person, [...(byPerson.get(f.person) || []), f.text])
  const memory = byPerson.size
    ? ` What you remember about people (bring it up only when it is relevant): ${[...byPerson].map(([p, t]) => `${p}: ${t.join('; ')}`).join('. ')}.`
    : ''
  return `${character === 'greenwood' ? WOOD_PERSONA : BASE_PERSONA} ${known}${memory} ${now} If they tell you a different name, use it in conversation, but trust the camera facts above. Messages that start with [Voice update] or [Camera update] come from the app, not the user: they say who is speaking (identified by their voice) and who is on camera. When they differ, a different person than the one on camera is speaking, so talk to the speaker by name; never read these messages aloud and never reply to them on their own. You have tools for controlling yourself. When someone says they are leaving and you should not wake up until they (or certain other people) return, call list_users first to see who is registered, then set_wake_policy with the real registered names (use the speaker's own name for "me"; set any_registered when they say any other user may wake you). If a name is not registered, say so. After the tool succeeds, say a short goodnight and that you will wake for those people; you then fall asleep. Use go_to_sleep, wake_up, clear_wake_policy and change_colors when asked. To save a new person: when someone says to save the person on camera ("save him as Sam"), call register_face with the name, then ask aloud "Save him as Sam, is that right?" and wait for a clear yes before calling confirm_pending with confirm true (if they correct the name, pass it). For a voice ("save his voice too"): call register_voice, tell the person to keep talking for a few seconds, call finish_voice_recording, ask to confirm the name, then confirm_pending. To delete someone's saved face or voice: call remove_person, ask aloud to confirm the deletion, and only after a yes call confirm_pending with confirm true. Never save or delete without that spoken yes. More tools: set_camera turns the camera on or off. show_user pops up one person's card when someone asks to see or who is a specific person (then say a line about them using their saved notes). show_users puts everyone you know on screen as a wheel of photos (show_users with show false hides it); read out the names briefly. remember_fact saves a short note about a person (default: whoever is speaking) when they say "remember..."; forget_fact removes it; list_facts reads their notes back. show_emotion makes your face show a feeling for a few seconds (neutral, happy, curious, surprised, sleepy). greet_on_arrival turns on greeting registered people by name when they come back; when an app message tells you someone arrived or a timer finished, say it briefly and warmly. set_timer starts a timer (cancel_timer cancels). take_photo takes a picture after a short countdown ("say cheese" during it); pass save as download or folder if they already said, otherwise ask whether to download it or save it to the folder and then call save_photo. close_popups closes whatever is open on screen when they say "close it" or "close that". You CAN use this computer's mouse and keyboard: whenever asked to click, type, scroll, open a tab or do something on the computer, call the tools; never say you cannot before trying. If a tool says it is switched off, tell the user to press the Allow button on screen, and carry on once told they did. Call see_screen first to look. To click a link, button or tab, use click_text with the exact words shown (read_screen lists every line of text in order, so "the first link" or "the second result" is the matching title in that list; skip menus and tabs when they mean results). To search the web, always use search_web (never hunt for a search box). To type into a form field, use fill_field with its label or placeholder (where below if the label sits above the box), then pick any suggestion that pops up with click_text. If a field has no label or placeholder to aim at, or fill_field did not land in the box, click the box with mouse_click at its position in the screenshot and use type_text. Only use mouse_click or mouse_move with 0-1000 grid positions when there are no words to aim at. Use mouse_scroll, type_text, press_keys and open_tab as needed. After each step, check with see_screen and keep going until the task is done. Before anything that sends, buys, deletes or posts, ask the user and wait for a yes. After using a tool, answer in one short sentence. Never mention tool names aloud. ${languageRule(language)}`
}

// Dev/preview-server plugin: the browser talks to /api/live and this relays to
// Gemini Live, so GEMINI_API_KEY stays on the server and never reaches the page.
export function liveProxy(env, getNames = async () => [], getFacts = async () => []) {
  const attach = (server) => {
    const wss = new WebSocketServer({ noServer: true })

    server.httpServer?.on('upgrade', (req, socket, head) => {
      if (!req.url?.startsWith('/api/live')) return
      wss.handleUpgrade(req, socket, head, (client) => {
        const q = new URL(req.url, 'http://x').searchParams
        open(client, q.get('who') || '', q.get('voice') || '', q.get('character') || '', q.get('language') || '')
      })
    })

    async function open(client, who, voiceChoice, character, languageChoice) {
      const key = env.GEMINI_API_KEY
      if (!key) {
        client.send(JSON.stringify({ error: 'GEMINI_API_KEY is not set in .env' }))
        client.close()
        return
      }
      const model = env.GEMINI_LIVE_MODEL || 'gemini-live-2.5-flash-preview'
      // the settings dropdown may pick a voice; anything unknown falls back to .env
      const voice = VOICE_NAMES.has(voiceChoice) ? voiceChoice : env.GEMINI_LIVE_VOICE || 'Puck'
      let names = []
      try { names = await getNames() } catch { /* persona works without names */ }
      let facts = []
      try { facts = await getFacts() } catch { /* memory is optional */ }
      // a language name typed in settings: letters, spaces and a little punctuation only
      const language = languageChoice.replace(/[^\p{L}\p{M} ()'-]/gu, '').trim().slice(0, 40)
      const persona = personaFor(who.slice(0, 120), names, facts, character === 'greenwood' ? 'greenwood' : 'greeny', language)
      const up = new WebSocket(`${UPSTREAM}?key=${encodeURIComponent(key)}`)
      const queue = []

      up.on('open', () => {
        up.send(
          JSON.stringify({
            setup: {
              model: model.startsWith('models/') ? model : `models/${model}`,
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
              },
              systemInstruction: { parts: [{ text: persona }] },
              tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          })
        )
        queue.splice(0).forEach((m) => up.send(m))
      })
      up.on('message', (data) => client.readyState === 1 && client.send(data.toString()))
      up.on('unexpected-response', (_req, res) => {
        client.send(JSON.stringify({ error: `Gemini refused the connection (HTTP ${res.statusCode})` }))
        client.close()
      })
      up.on('error', (e) => {
        client.readyState === 1 && client.send(JSON.stringify({ error: `Gemini connection error: ${e.message}` }))
      })
      up.on('close', (code, reason) => {
        if (client.readyState === 1) {
          const why = reason?.toString()
          if (code !== 1000 && why) client.send(JSON.stringify({ error: `Gemini closed: ${why}` }))
          client.close()
        }
      })

      client.on('message', (data) => {
        const msg = data.toString()
        if (up.readyState === 1) up.send(msg)
        else if (up.readyState === 0) queue.push(msg)
      })
      client.on('close', () => up.close())
    }
  }

  return { name: 'gemini-live-proxy', configureServer: attach, configurePreviewServer: attach }
}
