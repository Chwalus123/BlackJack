import { SuitIcon } from '../deco';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['c', 'd', 'h', 's'] as const;
const SUIT_NAMES = { c: '♣', d: '♦', h: '♥', s: '♠' } as const;

export function cardLabel(card: number): string {
  return `${RANKS[card >> 2]!}${SUIT_NAMES[SUITS[card & 3]!]}`;
}

/**
 * A large 2D card for the dock (phones read these more easily than the 3D table). `mark` highlights the cards
 * of a winning hand at showdown and dims the rest.
 */
export function BigCard({ card, mark }: { card: number | null; mark?: 'win' | 'dim' }) {
  if (card == null) return <div class="big-card back" aria-hidden="true" />;
  const s = SUITS[card & 3]!;
  const red = s === 'd' || s === 'h';
  return (
    <div class={`big-card ${red ? 'red' : ''} ${mark ?? ''}`} role="img" aria-label={cardLabel(card)}>
      <span>{RANKS[card >> 2]}</span>
      <SuitIcon suit={s} size={20} />
    </div>
  );
}

/** An empty place for a card that has not been dealt yet. */
export function CardSlot() {
  return <div class="big-card slot" aria-hidden="true" />;
}
