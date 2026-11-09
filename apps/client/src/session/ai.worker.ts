/// <reference lib="webworker" />
// Hold'em bots think off the main thread (Monte Carlo equity) so the 3D table keeps its frame rate.
import { createRng, decideHoldem } from '@casino/engine';

const rng = createRng(Array.from(crypto.getRandomValues(new Uint32Array(8))));

self.onmessage = (e: MessageEvent<{ id: number; view: unknown; legal: unknown; seat: number; persona: string }>) => {
  const { id, view, legal, seat, persona } = e.data;
  try {
    const d = decideHoldem(view as never, legal as never, seat, persona, rng);
    (self as unknown as Worker).postMessage({ id, decision: d });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
