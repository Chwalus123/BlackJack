import type { FunctionComponent } from 'preact';
import { clone, he } from '@casino/engine';
import type { TableScene } from '../../three/scene';
import type { TableStore } from '../../store/table';
import type { GameSession } from '../../session/types';
import type { TableContext } from '../table/TableView';
import { HoldemDirector } from '../../three/heDirector';
import { HoldemHud } from './HoldemHud';

export interface HoldemTableKit {
  Hud: FunctionComponent<{ ctx: TableContext }>;
  director: HoldemDirector;
  dispose(): void;
}

/** Wires a Hold'em session to the scene: authoritative view, director, HUD. */
export function createHoldemTable(scene: TableScene, store: TableStore<any, any>, session: GameSession<any, any, any>, speed: () => number): HoldemTableKit {
  const director = new HoldemDirector(scene, store, { speed });
  session.setPresentationGate?.(() => director.gate());
  const unsub = session.subscribe((m) => {
    if (m.kind === 'snapshot') {
      store.you.value = m.you;
      store.authoritative.value = clone(m.view);
      store.legal.value = m.legal;
      director.applySnapshot(m.view as he.HView);
    } else if (m.kind === 'batch') {
      const v = store.authoritative.value as he.HView | null;
      if (v) {
        for (const ev of m.pub as he.HEvent[]) he.reduceHoldemView(v, ev);
        for (const r of m.reveals) he.applyHoldemReveal(v, r);
        store.authoritative.value = { ...v };
      }
      store.legal.value = m.legal;
      director.enqueue(m.pub as he.HEvent[], m.reveals);
    } else store.legal.value = m.legal;
  });
  const Hud: FunctionComponent<{ ctx: TableContext }> = ({ ctx }) => <HoldemHud ctx={ctx} director={director} />;
  return {
    Hud,
    director,
    dispose() {
      unsub();
      director.dispose();
    },
  };
}
