"""Greeny's pointer: while Greeny controls the mouse, the Robot Face cursor (from
the Cursor Design project, tinted with the avatar's colours) rides on the real
pointer, its tip on the click point. Like the original it tilts with speed,
blinks now and then, and on a click squishes, smiles and sends out a ripple.

A click-through, always-on-top layered window with per-pixel alpha, so the
glow and shadow stay soft. It hides a few seconds after the last command.
Commands on stdin (from desktop_service.py):
  show [#rrggbb]   stay visible a while (the colour tints the fallback ring)
  art <folder>     use open.png / blink.png / press.png from that folder
"""
import ctypes
import math
import os
import sys
import threading
import time
from ctypes import wintypes

from PIL import Image, ImageDraw

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

HOLD = 4.0  # seconds visible after the last command
SCALE = user32.GetDpiForSystem() / 96 if hasattr(user32, "GetDpiForSystem") else 1.0
ART = round(64 * SCALE)  # the cursor's size on screen (the original is 60 css px)
TIP = 6 / 100 * ART  # the click point inside the art
CANVAS = round(ART * 2.3)  # room to tilt and for the ripple; the tip sits at the centre
C = CANVAS // 2

state = {"until": 0.0, "color": "#93c572", "art": None, "alive": True}


def ring_art(color):
    """Fallback until the browser sends the robot face: a ring around the tip."""
    s = 4
    big = Image.new("RGBA", (ART * s, ART * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    w = 5 * s * SCALE
    d.ellipse([w, w, ART * s - w, ART * s - w], outline=color, width=round(w))
    r = ART * s / 10
    d.ellipse([ART * s / 2 - r, ART * s / 2 - r, ART * s / 2 + r, ART * s / 2 + r], fill=color)
    img = big.resize((ART, ART), Image.LANCZOS)
    return {"open": img, "blink": img, "press": img, "tip": ART / 2}


def load_art(folder):
    frames = {}
    for name in ("open", "blink", "press"):
        frames[name] = Image.open(os.path.join(folder, f"{name}.png")).convert("RGBA").resize((ART, ART), Image.LANCZOS)
    frames["tip"] = TIP
    return frames


def read_stdin():
    for line in sys.stdin:
        parts = line.strip().split(" ", 1)
        if not parts or not parts[0]:
            continue
        if parts[0] == "show":
            if len(parts) > 1 and parts[1].startswith("#"):
                state["color"] = parts[1]
            state["until"] = time.time() + HOLD
        elif parts[0] == "art" and len(parts) > 1:
            try:
                state["art"] = load_art(parts[1])
            except Exception as e:
                print(f"[desktop] cursor art not loaded: {e}", flush=True)
    state["alive"] = False  # the desktop service went away


# ---- a layered (per-pixel alpha) window ----

class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG), ("biHeight", wintypes.LONG),
        ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG), ("biYPelsPerMeter", wintypes.LONG),
        ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD),
    ]


class BLENDFUNCTION(ctypes.Structure):
    _fields_ = [("BlendOp", ctypes.c_ubyte), ("BlendFlags", ctypes.c_ubyte), ("SourceConstantAlpha", ctypes.c_ubyte), ("AlphaFormat", ctypes.c_ubyte)]


user32.CreateWindowExW.restype = wintypes.HWND
user32.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_int, ctypes.c_int,
                                   ctypes.c_int, ctypes.c_int, wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID]
user32.UpdateLayeredWindow.argtypes = [wintypes.HWND, wintypes.HDC, ctypes.POINTER(wintypes.POINT), ctypes.POINTER(wintypes.SIZE), wintypes.HDC,
                                       ctypes.POINTER(wintypes.POINT), wintypes.COLORREF, ctypes.POINTER(BLENDFUNCTION), wintypes.DWORD]
user32.GetDC.restype = wintypes.HDC
gdi32.CreateCompatibleDC.restype = wintypes.HDC
gdi32.CreateCompatibleDC.argtypes = [wintypes.HDC]
gdi32.CreateDIBSection.restype = wintypes.HBITMAP
gdi32.CreateDIBSection.argtypes = [wintypes.HDC, ctypes.c_void_p, wintypes.UINT, ctypes.POINTER(ctypes.c_void_p), wintypes.HANDLE, wintypes.DWORD]
gdi32.SelectObject.argtypes = [wintypes.HDC, wintypes.HGDIOBJ]

WS_POPUP = 0x80000000
EX = 0x80000 | 0x20 | 0x8 | 0x80 | 0x08000000  # layered, transparent, topmost, toolwindow, noactivate


class Overlay:
    def __init__(self):
        self.hwnd = user32.CreateWindowExW(EX, "STATIC", None, WS_POPUP, 0, 0, CANVAS, CANVAS, None, None, None, None)
        self.screen = user32.GetDC(None)
        self.mem = gdi32.CreateCompatibleDC(self.screen)
        bmi = BITMAPINFOHEADER(ctypes.sizeof(BITMAPINFOHEADER), CANVAS, -CANVAS, 1, 32, 0, 0, 0, 0, 0, 0)
        self.bits = ctypes.c_void_p()
        self.bmp = gdi32.CreateDIBSection(self.screen, ctypes.byref(bmi), 0, ctypes.byref(self.bits), None, 0)
        gdi32.SelectObject(self.mem, self.bmp)
        self.visible = False

    def draw(self, img, x, y):
        data = img.convert("RGBa").tobytes("raw", "BGRa")  # premultiplied, as Windows wants
        ctypes.memmove(self.bits, data, len(data))
        blend = BLENDFUNCTION(0, 0, 255, 1)
        user32.UpdateLayeredWindow(self.hwnd, self.screen, ctypes.byref(wintypes.POINT(x, y)), ctypes.byref(wintypes.SIZE(CANVAS, CANVAS)),
                                   self.mem, ctypes.byref(wintypes.POINT(0, 0)), 0, ctypes.byref(blend), 2)

    def show(self, on):
        if on != self.visible:
            user32.ShowWindow(self.hwnd, 4 if on else 0)  # SW_SHOWNOACTIVATE / SW_HIDE
            self.visible = on

    def pump(self):
        msg = wintypes.MSG()
        while user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, 1):
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))


def main():
    threading.Thread(target=read_stdin, daemon=True).start()
    ov = Overlay()
    pt = wintypes.POINT()
    last = None
    vx = tilt = 0.0
    press = 0.0  # 0 rest .. 1 fully pressed
    ripple_at = -1.0
    was_down = False
    next_blink = time.time() + 2.5
    blink_until = 0.0

    while state["alive"]:
        ov.pump()
        now = time.time()
        if now >= state["until"]:
            ov.show(False)
            last = None
            time.sleep(0.05)
            continue

        user32.GetCursorPos(ctypes.byref(pt))
        if last is not None:
            vx = vx * 0.6 + (pt.x - last[0]) * 0.4 / SCALE
        last = (pt.x, pt.y)
        vx *= 0.88
        tilt += (max(-14, min(14, vx * 1.1)) - tilt) * 0.18

        down = bool(user32.GetAsyncKeyState(0x01) & 0x8000) or bool(user32.GetAsyncKeyState(0x02) & 0x8000)
        if down and not was_down:
            ripple_at = now
        was_down = down
        press += ((1.0 if down else 0.0) - press) * 0.45

        if now >= next_blink:
            blink_until = now + 0.12
            next_blink = now + 3.0 + (now * 7.3) % 2.5

        art = state["art"] or ring_art(state["color"])
        frame = art["press"] if press > 0.5 else art["blink"] if now < blink_until else art["open"]
        tip = art["tip"]

        canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
        # neon ripple from the tip after a click
        t = (now - ripple_at) / 0.5
        if 0 <= t < 1:
            r = t * ART * 0.75
            a = round(255 * (1 - t))
            col = state["color"].lstrip("#")
            rgb = tuple(int(col[i : i + 2], 16) for i in (0, 2, 4)) if len(col) == 6 else (255, 255, 255)
            ImageDraw.Draw(canvas).ellipse([C - r, C - r, C + r, C + r], outline=rgb + (a,), width=max(2, round(3 * SCALE)))
        # squish around the tip, then tilt around it, so the click point never moves
        s = 1 - 0.14 * press
        img = frame.resize((max(1, round(ART * s)), max(1, round(ART * s))), Image.BILINEAR) if s < 0.999 else frame
        layer = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
        layer.paste(img, (round(C - tip * s), round(C - tip * s)), img)
        if abs(tilt) > 0.3:
            layer = layer.rotate(-tilt, resample=Image.BICUBIC, center=(C, C))
        canvas.alpha_composite(layer)

        ov.draw(canvas, pt.x - C, pt.y - C)
        ov.show(True)
        time.sleep(1 / 60)


if __name__ == "__main__":
    main()
