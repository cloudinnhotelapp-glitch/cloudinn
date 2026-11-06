// Central session rules: lifetimes, idle timeout, cookie security, and the CSRF secret.
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';
import type { CookieSettings } from './session-cookies.js';

// Only refresh a session's "last seen" time once per minute, to avoid a database write on every request.
const LAST_SEEN_REFRESH_MS = 60_000;

// Session timestamps needed to decide whether a session is still usable.
export interface SessionTimes {
  revokedAt: Date | null;
  expiresAt: Date;
  lastSeenAt: Date;
}

// Service that applies the configured session lifetimes to both Super Admin and business-user sessions.
@Injectable()
export class SessionSettingsService {
  private readonly idleMs: number;
  private readonly absoluteMs: number;
  readonly secure: boolean;
  readonly csrfSecret: string;

  // Reads the validated session settings once at startup.
  constructor(config: ConfigService<Env, true>) {
    this.idleMs = config.get('SESSION_IDLE_TIMEOUT_MINUTES', { infer: true }) * 60_000;
    this.absoluteMs = config.get('SESSION_ABSOLUTE_TIMEOUT_HOURS', { infer: true }) * 3_600_000;
    this.secure = config.get('NODE_ENV', { infer: true }) === 'production';
    this.csrfSecret = config.get('SESSION_SECRET', { infer: true });
  }

  // Absolute expiry time for a session created now.
  newExpiry(now: Date = new Date()): Date {
    return new Date(now.getTime() + this.absoluteMs);
  }

  // True when a session is not revoked, not past its absolute expiry, and has been used within the idle timeout.
  isUsable(session: SessionTimes, now: Date = new Date()): boolean {
    return (
      session.revokedAt === null &&
      session.expiresAt.getTime() > now.getTime() &&
      session.lastSeenAt.getTime() + this.idleMs > now.getTime()
    );
  }

  // True when the "last seen" time is old enough to be worth updating.
  shouldRefreshLastSeen(lastSeenAt: Date, now: Date = new Date()): boolean {
    return now.getTime() - lastSeenAt.getTime() >= LAST_SEEN_REFRESH_MS;
  }

  // Cookie security settings: Secure in production, lifetime equal to the absolute session lifetime.
  cookieSettings(): CookieSettings {
    return { secure: this.secure, maxAgeMs: this.absoluteMs };
  }
}
