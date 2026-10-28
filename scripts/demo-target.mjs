/**
 * Persistent target for the demo workspace so the seeded monitors keep
 * producing coherent results in a local preview.
 *
 *   node scripts/demo-target.mjs
 *
 * Mirrors the behaviour used by scripts/seed-demo.ts: three client sites stay
 * healthy, Harbor Dental keeps returning HTTP 500 so its incident stays open.
 */
import http from 'node:http';

const PORT = Number(process.env.DEMO_TARGET_PORT ?? 9910);

const profiles = {
  '/northside': [70, 130],
  '/verdant': [180, 300],
  '/atlas': [95, 170],
  '/harbor': [210, 320],
};

const page = (name) => `<html><body><h1>${name}</h1><p>Open today</p></body></html>`;

// Harbor Dental can be switched between healthy and failing so the seeder can
// produce a resolved incident followed by a fresh open one.
let harborMode = 'fail';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (path === '/__demo/state') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ harborMode }));
    return;
  }

  if (path === '/__demo/mode') {
    const requested = url.searchParams.get('harbor');
    if (requested === 'ok' || requested === 'fail') harborMode = requested;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ harborMode }));
    return;
  }

  if (path === '/api/health') {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '2.4.1', db: 'connected' }));
    }, 55);
    return;
  }

  if (path === '/book') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><html><body>
      <h1>Book a session</h1>
      <form action="/book/confirm" method="get">
        <label for="date">Date</label><input id="date" name="date" value="2026-11-02" />
        <button type="submit">Confirm booking</button>
      </form>
    </body></html>`);
    return;
  }

  if (path === '/book/confirm') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body><h1>Booking confirmed</h1><p>Reference VW-8841</p></body></html>');
    return;
  }

  if (path === '/harbor' && harborMode === 'fail') {
    await new Promise((resolve) => setTimeout(resolve, 380));
    res.writeHead(500, { 'content-type': 'text/html' });
    res.end('<html><body><h1>Internal Server Error</h1></body></html>');
    return;
  }

  const [min, max] = profiles[path] ?? [80, 140];
  await new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(page(path.replace('/', '') || 'home'));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[demo-target] listening on http://127.0.0.1:${PORT} (harbor mode: ${harborMode})`);
});
