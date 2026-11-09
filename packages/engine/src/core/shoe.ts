import { fullDeck, type Card } from './cards';
import { nextInt, type RngState } from './chacha';
import { shuffle } from './shuffle';

export interface ShoeConfig {
  minDecks: number; // e.g. 6
  maxDecks: number; // scaling ceiling, e.g. 128
  penetration: readonly [number, number]; // cut card placed uniformly in this fraction range
  burnAfterShuffle: boolean;
}

export interface Shoe {
  cards: Card[]; // draw = pop()
  discards: Card[];
  decks: number;
  /** Cards remaining when the cut card comes out. */
  cutRemaining: number;
  needsShuffle: boolean;
  shuffles: number;
}

export type ShuffleReason = 'newShoe' | 'cut' | 'discards' | 'deckAdded' | 'newHand';
export interface ShuffleEvent {
  e: 'Shuffle';
  decks: number;
  reason: ShuffleReason;
  remaining: number;
}

/** Decks needed so a fresh shoe holds `budget` cards beyond the deepest cut-card position. */
export function decksFor(budget: number, cfg: ShoeConfig): number {
  const need = Math.ceil(budget / (52 * (1 - cfg.penetration[1])));
  return Math.max(1, Math.min(cfg.maxDecks, Math.max(cfg.minDecks, need)));
}

function placeCut(shoe: Shoe, cfg: ShoeConfig, rng: RngState) {
  const n = shoe.cards.length;
  const lo = Math.floor(n * cfg.penetration[0]);
  const hi = Math.floor(n * cfg.penetration[1]);
  const pen = lo + nextInt(rng, Math.max(1, hi - lo + 1));
  shoe.cutRemaining = Math.max(0, n - pen);
}

export function emptyShoe(): Shoe {
  return { cards: [], discards: [], decks: 0, cutRemaining: 0, needsShuffle: true, shuffles: 0 };
}

/** Gather every card not on the table (shoe + discards), resize to `decks`, shuffle, cut, burn. */
export function reshuffleShoe(
  shoe: Shoe,
  decks: number,
  cfg: ShoeConfig,
  rng: RngState,
  reason: ShuffleReason,
  emit: (e: ShuffleEvent) => void,
): void {
  const cards: Card[] = [];
  for (let d = 0; d < decks; d++) cards.push(...fullDeck());
  shoe.decks = decks;
  shoe.cards = shuffle(cards, rng);
  shoe.discards = [];
  shoe.needsShuffle = false;
  shoe.shuffles++;
  placeCut(shoe, cfg, rng);
  if (cfg.burnAfterShuffle) shoe.discards.push(shoe.cards.pop()!);
  emit({ e: 'Shuffle', decks, reason, remaining: shoe.cards.length });
}

/**
 * Called between rounds when the table is empty. Reshuffles when the cut card has come out or the shoe
 * cannot cover this round's card budget; the deck count scales with the number of hands.
 */
export function preRoundCheck(
  shoe: Shoe,
  budget: number,
  cfg: ShoeConfig,
  rng: RngState,
  emit: (e: ShuffleEvent) => void,
): void {
  const want = decksFor(budget, cfg);
  if (shoe.shuffles === 0) {
    reshuffleShoe(shoe, want, cfg, rng, 'newShoe', emit);
  } else if (shoe.needsShuffle || shoe.cards.length < Math.max(shoe.cutRemaining, budget) || want > shoe.decks) {
    reshuffleShoe(shoe, Math.max(want, Math.min(shoe.decks, cfg.maxDecks)), cfg, rng, want > shoe.decks ? 'newShoe' : 'cut', emit);
  }
}

/**
 * Draw one card. If the shoe runs dry mid-round, only the discard tray is reshuffled (cards on the
 * table are never touched); if that is empty too, one fresh deck is added — so any round can finish.
 */
export function draw(shoe: Shoe, cfg: ShoeConfig, rng: RngState, emit: (e: ShuffleEvent) => void): Card {
  if (shoe.cards.length === 0) {
    if (shoe.discards.length > 0) {
      shoe.cards = shuffle(shoe.discards, rng);
      shoe.discards = [];
      shoe.cutRemaining = 0;
      emit({ e: 'Shuffle', decks: shoe.decks, reason: 'discards', remaining: shoe.cards.length });
    } else {
      shoe.cards = shuffle(fullDeck(), rng);
      shoe.decks++;
      shoe.cutRemaining = 0;
      emit({ e: 'Shuffle', decks: shoe.decks, reason: 'deckAdded', remaining: shoe.cards.length });
    }
    shoe.needsShuffle = true;
  }
  const c = shoe.cards.pop()!;
  if (shoe.cards.length < shoe.cutRemaining) shoe.needsShuffle = true;
  return c;
}
