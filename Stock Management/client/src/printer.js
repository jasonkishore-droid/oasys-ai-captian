// PrintOD Bluetooth printing (D:\printer_connect\ble).
//
// The PrintOD app on the POS terminal runs a BLE "receiver" that waits for a sender. This module is that sender:
// it connects over Web Bluetooth, sends ESC/POS bytes in frames of [flag, ...up to 100 bytes] (flag 1 = last frame),
// and waits for PrintOD's reply on the notify characteristic ("OK" or "ERR <reason>") once its 58 mm printer is done.
//
// Web Bluetooth needs Chrome or Edge, and a secure page: https://… or http://localhost.
import { useSyncExternalStore } from 'react';
import { showUpiQr, billUpiLink, qrEscPos } from './upi.js';

const SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // we write jobs here
const TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // PrintOD notifies "OK" / "ERR …" here
const CHUNK = 100;
const REPLY_TIMEOUT_MS = 20000;
const AUTO_KEY = 'vasamo.printod.autoprint';
// Once connected, the printer stays connected: if the link drops (out of range, PrintOD restarted,
// the radio slept) it is reconnected by itself, retrying with a growing pause. Only pressing
// Disconnect stops that, and the choice is remembered across reloads.
const KEEP_KEY = 'vasamo.printod.keep';
const RETRY_MS = [1000, 2000, 4000, 8000, 15000]; // then every 15 s

let state = { status: 'disconnected', name: '', error: '', busy: false, autoPrint: readAuto() };
let device = null;
let rx = null;
let waiting = null; // { resolve, reject, timer } for the job in flight
let queue = Promise.resolve();
const listeners = new Set();
let keep = readKeep(); // stay connected (false only after the user pressed Disconnect)
let retryTimer = 0;
let retries = 0;

function readKeep() {
  try { return localStorage.getItem(KEEP_KEY) !== 'false'; } catch { return true; }
}
function setKeep(on) {
  keep = on;
  try { localStorage.setItem(KEEP_KEY, String(on)); } catch { /* private mode */ }
}

function readAuto() {
  try { return localStorage.getItem(AUTO_KEY) !== 'false'; } catch { return true; }
}
function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const supported = () => typeof navigator !== 'undefined' && !!navigator.bluetooth && window.isSecureContext;
export const unsupportedReason = () => {
  if (typeof navigator === 'undefined' || !navigator.bluetooth) return 'This browser has no Bluetooth support. Use Chrome or Edge.';
  if (!window.isSecureContext) return 'Bluetooth needs https:// or http://localhost. Open the app on a secure address.';
  return '';
};

export const getState = () => state;

export function usePrinter() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}

export function setAutoPrint(on) {
  try { localStorage.setItem(AUTO_KEY, String(on)); } catch { /* private mode */ }
  set({ autoPrint: on });
}

function onReply(e) {
  const text = new TextDecoder().decode(e.target.value).trim();
  if (!waiting) return;
  const { resolve, reject, timer } = waiting;
  clearTimeout(timer);
  waiting = null;
  if (text.startsWith('OK')) resolve(text);
  else reject(new Error(`Printer: ${text.replace(/^ERR\s*/, '') || 'error'}`));
}

function onDisconnected() {
  rx = null;
  if (waiting) { clearTimeout(waiting.timer); waiting.reject(new Error('Printer disconnected')); waiting = null; }
  if (keep && device) {
    set({ status: 'connecting', busy: false });
    scheduleRetry();
  } else {
    set({ status: 'disconnected', busy: false });
  }
}

// Try again after a pause; keeps going until it connects or the user presses Disconnect.
function scheduleRetry() {
  clearTimeout(retryTimer);
  if (!keep || !device) return;
  const wait = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)];
  retries += 1;
  retryTimer = setTimeout(async () => {
    if (!keep || !device || rx) return;
    try {
      await attach(device);
    } catch {
      set({ status: 'connecting' });
      scheduleRetry();
    }
  }, wait);
}

async function attach(dev) {
  device = dev;
  device.removeEventListener('gattserverdisconnected', onDisconnected);
  device.addEventListener('gattserverdisconnected', onDisconnected);
  set({ status: 'connecting', name: dev.name || 'PrintOD', error: '' });
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE);
  rx = await service.getCharacteristic(RX);
  const tx = await service.getCharacteristic(TX);
  await tx.startNotifications();
  tx.removeEventListener('characteristicvaluechanged', onReply);
  tx.addEventListener('characteristicvaluechanged', onReply);
  clearTimeout(retryTimer);
  retries = 0;
  set({ status: 'connected', name: dev.name || 'PrintOD', error: '' });
}

/** Opens the browser's device picker (must be called from a click). Shows only devices running the PrintOD receiver. */
export async function connect() {
  const why = unsupportedReason();
  if (why) { set({ error: why }); throw new Error(why); }
  try {
    const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE] }] });
    setKeep(true); // the user chose a printer: keep it connected from now on
    await attach(dev);
  } catch (e) {
    const msg = e.name === 'NotFoundError' ? 'No printer chosen. Is PrintOD open on the Receiver tab and started?' : e.message;
    set({ status: 'disconnected', error: msg });
    throw new Error(msg);
  }
}

/** Reconnects to the last chosen printer without the picker (if the browser remembers it).
 *  Does nothing after the user pressed Disconnect, until they connect again. */
export async function reconnect() {
  if (rx || !supported() || !keep) return false;
  try {
    let dev = device;
    if (!dev && navigator.bluetooth.getDevices) {
      const known = await navigator.bluetooth.getDevices();
      dev = known.find((d) => (d.name || '').length) || known[0];
    }
    if (!dev) return false;
    await attach(dev);
    return true;
  } catch {
    // the printer is known but not answering yet (PrintOD not started, out of range): keep trying
    if (keep && device) {
      set({ status: 'connecting' });
      scheduleRetry();
    } else {
      set({ status: 'disconnected' });
    }
    return false;
  }
}

/** The user's Disconnect: the only thing that stops the printer from reconnecting by itself. */
export function disconnect() {
  setKeep(false);
  clearTimeout(retryTimer);
  retries = 0;
  const dev = device;
  device = null; // before gatt.disconnect(), so onDisconnected does not start retrying
  dev?.gatt?.disconnect();
  rx = null;
  set({ status: 'disconnected', name: '' });
}

/** Sends one ESC/POS job and resolves when PrintOD replies "OK". Jobs are queued so two bills never interleave. */
export function printBytes(bytes) {
  const job = queue.then(async () => {
    if (!rx && !(await reconnect())) throw new Error('Printer not connected');
    set({ busy: true, error: '' });
    try {
      const done = new Promise((resolve, reject) => {
        waiting = { resolve, reject, timer: setTimeout(() => { waiting = null; reject(new Error('Printer did not confirm in time')); }, REPLY_TIMEOUT_MS) };
      });
      // Waiting for an acknowledgement on every frame costs a radio round trip each time, which made bills with a
      // UPI QR (about 5 KB of raster, so about 50 frames) take several seconds. PrintOD's RX characteristic also
      // accepts write-without-response, so the middle frames are streamed and only the last frame is acknowledged.
      // BLE delivers writes on one connection in order, so that final acknowledgement also covers the earlier frames.
      let fast = typeof rx.writeValueWithoutResponse === 'function';
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const part = bytes.slice(i, i + CHUNK);
        const last = i + CHUNK >= bytes.length;
        const frame = new Uint8Array(part.length + 1);
        frame[0] = last ? 1 : 0;
        frame.set(part, 1);
        if (last || !fast) await rx.writeValueWithResponse(frame);
        else {
          try { await rx.writeValueWithoutResponse(frame); }
          catch { fast = false; await rx.writeValueWithResponse(frame); } // the stack refused it: fall back for the rest
        }
      }
      return await done;
    } catch (e) {
      if (waiting) { clearTimeout(waiting.timer); waiting = null; }
      set({ error: e.message });
      throw e;
    } finally {
      set({ busy: false });
    }
  });
  queue = job.catch(() => {});
  return job;
}

// ---------------------------------------------------------------------------
// ESC/POS layout for PrintOD's 58 mm printer (32 characters per line).
// Thermal printers use a single-byte code page, so text is reduced to plain ASCII ("₹" becomes "Rs").
const COLS = 32;
const ESC = 0x1b;
const GS = 0x1d;
const ascii = (s) => String(s ?? '').replace(/₹/g, 'Rs').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '?');
const amt = (n) => Number(n || 0).toFixed(2);

class Esc {
  constructor() { this.b = [ESC, 0x40]; }
  raw(...x) { this.b.push(...x); return this; }
  align(a) { return this.raw(ESC, 0x61, { left: 0, center: 1, right: 2 }[a]); }
  bold(on) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  big(on) { return this.raw(GS, 0x21, on ? 0x11 : 0x00); }
  line(s = '') { for (const ch of ascii(s)) this.b.push(ch.charCodeAt(0)); this.b.push(0x0a); return this; }
  wrap(s, width = COLS) {
    const words = ascii(s).split(' ');
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > width) { if (cur) this.line(cur); cur = w; } else cur = (cur + ' ' + w).trim();
    }
    if (cur) this.line(cur);
    return this;
  }
  pair(l, r, width = COLS) { l = ascii(l); r = ascii(r); return this.line(l.slice(0, width - r.length - 1) + ' '.repeat(Math.max(1, width - l.length - r.length)) + r); }
  rule(ch = '-') { return this.line(ch.repeat(COLS)); }
  feed(n = 4) { return this.raw(ESC, 0x64, n); }
  bytes() { return Uint8Array.from(this.b); }
}

export function billToEscPos(bill, settings, { draft = false } = {}) {
  const r = settings.restaurant;
  const half = bill.tax_rate / 2;
  const when = new Date(bill.created_at || Date.now()).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const type = { dine_in: 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery' }[bill.order_type] || '';
  const p = new Esc();

  if (draft) p.align('center').bold(true).line('** PREVIEW - NOT SAVED **').bold(false);
  if (bill.status === 'void') p.align('center').bold(true).line('*** VOID ***').bold(false);
  p.align('center').bold(true).big(true).line(r.name.toUpperCase()).big(false).bold(false);
  p.line(r.tagline);
  p.wrap(r.address);
  if (r.phone) p.line(`Ph: ${r.phone}`);
  if (r.gstin) p.line(`GSTIN: ${r.gstin}`);
  if (r.fssai) p.line(`FSSAI: ${r.fssai}`);
  p.bold(true).line('TAX INVOICE').bold(false);
  p.align('left').rule();
  p.pair('Bill No', bill.bill_no || 'DRAFT');
  p.pair('Date', when);
  p.pair('Type', `${type}${bill.table_no ? ` / ${bill.table_no}` : ''}`);
  if (bill.customer) p.pair('Guest', bill.customer);
  if (bill.cashier) p.pair('Cashier', bill.cashier);
  p.rule();
  p.pair('Item', 'Amount');
  p.rule();
  for (const l of bill.items) {
    p.wrap(l.name);
    p.pair(`  ${l.quantity} x ${amt(l.unit_price)}`, amt(l.line_total ?? l.quantity * l.unit_price));
  }
  p.rule();
  p.pair('Subtotal', amt(bill.subtotal));
  if (bill.discount > 0) p.pair('Discount', `-${amt(bill.discount)}`);
  if (bill.service_charge > 0) p.pair(`Service ${bill.service_rate}% (opt.)`, amt(bill.service_charge));
  p.pair('Taxable value', amt(bill.taxable));
  p.pair(`CGST @ ${half}%`, amt(bill.cgst));
  p.pair(`SGST @ ${half}%`, amt(bill.sgst));
  if (bill.round_off) p.pair('Round off', `${bill.round_off > 0 ? '+' : ''}${amt(bill.round_off)}`);
  p.rule('=');
  p.bold(true).big(true).pair('TOTAL', `Rs ${amt(bill.total)}`, COLS / 2).big(false).bold(false);
  p.rule('=');
  if (bill.payment_mode) p.pair('Paid by', String(bill.payment_mode).toUpperCase());
  if (showUpiQr(settings, bill)) {
    p.line('').align('center').bold(true).line(`Scan to pay Rs ${amt(bill.total)} by UPI`).bold(false);
    p.raw(...qrEscPos(billUpiLink(settings, bill))).raw(0x0a);
    p.line(settings.upi.upi_id);
  }
  p.align('center').line('').line('Nandri! Thank you for dining').line('with us. Please visit again.');
  return p.feed(4).bytes();
}

export function testPage(settings) {
  const p = new Esc().align('center').bold(true).big(true).line(settings.restaurant.name.toUpperCase()).big(false).bold(false);
  p.line('PrintOD printer connected').line(new Date().toLocaleString('en-IN')).align('left').rule();
  p.pair('Left', 'Right').line('0123456789'.repeat(3).slice(0, COLS)).rule();
  return p.align('center').line('Test page OK').feed(4).bytes();
}
