import { signal, effect } from '@preact/signals';
import { CHIP, type Money } from '@casino/engine';
import { loadJSON, saveJSON } from '../store/persist';

/**
 * The single-player wallet: total fictitious chips the player owns. Chips on the table count as owned,
 * so a reload mid-round simply refunds the unfinished bet.
 */
export interface Profile {
  wallet: Money;
  startingBankroll: Money;
  resets: number;
  handsPlayed: number;
  biggestWin: Money;
}

const DEFAULT: Profile = { wallet: 1000 * CHIP, startingBankroll: 1000 * CHIP, resets: 0, handsPlayed: 0, biggestWin: 0 };

export const profile = signal<Profile>({ ...DEFAULT, ...loadJSON<Partial<Profile>>('profile', {}) });
effect(() => saveJSON('profile', profile.value));

export function setWallet(amount: Money): void {
  if (amount !== profile.value.wallet) profile.value = { ...profile.value, wallet: amount };
}

export function resetWallet(startingBankroll: Money): void {
  profile.value = { ...profile.value, wallet: startingBankroll, startingBankroll, resets: profile.value.resets + 1 };
}

export function recordHand(net: Money): void {
  const p = profile.value;
  profile.value = { ...p, handsPlayed: p.handsPlayed + 1, biggestWin: Math.max(p.biggestWin, net) };
}
