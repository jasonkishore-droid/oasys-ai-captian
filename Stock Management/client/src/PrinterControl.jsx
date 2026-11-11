import { useEffect, useState } from 'react';
import { useApp, useToast, Modal, Alert } from './ui.jsx';
import * as printer from './printer';
import { api } from './api';

// Print jobs asked for from outside this app: the AI Captain's "Print test page" button and the
// paper receipt a guest asks it for. The server offers each job to every open tab over a live
// stream (a stream, not polling: browsers slow timers down in background tabs). The tab whose
// printer is connected claims the job, prints it and reports back; other tabs leave it alone.
// This tab's id, so the server can tell the AI Captain whether this tab's printer is connected.
const TAB = Math.random().toString(36).slice(2, 14).padEnd(8, '0');
const reportPrinter = () => {
  const s = printer.getState();
  api.printerStatus(TAB, s.status, s.name).catch(() => {});
};

function usePrintJobs(settings, toast) {
  useEffect(() => {
    let queue = Promise.resolve(); // one job at a time, in the order they arrived
    const run = async (job) => {
      if (printer.getState().status !== 'connected' && !(await printer.reconnect())) {
        toast('AI Captain asked for a print, but the printer is not connected. Press "Connect printer".', 'error');
        return; // unclaimed: the server tells the asker the printer is not connected
      }
      if (!(await api.printJobClaim(job.id).catch(() => false))) return; // another tab took it
      const what = job.kind === 'bill' ? 'Receipt' : 'Test page';
      let error = '';
      try {
        const bytes = job.kind === 'bill' ? printer.billToEscPos(await api.bill(job.bill_id), settings) : printer.testPage(settings);
        await printer.printBytes(bytes);
        toast(`${what} printed (asked by AI Captain)`);
      } catch (e) { error = e.message; toast(`${what} did not print: ${e.message}`, 'error'); }
      await api.printJobDone(job.id, !error, error).catch(() => {});
    };
    const stream = new EventSource(`/api/print-queue/stream?tab=${TAB}`); // reconnects by itself if the server restarts
    stream.onopen = reportPrinter; // (re)opened: tell the server where the printer stands
    stream.onmessage = (e) => {
      let job;
      try { job = JSON.parse(e.data); } catch { return; }
      queue = queue.then(() => run(job)).catch(() => {});
    };
    return () => stream.close();
  }, [settings, toast]);
}

const LABEL = { connected: 'Printer ready', connecting: 'Connecting…', disconnected: 'Connect printer' };

// Top-bar button + dialog for the PrintOD Bluetooth printer.
export default function PrinterControl() {
  const p = printer.usePrinter();
  const [open, setOpen] = useState(false);
  const { settings } = useApp();
  const toast = useToast();
  useEffect(() => { printer.reconnect(); }, []); // silently reattach to the last printer if the browser allows it
  usePrintJobs(settings, toast);
  useEffect(reportPrinter, [p.status, p.name]); // and every time that changes
  return (
    <>
      <button className={`printer-chip ${p.status}`} onClick={() => setOpen(true)} title={p.status === 'connected' ? `${p.name} · PrintOD` : 'Connect the PrintOD Bluetooth printer'}>
        <span className="dot" aria-hidden />
        <span className="printer-label">{p.busy ? 'Printing…' : LABEL[p.status]}</span>
      </button>
      {open && <PrinterDialog onClose={() => setOpen(false)} />}
    </>
  );
}

export function PrinterDialog({ onClose }) {
  const { settings } = useApp();
  const toast = useToast();
  const p = printer.usePrinter();
  const [error, setError] = useState('');
  const why = printer.unsupportedReason();

  const run = async (fn, ok) => {
    setError('');
    try { await fn(); if (ok) toast(ok); } catch (e) { setError(e.message); }
  };

  return (
    <Modal title="Bluetooth printer (PrintOD)" onClose={onClose} size="small">
      <div className="printer-status">
        <span className={`printer-chip static ${p.status}`}><span className="dot" aria-hidden />{p.status === 'connected' ? p.name : LABEL[p.status]}</span>
        {p.status === 'connected' && <span className="muted small">58 mm · 32 columns</span>}
      </div>

      {p.status !== 'connected' && (
        <ol className="steps">
          <li>On the POS terminal, open <strong>PrintOD</strong> and go to the <strong>Receiver</strong> tab.</li>
          <li>Start the receiver so it shows <em>Waiting for sender</em>.</li>
          <li>Press <strong>Connect</strong> below and pick the terminal from the list.</li>
        </ol>
      )}

      {why && <Alert kind="warn">{why}</Alert>}
      {(error || p.error) && <Alert onClose={() => setError('')}>{error || p.error}</Alert>}

      <label className="check">
        <input type="checkbox" checked={p.autoPrint} onChange={(e) => printer.setAutoPrint(e.target.checked)} />
        Print automatically when a bill is saved
      </label>

      <div className="modal-actions">
        {p.status === 'connected' ? (
          <>
            <button className="btn danger-outline left" onClick={() => printer.disconnect()}>Disconnect</button>
            <button className="btn" disabled={p.busy} onClick={() => run(() => printer.printBytes(printer.testPage(settings)), 'Test page printed')}>
              {p.busy ? 'Printing…' : 'Print test page'}
            </button>
            <button className="btn primary" onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Close</button>
            <button className="btn primary" disabled={!!why || p.status === 'connecting'} onClick={() => run(printer.connect, 'Printer connected')}>
              {p.status === 'connecting' ? 'Connecting…' : 'Connect'}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

/** "Print" button for a saved or draft bill: uses PrintOD when connected, otherwise offers to connect. */
export function PrintBillButton({ bill, draft, className = 'btn primary' }) {
  const { settings } = useApp();
  const toast = useToast();
  const p = printer.usePrinter();
  const [dialog, setDialog] = useState(false);
  const go = async () => {
    if (p.status !== 'connected' && !(await printer.reconnect())) return setDialog(true);
    try {
      await printer.printBytes(printer.billToEscPos(bill, settings, { draft }));
      toast(`${bill.bill_no || 'Bill'} printed`);
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <button className={className} onClick={go} disabled={p.busy}>{p.busy ? 'Printing…' : 'Print (Bluetooth)'}</button>
      {dialog && <PrinterDialog onClose={() => setDialog(false)} />}
    </>
  );
}
