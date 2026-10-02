import { useState } from 'preact/hooks';
import { NICKNAME_RE, normalizeText } from '@casino/protocol';
import { t } from '../../i18n';
import { nickname, setNickname, connection } from '../../session/RemoteSession';

export function NicknameGate({ onDone }: { onDone?: () => void }) {
  const [value, setValue] = useState(nickname.value ?? '');
  const [err, setErr] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    const n = normalizeText(value);
    if (!NICKNAME_RE.test(n)) {
      setErr(true);
      return;
    }
    setNickname(n);
    const c = connection();
    await c.call('session:nickname', { nickname: n });
    onDone?.();
  };
  return (
    <form class="plaque form-grid" style={{ maxWidth: 440, margin: '22px auto 0' }} onSubmit={submit}>
      <div class="field">
        <label for="nick">{t('mp.nickname')}</label>
        <input id="nick" class="input" value={value} maxLength={20} autoComplete="nickname" onInput={(e) => { setValue((e.target as HTMLInputElement).value); setErr(false); }} aria-invalid={err} aria-describedby="nick-hint" />
        <small id="nick-hint" style={{ color: err ? 'var(--c-danger)' : 'var(--c-ivory-mute)' }}>
          {err ? t('error.NICKNAME') : t('mp.nicknameHint')}
        </small>
      </div>
      <button class="btn btn-brass" type="submit">
        {t('mp.continue')}
      </button>
    </form>
  );
}
