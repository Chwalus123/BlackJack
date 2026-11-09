import { createHash, randomBytes } from 'node:crypto';
import type { Socket } from 'socket.io';
import { TokenBucket } from './rateLimit';

export interface Session {
  playerId: string;
  tokenHash: string;
  nickname: string | null;
  locale: 'pl' | 'en';
  roomCode: string | null;
  socket: Socket | null;
  lastSeen: number;
  bucket: TokenBucket;
  hostBucket: TokenBucket;
  violations: number;
}

const hash = (token: string) => createHash('sha256').update(token).digest('base64url');

/** Guest identities: a random bearer token (only its hash is stored) mapped to a public player id. */
export class SessionStore {
  private byHash = new Map<string, Session>();
  private byPlayer = new Map<string, Session>();

  resume(token: string | undefined): Session | null {
    if (!token) return null;
    return this.byHash.get(hash(token)) ?? null;
  }

  create(locale: 'pl' | 'en'): { session: Session; token: string } {
    const token = randomBytes(24).toString('base64url');
    const session: Session = {
      playerId: `p_${randomBytes(9).toString('base64url')}`,
      tokenHash: hash(token),
      nickname: null,
      locale,
      roomCode: null,
      socket: null,
      lastSeen: Date.now(),
      bucket: new TokenBucket(12, 24),
      hostBucket: new TokenBucket(5, 8),
      violations: 0,
    };
    this.byHash.set(session.tokenHash, session);
    this.byPlayer.set(session.playerId, session);
    return { session, token };
  }

  get(playerId: string): Session | undefined {
    return this.byPlayer.get(playerId);
  }

  /** Forget sessions that have been offline and roomless for a long time. */
  sweep(maxIdleMs: number): void {
    const now = Date.now();
    for (const s of this.byPlayer.values()) {
      if (!s.socket && !s.roomCode && now - s.lastSeen > maxIdleMs) {
        this.byPlayer.delete(s.playerId);
        this.byHash.delete(s.tokenHash);
      }
    }
  }

  get size(): number {
    return this.byPlayer.size;
  }
}
