// A local stand-in for Meta's WhatsApp Cloud API, started by the Playwright config for browser tests, so no message ever
// leaves the machine. It accepts image uploads and template messages (refusing numbers ending in "0000"), and lists what
// it received at GET /__requests (path, recipient, and template; never the token). GET /health answers when it is ready.
import { createServer } from 'node:http';

const port = Number(process.env.FAKE_WHATSAPP_PORT ?? 4799);
const received = [];
let counter = 0;

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  const reply = (status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  const path = (req.url ?? '').replace(/^\/v\d+\.\d+/, '');
  if (req.method === 'GET' && path === '/health') return reply(200, { ok: true });
  if (req.method === 'GET' && path === '/__requests') return reply(200, received);
  const isJson = (req.headers['content-type'] ?? '').includes('application/json');
  const body = isJson ? JSON.parse(raw.toString('utf8')) : null;
  received.push({ path, to: body?.to ?? null, template: body?.template ?? null, hasToken: /^Bearer .{20,}/.test(req.headers.authorization ?? '') });
  if (path.endsWith('/media')) return reply(200, { id: `media-${++counter}` });
  if (path.endsWith('/messages')) {
    if (String(body?.to ?? '').endsWith('0000')) return reply(400, { error: { message: '(#131030) Recipient phone number not in allowed list', code: 131030 } });
    return reply(200, { messaging_product: 'whatsapp', messages: [{ id: `wamid.${++counter}` }] });
  }
  reply(404, { error: { message: 'Unknown path' } });
});

server.listen(port, '127.0.0.1', () => console.log(`Fake WhatsApp API listening on ${port}`));
