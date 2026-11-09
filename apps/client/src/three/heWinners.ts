import { he } from '@casino/engine';

type PotAwarded = Extract<he.HEvent, { e: 'PotAwarded' }>;

/**
 * Card ids of the winning five of every winner of a pot. The engine's PotAwarded names only the first winner's
 * five, which would leave a co-winner's cards unlit in a split pot.
 */
export function winningCids(view: he.HView | null, ev: PotAwarded): number[] {
  const out = [...(ev.best5 ?? [])];
  if (!view || ev.value == null) return out;
  for (const w of ev.winners) {
    const cards = [...(view.seats[w.seat]?.hole ?? []), ...view.board];
    if (cards.length < 5 || cards.some((c) => c.card == null)) continue;
    try {
      for (const card of he.bestFive(cards.map((c) => c.card!), ev.value)) {
        const cid = cards.find((c) => c.card === card)?.cid;
        if (cid != null) out.push(cid);
      }
    } catch {
      // this winner's cards do not make the pot's hand value (e.g. not shown); keep the engine's five
    }
  }
  return [...new Set(out)];
}
