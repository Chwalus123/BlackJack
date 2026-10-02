import { SuitIcon } from '../deco';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['c', 'd', 'h', 's'] as const;
const SUIT_NAMES = { c: '♣', d: '♦', h: '♥', s: '♠' } as const;

/** A large 2D card for the player's own hand in the dock (phones read these more easily than the 3D table). */
export function BigCard({ card }: { card: number | null }) {
  if (card == null) return <div class="big-card back" aria-hidden="true" />;
  const rank = RANKS[card >> 2]!;
  const s = SUITS[card & 3]!;
  const red = s === 'd' || s === 'h';
  return (
    <div class={`big-card ${red ? 'red' : ''}`} role="img" aria-label={`${rank}${SUIT_NAMES[s]}`}>
      <span>{rank}</span>
      <SuitIcon suit={s} size={20} />
    </div>
  );
}
