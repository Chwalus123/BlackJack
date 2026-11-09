/** Dealer announcements. Each key has a translation in the client's pl.ts and en.ts (checked at compile time). */
export const ANNOUNCE_KEYS = [
  'bj.placeBets',
  'bj.lastBets',
  'bj.noMoreBets',
  'bj.insurance',
  'bj.dealerBlackjack',
  'bj.noDealerBlackjack',
  'bj.dealerBusts',
  'bj.dealerHas',
  'bj.blackjack',
  'bj.shuffle',
  'he.shuffle',
  'he.blinds',
  'he.flop',
  'he.turn',
  'he.river',
  'he.showdown',
  'he.allIn',
  'he.wins',
  'he.splitPot',
  'table.welcome',
  'table.paused',
  'table.resumed',
] as const;

export type AnnounceKey = (typeof ANNOUNCE_KEYS)[number];
