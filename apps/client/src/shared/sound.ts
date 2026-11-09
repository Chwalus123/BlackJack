/**
 * Table sounds synthesised with WebAudio — no audio files. Card snaps, chip clacks, a riffle shuffle and a
 * soft bell for "your turn". Respects the sound setting and never throws if audio is unavailable.
 */
import { settings } from '../store/settings';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let lastAt = new Map<string, number>();

function audio(): AudioContext | null {
  if (!settings.value.sound) return null;
  try {
    if (!ctx) {
      const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
      if (!AC) return null;
      ctx = new AC();
      const len = Math.floor(ctx.sampleRate * 0.25);
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Browsers only allow audio after a user gesture: call this from the first click. */
export function unlockAudio(): void {
  audio();
}

function burst(c: AudioContext, at: number, dur: number, freq: number, q: number, gain: number) {
  const src = c.createBufferSource();
  src.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(at, Math.random() * 0.1, dur + 0.02);
}

function tone(c: AudioContext, at: number, freq: number, dur: number, gain: number) {
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** Rate-limit per sound so a burst of events does not turn into noise. */
function allow(kind: string, minGapMs: number): boolean {
  const now = performance.now();
  if ((lastAt.get(kind) ?? 0) + minGapMs > now) return false;
  lastAt.set(kind, now);
  if (lastAt.size > 32) lastAt = new Map([...lastAt].slice(-16));
  return true;
}

export const sfx = {
  card() {
    const c = audio();
    if (!c || !allow('card', 40)) return;
    burst(c, c.currentTime, 0.05, 3200, 0.9, 0.35);
  },
  flip() {
    const c = audio();
    if (!c || !allow('flip', 60)) return;
    burst(c, c.currentTime, 0.04, 2400, 1.2, 0.3);
    burst(c, c.currentTime + 0.05, 0.05, 3600, 0.8, 0.25);
  },
  chips(count = 3) {
    const c = audio();
    if (!c || !allow('chips', 70)) return;
    const n = Math.max(1, Math.min(5, count));
    for (let i = 0; i < n; i++) {
      const at = c.currentTime + i * 0.035 + Math.random() * 0.01;
      tone(c, at, 2600 + Math.random() * 900, 0.06, 0.06);
      burst(c, at, 0.03, 5200, 2.5, 0.18);
    }
  },
  shuffle() {
    const c = audio();
    if (!c || !allow('shuffle', 500)) return;
    for (let i = 0; i < 26; i++) burst(c, c.currentTime + i * 0.022, 0.02, 2800 + Math.random() * 1500, 1.4, 0.16);
  },
  turn() {
    const c = audio();
    if (!c || !allow('turn', 400)) return;
    tone(c, c.currentTime, 880, 0.5, 0.08);
    tone(c, c.currentTime + 0.12, 1320, 0.6, 0.05);
  },
  win() {
    const c = audio();
    if (!c || !allow('win', 300)) return;
    [784, 988, 1175].forEach((f, i) => tone(c, c.currentTime + i * 0.09, f, 0.35, 0.06));
  },
};
