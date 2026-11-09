import * as THREE from 'three';
import { bj, clone, PACING, type Account, type SeatId } from '@casino/engine';
import type { TableStore } from '../store/table';
import { sfx } from '../shared/sound';
import type { TableScene } from './scene';
import {
  BJ_DISCARD, BJ_RACK, BJ_SHOE, BJ_TABLE, bjBetPos, bjCardPos, bjDealerCardPos, bjInsurancePos, bjSpotAngle, bjSpotCenter, bjStackPos, mapSeats, v3, type V3,
} from './layout';

type V = bj.BJView;
type E = bj.BJEvent;
type L = bj.BJLegal;

const vec = (p: V3) => new THREE.Vector3(p.x, p.y, p.z);
const DEG = Math.PI / 180;

/**
 * Turns the blackjack event stream into choreography: the dealer's gestures, card flights, flips and chip
 * movements. Events commit to the presented view in order, each when its animation lands.
 */
export class BlackjackDirector {
  queue: E[] = [];
  running = false;
  current: string | null = null;
  private presented: V | null = null;
  private chain: Promise<void> = Promise.resolve();
  private pendingMine = 0;
  private flushing = false;
  private disposed = false;
  spots = new Map<SeatId, number>();

  constructor(
    private readonly scene: TableScene,
    private readonly store: TableStore<V, L>,
    private readonly opts: { speed: () => number },
  ) {}

  get view(): V | null {
    return this.presented;
  }

  // ───────────── public API ─────────────

  applySnapshot(view: V): void {
    this.queue = [];
    this.pendingMine = 0;
    this.presented = clone(view);
    this.remap();
    this.rebuild();
    this.publish();
    this.store.ready.value = true;
  }

  enqueue(events: E[]): void {
    for (const ev of events) {
      if (this.touchesMe(ev)) this.pendingMine++;
      this.queue.push(ev);
    }
    if (this.pendingMine > 0) this.store.ready.value = false;
    this.store.busy.value = true;
    if (!this.running) void this.run();
  }

  /** Snap everything that is queued or animating to its end state. */
  flush(): void {
    this.flushing = true;
    this.scene.flush();
    if (!this.running) this.flushing = false;
  }

  /** Estimated time (scene clock, ms from now) until the queue is presented — used to pace bots. */
  gate(): number {
    const sp = this.effectiveSpeed();
    if (!Number.isFinite(sp)) return performance.now();
    let ms = 0;
    for (const ev of this.queue) ms += this.nominal(ev);
    return performance.now() + ms / sp + (this.running ? 250 / sp : 0);
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
  }

  // ───────────── helpers ─────────────

  private you(): SeatId | null {
    return this.store.you.value;
  }

  private touchesMe(ev: E): boolean {
    const me = this.you();
    switch (ev.e) {
      case 'TurnStarted':
      case 'Phase':
      case 'RoundStarted':
      case 'InsuranceOffered':
      case 'CardFlipped':
      case 'DealerPeeked':
      case 'CardsCollected':
        return true;
      case 'CardDealt':
        return ev.to.t === 'dealer' || ev.to.seat === me;
      case 'ChipsMoved':
        return ('seat' in ev.from && ev.from.seat === me) || ('seat' in ev.to && ev.to.seat === me);
      case 'HandSplit':
      case 'HandState':
      case 'Decided':
      case 'InsuranceDecided':
      case 'SeatDeadline':
      case 'SeatStatus':
        return ev.seat === me;
      default:
        return false;
    }
  }

  private effectiveSpeed(): number {
    const base = this.opts.speed();
    if (this.flushing || !Number.isFinite(base)) return Infinity;
    let est = 0;
    for (const ev of this.queue) est += this.nominal(ev);
    if (this.queue.length > 60 || est / base > 6000) return Infinity;
    return base * Math.min(6, 1 + Math.max(0, est / base - 1500) / 1500);
  }

  private nominal(ev: E): number {
    switch (ev.e) {
      case 'CardDealt':
        return this.spotOfTarget(ev.to) == null ? 0 : PACING.bjCard;
      case 'CardFlipped':
        return PACING.flip;
      case 'DealerPeeked':
        return PACING.peek;
      case 'ChipsMoved':
        return 140;
      case 'Shuffle':
        return PACING.reshuffle;
      case 'CardsCollected':
        return PACING.sweep;
      case 'HandSplit':
        return PACING.split;
      default:
        return 0;
    }
  }

  private seat(id: SeatId) {
    return this.presented?.seats.find((s) => s.id === id);
  }

  private spotOfTarget(t: bj.BJTarget): number | null | 'dealer' {
    if (t.t === 'dealer') return 'dealer';
    return this.spots.get(t.seat) ?? null;
  }

  private remap(): void {
    const v = this.presented;
    if (!v) return;
    const order = [...v.seats].sort((a, b) => a.order - b.order).map((s) => s.id);
    this.spots = mapSeats(order, this.you(), BJ_TABLE.spots, BJ_TABLE.heroSpot, false);
    this.store.layoutVersion.value++;
  }

  private publish(): void {
    if (this.presented) this.store.presented.value = { ...this.presented };
  }

  private handCount(seat: SeatId): number {
    return Math.max(1, this.seat(seat)?.hands.length ?? 1);
  }

  private cardPos(seat: SeatId, hand: number, slot: number): { pos: V3; yaw: number } | null {
    const spot = this.spots.get(seat);
    if (spot == null) return null;
    const n = this.handCount(seat);
    const spread = n > 1 ? (hand - (n - 1) / 2) * 7.2 : 0;
    return { pos: bjCardPos(spot, hand, n, slot), yaw: (bjSpotAngle(spot) + spread) * DEG };
  }

  private accPos(a: Account): V3 | null {
    switch (a.k) {
      case 'house':
        return v3(BJ_RACK.x, 0.03, BJ_RACK.z + 0.02);
      case 'cashier':
        return null;
      case 'stack': {
        const s = this.spots.get(a.seat);
        return s == null ? null : bjStackPos(s);
      }
      case 'bet': {
        const s = this.spots.get(a.seat);
        return s == null ? null : bjBetPos(s, a.hand, this.handCount(a.seat));
      }
      case 'ins': {
        const s = this.spots.get(a.seat);
        return s == null ? null : bjInsurancePos(s);
      }
      default:
        return null;
    }
  }

  private accKey(a: Account): string | null {
    switch (a.k) {
      case 'stack':
        return `stack:${a.seat}`;
      case 'bet':
        return `bet:${a.seat}:${a.hand}`;
      case 'ins':
        return `ins:${a.seat}`;
      default:
        return null;
    }
  }

  private syncSeatChips(seatId: SeatId): void {
    const s = this.seat(seatId);
    const spot = this.spots.get(seatId);
    const chips = this.scene.chips;
    for (let h = 0; h < 4; h++) chips.setStack(`bet:${seatId}:${h}`, v3(0, 0, 0), 0);
    chips.setStack(`ins:${seatId}`, v3(0, 0, 0), 0);
    chips.setStack(`stack:${seatId}`, v3(0, 0, 0), 0);
    if (!s || spot == null) return;
    chips.setStack(`stack:${seatId}`, bjStackPos(spot), s.stack);
    s.hands.forEach((h, i) => chips.setStack(`bet:${seatId}:${i}`, bjBetPos(spot, i, s.hands.length), h.bet));
    chips.setStack(`ins:${seatId}`, bjInsurancePos(spot), s.insurance);
  }

  private syncAllChips(): void {
    const v = this.presented;
    if (!v) return;
    this.scene.chips.clearAll();
    for (const s of v.seats) this.syncSeatChips(s.id);
  }

  /** Recreate every card and chip stack from the presented view (snapshot / remap). */
  private rebuild(): void {
    const v = this.presented;
    if (!v) return;
    const cards = this.scene.cards;
    cards.clear();
    for (const s of v.seats) {
      s.hands.forEach((h, hi) =>
        h.cards.forEach((c, slot) => {
          const p = this.cardPos(s.id, hi, slot);
          if (p) cards.create(c.cid, c.card, p.pos, p.yaw, c.card != null);
        }),
      );
    }
    v.dealer.cards.forEach((c, slot) => cards.create(c.cid, c.card, bjDealerCardPos(slot), 0, c.card != null));
    this.syncAllChips();
    this.updateShoe();
    this.scene.wake(100);
  }

  private updateShoe(): void {
    const v = this.presented;
    if (!v || v.shoe.decks === 0) return;
    this.scene.table.setShoeFill(v.shoe.remaining / (v.shoe.decks * 52));
  }

  private commit(ev: E): void {
    const v = this.presented;
    if (!v || this.disposed) return;
    bj.reduceBlackjackView(v, ev);
    this.sound(ev);
    switch (ev.e) {
      case 'ChipsMoved':
        for (const [acc, bal] of [[ev.from, ev.fromBal], [ev.to, ev.toBal]] as const) {
          const key = this.accKey(acc);
          const pos = this.accPos(acc);
          if (key && pos) this.scene.chips.setStack(key, pos, bal);
        }
        break;
      case 'Announce':
        this.store.pushAnnounce(ev.key, ev.params);
        break;
      case 'HandResult':
        this.store.pushResult({ seat: ev.seat, hand: ev.hand, outcome: ev.outcome, net: ev.net });
        break;
      case 'RoundStarted':
        this.store.clearResults();
        break;
      case 'Shuffle':
      case 'CardDealt':
        this.updateShoe();
        break;
      default:
        break;
    }
    if (this.touchesMe(ev)) {
      this.pendingMine = Math.max(0, this.pendingMine - 1);
      if (this.pendingMine === 0) this.store.ready.value = true;
    }
    this.publish();
    this.scene.wake(200);
  }

  private sound(ev: E): void {
    if (!Number.isFinite(this.effectiveSpeed()) && this.queue.length > 3) return;
    const me = this.you();
    switch (ev.e) {
      case 'CardDealt':
        if (this.spotOfTarget(ev.to) != null) sfx.card();
        break;
      case 'CardFlipped':
        sfx.flip();
        break;
      case 'ChipsMoved':
        if (ev.from.k !== 'cashier' && ev.to.k !== 'cashier') sfx.chips(Math.ceil(ev.amount / 2500));
        break;
      case 'Shuffle':
        sfx.shuffle();
        break;
      case 'TurnStarted':
        if (me != null && ev.seats.includes(me)) sfx.turn();
        break;
      case 'HandResult':
        if (ev.seat === me && ev.net > 0) sfx.win();
        break;
      default:
        break;
    }
  }

  private commitAfter(landing: Promise<unknown>, ev: E): void {
    this.chain = Promise.all([this.chain, landing]).then(() => this.commit(ev));
  }

  private async run(): Promise<void> {
    this.running = true;
    try {
      while (this.queue.length && !this.disposed) {
        const ev = this.queue.shift()!;
        const speed = this.effectiveSpeed();
        this.scene.setSpeed(speed);
        this.current = ev.e;
        try {
          await this.play(ev);
        } catch (err) {
          console.error('director', err);
          this.commitAfter(Promise.resolve(), ev);
        }
      }
      await this.chain;
    } finally {
      this.running = false;
      this.flushing = false;
      this.scene.setSpeed(this.opts.speed());
      this.store.busy.value = false;
      this.pendingMine = 0;
      this.store.ready.value = true;
      if (this.queue.length) void this.run();
    }
  }

  private wait(ms: number): Promise<void> {
    return this.scene.tweens.wait(ms);
  }

  /** Never let a gesture that fails to resolve stall the table: give up after `ms` of scene time. */
  private guard(p: Promise<unknown>, ms: number): Promise<void> {
    return Promise.race([p.then(() => undefined), this.wait(ms)]);
  }

  private async play(ev: E): Promise<void> {
    const sc = this.scene;
    switch (ev.e) {
      case 'RoundStarted': {
        await this.chain;
        this.commit(ev);
        this.remap();
        this.syncAllChips();
        return;
      }
      case 'SeatJoined':
      case 'SeatLeft': {
        await this.chain;
        this.commit(ev);
        const phase = this.presented?.phase;
        if (phase === 'idle' || phase === 'betting' || ev.e === 'SeatJoined') {
          const before = JSON.stringify([...this.spots]);
          this.remap();
          if (JSON.stringify([...this.spots]) !== before) this.rebuild();
          else if (ev.e === 'SeatJoined') this.syncSeatChips(ev.seat.id);
        }
        if (ev.e === 'SeatLeft') this.syncAllChips();
        return;
      }
      case 'Shuffle': {
        const done = this.guard(sc.dealer.shuffle({ durationMs: PACING.reshuffle }).done, PACING.reshuffle * 1.5);
        this.commitAfter(done, ev);
        await done;
        return;
      }
      case 'CardDealt': {
        const t = ev.to;
        const spot = this.spotOfTarget(t);
        if (spot == null) {
          this.commitAfter(Promise.resolve(), ev);
          return;
        }
        let pos: V3;
        let yaw = 0;
        if (t.t === 'dealer') pos = bjDealerCardPos(t.slot);
        else {
          const p = this.cardPos(t.seat, t.hand, t.slot)!;
          pos = p.pos;
          yaw = p.yaw;
        }
        const landing = new Promise<void>((resolve) => {
          let released = false;
          const release = (from: THREE.Vector3 | V3) => {
            if (released) return;
            released = true;
            sc.cards.create(ev.cid, ev.card, { x: from.x, y: from.y, z: from.z }, -0.5, false);
            const dist = Math.hypot(from.x - pos.x, from.z - pos.z);
            void sc.cards.fly(ev.cid, pos, yaw, 220 + dist * 260, { faceUp: ev.faceUp }).then(resolve);
          };
          sc.dealer.dealFromShoe(vec(BJ_SHOE), vec(pos), { durationMs: PACING.bjCard, onRelease: (p: THREE.Vector3) => release(p) });
          void this.wait(PACING.bjCard * 4).then(() => release(BJ_SHOE));
        });
        this.commitAfter(landing, ev);
        await this.wait(PACING.bjCard);
        return;
      }
      case 'CardFlipped': {
        await this.chain;
        const cid = ev.cid;
        const obj = sc.cards.get(cid);
        const at = obj ? obj.group.position.clone() : vec(bjDealerCardPos(1));
        const flipped = new Promise<void>((resolve) => {
          let done = false;
          const flip = () => {
            if (done) return;
            done = true;
            sc.cards.setFace(cid, ev.card);
            void sc.cards.flip(cid, true, PACING.flip * 0.7).then(resolve);
          };
          sc.dealer.flip(at, { durationMs: PACING.flip, onFlip: flip });
          void this.wait(PACING.flip * 3).then(flip);
        });
        this.commitAfter(flipped, ev);
        await flipped;
        return;
      }
      case 'DealerPeeked': {
        await this.chain;
        const hole = this.presented?.dealer.cards[1];
        const at = vec(bjDealerCardPos(1));
        const g = this.guard(sc.dealer.peek(at, { durationMs: PACING.peek }).done, PACING.peek * 1.5);
        const p = hole ? sc.cards.peek(hole.cid, PACING.peek * 0.8) : Promise.resolve();
        this.commitAfter(Promise.all([g, p]), ev);
        await Promise.all([g, p]);
        return;
      }
      case 'HandSplit': {
        await this.chain;
        this.commit(ev);
        const s = this.seat(ev.seat);
        if (!s || this.spots.get(ev.seat) == null) return;
        const moves: Promise<void>[] = [];
        s.hands.forEach((h, hi) =>
          h.cards.forEach((c, slot) => {
            const p = this.cardPos(ev.seat, hi, slot)!;
            moves.push(sc.cards.fly(c.cid, p.pos, p.yaw, PACING.split, { height: 0.02 }));
          }),
        );
        this.syncSeatChips(ev.seat);
        await Promise.all(moves);
        return;
      }
      case 'ChipsMoved': {
        const from = this.accPos(ev.from);
        const to = this.accPos(ev.to);
        if (!from || !to) {
          this.commitAfter(Promise.resolve(), ev);
          return;
        }
        const fromKey = this.accKey(ev.from);
        if (fromKey) sc.chips.setStack(fromKey, from, ev.fromBal);
        let dur: number = PACING.collect;
        if (ev.from.k === 'house') {
          dur = PACING.payout;
          sc.dealer.pushChips(vec(to), { durationMs: PACING.payout });
        } else if (ev.to.k === 'house') {
          sc.dealer.takeChips(vec(from), { durationMs: PACING.collect });
        } else if (ev.reason === 'bet' || ev.reason === 'double' || ev.reason === 'split' || ev.reason === 'insurance') {
          dur = PACING.bet + 60;
        }
        const landing = sc.chips.fly(from, to, ev.amount, dur);
        this.commitAfter(landing, ev);
        await this.wait(ev.from.k === 'house' || ev.to.k === 'house' ? 160 : 90);
        return;
      }
      case 'CardsCollected': {
        await this.chain;
        const all = sc.cards.all();
        if (all.length) {
          const positions = all.map((c) => c.group.position.clone());
          sc.dealer.sweep(positions, vec(BJ_DISCARD), { durationMs: PACING.sweep });
          await Promise.all(
            all.map((c, i) =>
              sc.cards.fly(c.cid, { x: BJ_DISCARD.x, y: BJ_DISCARD.y + 0.01, z: BJ_DISCARD.z }, 0.45, PACING.sweep * 0.6, { from: { x: c.group.position.x, y: c.group.position.y, z: c.group.position.z }, faceUp: false, height: 0.05 }).then(async () => {
                await this.wait(i * 4);
                sc.cards.remove(c.cid);
              }),
            ),
          );
        }
        this.commit(ev);
        return;
      }
      case 'TurnStarted': {
        this.commitAfter(Promise.resolve(), ev);
        const me = this.you();
        const target = ev.seats.length === 1 ? ev.seats[0]! : me != null && ev.seats.includes(me) ? me : null;
        const spot = target != null ? this.spots.get(target) : undefined;
        if (spot != null) {
          const c = bjSpotCenter(spot);
          sc.dealer.lookAt(new THREE.Vector3(c.x, 0.35, c.z));
          if (target === me && ev.seats.length === 1) sc.dealer.point(vec(c), { durationMs: 700 });
        } else sc.dealer.lookAt(null);
        return;
      }
      case 'Phase': {
        this.commitAfter(Promise.resolve(), ev);
        if (ev.phase === 'betting') sc.dealer.lookAt(null);
        return;
      }
      default:
        this.commitAfter(Promise.resolve(), ev);
        return;
    }
  }
}
