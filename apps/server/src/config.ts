import { z } from 'zod';
import path from 'node:path';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  PUBLIC_ORIGIN: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  STATIC_DIR: z.string().optional(),
  TRUST_PROXY: z.enum(['0', '1']).default('0'),
  MAX_ROOMS: z.coerce.number().int().min(1).default(200),
  ROOMS_PER_IP: z.coerce.number().int().min(1).default(3),
  /** 0 = unlimited seats at a blackjack table (operator safety valve). */
  MAX_PLAYERS_PER_ROOM: z.coerce.number().int().min(0).default(0),
  MAX_SPECTATORS_PER_ROOM: z.coerce.number().int().min(0).default(500),
  MAX_CONNECTIONS: z.coerce.number().int().min(1).default(3000),
  CONNECTIONS_PER_IP: z.coerce.number().int().min(1).default(12),
  RECONNECT_GRACE_MS: z.coerce.number().int().min(0).default(60000),
  EMPTY_ROOM_TTL_MS: z.coerce.number().int().min(0).default(5 * 60000),
  DRAIN_TIMEOUT_MS: z.coerce.number().int().min(0).default(20000),
});

export type Config = z.infer<typeof Env> & { staticDir: string; trustProxy: boolean };

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = Env.parse(env);
  if (parsed.NODE_ENV === 'production' && env.TEST_SEED) throw new Error('TEST_SEED must not be set in production');
  return {
    ...parsed,
    staticDir: path.resolve(parsed.STATIC_DIR ?? path.join(process.cwd(), 'apps/client/dist')),
    trustProxy: parsed.TRUST_PROXY === '1',
  };
}
