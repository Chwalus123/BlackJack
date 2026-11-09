/** Original rules text written for Jacbos Casino (PL + EN). Each section: heading + paragraphs and/or a list. */
export interface RulesSection {
  h: string;
  p?: string[];
  list?: string[];
}
export interface RulesDoc {
  title: string;
  intro: string;
  sections: RulesSection[];
}

type Game = 'blackjack' | 'holdem';

export const RULES: Record<'pl' | 'en', Record<Game, RulesDoc>> = {
  pl: {
    blackjack: {
      title: 'Blackjack — zasady stołu',
      intro:
        'Grasz przeciwko kasynu, które reprezentuje krupier. Inni gracze przy stole nie są twoimi rywalami — każdy rozlicza się z krupierem osobno.',
      sections: [
        {
          h: 'Cel gry',
          p: [
            'Zbierz karty o sumie bliższej 21 niż krupier, nie przekraczając 21. Suma powyżej 21 to „fura” — przegrywasz od razu, niezależnie od tego, co później dostanie krupier.',
          ],
        },
        {
          h: 'Wartość kart',
          list: [
            'Karty od 2 do 10 — tyle punktów, ile oczek.',
            'Walet, dama i król — po 10 punktów.',
            'As — 11 punktów albo 1 punkt, zawsze w sposób korzystniejszy dla ręki. Ręka z asem liczonym jako 11 to ręka „miękka” (np. as i szóstka to miękkie 17).',
            'Kolor karty nie ma znaczenia.',
          ],
        },
        {
          h: 'Przebieg rundy',
          list: [
            'Obstawiasz zakład żetonami w swoim polu. W grze solo wybierasz kwotę w granicach limitu stołu, w multiplayerze stawkę ustala gospodarz.',
            'Krupier rozdaje po jednej odkrytej karcie każdemu graczowi, jedną odkrytą sobie, drugą kartę graczom i jedną zakrytą sobie.',
            'Gdy krupier pokazuje asa lub kartę wartą 10, sprawdza zakrytą kartę. Jeśli ma blackjacka, odsłania ją od razu i runda się kończy.',
            'Następnie gracze podejmują decyzje, a na końcu gra krupier.',
          ],
        },
        {
          h: 'Twoje decyzje',
          list: [
            'Dobierz — weź kolejną kartę.',
            'Stój — zostań przy obecnej sumie.',
            'Podwój — na dwóch pierwszych kartach dołóż drugi taki sam zakład i weź dokładnie jedną kartę.',
            'Rozdziel — dwie karty o tej samej wartości dzielisz na dwie ręce, dokładając zakład do drugiej. Można mieć do czterech rąk. Rozdzielone asy dostają po jednej karcie i nie można ich dzielić ponownie. Po rozdzieleniu wolno podwajać.',
          ],
        },
        {
          h: 'Blackjack, ubezpieczenie i równa wypłata',
          list: [
            'Blackjack to as i karta warta 10 z dwóch pierwszych kart. Płaci 3:2 (zakład 10 wygrywa 15). Suma 21 po rozdzieleniu nie jest blackjackiem i płaci 1:1.',
            'Gdy krupier pokazuje asa, możesz wykupić ubezpieczenie za połowę zakładu. Płaci 2:1, jeśli krupier ma blackjacka.',
            'Jeśli sam masz blackjacka, a krupier pokazuje asa, możesz wziąć równą wypłatę — 1:1 od razu, bez ryzyka remisu.',
          ],
        },
        {
          h: 'Gra krupiera',
          p: [
            'Krupier nie podejmuje decyzji: dobiera, dopóki ma 16 lub mniej, i zatrzymuje się na każdej sumie 17, także miękkiej. Jeśli przekroczy 21, wygrywają wszystkie ręce, które jeszcze grają.',
          ],
        },
        {
          h: 'Wypłaty',
          list: [
            'Wygrana — 1:1.',
            'Blackjack — 3:2.',
            'Ubezpieczenie — 2:1.',
            'Remis (ta sama suma) — zakład wraca do ciebie.',
          ],
        },
        {
          h: 'But i tasowanie',
          p: [
            'Gramy sześcioma taliami z buta. Karta odcięcia leży mniej więcej między 70% a 80% buta — po jej wyjściu krupier tasuje przed następną rundą. Przy dużym stole w multiplayerze krupier dokłada talie, aby kart wystarczyło dla wszystkich.',
          ],
        },
        {
          h: 'Multiplayer',
          list: [
            'Gospodarz ustala stałą stawkę dla wszystkich. Podwojenie i rozdzielenie kosztuje jedną stawkę, ubezpieczenie — pół stawki.',
            'Przy jednym stole może grać dowolnie wielu graczy. Wszyscy podejmują decyzje jednocześnie, każdy ma własny zegar.',
            'Jeśli czas minie, twoja ręka zostaje przy obecnej sumie. Po dwóch takich rundach z rzędu przechodzisz w pauzę.',
          ],
        },
      ],
    },
    holdem: {
      title: "Texas Hold'em — zasady stołu",
      intro:
        'Grasz przeciwko innym graczom, a krupier AI prowadzi rozdanie: tasuje, rozdaje, pilnuje kolejki i dzieli pule. Odmiana No-Limit — w każdej chwili możesz postawić wszystkie żetony.',
      sections: [
        {
          h: 'Cel gry',
          p: [
            'Wygraj pulę: albo wszyscy pozostali spasują, albo przy odkryciu kart ułożysz najlepszy układ pięciu kart z dwóch własnych i pięciu wspólnych.',
          ],
        },
        {
          h: 'Przycisk i ciemne',
          list: [
            'Przycisk krupierski (D) wskazuje umownego rozdającego i co rozdanie przesuwa się o jedno miejsce w lewo.',
            'Gracz po lewej od przycisku wpłaca małą ciemną (MC), następny — dużą ciemną (DC), zwykle dwa razy większą.',
            'Przy dwóch graczach przycisk wpłaca małą ciemną, mówi pierwszy przed flopem i ostatni po nim.',
            'Nowy gracz wpłaca dużą ciemną, zanim dostanie karty, albo czeka, aż ta pozycja do niego dotrze.',
          ],
        },
        {
          h: 'Przebieg rozdania',
          list: [
            'Każdy dostaje dwie zakryte karty i zaczyna się pierwsza licytacja. Pierwszy mówi gracz po lewej od dużej ciemnej.',
            'Flop — krupier spala jedną kartę i odkrywa trzy wspólne. Druga licytacja.',
            'Turn — spalenie i czwarta karta wspólna. Trzecia licytacja.',
            'River — spalenie i piąta karta. Ostatnia licytacja i odkrycie kart.',
          ],
        },
        {
          h: 'Twoje ruchy',
          list: [
            'Pas — rezygnujesz z rozdania.',
            'Czekam — gdy nikt jeszcze nie postawił w tej rundzie.',
            'Sprawdzam — wyrównujesz najwyższą stawkę.',
            'Stawiam / Podbijam — podbicie musi być co najmniej tak duże jak poprzednie podbicie w tej rundzie (pierwsze — co najmniej duża ciemna).',
            'All-in — stawiasz wszystkie żetony. All-in mniejszy niż pełne podbicie nie otwiera licytacji ponownie dla graczy, którzy już mówili.',
          ],
        },
        {
          h: 'Pule boczne',
          p: [
            'Gdy ktoś gra all-in za mniej, pozostałe żetony trafiają do puli bocznej, o którą grają tylko gracze, którzy do niej dołożyli. Każda pula jest rozliczana osobno; przy remisie dzielona po równo, a niepodzielny żeton dostaje pierwszy zwycięzca po lewej od przycisku.',
          ],
        },
        {
          h: 'Odkrycie kart',
          p: [
            'Jako pierwszy karty pokazuje gracz, który ostatni podbijał na riverze, a jeśli nikt nie podbijał — pierwszy gracz po lewej od przycisku. Ręce, które nie mogą już wygrać, są odrzucane bez pokazywania.',
          ],
        },
        {
          h: 'Starszeństwo układów (od najwyższego)',
          list: [
            'Poker królewski — A K D W 10 w jednym kolorze.',
            'Poker — pięć kolejnych kart w jednym kolorze.',
            'Kareta — cztery karty tej samej wysokości.',
            'Full — trójka i para.',
            'Kolor — pięć kart w jednym kolorze.',
            'Strit — pięć kolejnych kart (as może być najniższy: A 2 3 4 5).',
            'Trójka — trzy karty tej samej wysokości.',
            'Dwie pary.',
            'Para.',
            'Wysoka karta.',
          ],
        },
        {
          h: 'Multiplayer',
          list: [
            'Gospodarz ustala stałe ciemne i wpisowe dla wszystkich.',
            'Przy stole jest do 22 miejsc — tyle pozwala jedna talia (44 karty graczy, 5 wspólnych i 3 spalone). Kolejni gracze czekają w kolejce jako widzowie i siadają, gdy zwolni się miejsce.',
            'Gdy minie twój czas, czekasz, jeśli to możliwe, a w przeciwnym razie pasujesz.',
          ],
        },
      ],
    },
  },
  en: {
    blackjack: {
      title: 'Blackjack — table rules',
      intro:
        'You play against the house, represented by the dealer. Other players at the table are not your opponents — everyone settles with the dealer separately.',
      sections: [
        {
          h: 'The goal',
          p: [
            'Finish closer to 21 than the dealer without going over. Going over 21 is a bust — you lose at once, whatever the dealer draws later.',
          ],
        },
        {
          h: 'Card values',
          list: [
            'Cards 2 to 10 count their face value.',
            'Jack, queen and king count 10.',
            'An ace counts 11 or 1, whichever is better for the hand. A hand with an ace counted as 11 is “soft” (an ace and a six is soft 17).',
            'Suits do not matter.',
          ],
        },
        {
          h: 'How a round goes',
          list: [
            'Place your bet in your circle. In single-player you choose the amount within the table limits; in multiplayer the host sets the stake.',
            'The dealer gives each player one card face up, one face up to the dealer, a second card to each player and one face down to the dealer.',
            'When the dealer shows an ace or a ten-value card, the dealer checks the face-down card. With a blackjack it is turned over at once and the round ends.',
            'Then the players decide, and the dealer plays last.',
          ],
        },
        {
          h: 'Your options',
          list: [
            'Hit — take another card.',
            'Stand — keep your total.',
            'Double — on your first two cards, add a second equal bet and take exactly one card.',
            'Split — two cards of the same value become two hands; add a bet to the second one. Up to four hands. Split aces get one card each and cannot be split again. Doubling after a split is allowed.',
          ],
        },
        {
          h: 'Blackjack, insurance and even money',
          list: [
            'A blackjack is an ace and a ten-value card as your first two cards. It pays 3 to 2 (a bet of 10 wins 15). 21 after a split is not a blackjack and pays 1 to 1.',
            'When the dealer shows an ace you may buy insurance for half your bet. It pays 2 to 1 if the dealer has blackjack.',
            'If you hold a blackjack against a dealer ace you may take even money — paid 1 to 1 immediately, with no risk of a push.',
          ],
        },
        {
          h: 'How the dealer plays',
          p: [
            'The dealer makes no choices: draws on 16 or less and stands on every 17, including soft 17. If the dealer busts, every hand still in play wins.',
          ],
        },
        {
          h: 'Payouts',
          list: ['Win — 1 to 1.', 'Blackjack — 3 to 2.', 'Insurance — 2 to 1.', 'Push (same total) — your bet is returned.'],
        },
        {
          h: 'Shoe and shuffle',
          p: [
            'We deal six decks from a shoe. The cut card sits roughly 70–80% deep; once it comes out the dealer shuffles before the next round. At a big multiplayer table the dealer adds decks so there are enough cards for everyone.',
          ],
        },
        {
          h: 'Multiplayer',
          list: [
            'The host sets one fixed stake for everyone. Doubling and splitting cost one stake, insurance costs half a stake.',
            'Any number of players can sit at one table. Everyone decides at the same time, each with their own clock.',
            'If your time runs out your hand stands. After two such rounds in a row you are sat out.',
          ],
        },
      ],
    },
    holdem: {
      title: "Texas Hold'em — table rules",
      intro:
        'You play against the other players, while the AI dealer runs the hand: shuffles, deals, keeps the order of play and splits the pots. This is No-Limit — you can bet all your chips at any time.',
      sections: [
        {
          h: 'The goal',
          p: [
            'Win the pot: either everyone else folds, or at the showdown you make the best five-card hand from your two cards and the five community cards.',
          ],
        },
        {
          h: 'Button and blinds',
          list: [
            'The dealer button (D) marks the nominal dealer and moves one seat to the left every hand.',
            'The player left of the button posts the small blind (SB), the next one the big blind (BB), usually twice as large.',
            'Heads-up, the button posts the small blind, acts first before the flop and last after it.',
            'A new player posts a big blind before being dealt in, or waits until the big blind reaches them.',
          ],
        },
        {
          h: 'How a hand goes',
          list: [
            'Everyone gets two face-down cards and the first betting round starts with the player left of the big blind.',
            'Flop — the dealer burns a card and turns three community cards. Second betting round.',
            'Turn — a burn and the fourth community card. Third betting round.',
            'River — a burn and the fifth card. Final betting round and showdown.',
          ],
        },
        {
          h: 'Your options',
          list: [
            'Fold — give up the hand.',
            'Check — when nobody has bet yet this round.',
            'Call — match the highest bet.',
            'Bet / Raise — a raise must be at least as large as the previous raise this round (the first bet at least the big blind).',
            'All-in — bet all your chips. An all-in smaller than a full raise does not reopen the betting for players who have already acted.',
          ],
        },
        {
          h: 'Side pots',
          p: [
            'When someone is all-in for less, the extra chips go into a side pot that only the players who paid into it can win. Each pot is settled separately; ties split evenly and an odd chip goes to the first winner left of the button.',
          ],
        },
        {
          h: 'Showdown',
          p: [
            'The last player to bet or raise on the river shows first; if nobody bet, the first player left of the button shows first. Hands that can no longer win are mucked without being shown.',
          ],
        },
        {
          h: 'Hand rankings (highest first)',
          list: [
            'Royal flush — A K Q J 10 of one suit.',
            'Straight flush — five cards in sequence, one suit.',
            'Four of a kind.',
            'Full house — three of a kind plus a pair.',
            'Flush — five cards of one suit.',
            'Straight — five cards in sequence (the ace can be low: A 2 3 4 5).',
            'Three of a kind.',
            'Two pair.',
            'One pair.',
            'High card.',
          ],
        },
        {
          h: 'Multiplayer',
          list: [
            'The host sets fixed blinds and a fixed buy-in for everyone.',
            'A table has up to 22 seats — as many as one deck allows (44 player cards, 5 community cards and 3 burns). Further players wait in a queue as spectators and sit down when a seat frees up.',
            'If your time runs out you check when you can, otherwise you fold.',
          ],
        },
      ],
    },
  },
};
