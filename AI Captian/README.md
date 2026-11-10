# AI Captain

A tablet waiter on a round dining table. The face lives on the tablet's screen:
it turns toward you on its stand, recognises who is sitting there, talks with
you out loud (Gemini Live) and takes your order, showing the bill, the
e-receipt and every other order step right on the screen. Camera inference
runs in the browser; no video leaves your machine.

Split out of the Greeny project: only the tablet-on-table view, plus the whole
backend.

## Run

```bash
npm install
npm run dev:lan  # https://localhost:5444 and https://<this PC's IP>:5444 (self-signed: accept the warning once per device)
npm run dev      # http://localhost:5173 (this machine only)
npm run build    # production build in dist/
npm run preview  # serve the production build
```

Copy `.env.example` to `.env` and fill it in (Gemini API key, Oasys Bay, ports).
The camera and mic need a secure context: `localhost` or HTTPS.

## What it does

| Feature | Model / service | Runs on |
| --- | --- | --- |
| People and 80 object classes | YOLOv8n (ONNX) | ONNX Runtime Web (WASM worker, multithreaded) |
| Face lock | YuNet (ONNX) | ONNX Runtime Web |
| Who is it | SFace (ONNX) + saved faces | ONNX Runtime Web, SQLite |
| Who is speaking | SpeechBrain ECAPA | `sidecar/voice_service.py` |
| Voice chat and tools | Gemini Live | `server/liveProxy.js` relay |
| Mouse and keyboard tools | | `sidecar/desktop_service.py` |
| Menu and orders | Oasys Bay club app | `server/oasysApi.js` |

Drag to orbit the table, scroll to zoom, double-click to reset the view.
Settings (gear in the dock) persist in `localStorage`, including a light / dark
/ system theme.

## Layout

```
src/
  App.jsx               state, tools context, popups, dock, camera preview
  three/TabletBot3D.jsx the scene: tablet on its stand, the table, plates and chairs; face + order panels drawn on the screen
  SettingsPanel.jsx     the gear menu
  settings.js           defaults, persisted settings, theme
  usePersonTracker.js   camera + YOLO + YuNet + SFace loop
  useLive.js            Gemini Live voice chat
  tools.js, lib/toolDefs.js   the voice tools
  styles/               tokens.css (palette, light theme), tablet.css, ui.css
server/                 dev-server API: faces, voices, facts, photos, desktop, Oasys Bay, Live relay; db/ (SQLite + migrations)
sidecar/                Python helpers: voice ID, desktop control
public/models/          yolov8n-f32.onnx, yunet.onnx, sface.onnx
data/                   the database and saved photos (not in git)
```

See `TOOLS.md` for the tool list.

## Model licences

- **YOLOv8n**: Ultralytics, AGPL-3.0. Check the terms before distributing a
  product that bundles it.
- **YuNet**, **SFace**: OpenCV Zoo.
