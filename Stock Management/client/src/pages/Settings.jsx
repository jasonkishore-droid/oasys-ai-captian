import { useState } from 'react';
import { api } from '../api';
import { useApp, useToast, Field, Alert } from '../ui.jsx';
import UpiQr from '../UpiQr.jsx';
import { upiLink, qrEscPos } from '../upi';
import * as printer from '../printer';

const VPA = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;

export default function Settings() {
  const { settings, reloadSettings } = useApp();
  const toast = useToast();
  const pr = printer.usePrinter();
  const [f, setF] = useState(() => ({ ...settings.upi, enabled: settings.upi.enabled || !settings.upi.upi_id }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const id = f.upi_id.trim();
  const valid = id === '' || VPA.test(id);
  const sampleAmount = 630;
  const link = id && valid ? upiLink({ ...f, upi_id: id }, { amount: sampleAmount, note: `${settings.restaurant.name} bill SAMPLE`, payeeFallback: settings.restaurant.name }) : '';

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.saveUpi({ upi_id: id, payee_name: f.payee_name.trim(), enabled: f.enabled && !!id, only_upi_bills: f.only_upi_bills });
      await reloadSettings();
      toast(id && f.enabled ? 'UPI QR will be printed on bills' : 'UPI QR switched off');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const testPrint = async () => {
    try {
      const enc = new TextEncoder();
      const bytes = Uint8Array.from([0x1b, 0x40, 0x1b, 0x61, 1, ...enc.encode(`UPI test: Rs ${sampleAmount}.00\n`), ...qrEscPos(link), 0x0a, ...enc.encode(`${id}\n`), 0x1b, 0x64, 4]);
      await printer.printBytes(bytes);
      toast('Test QR printed. Scan it with a UPI app to check (no need to pay).');
    } catch (err) { toast(err.message, 'error'); }
  };

  return (
    <div className="page">
      <form className="card pad settings-card" onSubmit={save}>
        <div className="card-head"><h2>UPI QR on bills</h2></div>
        <p className="muted">
          Type your UPI ID and every bill gets a "Scan to pay" QR with the exact bill amount and bill number filled in.
          Guests scan it with GPay, PhonePe, Paytm or any UPI app and just confirm. It appears on screen, on browser prints and on Bluetooth (PrintOD) prints.
        </p>
        <div className="grid two">
          <Field label="UPI ID" error={!valid ? 'Should look like name@bank, e.g. oasys@okhdfcbank' : ''} hint="From your UPI / merchant app, e.g. 9876543210@ybl">
            <input value={f.upi_id} onChange={set('upi_id')} placeholder="oasys@okhdfcbank" autoComplete="off" spellCheck={false} className={!valid ? 'invalid' : ''} />
          </Field>
          <Field label="Name shown to the guest" hint={`Defaults to "${settings.restaurant.name}"`}>
            <input value={f.payee_name} onChange={set('payee_name')} placeholder={settings.restaurant.name} maxLength={50} />
          </Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.enabled} onChange={set('enabled')} /> Print the UPI QR on bills</label>
        <label className="check"><input type="checkbox" checked={f.only_upi_bills} onChange={set('only_upi_bills')} disabled={!f.enabled} /> Only on bills where payment is set to UPI</label>

        {link && (
          <div className="upi-preview">
            <UpiQr link={link} size={168} />
            <div className="stack" style={{ gap: 6 }}>
              <strong>Preview for a ₹{sampleAmount} bill</strong>
              <code>{link}</code>
              <span className="muted small">Scan with your phone to check the name and ID before saving. You don't need to pay.</span>
              {pr.status === 'connected' && <button type="button" className="btn" onClick={testPrint} disabled={pr.busy}>Print test QR on {pr.name}</button>}
            </div>
          </div>
        )}

        {error && <Alert>{error}</Alert>}
        <div className="modal-actions">
          <button className="btn primary" disabled={busy || !valid}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
