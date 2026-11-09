import * as THREE from 'three';
import { clone, he, PACING, type Account, type Reveal, type SeatId } from '@casino/engine';
import type { TableStore } from '../store/table';
import { sfx } from '../shared/sound';
import type { TableScene } from './scene';
import { winningCids } from './heWinners';
import { HE_BOARD_SCALE, HE_DECK, HE_MUCK, HE_POT, HE_SPOT_ANGLES, HE_TABLE, heBetPos, heBoardPos, heButtonPos, heHolePos, heSpotCenter, heStackPos, mapSeats, v3, type V3 } from './layout';

type V = he.HView;
type E = he.HEvent;
type L = he.HLegal;

const vec = (p: V3) => new THREE.Vector3(p.x, p.y, p.z);
const DEG = Math.PI / 180;

/** Hold'em choreography: deck-in-hand dealing, burns, the board, chips to the pot and back. */
export class HoldemDirector {
  private queue: { ev: E; reveals: Map<number, number> }[] = [];
  private running = false;
  private presented: V | null = null;
  private chain: Promise<void> = Promise.resolve();
  private pendingMine = 0;
  private flushing = false;
  private disposed = false;
  private readonly button: THREE.Mesh;
  /** Known card faces from private reveals (my hole cards), by cid. */
  private known = new Map<number, number>();
  spots = new Map<SeatId, number>();
  /** Card ids of the winning five(s) at showdown, lit in 3D and in the HUD boxes. */
  highlight = new Set<number>();
  /** Bumped by snapshots: animations and commits started before a snapshot must not touch the new view. */
  private epoch = 0;
  private playEpoch = 0;

  constructor(
    private readonly scene: TableScene,
    private readonly store: TableStore<V, L>,
    private readonly opts: { speed: () => number },
  ) {
    const g = new THREE.CylinderGeometry(0.024, 0.024, 0.006, 32);
    const tex = buttonTexture();
    const mat = [
      new THREE.MeshStandardMaterial({ color: '#f4ecd8', roughness: 0.5 }),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 }),
      new THREE.MeshStandardMaterial({ color: '#f4ecd8', roughness: 0.5 }),
    ];
    this.button = new THREE.Mesh(g, mat);
    this.button.castShadow = true;
    this.button.visible = false;
    scene.scene.add(this.button);
  }

  get view(): V | null {
    return this.presented;
  }

  applySnapshot(view: V): void {
    this.epoch++;
    this.chain = Promise.resolve();
    this.highlight.clear();
    this.queue = [];
    this.pendingMine = 0;
    this.presented = clone(view);
    for (const s of view.seats) for (const c of s?.hole ?? []) if (c.card != null) this.known.set(c.cid, c.card);
    this.remap();
    this.rebuild();
    this.publish();
    this.store.ready.value = true;
  }

  enqueue(events: E[], reveals: Reveal[]): void {
    const map = new Map(reveals.map((r) => [r.cid, r.card]));
    for (const r of reveals) this.known.set(r.cid, r.card);
    for (const ev of events) {
      if (this.touchesMe(ev)) this.pendingMine++;
      this.queue.push({ ev, reveals: map });
    }
    if (this.pendingMine > 0) this.store.ready.value = false;
    this.store.busy.value = true;
    if (!this.running) void this.run();
  }

  flush(): void {
    this.flushing = true;
    this.scene.flush();
    if (!this.running) this.flushing = false;
  }

  gate(): number {
    const sp = this.speed();
    if (!Number.isFinite(sp)) return performance.now();
    let ms = 0;
    for (const q of this.queue) ms += this.nominal(q.ev);
    return performance.now() + ms / sp + (this.running ? 250 / sp : 0);
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
    this.scene.scene.remove(this.button);
    this.button.geometry.dispose();
    for (const m of this.button.material as THREE.MeshStandardMaterial[]) {
      m.map?.dispose();
      m.dispose();
    }
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
      case 'HandStarted':
      case 'StreetDealt':
      case 'BetsGathered':
      case 'PotAwarded':
      case 'CardsCollected':
        return true;
      case 'CardDealt':
        return ev.to.t === 'board' || (ev.to.t === 'hole' && ev.to.seat === me);
      case 'ChipsMoved':
        return ('seat' in ev.from && ev.from.seat === me) || ('seat' in ev.to && ev.to.seat === me);
      case 'Acted':
      case 'BlindPosted':
      case 'SeatStatus':
        return ev.seat === me;
      default:
        return false;
    }
  }

  private speed(): number {
    const base = this.opts.speed();
    if (this.flushing || !Number.isFinite(base)) return Infinity;
    let est = 0;
    for (const q of this.queue) est += this.nominal(q.ev);
    if (this.queue.length > 80 || est / base > 6000) return Infinity;
    return base * Math.min(6, 1 + Math.max(0, est / base - 1500) / 1500);
  }

  private nominal(ev: E): number {
    switch (ev.e) {
      case 'CardDealt':
        return ev.to.t === 'hole' ? (this.spots.has(ev.to.seat) ? PACING.heHoleCard : 0) : ev.to.t === 'burn' ? PACING.burn : PACING.street / 2;
      case 'ChipsMoved':
        return 120;
      case 'Shuffle':
        return PACING.reshuffle / 2;
      case 'CardsCollected':
        return PACING.sweep;
      case 'PotAwarded':
        return PACING.potPush;
      default:
        return 0;
    }
  }

  private seat(id: SeatId) {
    return this.presented?.seats[id] ?? null;
  }

  private remap(): void {
    const v = this.presented;
    if (!v) return;
    const order = v.seats.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    this.spots = mapSeats(order, this.you(), HE_TABLE.spots, HE_TABLE.heroSpot, true);
    this.store.layoutVersion.value++;
  }

  private publish(): void {
    if (this.presented) this.store.presented.value = { ...this.presented };
  }

  private yaw(spot: number): number {
    return (HE_SPOT_ANGLES[spot] ?? 0) * DEG;
  }

  private accPos(a: Account): V3 | null {
    switch (a.k) {
      case 'stack': {
        const s = this.spots.get(a.seat);
        return s == null ? null : heStackPos(s);
      }
      case 'street': {
        const s = this.spots.get(a.seat);
        return s == null ? null : heBetPos(s);
      }
      case 'pot':
        return v3(HE_POT.x, 0, HE_POT.z);
      default:
        return null;
    }
  }

  private accKey(a: Account): string | null {
    return a.k === 'stack' ? `stack:${a.seat}` : a.k === 'street' ? `street:${a.seat}` : a.k === 'pot' ? 'pot' : null;
  }

  private syncChips(): void {
    const v = this.presented;
    if (!v) return;
    const chips = this.scene.chips;
    chips.clearAll();
    v.seats.forEach((s, id) => {
      const spot = this.spots.get(id);
      if (!s || spot == null) return;
      chips.setStack(`stack:${id}`, heStackPos(spot), s.stack);
      chips.setStack(`street:${id}`, heBetPos(spot), s.street);
    });
    chips.setStack('pot', v3(HE_POT.x, 0, HE_POT.z), v.pot);
  }

  private faceOf(cid: number, card: number | null): number | null {
    return card ?? this.known.get(cid) ?? null;
  }

  private rebuild(): void {
    const v = this.presented;
    if (!v) return;
    const cards = this.scene.cards;
    cards.clear();
    this.scene.setCardBack(v.hand % 2 === 1);
    v.seats.forEach((s, id) => {
      const spot = this.spots.get(id);
      if (!s || spot == null) return;
      s.hole.forEach((c, slot) => {
        const face = this.faceOf(c.cid, c.card);
        const up = face != null && (id === this.you() || s.shown);
        cards.create(c.cid, face, heHolePos(spot, slot), this.yaw(spot), up);
      });
    });
    v.board.forEach((c, slot) => cards.create(c.cid, c.card, heBoardPos(slot), 0, true, HE_BOARD_SCALE));
    this.placeButton(v.button, false);
    this.syncChips();
    this.scene.wake(100);
  }

  private placeButton(pos: number | null, animate: boolean): Promise<void> {
    const spot = pos == null ? undefined : this.spots.get(pos);
    if (spot == null) {
      this.button.visible = false;
      return Promise.resolve();
    }
    const to = heButtonPos(spot);
    if (!animate || !this.button.visible) {
      this.button.position.set(to.x, 0.003, to.z);
      this.button.visible = true;
      return Promise.resolve();
    }
    const from = this.button.position.clone();
    return this.scene.tweens.add(PACING.button, (k) => {
      this.button.position.lerpVectors(from, vec({ x: to.x, y: 0.003, z: to.z }), k);
      this.button.position.y = 0.003 + Math.sin(Math.PI * k) * 0.03;
    });
  }

  private commit(ev: E, reveals: Map<number, number>): void {
    const v = this.presented;
    if (!v || this.disposed) return;
    he.reduceHoldemView(v, ev);
    this.sound(ev);
    if (ev.e === 'CardDealt' && ev.to.t === 'hole') {
      const card = reveals.get(ev.cid);
      if (card != null) he.applyHoldemReveal(v, { seat: ev.to.seat, cid: ev.cid, card });
    }
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
      case 'PotAwarded':
        for (const w of ev.winners) this.store.pushResult({ seat: w.seat, hand: ev.pot, outcome: 'win', net: w.amount, value: ev.value });
        for (const cid of this.winningCids(ev)) this.highlight.add(cid);
        break;
      case 'CardsCollected':
        this.highlight.clear();
        break;
      case 'HandStarted':
        this.store.clearResults();
        this.highlight.clear();
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
    if (!Number.isFinite(this.speed()) && this.queue.length > 3) return;
    const me = this.you();
    switch (ev.e) {
      case 'CardDealt':
        if (ev.to.t !== 'hole' || this.spots.has(ev.to.seat)) sfx.card();
        break;
      case 'HandsRevealed':
      case 'Shown':
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
      case 'PotAwarded':
        if (ev.winners.some((w) => w.seat === me)) sfx.win();
        break;
      default:
        break;
    }
  }

  private commitAfter(landing: Promise<unknown>, ev: E, reveals: Map<number, number>): void {
    const ep = this.playEpoch;
    this.chain = Promise.all([this.chain, landing]).then(() => this.commitIf(ep, ev, reveals));
  }

  /** Commit unless a snapshot has replaced the view since this event started playing. */
  private commitIf(ep: number, ev: E, reveals: Map<number, number>): void {
    if (ep === this.epoch) this.commit(ev, reveals);
  }

  private winningCids(ev: Extract<E, { e: 'PotAwarded' }>): number[] {
    return winningCids(this.presented, ev);
  }

  private async run(): Promise<void> {
    this.running = true;
    try {
      while (this.queue.length && !this.disposed) {
        const q = this.queue.shift()!;
        this.playEpoch = this.epoch;
        this.scene.setSpeed(this.speed());
        try {
          await this.play(q.ev, q.reveals);
        } catch (err) {
          console.error('director', err);
          this.commitAfter(Promise.resolve(), q.ev, q.reveals);
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

  private async foldCards(seat: SeatId): Promise<void> {
    const s = this.seat(seat);
    if (!s) return;
    const sc = this.scene;
    const ep = this.playEpoch;
    await Promise.all(
      s.hole.map((c) =>
        sc.cards.has(c.cid)
          ? sc.cards.fly(c.cid, { x: HE_MUCK.x, y: HE_MUCK.y, z: HE_MUCK.z }, 0.3, 420, { faceUp: false, height: 0.04 }).then(() => this.removeIf(ep, c.cid))
          : Promise.resolve(),
      ),
    );
  }

  /** Remove a card after its exit flight, unless a snapshot has since rebuilt the table (it may hold that cid). */
  private removeIf(ep: number, cid: number): void {
    if (ep === this.epoch) this.scene.cards.remove(cid);
  }

  private async play(ev: E, reveals: Map<number, number>): Promise<void> {
    const sc = this.scene;
    switch (ev.e) {
      case 'HandStarted': {
        await this.chain;
        this.commitIf(this.playEpoch, ev, reveals);
        this.remap();
        this.scene.setCardBack(ev.hand % 2 === 1);
        this.syncChips();
        return;
      }
      case 'SeatJoined':
      case 'SeatLeft': {
        await this.chain;
        this.commitIf(this.playEpoch, ev, reveals);
        const before = JSON.stringify([...this.spots]);
        this.remap();
        if (JSON.stringify([...this.spots]) !== before) this.rebuild();
        else this.syncChips();
        return;
      }
      case 'ButtonMoved': {
        const p = this.placeButton(ev.button, true);
        this.commitAfter(p, ev, reveals);
        await p;
        return;
      }
      case 'Shuffle': {
        const done = this.guard(sc.dealer.shuffle({ durationMs: PACING.reshuffle / 2 }).done, PACING.reshuffle);
        this.commitAfter(done, ev, reveals);
        await done;
        return;
      }
      case 'CardDealt': {
        const t = ev.to;
        let pos: V3;
        let yaw = 0;
        let faceUp = ev.faceUp;
        let face = ev.card;
        if (t.t === 'hole') {
          const spot = this.spots.get(t.seat);
          if (spot == null) {
            this.commitAfter(Promise.resolve(), ev, reveals);
            return;
          }
          pos = heHolePos(spot, t.slot);
          yaw = this.yaw(spot);
          face = face ?? reveals.get(ev.cid) ?? null;
          faceUp = t.seat === this.you() && face != null;
        } else if (t.t === 'board') {
          pos = heBoardPos(t.slot);
        } else {
          pos = { x: HE_MUCK.x, y: HE_MUCK.y + 0.002, z: HE_MUCK.z };
          yaw = 0.3;
        }
        const ep = this.playEpoch;
        const landing = new Promise<void>((resolve) => {
          let released = false;
          const release = (from: THREE.Vector3 | V3) => {
            if (released) return;
            released = true;
            // A snapshot rebuilt the table while the dealer was reaching: do not fly a stale card onto it.
            if (ep !== this.epoch) return resolve();
            sc.cards.create(ev.cid, face, { x: from.x, y: from.y, z: from.z }, 0, false);
            const dist = Math.hypot(from.x - pos.x, from.z - pos.z);
            void sc.cards.fly(ev.cid, pos, yaw, 200 + dist * 240, { faceUp, scale: t.t === 'board' ? HE_BOARD_SCALE : 1 }).then(resolve);
          };
          const dur = t.t === 'hole' ? PACING.heHoleCard : t.t === 'burn' ? PACING.burn : PACING.street / 2;
          if (t.t === 'burn') sc.dealer.burn({ durationMs: dur, onRelease: (p: THREE.Vector3) => release(p) });
          else sc.dealer.dealFromHand(vec(pos), { durationMs: dur, onRelease: (p: THREE.Vector3) => release(p) });
          void this.wait(dur * 4).then(() => release(HE_DECK));
        });
        this.commitAfter(landing, ev, reveals);
        await this.wait(t.t === 'hole' ? PACING.heHoleCard : t.t === 'burn' ? PACING.burn : PACING.street / 2);
        return;
      }
      case 'Acted': {
        if (ev.action === 'fold') {
          await this.chain;
          const p = this.foldCards(ev.seat);
          this.commitAfter(p, ev, reveals);
          await p;
          return;
        }
        this.commitAfter(Promise.resolve(), ev, reveals);
        return;
      }
      case 'Mucked': {
        await this.chain;
        const p = this.foldCards(ev.seat);
        this.commitAfter(p, ev, reveals);
        await p;
        return;
      }
      case 'HandsRevealed':
      case 'Shown': {
        await this.chain;
        const hands = ev.e === 'Shown' ? [{ seat: ev.seat, cards: ev.cards }] : ev.hands;
        const flips: Promise<void>[] = [];
        for (const h of hands) {
          for (const c of h.cards) {
            if (c.card == null || !sc.cards.has(c.cid)) continue;
            sc.cards.setFace(c.cid, c.card);
            if (!sc.cards.get(c.cid)!.faceUp) flips.push(sc.cards.flip(c.cid, true, PACING.flip));
          }
        }
        this.commitAfter(Promise.all(flips), ev, reveals);
        await Promise.all(flips);
        return;
      }
      case 'ChipsMoved': {
        const from = this.accPos(ev.from);
        const to = this.accPos(ev.to);
        if (!from || !to) {
          this.commitAfter(Promise.resolve(), ev, reveals);
          return;
        }
        const fromKey = this.accKey(ev.from);
        if (fromKey) sc.chips.setStack(fromKey, from, ev.fromBal);
        const award = ev.from.k === 'pot';
        if (award) sc.dealer.pushChips(vec(to), { durationMs: PACING.potPush });
        const dur = award ? PACING.potPush : ev.to.k === 'pot' ? PACING.gather : PACING.bet + 40;
        const landing = sc.chips.fly(from, to, ev.amount, dur);
        this.commitAfter(landing, ev, reveals);
        await this.wait(award ? 200 : ev.to.k === 'pot' ? 60 : 120);
        return;
      }
      case 'PotAwarded': {
        await this.chain;
        for (const cid of this.winningCids(ev)) {
          const c = sc.cards.get(cid);
          if (c) void sc.tweens.add(250, (k) => (c.group.position.y = 0.0006 + k * 0.012));
        }
        this.commitAfter(this.wait(350), ev, reveals);
        await this.wait(350);
        return;
      }
      case 'CardsCollected': {
        await this.chain;
        const ep = this.playEpoch;
        const all = sc.cards.all();
        if (all.length) {
          sc.dealer.sweep(all.map((c) => c.group.position.clone()), vec(HE_MUCK), { durationMs: PACING.sweep });
          await Promise.all(
            all.map((c) =>
              sc.cards.fly(c.cid, { x: HE_MUCK.x, y: HE_MUCK.y, z: HE_MUCK.z }, 0.3, PACING.sweep * 0.6, { faceUp: false, height: 0.05, scale: 1 }).then(() => this.removeIf(ep, c.cid)),
            ),
          );
        }
        this.commitIf(this.playEpoch, ev, reveals);
        this.syncChips();
        return;
      }
      case 'TurnStarted': {
        this.commitAfter(Promise.resolve(), ev, reveals);
        const target = ev.seats[0];
        const spot = target != null ? this.spots.get(target) : undefined;
        if (spot != null) {
          const c = heSpotCenter(spot);
          sc.dealer.lookAt(new THREE.Vector3(c.x, 0.35, c.z));
        } else sc.dealer.lookAt(null);
        return;
      }
      default:
        this.commitAfter(Promise.resolve(), ev, reveals);
        return;
    }
  }
}

function buttonTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f4ecd8';
  ctx.beginPath();
  ctx.arc(64, 64, 64, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c9a24a';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(64, 64, 54, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#141110';
  ctx.font = "800 64px 'Cinzel Variable', Georgia, serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('D', 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
