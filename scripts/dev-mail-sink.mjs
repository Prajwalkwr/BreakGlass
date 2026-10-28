/**
 * Development SMTP sink.
 *
 *   node scripts/dev-mail-sink.mjs
 *
 * A tiny SMTP server that accepts mail on 127.0.0.1:1025 and writes it to
 * .data/outbox-smtp/<timestamp>-<to>.eml plus a JSON sidecar. It exists so the
 * SMTP delivery path can be exercised locally (real SMTP handshake, real
 * nodemailer client) without contacting a third-party provider.
 *
 * It is a development tool only: it does not relay, authenticate, or queue.
 */
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const PORT = Number(process.env.MAIL_SINK_PORT ?? 1025);
const HOST = process.env.MAIL_SINK_HOST ?? '127.0.0.1';
const OUT = path.resolve('.data/outbox-smtp');

await fs.mkdir(OUT, { recursive: true });

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

const server = net.createServer((socket) => {
  let buffer = '';
  let inData = false;
  let data = '';
  let from = '';
  let to = [];

  socket.write('220 breakglass-dev-sink ESMTP ready\r\n');

  socket.on('data', async (chunk) => {
    buffer += chunk.toString('utf8');

    if (inData) {
      data += buffer;
      buffer = '';
      const end = data.indexOf('\r\n.\r\n');
      if (end === -1) {
        // Guard against runaway bodies.
        if (data.length > 2_000_000) socket.destroy();
        return;
      }
      const body = data.slice(0, end);
      data = '';
      inData = false;

      const recipient = to[0] ?? 'unknown';
      const file = path.join(OUT, `${timestamp()}-${recipient.replace(/[^a-z0-9@._-]/gi, '_')}.eml`);
      await fs.writeFile(file, body.replace(/^\.\./gm, '.'), 'utf8');
      await fs.writeFile(
        `${file}.json`,
        JSON.stringify({ from, to, receivedAt: new Date().toISOString(), bytes: body.length }, null, 2),
        'utf8',
      );
      console.log(`[mail-sink] accepted ${body.length} bytes for ${recipient} -> ${path.relative(process.cwd(), file)}`);
      from = '';
      to = [];
      socket.write('250 2.0.0 Ok: queued\r\n');
      return;
    }

    let index = buffer.indexOf('\r\n');
    while (index !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const upper = line.toUpperCase();

      if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
        socket.write('250-breakglass-dev-sink\r\n250-8BITMIME\r\n250-SIZE 5000000\r\n250 OK\r\n');
      } else if (upper.startsWith('MAIL FROM')) {
        from = line.slice(line.indexOf(':') + 1).trim();
        socket.write('250 2.1.0 Ok\r\n');
      } else if (upper.startsWith('RCPT TO')) {
        to.push(line.slice(line.indexOf(':') + 1).trim().replace(/^<|>$/g, ''));
        socket.write('250 2.1.5 Ok\r\n');
      } else if (upper === 'DATA') {
        inData = true;
        socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
      } else if (upper === 'RSET') {
        from = '';
        to = [];
        socket.write('250 2.0.0 Ok\r\n');
      } else if (upper === 'QUIT') {
        socket.write('221 2.0.0 Bye\r\n');
        socket.end();
      } else if (upper === 'NOOP') {
        socket.write('250 2.0.0 Ok\r\n');
      } else if (upper.startsWith('STARTTLS')) {
        // No TLS in the sink; refusing keeps the client on plaintext locally.
        socket.write('502 5.5.1 STARTTLS not supported\r\n');
      } else {
        socket.write('250 2.0.0 Ok\r\n');
      }

      index = buffer.indexOf('\r\n');
    }
  });

  socket.on('error', () => socket.destroy());
});

server.listen(PORT, HOST, () => {
  console.log(`[mail-sink] SMTP sink listening on ${HOST}:${PORT} -> .data/outbox-smtp`);
});
