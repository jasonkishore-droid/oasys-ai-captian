// Print jobs asked for from outside the app (the AI Captain's "Print test page" button, and the
// paper receipt a guest asks it for).
// The Bluetooth printer is reached from a signed-in browser tab, not from this server. Each open
// tab keeps a live stream to the server (browsers slow timers down in background tabs, so polling
// would stall; a stream does not). A new job is offered to every tab; the one that has the printer
// connected claims it, prints it and reports back.
// Kept in memory: a job only matters for a few seconds, and is dropped after five minutes.
const fs = require('fs');
const path = require('path');

const KEEP_MS = 5 * 60 * 1000;
const CLAIM_MS = 5 * 1000; // how long a tab has to say "my printer is connected, I'll take it"
const jobs = new Map();
const tabs = new Set(); // send(job) functions, one per open stream
let nextId = 1;

// A plain-text trail of who asked for paper and when (server/print-jobs.log), to settle
// "why did it print?" questions. Never throws: logging must not break printing.
const LOG = path.join(__dirname, '../../print-jobs.log');
function audit(line) {
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); } catch { /* ignore */ }
}

function prune() {
  const cutoff = Date.now() - KEEP_MS;
  for (const [id, j] of jobs) if (j.at < cutoff) jobs.delete(id);
}

// A tab's stream: returns the function that ends the subscription.
function subscribe(send) {
  tabs.add(send);
  return () => tabs.delete(send);
}
const tabOnline = () => tabs.size > 0;

// kind: 'test' (a test page) or 'bill' (a receipt, with data.bill_id)
function add(kind, data = {}) {
  prune();
  const job = { id: nextId++, kind, data, status: 'waiting', error: null, at: Date.now() };
  jobs.set(job.id, job);
  audit(`job ${job.id} requested: ${kind} ${JSON.stringify(data)} (open tabs: ${tabs.size})`);
  for (const send of tabs) send({ id: job.id, kind, ...data });
  setTimeout(() => {
    if (job.status === 'waiting') {
      finish(job.id, false, 'The printer is not connected. In the Stock Management app, press "Connect printer" at the top and choose the printer.');
    }
  }, CLAIM_MS).unref();
  return job;
}

// The first tab to claim a job prints it; the others leave it alone.
function claim(id) {
  const job = jobs.get(id);
  if (!job || job.status !== 'waiting') return false;
  job.status = 'printing';
  return true;
}

function finish(id, ok, error) {
  const job = jobs.get(id);
  if (!job) return null;
  job.status = ok ? 'printed' : 'failed';
  job.error = ok ? null : String(error || 'The printer did not print it').slice(0, 200);
  audit(`job ${id} ${job.status}${job.error ? `: ${job.error}` : ''}`);
  return job;
}

const get = (id) => jobs.get(id) || null;

module.exports = { add, claim, finish, get, subscribe, tabOnline };
