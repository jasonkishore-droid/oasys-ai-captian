# Greeny voice tools

Everything Greeny can do (or could do) when you ask by voice. Tools are declared
in `src/lib/toolDefs.js` and run in `src/tools.js`. To add one, declare it in the
first file and add a handler with the same name in the second.

Numbers are from the original 50-item list. `show_users` and `show_user` were
added later and have no number.

## Built (37)

| Group | Tool | What it does |
|---|---|---|
| People | `list_users` | Who is registered, who is on camera, who is speaking, awake or asleep. |
| People | `register_face` | Save the new person on camera ("save him as Sam"). |
| People | `register_voice` | Record someone's voice. |
| People | `finish_voice_recording` | Wait until the voice sample is long enough. |
| People | `confirm_pending` | Complete or cancel a save or delete after your spoken yes. |
| People | `remove_person` | Delete a face, a voice, or both. |
| Sleep | `set_wake_policy` | Choose who may wake it, and sleep now. |
| Sleep | `clear_wake_policy` | Let anyone wake it again. |
| Sleep | `go_to_sleep` | Go to sleep. |
| Sleep | `wake_up` | Wake up. |
| Camera | `set_camera` | Turn the camera on or off. |
| Memory | `remember_fact` | Save a short note about a person ("I like green tea"). |
| Memory | `forget_fact` | Remove a saved note. |
| Memory | `list_facts` | Read someone's notes back. |
| Time | `set_timer` | "Remind me in 10 minutes." |
| Time | `cancel_timer` | Cancel a timer. |
| Time | `greet_on_arrival` | Say hello by name when a recognised person arrives. |
| Look | `change_colors` | Eye and face colour. |
| Look | `show_emotion` | "Look happy", "act surprised" (neutral, happy, curious, surprised, sleepy). |
| Display | `show_users` | Show everyone saved as a turning wheel on the right ("show all users"). |
| Display | `show_user` | Pop up one person's card ("show me Sam"). |
| Camera | `take_photo` | Countdown, then a photo with Download / Save to folder (`data/photos`). |
| Camera | `save_photo` | Download, save or close the photo just taken ("download it"). |
| Display | `close_popups` | Close whatever is open on screen ("close it"). |
| Computer | `see_screen` | Screenshot of this PC sent to Greeny so it can see where to click. |
| Computer | `click_text` | Click words on screen, found by reading the screen ("click AI Mode", "the first result"). |
| Computer | `fill_field` | Click a form field by its label or placeholder ("From", "To") and type into it. |
| Computer | `read_screen` | All the text on screen, line by line with positions. |
| Computer | `mouse_move` | Move the real mouse (0-1000 grid over the screen). |
| Computer | `mouse_click` | Left, right or double click, at a point or where the pointer is. |
| Computer | `mouse_scroll` | Scroll up or down. |
| Computer | `type_text` | Type into whatever has focus. |
| Computer | `press_keys` | Keys and shortcuts ("enter", "ctrl+t", "alt+tab"). |
| Computer | `open_tab` | Open a new browser tab, at a site if named. |
| Oasys Restaurant | `get_menu` | What the restaurant has available, with prices in rupees ("what dosas do you have?"). With `diet` (veg, egg, vegan, jain) and/or `avoid` (onion, garlic, nuts, gluten, seafood, ...) only what fits: "I'm Jain", "no onion", "I have a nut allergy". The filter is remembered for the table until the tab is paid, and `place_order` flags a dish that doesn't fit it. |
| Oasys Restaurant | `place_order` | Match the spoken items, check stock and read the items back. Shows the order card. Does not ask about payment and saves nothing yet. |
| Oasys Restaurant | `confirm_order` | After the guest's yes (or Confirm on the card): ask how they will pay (cash, UPI or card, spoken or tapped on the card), then create the bill in Stock Management with that payment mode (stock deducted) and offer an e-receipt. |
| Oasys Restaurant | `order_status` | Where is the food? Reads the kitchen's stage for each round on the table's open tab (received, being cooked, ready, on its way, served) and who is bringing it. Read-only: shows no card and promises no time. |
| Oasys Restaurant | `print_receipt` | Print a paper receipt for the order just placed on the restaurant's Bluetooth printer (needs the Stock Management app open with the printer connected). |
| Oasys Restaurant | `set_receipt_email` | Take the e-receipt address (said, or typed on the card) and spell it back for confirmation. Sends nothing. |
| Oasys Restaurant | `send_receipt` | Email the e-receipt, only after the guest confirmed the address ("Yes, send" on the card or a spoken yes). |
| Table | `call_waiter` | Call a person to the table ("can someone come over?", "some water please"), with a reason (help, water, bill, cutlery, clean, other). Same as the tablet's "Call waiter" button. Calling again reminds the staff. Needs the table number set, but not "Connect to Oasys Restaurant". |
| Table | `cancel_waiter_call` | Cancel the table's waiter call when the guest no longer needs it. |
| Oasys Restaurant | `rate_meal` | After payment and receipts: without a rating it shows the 1-5 star card ("No thanks" on the receipt card and "Done" after an e-receipt lead there too); with a rating it saves it, with what they liked / what could be better and a comment. Rating again updates the same bill. On 1-2 stars Greeny apologises and offers a manager (`call_waiter`). |

Ratings are saved one per bill in the `feedback` table of `data/tabs.sqlite3` (no guest name or face), through
`server/inventory/feedback.js`: `POST /api/oasys/feedback { bill_no, rating, liked?, improve?, comment? }`, and
`GET /api/oasys/feedback?since_id=&limit=` for the manager screens (count, average, newest first).
Star and tag taps on the card run `rating_pick` in `src/tools.js`, which is not a voice tool.

The waiter calls live in `data/tabs.sqlite3` and are served by `server/inventory/waiter.js` under
`/api/oasys/waiter/*`: the tablet polls `GET /api/oasys/waiter?table_no=`, and the staff screen (the KDS, F9)
polls `GET /api/oasys/waiter/calls` and answers with `POST /api/oasys/waiter/ack { id, by }` and `/done { id }`.
When a waiter acknowledges, the tablet shows "A waiter is on the way" and Greeny tells the guest.

**Dietary filters (F3).** The tags are kept with the menu in `Menue Card/src/dietary.js` and matched to the
till's dishes by name (`MENU_CARD_DIR` if that folder is elsewhere). `show_menu` takes the same `diet` / `avoid`
and shows only the dishes that fit, each marked if it needs its sambar and chutneys swapped or is not yet confirmed.
Tags only count as confirmed once the owner has signed them off:

1. `node scripts/check-dietary.mjs` (in Menue Card) writes `dietary-review.csv`.
2. The owner / head chef goes through it with the kitchen: fixes the "Dish tags" column where needed, then
   puts Y in "Correct? (Y/N)", or N with a note.
3. `node scripts/apply-dietary-review.mjs dietary-review.csv --by "Name"` writes `src/dietary-signoff.json`.
   The server picks it up straight away. Run steps 1-3 again as more rows are done (step 1 keeps what is signed off).

Until a dish is signed off, Greeny says it "should fit" but the guest must check with staff. For any allergy it
always tells the guest to tell the staff too (shared kitchen, asafoetida that can contain wheat), and never calls
a dish safe.

The Oasys Restaurant tools need "Connect to Oasys Restaurant" switched on in Settings (Tracking tab) or the tablet's gear menu and the
Stock Management app running. `server/oasysApi.js` relays `/api/oasys/*` to `INVENTORY_API_URL`
(default `http://127.0.0.1:4020`) and adds `ORDER_API_KEY`, which must match the same key in
`Stock Management/server/.env`. The key stays on the server and never reaches the browser.

The Computer tools need "Let Greeny use the mouse" switched on in Settings, and
only work from a browser on the Greeny PC itself (`DESKTOP_ALLOW_LAN=1` in `.env`
lets other devices use them). A ring in the avatar's colour follows the pointer
while Greeny is driving. Push the mouse into a screen corner to stop it.
`click_text`, `fill_field` and `read_screen` use Windows' built-in OCR
(`pip install winrt-Windows.Media.Ocr` and its companion `winrt-*` packages).

## Still to build (34)

### People
- 7 `rename_person`: "His name is actually Sam."
- 8 `who_is_here`: a quick "who's around?" (mostly covered by `list_users`).
- 9 `onboard_person`: one guided "meet Sam" flow for face, voice and confirmation.
- 10 `guest_mode`: call a stranger by a name for this session only, nothing saved.
- 11 `merge_people`: fix duplicates ("Sam and Samuel are the same person").
- 12 `focus_on_person`: "Watch Sam" when several people are in view.

### Sleep and presence
- 17 `set_sleep_delay`: "Sleep after 2 minutes without a face."
- 18 `wake_at`: "Wake me at 8 am" (only while the page stays open).
- 19 `do_not_disturb`: "Don't talk until I say so." It listens but stays silent.
- 20 `wake_word`: respond only when you say "Hey Greeny".
- 21 `mute_for`: "Stop listening for 5 minutes."

### Camera and privacy
- 23 `privacy_mode`: camera off and mic stopped together.
- 25 `describe_scene`: "What am I holding?" Sends camera pictures to Gemini, so it asks permission first.

### Notes and logs
- 27 `take_note` / `read_notes`: "Note: buy milk", "what were my notes?"
- 28 `visit_log`: record who arrives and when ("when did Sam last come?", "who came today?").
- 29 `stranger_alert`: "Tell me if someone I don't know shows up."

### Time
- 31 `set_reminder`: at a clock time or repeating ("every hour, remind me to stretch").
- 32 `focus_session`: a work timer where it stays quiet, then speaks at the break.

### Character and look
- 36 `look_at`: look left, right, or at you.
- 37 `set_expressiveness`: "Be more expressive."
- 38 `set_style`: Studio or Classic.
- 39 `toggle_hands` / `toggle_3d`: for the Classic avatar.
- 40 `set_theme`: light or dark interface.

### Voice and personality
- 41 `change_voice`: "Use the Fenrir voice" (restarts the chat).
- 42 `set_personality`: "Be more formal", "be funny", "talk like a teacher."
- 43 `set_reply_length`: "Keep answers short."
- 44 `set_speech_speed`: "Talk slower."
- 45 `set_language`: "Speak Tamil", or a translator mode between two people.
- 46 `introduce`: "Introduce yourself to Sam."

### Tracking
- 47 `set_tracking`: "Stop tracking objects", "people only."

### Outside the app
- 48 `get_time_date`: needs nothing external.
- 49 `get_weather`: needs an outside weather service.
- 50 `call_webhook`: trigger lights or smart home through a URL you set up.

## Suggested next five

`visit_log`, `rename_person`, `onboard_person`, `set_personality`, `change_voice`.
They reuse data and code that already exist.
