import { BJ_TABLE, bjSpotCenter, HE_TABLE, heBoardPos, HE_BOARD_SCALE, HE_POT, CARD_W, CARD_H } from '../layout';
import { DISPLAY } from './fonts';

/** Felt textures cover a fixed world rectangle; table geometry maps UVs to the same rectangle. */
export interface FeltExtent {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
export const BJ_FELT_EXTENT: FeltExtent = { x0: -1.0, x1: 1.0, z0: -0.48, z1: 0.68 };
export const HE_FELT_EXTENT: FeltExtent = { x0: -1.1, x1: 1.1, z0: -0.55, z1: 0.61 };

export interface FeltText {
  payout: string; // BLACKJACK PAYS 3 TO 2
  insurance: string; // INSURANCE PAYS 2 TO 1
  dealerRule: string; // Dealer must draw to 16 and stand on all 17s
  title: string; // JACBOS CASINO
  game: string; // TEXAS HOLD'EM
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function base(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cy: number) {
  const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(w, h) * 0.75);
  g.addColorStop(0, '#16704a');
  g.addColorStop(0.55, '#0f5538');
  g.addColorStop(1, '#083422');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // woven grain
  const rnd = mulberry32(7);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 14;
    d[i] = Math.max(0, Math.min(255, d[i]! + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n * 1.1));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n * 0.8));
  }
  ctx.putImageData(img, 0, 0);
}

function arcText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, r: number, font: string, color: string, spacing = 0) {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const widths = [...text].map((ch) => ctx.measureText(ch).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0);
  let a = -total / (2 * r);
  for (let i = 0; i < widths.length; i++) {
    const ch = [...text][i]!;
    const half = widths[i]! / (2 * r);
    a += half;
    ctx.save();
    ctx.translate(cx + r * Math.sin(a), cy + r * Math.cos(a));
    ctx.rotate(-a);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    a += half;
  }
  ctx.restore();
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, width: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

const GOLD = 'rgba(232, 202, 122, 0.88)';
const GOLD_SOFT = 'rgba(232, 202, 122, 0.45)';

export function buildBlackjackFelt(text: FeltText, pxPerM = 1100): HTMLCanvasElement {
  const ext = BJ_FELT_EXTENT;
  const w = Math.round((ext.x1 - ext.x0) * pxPerM);
  const h = Math.round((ext.z1 - ext.z0) * pxPerM);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const X = (x: number) => (x - ext.x0) * pxPerM;
  const Y = (z: number) => (z - ext.z0) * pxPerM;
  const S = (m: number) => m * pxPerM;
  base(ctx, w, h, X(0), Y(0.1));
  const cx = X(0);
  const cy = Y(BJ_TABLE.spotArcCenterZ);
  // border line inside the rail
  ctx.beginPath();
  ctx.arc(X(0), Y(BJ_TABLE.arcCenterZ), S(BJ_TABLE.arcRadius - 0.035), 0.25, Math.PI - 0.25);
  ctx.strokeStyle = GOLD_SOFT;
  ctx.lineWidth = S(0.003);
  ctx.stroke();
  // insurance band
  for (const r of [0.505, 0.6]) {
    ctx.beginPath();
    ctx.arc(cx, cy, S(r), Math.PI / 2 - 0.62, Math.PI / 2 + 0.62);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = S(0.0025);
    ctx.stroke();
  }
  arcText(ctx, text.insurance, cx, cy, S(0.552), `700 ${S(0.03)}px ${DISPLAY}`, GOLD, S(0.004));
  arcText(ctx, text.payout, cx, cy, S(0.445), `800 ${S(0.038)}px ${DISPLAY}`, 'rgba(243, 223, 162, 0.95)', S(0.005));
  arcText(ctx, text.dealerRule, cx, cy, S(0.39), `600 ${S(0.0175)}px ${DISPLAY}`, GOLD_SOFT, S(0.0015));
  // betting circles
  for (let i = 0; i < BJ_TABLE.spots; i++) {
    const p = bjSpotCenter(i);
    ring(ctx, X(p.x), Y(p.z), S(0.052), GOLD, S(0.004));
    ring(ctx, X(p.x), Y(p.z), S(0.044), GOLD_SOFT, S(0.0015));
  }
  // house monogram
  ctx.save();
  ctx.globalAlpha = 0.5;
  ring(ctx, X(0), Y(-0.31), S(0.05), GOLD, S(0.002));
  ctx.font = `800 ${S(0.04)}px ${DISPLAY}`;
  ctx.fillStyle = GOLD;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('JC', X(0), Y(-0.307));
  ctx.restore();
  return c;
}

export function buildHoldemFelt(text: FeltText, pxPerM = 1000): HTMLCanvasElement {
  const ext = HE_FELT_EXTENT;
  const w = Math.round((ext.x1 - ext.x0) * pxPerM);
  const h = Math.round((ext.z1 - ext.z0) * pxPerM);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const X = (x: number) => (x - ext.x0) * pxPerM;
  const Y = (z: number) => (z - ext.z0) * pxPerM;
  const S = (m: number) => m * pxPerM;
  base(ctx, w, h, X(0), Y(HE_TABLE.centerZ));
  // inner racetrack line
  const r = HE_TABLE.halfDepth - 0.1;
  const cx = HE_TABLE.halfWidth - HE_TABLE.halfDepth;
  ctx.beginPath();
  ctx.arc(X(cx), Y(HE_TABLE.centerZ), S(r), -Math.PI / 2, Math.PI / 2);
  ctx.arc(X(-cx), Y(HE_TABLE.centerZ), S(r), Math.PI / 2, (3 * Math.PI) / 2);
  ctx.closePath();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = S(0.003);
  ctx.stroke();
  // board card outlines
  const bw = CARD_W * HE_BOARD_SCALE;
  const bh = CARD_H * HE_BOARD_SCALE;
  for (let i = 0; i < 5; i++) {
    const p = heBoardPos(i);
    ctx.strokeStyle = GOLD_SOFT;
    ctx.lineWidth = S(0.002);
    ctx.strokeRect(X(p.x - bw / 2 - 0.004), Y(p.z - bh / 2 - 0.004), S(bw + 0.008), S(bh + 0.008));
  }
  ring(ctx, X(HE_POT.x), Y(HE_POT.z), S(0.06), GOLD_SOFT, S(0.002));
  ctx.save();
  ctx.font = `800 ${S(0.05)}px ${DISPLAY}`;
  ctx.fillStyle = 'rgba(243, 223, 162, 0.55)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.title, X(0), Y(0.24));
  ctx.font = `700 ${S(0.024)}px ${DISPLAY}`;
  ctx.fillStyle = GOLD_SOFT;
  ctx.fillText(text.game, X(0), Y(0.3));
  ctx.restore();
  return c;
}
