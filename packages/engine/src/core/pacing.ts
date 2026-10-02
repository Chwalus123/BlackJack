/**
 * The single source of nominal animation durations (ms at 1× speed). The client animator uses these
 * as its timing table and the hosts use them to keep decision clocks from being eaten by animations.
 */
export const PACING = {
  bjCard: 380,
  heHoleCard: 260,
  flip: 450,
  peek: 900,
  burn: 300,
  flop: 950,
  street: 750,
  split: 450,
  double: 950,
  bet: 350,
  blind: 300,
  payout: 600,
  collect: 500,
  gather: 450,
  potPush: 700,
  sweep: 900,
  button: 400,
  reshuffle: 2000,
  announce: 1200,
  dealWaveCap: 6000,
} as const;

/** Extra slack added to every deadline so network latency never costs a player their turn. */
export const LATENCY_GRACE_MS = 300;

interface EventLike {
  e: string;
  to?: unknown;
  reason?: string;
}

const targetKind = (to: unknown): string | undefined =>
  to && typeof to === 'object' && 't' in to ? String((to as { t: unknown }).t) : undefined;

/** Nominal time the client needs to present a batch of events at 1×. Deal waves are capped. */
export function animBudget(events: readonly EventLike[]): number {
  let total = 0;
  let deal = 0;
  for (const ev of events) {
    switch (ev.e) {
      case 'CardDealt': {
        const t = targetKind(ev.to);
        if (t === 'board') total += PACING.street;
        else if (t === 'burn') total += PACING.burn;
        else if (t === 'hole') deal += PACING.heHoleCard;
        else deal += PACING.bjCard;
        break;
      }
      case 'CardFlipped': total += PACING.flip; break;
      case 'DealerPeeked': total += PACING.peek; break;
      case 'HandSplit': total += PACING.split; break;
      case 'ChipsMoved': total += ev.reason === 'gather' ? PACING.gather : ev.reason === 'award' ? PACING.potPush : 120; break;
      case 'Shuffle': total += ev.reason === 'newHand' ? PACING.reshuffle / 2.5 : PACING.reshuffle; break;
      case 'CardsCollected': total += PACING.sweep; break;
      case 'ButtonMoved': total += PACING.button; break;
      default: break;
    }
  }
  return total + Math.min(deal, PACING.dealWaveCap);
}
