// Testing the receipt printer. The Bluetooth printer is driven from a signed-in Stock Management
// browser tab, so both checks go through that app (proxied at /api/oasys/...).

const call = async (path, method = 'GET') => {
  const r = await fetch(`/api/oasys/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? '{}' : undefined,
  })
  const b = await r.json().catch(() => ({}))
  return { r, b }
}

// Is the printer connected right now? -> { ok: true | false, text }
export async function checkPrinter() {
  try {
    const { r, b } = await call('printer')
    // an older Stock Management has no /printer route, so its sign-in check answers instead
    if (r.status === 404 || (r.status === 401 && b.error === 'Please sign in'))
      return { ok: false, text: 'Stock Management is running an old build: restart it.' }
    if (!r.ok) return { ok: false, text: b.error || `Stock Management answered ${r.status}` }
    if (b.connected) return { ok: true, text: `Connected · ${b.name || 'printer'}` }
    if (b.connecting) return { ok: false, text: 'The printer is reconnecting… try again in a moment.' }
    if (!b.tab_online) return { ok: false, text: 'No Stock Management tab is open. Open it, sign in and connect the printer.' }
    return { ok: false, text: 'Stock Management is open, but the printer is not connected there.' }
  } catch {
    return { ok: false, text: 'Cannot reach the Stock Management app.' }
  }
}

// Print a test page and wait to hear how it went. onStep(text) reports progress.
export async function printTestPage(onStep = () => {}) {
  try {
    onStep('Sending to the printer…')
    const { r, b } = await call('print-test', 'POST')
    if (!r.ok) return { ok: false, text: b.error || `Error ${r.status}` }
    for (let i = 0; i < 25; i++) {
      await new Promise((res) => setTimeout(res, 1000))
      const { r: jr, b: job } = await call(`print-jobs/${b.job_id}`)
      if (!jr.ok) return { ok: false, text: job.error || `Error ${jr.status}` }
      if (job.status === 'printed') return { ok: true, text: 'Test page printed' }
      if (job.status === 'failed') return { ok: false, text: job.error || 'The printer did not print it' }
      if (job.status === 'printing') onStep('Printing…')
    }
    return { ok: false, text: 'No answer. Open the Stock Management app in a browser tab, sign in and connect the printer there.' }
  } catch (e) {
    return { ok: false, text: e.message || 'Cannot reach the Stock Management app.' }
  }
}
