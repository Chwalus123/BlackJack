import { signal } from '@preact/signals';
import type { AnnounceKey, SeatId } from '@casino/engine';

export interface AnnounceMsg {
  id: number;
  key: AnnounceKey;
  params?: Record<string, string | number>;
}

export interface ResultMsg {
  id: number;
  seat: SeatId;
  hand: number;
  outcome: string;
  net: number;
  /** Hold'em: the winning hand's value when it was shown (for "wins with a flush"). */
  value?: number | null;
}

/**
 * Two views of the same table:
 *  - `authoritative`: updated the moment a batch arrives (drives which buttons are legal);
 *  - `presented`: updated as the animation director commits each event (drives totals, chips, outcomes),
 *    so nothing is revealed before the card visibly lands.
 */
export class TableStore<V, L> {
  readonly authoritative = signal<V | null>(null);
  readonly presented = signal<V | null>(null);
  readonly legal = signal<L | null>(null);
  readonly you = signal<SeatId | null>(null);
  /** True while the director still has events to present. */
  readonly busy = signal(false);
  /** Presentation has caught up with the latest turn that involves me. */
  readonly ready = signal(true);
  readonly announce = signal<AnnounceMsg | null>(null);
  readonly results = signal<ResultMsg[]>([]);
  /** Bumps whenever seat → spot mapping or camera changes, so anchored HUD elements re-project. */
  readonly layoutVersion = signal(0);
  private seq = 0;

  pushAnnounce(key: AnnounceKey, params?: Record<string, string | number>): void {
    this.announce.value = { id: ++this.seq, key, params };
  }

  pushResult(r: Omit<ResultMsg, 'id'>): void {
    this.results.value = [...this.results.value.filter((x) => !(x.seat === r.seat && x.hand === r.hand)), { ...r, id: ++this.seq }];
  }

  clearResults(): void {
    if (this.results.value.length) this.results.value = [];
  }
}
