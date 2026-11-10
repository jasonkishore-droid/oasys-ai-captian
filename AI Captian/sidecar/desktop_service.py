"""Desktop control for Greeny's mouse tools: move, click, scroll, type, keys,
open a browser tab, a screenshot so the model can see where to click, and
on-screen text search (Windows OCR) so it can click words and fill fields
precisely ("click AI Mode", "type Chennai in the From box").

Runs on 127.0.0.1 only; the dev server relays /api/desktop/* to it. Positions
are given on a 0..1000 grid over the primary screen (0,0 top left), which is
what the model reads off the screenshot. While Greeny is driving, a ring in the
avatar's colour follows the pointer (cursor_ring.py).

pyautogui's fail-safe stays on: slam the mouse into a screen corner to stop it.
"""
import asyncio
import base64
import ctypes
import re
from difflib import SequenceMatcher
import io
import os
import subprocess
import sys
import tempfile
import time
import webbrowser
from urllib.parse import quote_plus

# real pixels for both the screenshot and the mouse, whatever the display scaling
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass

import pyautogui
from flask import Flask, jsonify, request
from PIL import ImageDraw, ImageGrab

try:  # Windows' built-in OCR; the text tools need it, the rest work without
    from winrt.windows.graphics.imaging import BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap
    from winrt.windows.media.ocr import OcrEngine
    from winrt.windows.storage.streams import DataWriter
except Exception:
    OcrEngine = None

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.05

app = Flask(__name__)
HERE = os.path.dirname(os.path.abspath(__file__))
SHOT_W = 1280  # screenshots are scaled down to this width for the model
ring = {"proc": None, "color": "#93c572", "art_key": None, "art_dir": None, "sent": False}
ART_DIR = os.path.join(tempfile.gettempdir(), "greeny-cursor")


def save_art(art):
    """The pointer frames the browser drew (the Robot Face cursor in the avatar's
    colours), saved for the pointer window to load."""
    if not isinstance(art, dict) or not art.get("key") or art["key"] == ring["art_key"]:
        return
    os.makedirs(ART_DIR, exist_ok=True)
    for name in ("open", "blink", "press"):
        with open(os.path.join(ART_DIR, f"{name}.png"), "wb") as f:
            f.write(base64.b64decode(art[name]))
    ring["art_key"] = art["key"]
    ring["art_dir"] = ART_DIR
    ring["sent"] = False


def show_ring(color=None):
    """Start Greeny's pointer (or update it) and keep it visible for a few seconds."""
    if color:
        ring["color"] = color
    p = ring["proc"]
    if p is None or p.poll() is not None:
        p = ring["proc"] = subprocess.Popen(
            [sys.executable, "-u", os.path.join(HERE, "cursor_ring.py")],
            stdin=subprocess.PIPE,
            text=True,
        )
        ring["sent"] = False
    try:
        if ring["art_dir"] and not ring["sent"]:
            p.stdin.write(f"art {ring['art_dir']}\n")
            ring["sent"] = True
        p.stdin.write(f"show {ring['color']}\n")
        p.stdin.flush()
    except Exception:
        ring["proc"] = None


def type_any(text):
    """Types text into whatever has focus. pyautogui only types plain ASCII,
    so anything else (accents, Hindi, emoji) goes in through the clipboard."""
    if text.isascii():
        pyautogui.write(text, interval=0.03)
        return
    import tkinter as tk

    r = tk.Tk()
    r.withdraw()
    r.clipboard_clear()
    r.clipboard_append(text)
    r.update()
    pyautogui.hotkey("ctrl", "v")
    time.sleep(0.1)
    r.destroy()


def to_px(x, y):
    w, h = pyautogui.size()
    cx = max(0.0, min(1000.0, float(x))) / 1000.0
    cy = max(0.0, min(1000.0, float(y))) / 1000.0
    # stay one pixel inside the edge so the fail-safe corner is never hit by us
    return max(1, min(w - 2, round(cx * w))), max(1, min(h - 2, round(cy * h)))


def body():
    return request.get_json(silent=True) or {}


def log(msg):
    print(f"[desktop] {msg}"[:400], flush=True)


def foreground_title():
    u = ctypes.windll.user32
    buf = ctypes.create_unicode_buffer(512)
    u.GetWindowTextW(u.GetForegroundWindow(), buf, 512)
    return buf.value


def act(fn):
    """Runs a mouse/keyboard action and reports errors (incl. the fail-safe) as JSON."""
    args = {k: v for k, v in body().items() if k not in ("color", "cursor")}
    try:
        save_art(body().get("cursor"))
        show_ring(body().get("color"))
        out = fn() or {}
        log(f"{request.path} {args} -> {out}")
        return jsonify({"ok": True, **out, "cursor_art": ring["art_key"]})
    except (LookupError, ValueError) as e:  # text not found, bad input
        log(f"{request.path} {args} -> not done: {e}")
        return jsonify({"ok": False, "error": str(e)}), 404
    except pyautogui.FailSafeException:
        return jsonify({"ok": False, "error": "Stopped: the mouse was pushed into a screen corner (fail-safe)."}), 409
    except Exception as e:  # report, don't crash the service
        return jsonify({"ok": False, "error": str(e)}), 500


# ---- on-screen text (OCR) ----

def _norm(t):
    return re.sub(r"[^\w ]+", "", t.lower()).strip()


def greeny_rect():
    """The Greeny window when it is in front, so its own transcript is never
    mistaken for the thing to click."""
    try:
        u = ctypes.windll.user32
        hwnd = u.GetForegroundWindow()
        buf = ctypes.create_unicode_buffer(512)
        u.GetWindowTextW(hwnd, buf, 512)
        if "greeny" not in buf.value.lower():
            return None
        r = (ctypes.c_long * 4)()
        u.GetWindowRect(hwnd, r)
        return tuple(r)
    except Exception:
        return None


async def _ocr(img):
    eng = OcrEngine.try_create_from_user_profile_languages()
    w = DataWriter()
    w.write_bytes(img.tobytes())
    bmp = SoftwareBitmap.create_copy_from_buffer(
        w.detach_buffer(), BitmapPixelFormat.RGBA8, img.width, img.height, BitmapAlphaMode.PREMULTIPLIED
    )
    res = await eng.recognize_async(bmp)
    lines = []
    for ln in res.lines:
        words = []
        for wd in ln.words:
            r = wd.bounding_rect
            words.append((wd.text, (r.x, r.y, r.x + r.width, r.y + r.height)))
        if words:
            lines.append(words)
    return lines


def screen_lines():
    """Every line of text on the primary screen as [(word, (l, t, r, b)), ...]."""
    if OcrEngine is None:
        raise RuntimeError("Windows OCR is not available (pip install winrt-Windows.Media.Ocr and its companions).")
    lines = asyncio.run(_ocr(ImageGrab.grab().convert("RGBA")))
    skip = greeny_rect()
    if skip:
        l, t, r, b = skip
        lines = [ln for ln in lines if not (l <= ln[0][1][0] <= r and t <= ln[0][1][1] <= b)]
    return lines


def find_text(target, lines):
    """Places where `target` appears, in reading order (top to bottom, left to
    right). Matches whole phrases across words, ignoring case and punctuation,
    and tolerates small OCR slips. Only the best-matching places are kept."""
    want = _norm(target)
    n = max(1, len(want.split()))
    found = []
    for words in lines:
        for size in {n, n + 1, max(1, n - 1)}:
            for i in range(0, max(1, len(words) - size + 1)):
                chunk = words[i : i + size]
                text = _norm(" ".join(w for w, _ in chunk))
                if not text:
                    continue
                if text == want:
                    score = 1.0
                elif text.startswith(want) or (want.startswith(text) and len(text) >= 0.6 * len(want)):
                    score = 0.93
                else:
                    score = SequenceMatcher(None, want, text).ratio()
                if score >= 0.78:
                    box = (
                        min(r[0] for _, r in chunk),
                        min(r[1] for _, r in chunk),
                        max(r[2] for _, r in chunk),
                        max(r[3] for _, r in chunk),
                    )
                    # a label that stands alone (a tab, a button) beats the same
                    # word inside longer text ("Videos" vs "Short videos")
                    if len(chunk) == len(words):
                        score += 0.1
                    # among equal scores, the chunk closest to the wanted length wins
                    fit = -abs(len(text) - len(want))
                    found.append({"text": " ".join(w for w, _ in chunk), "score": score, "fit": fit, "box": box})
    # one result per spot: overlapping matches are the same place
    found.sort(key=lambda f: (-f["score"], -f["fit"]))
    overlaps = lambda a, b: a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]
    picked = []
    for f in found:
        if not any(overlaps(f["box"], p["box"]) for p in picked):
            picked.append(f)
    best = picked[0]["score"] if picked else 0
    picked = [f for f in picked if f["score"] >= best - 0.08]
    picked.sort(key=lambda f: (round(f["box"][1] / 12), f["box"][0]))
    return picked


def grid(x, y):
    w, h = pyautogui.size()
    return [round(x / w * 1000), round(y / h * 1000)]


def locate(text, occurrence=None):
    text = str(text or "").strip()
    if not text:
        raise ValueError("Say which text to look for.")
    hits = find_text(text, screen_lines())
    if not hits:
        raise LookupError(f'Could not find "{text}" on the screen. Call read_screen to check the exact wording.')
    k = max(1, int(occurrence or 1))
    if k > len(hits):
        raise LookupError(f'"{text}" appears only {len(hits)} time(s) on the screen.')
    return hits[k - 1], hits


@app.post("/read")
def read_screen():
    try:
        lines = screen_lines()
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    out = [{"text": " ".join(w for w, _ in words), "at": grid(words[0][1][0], words[0][1][1])} for words in lines[:220]]
    return jsonify({"ok": True, "lines": out, "note": "Each line's top-left on the 0-1000 grid, in reading order."})


@app.post("/click_text")
def click_text():
    b = body()

    def run():
        hit, hits = locate(b.get("text"), b.get("occurrence"))
        l, t, r, btm = hit["box"]
        x, y = (l + r) / 2, (t + btm) / 2
        pyautogui.moveTo(x, y, duration=0.4, tween=pyautogui.easeInOutQuad)
        button = "right" if b.get("button") == "right" else "left"
        pyautogui.click(button=button, clicks=2 if b.get("double") else 1, interval=0.08)
        return {"clicked": hit["text"], "at": grid(x, y), "matches_on_screen": len(hits)}

    return act(run)


@app.post("/fill")
def fill():
    b = body()

    def run():
        hit, hits = locate(b.get("field"), b.get("occurrence"))
        l, t, r, btm = hit["box"]
        h = btm - t
        # the text is the box's placeholder ("on"), or a label above ("below")
        # or to the left ("right") of the box
        where = b.get("where") or "on"
        x, y = (l + r) / 2, (t + btm) / 2
        if where == "below":
            x, y = l + 4 * h, btm + 1.6 * h
        elif where == "right":
            x, y = r + 5 * h, (t + btm) / 2
        pyautogui.moveTo(x, y, duration=0.4, tween=pyautogui.easeInOutQuad)
        pyautogui.click()
        time.sleep(0.15)
        if b.get("clear", True):
            pyautogui.hotkey("ctrl", "a")
            pyautogui.press("backspace")
        text = str(b.get("text") or "")[:2000]
        type_any(text)
        if b.get("enter"):
            pyautogui.press("enter")
        return {
            "clicked_near": hit["text"],
            "at": grid(x, y),
            "typed": text,
            "matches_on_screen": len(hits),
            "check": "Call see_screen to make sure the text landed in the right box.",
        }

    return act(run)


@app.get("/health")
def health():
    w, h = pyautogui.size()
    return jsonify({"ok": True, "screen": [w, h]})


@app.post("/screenshot")
def screenshot():
    img = ImageGrab.grab()  # primary screen
    w, h = img.size
    # mark where the pointer is, so the model knows where it starts from
    mx, my = pyautogui.position()
    d = ImageDraw.Draw(img)
    r = max(10, w // 120)
    d.ellipse([mx - r, my - r, mx + r, my + r], outline=(255, 0, 80), width=max(3, r // 3))
    scale = SHOT_W / w
    if scale < 1:
        img = img.resize((SHOT_W, round(h * scale)))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=70)
    return jsonify(
        {
            "ok": True,
            "image": base64.b64encode(buf.getvalue()).decode("ascii"),
            "mimeType": "image/jpeg",
            "pointer": [round(mx / w * 1000), round(my / h * 1000)],
        }
    )


@app.post("/move")
def move():
    b = body()
    return act(lambda: (pyautogui.moveTo(*to_px(b.get("x", 500), b.get("y", 500)), duration=0.45, tween=pyautogui.easeInOutQuad), None)[1])


@app.post("/click")
def click():
    b = body()

    def run():
        if b.get("x") is not None and b.get("y") is not None:
            pyautogui.moveTo(*to_px(b["x"], b["y"]), duration=0.45, tween=pyautogui.easeInOutQuad)
        button = "right" if b.get("button") == "right" else "middle" if b.get("button") == "middle" else "left"
        pyautogui.click(button=button, clicks=2 if b.get("double") else 1, interval=0.08)
        return {"clicked": button, "double": bool(b.get("double"))}

    return act(run)


@app.post("/scroll")
def scroll():
    b = body()
    steps = max(1, min(30, int(b.get("amount") or 5)))
    sign = 1 if b.get("direction") == "up" else -1
    return act(lambda: (pyautogui.scroll(sign * steps * 120), {"scrolled": b.get("direction") or "down"})[1])


@app.post("/type")
def type_text():
    text = str(body().get("text") or "")[:2000]
    return act(lambda: (type_any(text), {"typed": len(text)})[1])


@app.post("/keys")
def keys():
    combo = [k.strip().lower() for k in str(body().get("keys") or "").replace(" ", "").split("+") if k.strip()]
    bad = [k for k in combo if k not in pyautogui.KEYBOARD_KEYS]
    if not combo or bad:
        return jsonify({"ok": False, "error": f"Unknown key(s): {', '.join(bad) or 'none given'}"}), 400
    return act(lambda: (pyautogui.hotkey(*combo), {"pressed": "+".join(combo)})[1])


@app.post("/search")
def search():
    """A web search that does not depend on finding the search box: through the
    browser's address bar when a browser is in front, else in a new tab."""
    b = body()
    query = str(b.get("query") or "").strip()[:500]
    if not query:
        return jsonify({"ok": False, "error": "Say what to search for."}), 400

    def run():
        title = foreground_title()
        browser = any(n in title for n in ("Google Chrome", "Microsoft Edge", "Mozilla Firefox", "Brave", "Opera"))
        # never type over Greeny's own tab: search in a new tab instead
        if b.get("new_tab") or not browser or "greeny" in title.lower():
            webbrowser.open_new_tab("https://www.google.com/search?q=" + quote_plus(query))
            return {"searched": query, "in": "a new tab"}
        pyautogui.hotkey("ctrl", "l")
        time.sleep(0.15)
        type_any(query)
        pyautogui.press("enter")
        return {"searched": query, "in": title}

    return act(run)


@app.post("/open")
def open_tab():
    url = str(body().get("url") or "").strip() or "https://www.google.com"
    if "://" not in url:
        url = "https://" + url
    if not url.startswith(("http://", "https://")):
        return jsonify({"ok": False, "error": "Only web addresses can be opened."}), 400
    webbrowser.open_new_tab(url)
    return jsonify({"ok": True, "opened": url})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("DESKTOP_PORT", "8792"))
    print(f"[desktop] ready on {port}", flush=True)
    app.run(host="127.0.0.1", port=port, threaded=False)
