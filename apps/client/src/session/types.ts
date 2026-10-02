import type { EngineError, Reveal, SeatId } from '@casino/engine';

export type GameKind = 'blackjack' | 'holdem';

export type ActResult = { ok: true } | { ok: false; error: EngineError | { code: string; detail?: string } };

export type SessionMessage<V, E, L> =
  | { kind: 'snapshot'; view: V; legal: L | null; you: SeatId | null }
  | { kind: 'batch'; pub: E[]; reveals: Reveal[]; legal: L | null }
  | { kind: 'legal'; legal: L | null };

/** What the table UI talks to — the same for single-player (local engine) and multiplayer (server). */
export interface GameSession<V, E, L> {
  readonly game: GameKind;
  readonly mode: 'local' | 'remote';
  subscribe(fn: (m: SessionMessage<V, E, L>) => void): () => void;
  /** Send a player action (the session fills in the seat). */
  act(action: { type: string } & Record<string, unknown>): Promise<ActResult>;
  /** Earliest time bots may act (lets the table finish presenting first). Local only. */
  setPresentationGate?(fn: () => number): void;
  /** Clock used for deadlines in views (ms). */
  now(): number;
  dispose(): void;
}
