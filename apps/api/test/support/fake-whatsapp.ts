// A local stand-in for Meta's WhatsApp Cloud API, for integration tests: no message ever leaves the machine. It records
// each request (path, bearer token, and JSON body), accepts image uploads, and refuses messages to numbers ending in
// "0000" the way Meta refuses an unknown number. The token "token-that-fails-uploads-..." makes the upload fail.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

// One request the stand-in received.
export interface FakeRequest {
  path: string;
  token: string;
  /** Parsed JSON for messages; null for uploads. */
  body: (Record<string, unknown> & { to?: string }) | null;
}

// A running stand-in.
export interface FakeWhatsApp {
  /** Base URL with a version segment, as WHATSAPP_GRAPH_BASE_URL. */
  url: string;
  requests: FakeRequest[];
  close(): Promise<void>;
}

// Reads a request body.
async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

// Starts the stand-in on a free local port.
export async function startFakeWhatsApp(): Promise<FakeWhatsApp> {
  const requests: FakeRequest[] = [];
  let counter = 0;
  const server = createServer(async (req, res) => {
    const raw = await readBody(req);
    const path = (req.url ?? '').replace(/^\/v\d+\.\d+/, '');
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const isJson = (req.headers['content-type'] ?? '').includes('application/json');
    const body = isJson ? (JSON.parse(raw.toString('utf8')) as Record<string, unknown> & { to?: string }) : null;
    requests.push({ path, token, body });
    const reply = (status: number, payload: object) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (path.endsWith('/media')) {
      if (token.startsWith('token-that-fails-uploads')) return reply(400, { error: { message: 'Media upload error', code: 131053 } });
      return reply(200, { id: `media-${++counter}` });
    }
    if (path.endsWith('/messages')) {
      const to = String(body?.to ?? '');
      if (to.endsWith('0000')) return reply(400, { error: { message: '(#131030) Recipient phone number not in allowed list', code: 131030, error_data: { details: 'Recipient phone number not in allowed list' } } });
      return reply(200, { messaging_product: 'whatsapp', contacts: [{ input: to, wa_id: to }], messages: [{ id: `wamid.${++counter}` }] });
    }
    reply(404, { error: { message: 'Unknown path' } });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v23.0`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
