import type { GameModule } from '../core/game';
import { applyHoldem, createHoldem } from './engine';
import { validateHoldemRules, type HoldemRules } from './rules';
import type { HAction, HEvent, HLegal, HState, HView } from './types';
import { legalHoldem, nextDeadlineHoldem, pendingHoldem, reduceHoldemView, viewHoldem } from './view';

export const Holdem: GameModule<HoldemRules, HState, HAction, HView, HEvent, HLegal> = {
  id: 'holdem',
  validateRules: validateHoldemRules,
  create: createHoldem,
  apply: applyHoldem,
  view: viewHoldem,
  legal: legalHoldem,
  nextDeadline: nextDeadlineHoldem,
  pendingDecisions: pendingHoldem,
  reduceView: reduceHoldemView,
};

export * from './rules';
export * from './types';
export { eval7, bestFive, describeHand, handCategory, CAT_NAMES, type HandValue, type HandCategory } from './eval';
export { buildPots, splitPot, type Contribution } from './pots';
export { computePositions, type Positions } from './positions';
export { actOptions, type ActOptions } from './betting';
export { applyHoldem, createHoldem } from './engine';
export {
  viewHoldem,
  legalHoldem,
  reduceHoldemView,
  applyHoldemReveal,
  nextDeadlineHoldem,
  pendingHoldem,
  freeSeats,
  seatView,
  canRebuy,
} from './view';
