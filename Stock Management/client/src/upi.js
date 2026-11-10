// UPI "scan to pay" QR for bills. Any UPI app (GPay, PhonePe, Paytm, BHIM…) reads the standard upi://pay link:
// payee VPA, payee name, exact amount and the bill number as the note, so the guest only has to confirm.
import QRCode from 'qrcode';

export function showUpiQr(settings, bill) {
  const upi = settings.upi;
  if (!upi?.enabled || !upi.upi_id || !bill || bill.status === 'void' || !(bill.total > 0)) return false;
  if (upi.only_upi_bills && bill.payment_mode !== 'upi') return false;
  return true;
}

export function upiLink(upi, { amount, note, payeeFallback }) {
  const q = new URLSearchParams({ pa: upi.upi_id, pn: (upi.payee_name || payeeFallback || '').slice(0, 50), cu: 'INR' });
  if (amount > 0) q.set('am', Number(amount).toFixed(2));
  if (note) q.set('tn', note.slice(0, 80));
  // Keep "@" literal in the VPA as in NPCI's examples; some UPI apps reject "%40".
  return `upi://pay?${q.toString().replace(/\+/g, '%20').replace(/%40/g, '@')}`;
}

export const billUpiLink = (settings, bill) =>
  upiLink(settings.upi, { amount: bill.total, note: `${settings.restaurant.name} bill ${bill.bill_no || ''}`.trim(), payeeFallback: settings.restaurant.name });

// QR module matrix → crisp SVG path (no anti-aliasing blur, scales to any size).
export function qrSvgPath(text) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(y, x)) d += `M${x} ${y}h1v1h-1z`;
  return { size: n, d };
}

// QR → ESC/POS raster (GS v 0), the same command PrintOD's own QR printing uses. Each module becomes a
// square of `scale` dots; 5 dots (~0.6 mm) per module on a 203 dpi head scans reliably and keeps the job small.
export function qrEscPos(text, { maxDots = 232, quiet = 2 } = {}) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const scale = Math.max(2, Math.floor(maxDots / (n + quiet * 2)));
  const w = Math.ceil(((n + quiet * 2) * scale) / 8) * 8;
  const h = (n + quiet * 2) * scale;
  const rowBytes = w / 8;
  const bits = new Uint8Array(rowBytes * h);
  for (let y = 0; y < h; y++) {
    const my = Math.floor(y / scale) - quiet;
    for (let x = 0; x < w; x++) {
      const mx = Math.floor(x / scale) - quiet;
      if (my >= 0 && my < n && mx >= 0 && mx < n && qr.modules.get(my, mx)) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return [0x1d, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, h & 0xff, h >> 8, ...bits];
}
