import type { FeltText } from '../../three/textures/felt';

/** Printed felt wording — the rules on the felt always match the engine's fixed v1 rules. */
export function feltText(_game: 'blackjack' | 'holdem', l: 'pl' | 'en'): FeltText {
  return l === 'pl'
    ? {
        payout: 'BLACKJACK WYPŁACA 3 DO 2',
        insurance: 'UBEZPIECZENIE WYPŁACA 2 DO 1',
        dealerRule: 'Krupier dobiera do 16 i stoi na każdej 17',
        title: 'JACBOS CASINO',
        game: "TEXAS HOLD'EM · NO LIMIT",
      }
    : {
        payout: 'BLACKJACK PAYS 3 TO 2',
        insurance: 'INSURANCE PAYS 2 TO 1',
        dealerRule: 'Dealer must draw to 16 and stand on all 17s',
        title: 'JACBOS CASINO',
        game: "TEXAS HOLD'EM · NO LIMIT",
      };
}
