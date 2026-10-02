/**
 * Cards are integers 0..51: rank = (c >> 2) + 2 (2..14, ace = 14), suit = c & 3.
 * Suits: 0 clubs, 1 diamonds, 2 hearts, 3 spades.
 */
export type Card = number;
export type Suit = 0 | 1 | 2 | 3;

export const SUITS = ['c', 'd', 'h', 's'] as const;
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;

export const rankOf = (c: Card): number => (c >> 2) + 2;
export const suitOf = (c: Card): Suit => (c & 3) as Suit;
export const makeCard = (rank: number, suit: number): Card => ((rank - 2) << 2) | suit;

export function fullDeck(): Card[] {
  const d: Card[] = [];
  for (let c = 0; c < 52; c++) d.push(c);
  return d;
}

/** "As", "Td", "10h", "9c" → Card. */
export function parseCard(s: string): Card {
  const t = s.trim();
  const suitCh = t.slice(-1).toLowerCase();
  let rankStr = t.slice(0, -1).toUpperCase();
  if (rankStr === '10') rankStr = 'T';
  const r = RANKS.indexOf(rankStr as (typeof RANKS)[number]);
  const su = SUITS.indexOf(suitCh as (typeof SUITS)[number]);
  if (r < 0 || su < 0) throw new Error(`Bad card: ${s}`);
  return makeCard(r + 2, su);
}

export const parseCards = (s: string): Card[] => s.split(/\s+/).filter(Boolean).map(parseCard);

export function formatCard(c: Card): string {
  return `${RANKS[rankOf(c) - 2]}${SUITS[suitOf(c)]}`;
}

/** Blackjack value of a single card: ace = 1 (soft handling is done by hand math), faces = 10. */
export function bjValue(c: Card): number {
  const r = rankOf(c);
  if (r === 14) return 1;
  return r >= 10 ? 10 : r;
}
