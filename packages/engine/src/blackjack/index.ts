import type { GameModule } from '../core/game';
import { applyBlackjack, createBlackjack } from './engine';
import { validateBlackjackRules, type BlackjackRules } from './rules';
import type { BJAction, BJEvent, BJLegal, BJState, BJView } from './types';
import { legalBlackjack, nextDeadlineBlackjack, pendingBlackjack, reduceBlackjackView, viewBlackjack } from './view';

export const Blackjack: GameModule<BlackjackRules, BJState, BJAction, BJView, BJEvent, BJLegal> = {
  id: 'blackjack',
  validateRules: validateBlackjackRules,
  create: createBlackjack,
  apply: applyBlackjack,
  view: viewBlackjack,
  legal: legalBlackjack,
  nextDeadline: nextDeadlineBlackjack,
  pendingDecisions: pendingBlackjack,
  reduceView: reduceBlackjackView,
};

export * from './rules';
export * from './types';
export * from './hand';
export { applyBlackjack, createBlackjack, canDouble, canSplit } from './engine';
export { viewBlackjack, legalBlackjack, reduceBlackjackView, nextDeadlineBlackjack, pendingBlackjack, seatView } from './view';
