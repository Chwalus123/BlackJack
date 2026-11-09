/**
 * The wire contract between the browser and the multiplayer server: typed Socket.IO events, input
 * validation (zod, strict) and the host settings → engine rules mapping. Everything is in integer
 * minor units (100 = 1 chip).
 */
import { z } from 'zod';
import { CHIP, type Money, type Reveal, type SeatId } from '@casino/engine';

export const PROTOCOL_VERSION = 1;
export type GameKind = 'blackjack' | 'holdem';
export type PlayerId = string;

// ───────────────────────── limits ─────────────────────────
export const LIMITS = {
  nickname: { min: 2, max: 20 },
  roomName: { max: 32 },
  chat: { max: 200 },
  roomCodeLength: 6,
  roomCodeAlphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
  bj: {
    stakes: [1, 2, 5, 10, 25, 50, 100, 500].map((c) => c * CHIP),
    bankrollMultiples: [20, 50, 100] as const,
    decisionSec: { min: 10, max: 60, default: 20 },
    betSec: { min: 5, max: 30, default: 12 },
  },
  he: {
    blinds: [
      [1, 2],
      [2, 4],
      [5, 10],
      [10, 20],
      [25, 50],
      [100, 200],
      [500, 1000],
    ].map(([s, b]) => [s! * CHIP, b! * CHIP] as [Money, Money]),
    buyInBB: [50, 100, 200] as const,
    decisionSec: { min: 10, max: 60, default: 20 },
    maxSeats: { min: 2, max: 22, default: 9 },
  },
} as const;

export const NICKNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,18}[\p{L}\p{N}_.-]$/u;

/** Trim, collapse whitespace, strip control/format characters. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ───────────────────────── schemas ─────────────────────────
const int = () => z.number().int().safe();
const nickname = z
  .string()
  .max(64)
  .transform(normalizeText)
  .pipe(z.string().min(LIMITS.nickname.min).max(LIMITS.nickname.max).regex(NICKNAME_RE));

export const HandshakeAuth = z
  .object({
    protocol: z.literal(PROTOCOL_VERSION),
    token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/).optional(),
    nickname: nickname.optional(),
    locale: z.enum(['pl', 'en']).default('pl'),
  })
  .strict();
export type HandshakeAuth = z.infer<typeof HandshakeAuth>;

const rebuy = z.enum(['never', 'whenBroke']);

export const BlackjackSettings = z
  .object({
    game: z.literal('blackjack'),
    stake: int().refine((v) => (LIMITS.bj.stakes as readonly number[]).includes(v), 'stake'),
    bankrollMultiple: z.union([z.literal(20), z.literal(50), z.literal(100)]),
    decisionSec: int().min(LIMITS.bj.decisionSec.min).max(LIMITS.bj.decisionSec.max),
    betSec: int().min(LIMITS.bj.betSec.min).max(LIMITS.bj.betSec.max),
    rebuy,
  })
  .strict();
export type BlackjackSettings = z.infer<typeof BlackjackSettings>;

export const HoldemSettings = z
  .object({
    game: z.literal('holdem'),
    sb: int().positive(),
    bb: int().positive(),
    buyInBB: z.union([z.literal(50), z.literal(100), z.literal(200)]),
    decisionSec: int().min(LIMITS.he.decisionSec.min).max(LIMITS.he.decisionSec.max),
    maxSeats: int().min(LIMITS.he.maxSeats.min).max(LIMITS.he.maxSeats.max),
    rebuy,
  })
  .strict()
  .refine((s) => LIMITS.he.blinds.some(([sb, bb]) => sb === s.sb && bb === s.bb), 'blinds');
export type HoldemSettings = z.infer<typeof HoldemSettings>;

export const RoomSettings = z.union([BlackjackSettings, HoldemSettings]);
export type RoomSettings = BlackjackSettings | HoldemSettings;

export const CreateRoomInput = z
  .object({
    name: z.string().max(64).transform(normalizeText).pipe(z.string().min(1).max(LIMITS.roomName.max)),
    visibility: z.enum(['public', 'private']),
    settings: RoomSettings,
  })
  .strict();
export type CreateRoomInput = z.infer<typeof CreateRoomInput>;

export const RoomCode = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().length(LIMITS.roomCodeLength).regex(/^[A-Z0-9]+$/));

export const JoinRoomInput = z.object({ code: RoomCode }).strict();

/** Every action a client may originate. Seat, time, amounts for fixed stakes and entropy are added by the server. */
export const CLIENT_ACTION_TYPES = [
  // shared
  'LEAVE', 'SIT_OUT', 'SIT_IN', 'REBUY',
  // blackjack
  'BET', 'CLEAR_BET', 'PASS', 'INSURANCE', 'HIT', 'STAND', 'DOUBLE', 'SPLIT', 'SET_AUTOBET',
  // hold'em
  'FOLD', 'CHECK', 'CALL', 'RAISE', 'ALL_IN', 'SHOW', 'MUCK', 'SET_WAIT_BB',
] as const;

export const GameAction = z
  .object({
    type: z.enum(CLIENT_ACTION_TYPES),
    amount: int().nonnegative().optional(),
    to: int().nonnegative().optional(),
    take: z.boolean().optional(),
    value: z.boolean().optional(),
    dId: int().nonnegative().optional(),
  })
  .strict();
export type GameAction = z.infer<typeof GameAction>;

export const ChatInput = z
  .object({ text: z.string().max(400).transform(normalizeText).pipe(z.string().min(1).max(LIMITS.chat.max)) })
  .strict();

export const KickInput = z.object({ playerId: z.string().max(40) }).strict();
export const PauseInput = z.object({ value: z.boolean() }).strict();
export const SettingsPatch = z.object({ settings: RoomSettings }).strict();

// ───────────────────────── server → client payloads ─────────────────────────
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'RATE_LIMITED'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'NOT_HOST'
  | 'NOT_IN_ROOM'
  | 'SERVER_DRAINING'
  | 'PROTOCOL_MISMATCH'
  | 'TOO_MANY_ROOMS'
  | 'NICKNAME'
  | 'NEED_PLAYERS'
  | 'BAD_PHASE'
  | 'NOT_YOUR_TURN'
  | 'STALE_TURN'
  | 'ILLEGAL_ACTION'
  | 'BAD_AMOUNT'
  | 'INSUFFICIENT_FUNDS'
  | 'UNKNOWN_SEAT'
  | 'TABLE_FULL'
  | 'ALREADY_SEATED'
  | 'RULES_INVALID'
  | 'PAUSED'
  | 'INTERNAL';

export type Ack<T = undefined> = { ok: true; data: T } | { ok: false; code: ErrorCode };

export type RoomStatus = 'waiting' | 'running' | 'paused' | 'closing';

export interface MemberInfo {
  id: PlayerId;
  nickname: string;
  seat: SeatId | null;
  connected: boolean;
  queued: boolean;
}

export interface RoomMeta {
  code: string;
  name: string;
  game: GameKind;
  visibility: 'public' | 'private';
  hostId: PlayerId;
  status: RoomStatus;
  settings: RoomSettings;
  members: MemberInfo[];
  /** Hold'em spectator queue (player ids, first = next to sit). */
  queue: PlayerId[];
}

export interface RoomSummary {
  code: string;
  name: string;
  game: GameKind;
  status: RoomStatus;
  players: number;
  spectators: number;
  stakeLabel: { stake?: Money; sb?: Money; bb?: Money };
  maxSeats: number | null;
}

export interface RoomSnapshot {
  meta: RoomMeta;
  view: unknown;
  legal: unknown;
  you: SeatId | null;
  eid: number;
  serverNow: number;
}

export interface EventsBatch {
  eid: number;
  pub: unknown[];
  serverNow: number;
}

export interface PrivateBatch {
  eid: number;
  reveals: Reveal[];
  legal: unknown;
  you: SeatId | null;
}

export interface ChatMsg {
  id: number;
  from: PlayerId;
  nickname: string;
  text: string;
  at: number;
}

export interface SessionInfo {
  playerId: PlayerId;
  token: string;
  nickname: string | null;
}

export interface ServerToClientEvents {
  session: (s: SessionInfo) => void;
  'room:snapshot': (s: RoomSnapshot) => void;
  'room:meta': (m: RoomMeta) => void;
  'game:events': (b: EventsBatch) => void;
  'game:private': (p: PrivateBatch) => void;
  'room:chat': (m: ChatMsg) => void;
  'room:kicked': (r: { reason: 'kicked' | 'closed' }) => void;
  'server:notice': (n: { kind: 'shutdown' | 'replaced' }) => void;
}

export interface ClientToServerEvents {
  'session:nickname': (p: { nickname: string }, ack: (r: Ack<SessionInfo>) => void) => void;
  'lobby:list': (p: { game?: GameKind }, ack: (r: Ack<RoomSummary[]>) => void) => void;
  'room:create': (p: CreateRoomInput, ack: (r: Ack<{ code: string }>) => void) => void;
  'room:join': (p: { code: string }, ack: (r: Ack<RoomSnapshot>) => void) => void;
  'room:leave': (p: Record<string, never>, ack: (r: Ack) => void) => void;
  'room:resync': (p: Record<string, never>, ack: (r: Ack<RoomSnapshot>) => void) => void;
  'room:chat': (p: { text: string }, ack: (r: Ack) => void) => void;
  'seat:sit': (p: Record<string, never>, ack: (r: Ack) => void) => void;
  'seat:stand': (p: Record<string, never>, ack: (r: Ack) => void) => void;
  'game:action': (p: GameAction, ack: (r: Ack) => void) => void;
  'host:start': (p: Record<string, never>, ack: (r: Ack) => void) => void;
  'host:pause': (p: { value: boolean }, ack: (r: Ack) => void) => void;
  'host:kick': (p: { playerId: string }, ack: (r: Ack) => void) => void;
  'host:close': (p: Record<string, never>, ack: (r: Ack) => void) => void;
  'host:settings': (p: { settings: RoomSettings }, ack: (r: Ack) => void) => void;
}

// ───────────────────────── defaults ─────────────────────────
export function defaultSettings(game: GameKind): RoomSettings {
  return game === 'blackjack'
    ? { game, stake: 25 * CHIP, bankrollMultiple: 50, decisionSec: LIMITS.bj.decisionSec.default, betSec: LIMITS.bj.betSec.default, rebuy: 'whenBroke' }
    : { game, sb: 5 * CHIP, bb: 10 * CHIP, buyInBB: 100, decisionSec: LIMITS.he.decisionSec.default, maxSeats: LIMITS.he.maxSeats.default, rebuy: 'whenBroke' };
}

export function stakeLabel(s: RoomSettings): RoomSummary['stakeLabel'] {
  return s.game === 'blackjack' ? { stake: s.stake } : { sb: s.sb, bb: s.bb };
}
