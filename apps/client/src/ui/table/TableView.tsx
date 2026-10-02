import './table.css';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { effect, signal } from '@preact/signals';
import { bj, clone } from '@casino/engine';
import { locale, t } from '../../i18n';
import { TableStore } from '../../store/table';
import { reducedMotion, settings, speedMult, updateSettings, SPEEDS } from '../../store/settings';
import type { GameKind, GameSession } from '../../session/types';
import { TableScene, webglAvailable } from '../../three/scene';
import { BlackjackDirector } from '../../three/bjDirector';
import { Icon } from '../deco';
import { Dialog } from '../chrome';
import { BlackjackHud } from '../blackjack/BlackjackHud';
import { feltText } from './feltText';
import { createHoldemTable, type HoldemTableKit } from '../holdem/kit';
import { unlockAudio } from '../../shared/sound';

export interface TableContext {
  scene: TableScene;
  store: TableStore<any, any>;
  session: GameSession<any, any, any>;
  /** Re-render trigger for anchored overlays (resize, remap). */
  anchors: ReturnType<typeof signal<number>>;
  bjDirector?: BlackjackDirector;
  holdem?: HoldemTableKit;
}

const speedLabel = (s: (typeof SPEEDS)[number]) => (s === 'inf' ? '∞' : `${s}×`);

export function TableView({
  game,
  session,
  onLeave,
  info,
  topExtra,
  overlay,
  confirmLeave = true,
}: {
  game: GameKind;
  session: GameSession<any, any, any>;
  onLeave: () => void;
  info: ComponentChildren;
  topExtra?: ComponentChildren;
  overlay?: ComponentChildren;
  confirmLeave?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [ctx, setCtx] = useState<TableContext | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [askLeave, setAskLeave] = useState(false);
  const anchors = useMemo(() => signal(0), []);

  useEffect(() => {
    if (!webglAvailable()) {
      setFailed('webgl');
      return;
    }
    let disposed = false;
    let cleanup: (() => void) | null = null;
    const store = new TableStore<any, any>();
    const q = settings.value.quality;
    void TableScene.create(game, host.current!, { locale: locale.value, felt: feltText(game, locale.value), quality: q === 'auto' ? undefined : q })
      .then((scene) => {
        if (disposed) {
          scene.dispose();
          return;
        }
        scene.setSpeed(speedMult.value);
        scene.setReducedMotion(reducedMotion.value);
        const c: TableContext = { scene, store, session, anchors };
        const unsubs: (() => void)[] = [];
        if (game === 'blackjack') {
          const director = new BlackjackDirector(scene, store, { speed: () => speedMult.value });
          c.bjDirector = director;
          session.setPresentationGate?.(() => director.gate());
          unsubs.push(
            session.subscribe((m) => {
              if (m.kind === 'snapshot') {
                store.you.value = m.you;
                store.authoritative.value = clone(m.view);
                store.legal.value = m.legal;
                director.applySnapshot(m.view);
              } else if (m.kind === 'batch') {
                const v = store.authoritative.value;
                if (v) {
                  for (const ev of m.pub) bj.reduceBlackjackView(v, ev);
                  store.authoritative.value = { ...v };
                }
                store.legal.value = m.legal;
                director.enqueue(m.pub);
              } else store.legal.value = m.legal;
            }),
          );
          unsubs.push(() => director.dispose());
        } else {
          const kit = createHoldemTable(scene, store, session, () => speedMult.value);
          c.holdem = kit;
          unsubs.push(() => kit.dispose());
        }
        unsubs.push(
          effect(() => {
            scene.setSpeed(speedMult.value);
          }),
          effect(() => scene.setReducedMotion(reducedMotion.value)),
          scene.onFrame(() => undefined),
        );
        const ro = new ResizeObserver(() => (anchors.value = anchors.peek() + 1));
        ro.observe(host.current!);
        unsubs.push(() => ro.disconnect());
        unsubs.push(
          effect(() => {
            void store.layoutVersion.value;
            anchors.value = anchors.peek() + 1;
          }),
        );
        scene.start();
        setCtx(c);
        if (import.meta.env.DEV) (window as unknown as { __casino?: unknown }).__casino = c;
        cleanup = () => {
          for (const u of unsubs) u();
          scene.dispose();
        };
      })
      .catch((err) => {
        console.error(err);
        setFailed('error');
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [game, session]);

  // Keep the table centred in the area not covered by the top bar and the bottom dock. In Hold'em the camera fits
  // the table into that area, so the reserved dock height only grows (until the window is resized) and the table
  // does not zoom every time the action bar appears.
  useEffect(() => {
    if (!ctx || !host.current) return;
    const root = host.current.parentElement!;
    let size = '';
    let reserved = 0;
    const measure = () => {
      const now = `${root.clientWidth}x${root.clientHeight}`;
      if (now !== size) {
        size = now;
        reserved = 0;
      }
      const dock = root.querySelector<HTMLElement>('.dock');
      const h = dock ? Math.min(dock.offsetHeight, root.clientHeight * 0.45) : 0;
      reserved = game === 'holdem' ? Math.max(reserved, h) : h;
      ctx.scene.setInsets({ top: 48, bottom: reserved, left: 0, right: 0 });
      anchors.value = anchors.peek() + 1;
    };
    const ro = new ResizeObserver(measure);
    const dock = root.querySelector<HTMLElement>('.dock');
    if (dock) ro.observe(dock);
    ro.observe(root);
    measure();
    return () => ro.disconnect();
  }, [ctx, game]);

  // Keep the dealer badge text and felt print in the chosen language.
  useEffect(() => {
    ctx?.scene.dealer.setLocale(locale.value);
  }, [ctx, locale.value]);

  const leave = () => (confirmLeave ? setAskLeave(true) : onLeave());

  return (
    <div class="table-root" onPointerDown={unlockAudio} onKeyDown={unlockAudio}>
      <div class="table-canvas" ref={host} />
      {!ctx && (
        <div class="table-loading" role="status">
          {failed === 'webgl' ? (
            <div class="plaque" style={{ maxWidth: 420 }}>
              <h1 class="gold-text" style={{ fontSize: 22 }}>
                {t('app.webglRequired')}
              </h1>
              <p style={{ color: 'var(--c-ivory-dim)', fontFamily: 'var(--font-ui)', letterSpacing: 0 }}>{t('app.webglHint')}</p>
              <button class="btn btn-brass" onClick={onLeave}>
                {t('nav.back')}
              </button>
            </div>
          ) : failed ? (
            <div class="plaque">
              <p>{t('error.generic')}</p>
              <button class="btn btn-brass" onClick={onLeave}>
                {t('nav.back')}
              </button>
            </div>
          ) : (
            t('app.loading')
          )}
        </div>
      )}
      <div class="table-top">
        <div class="group">
          <button class="btn btn-lacquer btn-icon" aria-label={t('nav.leaveTable')} title={t('nav.leaveTable')} onClick={leave}>
            <Icon name="back" />
          </button>
          <div class="info">{info}</div>
        </div>
        <div class="group">
          {topExtra}
          <button
            class="btn btn-lacquer btn-sm"
            aria-label={`${t('table.speed')}: ${speedLabel(settings.value.speed)}`}
            title={t('table.speed')}
            onClick={() => {
              const i = SPEEDS.indexOf(settings.value.speed);
              updateSettings({ speed: SPEEDS[(i + 1) % SPEEDS.length]! });
            }}
          >
            {speedLabel(settings.value.speed)}
          </button>
          <button class="btn btn-lacquer btn-icon" aria-label={t('settings.sound')} aria-pressed={settings.value.sound} onClick={() => updateSettings({ sound: !settings.value.sound })}>
            <Icon name={settings.value.sound ? 'sound' : 'mute'} />
          </button>
        </div>
      </div>
      {ctx && game === 'blackjack' && <BlackjackHud ctx={ctx} />}
      {ctx && game === 'holdem' && ctx.holdem && <ctx.holdem.Hud ctx={ctx} />}
      {overlay}
      {askLeave && (
        <Dialog title={t('nav.leaveTable')} onClose={() => setAskLeave(false)}>
          <p style={{ color: 'var(--c-ivory-dim)' }}>{t('nav.leaveConfirm')}</p>
          <div class="actions">
            <button class="btn btn-velvet" onClick={onLeave}>
              {t('nav.leaveTable')}
            </button>
            <button class="btn btn-lacquer" onClick={() => setAskLeave(false)}>
              {t('nav.back')}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
