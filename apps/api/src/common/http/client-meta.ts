// Reads the caller's IP address and browser description from a request, for sessions and audit entries.
import type { Request } from 'express';

// Client details stored with sessions and audit entries (trimmed to the database column sizes).
export interface ClientMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

// Extracts client details; req.ip already honours the "trust proxy" setting for the local Next.js proxy.
export function getClientMeta(req: Request): ClientMeta {
  return {
    ipAddress: req.ip ? req.ip.slice(0, 45) : null,
    userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
  };
}
