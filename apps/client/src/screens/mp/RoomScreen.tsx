import '../landing.css';
import './mp.css';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatMoney, t } from '../../i18n';
import { navigate } from '../../app/router';
import { Dialog, Page, toast } from '../../ui/chrome';
import { Icon } from '../../ui/deco';
import { TableView } from '../../ui/table/TableView';
import { connection, nickname } from '../../session/RemoteSession';
import { NicknameGate } from './NicknameGate';
import type { RoomMeta } from '@casino/protocol';

/** The Clipboard API needs HTTPS or localhost; on a plain-HTTP LAN address fall back to execCommand. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok: boolean;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function stakeInfo(m: RoomMeta): string {
  const s = m.settings;
  return s.game === 'blackjack' ? t('table.stake', { amount: formatMoney(s.stake) }) : `${formatMoney(s.sb)} / ${formatMoney(s.bb)}`;
}

export function RoomScreen({ code }: { code: string }) {
  const c = connection();
  const [named, setNamed] = useState(!!nickname.value);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRoom, setShowRoom] = useState(true);
  const meta = c.meta.value;
  const me = c.session.value?.playerId;

  useEffect(() => {
    if (!named) return;
    let cancelled = false;
    void c.join(code).then((r) => {
      if (cancelled) return;
      if (r.ok) setJoined(true);
      else setError(r.code);
    });
    return () => {
      cancelled = true;
    };
  }, [named, code]);

  // Re-join automatically after a reconnect (the server also re-attaches by token).
  useEffect(() => {
    if (joined && c.connected.value && !meta) void c.join(code);
  }, [c.connected.value]);

  const session = useMemo(() => (meta ? c.tableSession(meta.game) : null), [meta?.game]);

  if (!named) {
    return (
      <Page backTo="/lobby" title={t('mp.waitingRoom')}>
        <NicknameGate onDone={() => setNamed(true)} />
      </Page>
    );
  }
  if (error) {
    return (
      <Page backTo="/lobby" title={t('mp.waitingRoom')}>
        <div class="plaque" style={{ maxWidth: 460, margin: '40px auto', textAlign: 'center' }}>
          <h1 class="gold-text" style={{ fontSize: 22 }} tabIndex={-1}>
            {t(`error.${error}` as 'error.generic')}
          </h1>
          <button class="btn btn-brass" onClick={() => navigate('/lobby')}>
            {t('mp.lobby')}
          </button>
        </div>
      </Page>
    );
  }
  if (!meta || !session) return <div class="table-loading">{t('app.loading')}</div>;

  const isHost = meta.hostId === me;
  const mine = meta.members.find((m) => m.id === me);
  const seated = mine?.seat != null;
  const queuePos = meta.queue.indexOf(me ?? '') + 1;
  const notice = c.notice.value;

  const leave = async () => {
    await c.leave();
    navigate(`/lobby?game=${meta.game}`);
  };

  return (
    <TableView
      game={meta.game}
      session={session}
      onLeave={() => void leave()}
      info={
        <>
          <strong>{meta.name}</strong>
          <span>{stakeInfo(meta)}</span>
          <span class="pill">{code}</span>
        </>
      }
      topExtra={
        <button class="btn btn-lacquer btn-sm" aria-expanded={showRoom} onClick={() => setShowRoom(!showRoom)}>
          <Icon name="info" size={16} />
        </button>
      }
      overlay={
        <>
          {showRoom && (
            <WaitingPanel meta={meta} me={me ?? ''} isHost={isHost} seated={seated} queuePos={queuePos} onClose={() => setShowRoom(false)} />
          )}
          <Chat />
          {!c.connected.value && (
            <div class="dialog-backdrop" role="alert">
              <div class="plaque">{t('mp.reconnecting')}</div>
            </div>
          )}
          {notice && (notice.kind === 'kicked' || notice.kind === 'closed' || notice.kind === 'replaced') && (
            <Dialog title={t(notice.kind === 'kicked' ? 'mp.kicked' : notice.kind === 'closed' ? 'mp.closed' : 'mp.replaced')}>
              <div class="actions">
                <button
                  class="btn btn-brass"
                  onClick={() => {
                    c.notice.value = null;
                    navigate('/lobby');
                  }}
                >
                  {t('mp.lobby')}
                </button>
              </div>
            </Dialog>
          )}
          {notice?.kind === 'shutdown' && <div class="announce">{t('mp.shutdown')}</div>}
        </>
      }
    />
  );
}

function WaitingPanel({ meta, me, isHost, seated, queuePos, onClose }: { meta: RoomMeta; me: string; isHost: boolean; seated: boolean; queuePos: number; onClose: () => void }) {
  const c = connection();
  const link = `${location.origin}${location.pathname}#/r/${meta.code}`;
  const run = async (ev: Parameters<typeof c.call>[0], payload: unknown = {}) => {
    const r = await c.call(ev, payload);
    if (!r.ok) toast(t(`error.${r.code}` as 'error.generic'), 'error');
  };
  const players = meta.members.filter((m) => m.seat != null);
  const spectators = meta.members.filter((m) => m.seat == null);
  return (
    <section class="plaque waiting" aria-label={t('mp.waitingRoom')}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 class="gold-text" style={{ fontSize: 18 }}>
          {meta.status === 'waiting' ? t('mp.waitingRoom') : meta.name}
        </h2>
        <button class="btn btn-ghost btn-icon" aria-label={t('nav.back')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div class="invite" style={{ marginTop: 8 }}>
        <span style={{ color: 'var(--c-ivory-dim)', fontSize: 13 }}>{t('mp.invite')}:</span>
        <code>{meta.code}</code>
        <button
          class="btn btn-lacquer btn-sm"
          onClick={() => {
            void copyText(link).then((ok) => toast(ok ? t('mp.copied') : link));
          }}
        >
          <Icon name="copy" size={16} /> {t('mp.copy')}
        </button>
      </div>
      <h3 style={{ fontSize: 13, marginTop: 14, color: 'var(--c-gold300)' }}>
        {t('table.players')} ({players.length}
        {meta.settings.game === 'holdem' ? ` / ${meta.settings.maxSeats}` : ''})
      </h3>
      <ul class="member-list">
        {players.map((m) => (
          <li class={m.connected ? '' : 'off'}>
            <span>
              {m.nickname} {m.id === meta.hostId && <span class="pill">{t('mp.host')}</span>} {m.id === me && <span class="pill">{t('table.you')}</span>}
            </span>
            {isHost && m.id !== me && (
              <button class="btn btn-ghost btn-sm" onClick={() => void run('host:kick', { playerId: m.id })}>
                {t('mp.kick')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {spectators.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, color: 'var(--c-gold300)' }}>
            {t('mp.spectators')} ({spectators.length})
          </h3>
          <ul class="member-list">
            {spectators.slice(0, 50).map((m) => (
              <li class={m.connected ? '' : 'off'}>
                <span>
                  {m.nickname} {m.queued && <span class="pill">#{meta.queue.indexOf(m.id) + 1}</span>}
                </span>
                {isHost && m.id !== me && (
                  <button class="btn btn-ghost btn-sm" onClick={() => void run('host:kick', { playerId: m.id })}>
                    {t('mp.kick')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {queuePos > 0 && <p style={{ color: 'var(--c-gold200)' }}>{t('he.queue', { pos: queuePos })}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {!seated && queuePos === 0 && (
          <button class="btn btn-brass" onClick={() => void run('seat:sit')}>
            {t('mp.sit')}
          </button>
        )}
        {(seated || queuePos > 0) && (
          <button class="btn btn-ghost" onClick={() => void run('seat:stand')}>
            {t('mp.standUp')}
          </button>
        )}
        {isHost && (meta.status === 'waiting' || meta.status === 'paused') && (
          <button class="btn btn-brass" onClick={() => void run('host:start')}>
            {meta.status === 'waiting' ? t('mp.start') : t('mp.resume')}
          </button>
        )}
        {isHost && meta.status === 'running' && (
          <button class="btn btn-lacquer" onClick={() => void run('host:pause', { value: true })}>
            <Icon name="pause" size={14} /> {t('mp.pause')}
          </button>
        )}
        {isHost && (
          <button class="btn btn-velvet" onClick={() => void run('host:close')}>
            {t('mp.close')}
          </button>
        )}
      </div>
    </section>
  );
}

function Chat() {
  const c = connection();
  const [text, setText] = useState('');
  const log = useRef<HTMLDivElement>(null);
  const msgs = c.chat.value;
  useEffect(() => {
    log.current?.scrollTo(0, log.current.scrollHeight);
  }, [msgs.length]);
  const members = c.meta.value?.members ?? [];
  return (
    <div class="chat-box">
      {msgs.length > 0 && (
        <div class="chat-log" ref={log} aria-live="polite">
          {msgs.map((m) =>
            m.from === 'system' ? (
              <div class="sys">{m.text.startsWith('host:') ? t('mp.newHost', { name: m.text.slice(5) }) : m.text}</div>
            ) : (
              <div>
                <b>{m.nickname}:</b> {m.text}
              </div>
            ),
          )}
        </div>
      )}
      <form
        class="chat-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = text.trim();
          if (!v) return;
          setText('');
          const r = await c.call('room:chat', { text: v });
          if (!r.ok) toast(t(`error.${r.code}` as 'error.generic'), 'error');
        }}
      >
        <input class="input" maxLength={200} value={text} placeholder={t('mp.chatPlaceholder')} aria-label={t('mp.chatPlaceholder')} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
        <button class="btn btn-lacquer btn-sm" type="submit" aria-label={t('mp.send')} disabled={members.length === 0}>
          <Icon name="chat" size={16} />
        </button>
      </form>
    </div>
  );
}
