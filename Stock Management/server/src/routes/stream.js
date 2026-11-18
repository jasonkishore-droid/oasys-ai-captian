// A live feed for the web app: an event whenever stock or the menu changes, so the open pages update by themselves.
// Stock also changes from outside this server (the AI Captain's kitchen takes ingredients off the shelf when it starts
// a round, straight in the database), so this watches the database itself rather than waiting to be told.
//
//   GET /api/stock/stream   server-sent events: a "stock" event on connect, then whenever a stock movement, an
//                           ingredient or a dish changes
const express = require('express');

const POLL_MS = 2000;

module.exports = function stream(db) {
  const router = express.Router();
  const watchers = new Set();
  let timer = null;
  let last = '';

  // changes whenever anything that affects the numbers on screen changes
  const stamp = async () => {
    const [m, i, d] = await Promise.all([
      db('stock_movements').max({ v: 'id' }).first(),
      db('ingredients').max({ v: 'updated_at' }).first(),
      db('dishes').max({ v: 'updated_at' }).first(),
    ]);
    return JSON.stringify([m && m.v, i && i.v, d && d.v]);
  };
  const frame = () => `event: stock\ndata: ${Date.now()}\n\n`;
  const poll = async () => {
    let now;
    try { now = await stamp(); } catch { return; } // the database is busy for a moment: the next tick tries again
    if (now === last) return;
    last = now;
    for (const w of watchers) w.write(frame());
  };

  router.get('/stock/stream', async (req, res) => {
    // no-transform: the compression middleware must not buffer the stream
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n: connected\n\n');
    if (!watchers.size) {
      try { last = await stamp(); } catch { last = ''; }
      timer = setInterval(poll, POLL_MS);
    }
    res.write(frame()); // the first event: "load it now"
    watchers.add(res);
    const beat = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(beat);
      watchers.delete(res);
      if (!watchers.size) clearInterval(timer);
    });
  });

  return router;
};
