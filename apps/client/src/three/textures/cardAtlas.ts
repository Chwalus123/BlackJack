import { rankOf, suitOf } from '@casino/engine';
import { SUIT_PATHS } from '../../ui/deco';
import { DISPLAY, UI } from './fonts';

/**
 * One generated texture atlas holds all 52 faces and two backs (burgundy / navy) — original artwork drawn
 * with Canvas 2D: our own suit paths, standard pip layouts and typographic court cards.
 */
export const ATLAS_COLS = 10;
export const ATLAS_ROWS = 6;
export const TILE_BACK_RED = 52;
export const TILE_BACK_BLUE = 53;

const RED = '#b81f33';
const BLACK = '#15110f';
const IVORY = '#fbf6ea';
const SUIT_KEYS = ['c', 'd', 'h', 's'] as const;
const RANK_LABEL = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export interface CardAtlas {
  canvas: HTMLCanvasElement;
  tileW: number;
  tileH: number;
  /** UV rect for a tile, in Three.js convention (v up, texture.flipY = true). */
  uv(tile: number): { u0: number; v0: number; u1: number; v1: number };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const suitPath = new Map<string, Path2D>();
function suit(ctx: CanvasRenderingContext2D, s: (typeof SUIT_KEYS)[number], cx: number, cy: number, size: number, flip = false) {
  let p = suitPath.get(s);
  if (!p) {
    p = new Path2D(SUIT_PATHS[s]);
    suitPath.set(s, p);
  }
  ctx.save();
  ctx.translate(cx, cy);
  if (flip) ctx.rotate(Math.PI);
  ctx.scale(size / 100, size / 100);
  ctx.translate(-50, -50);
  ctx.fill(p);
  ctx.restore();
}

const PIPS: Record<number, [number, number][]> = {
  2: [[0.5, 0.18], [0.5, 0.82]],
  3: [[0.5, 0.18], [0.5, 0.5], [0.5, 0.82]],
  4: [[0.28, 0.18], [0.72, 0.18], [0.28, 0.82], [0.72, 0.82]],
  5: [[0.28, 0.18], [0.72, 0.18], [0.5, 0.5], [0.28, 0.82], [0.72, 0.82]],
  6: [[0.28, 0.18], [0.72, 0.18], [0.28, 0.5], [0.72, 0.5], [0.28, 0.82], [0.72, 0.82]],
  7: [[0.28, 0.18], [0.72, 0.18], [0.5, 0.34], [0.28, 0.5], [0.72, 0.5], [0.28, 0.82], [0.72, 0.82]],
  8: [[0.28, 0.18], [0.72, 0.18], [0.5, 0.34], [0.28, 0.5], [0.72, 0.5], [0.5, 0.66], [0.28, 0.82], [0.72, 0.82]],
  9: [[0.28, 0.18], [0.72, 0.18], [0.28, 0.39], [0.72, 0.39], [0.5, 0.5], [0.28, 0.61], [0.72, 0.61], [0.28, 0.82], [0.72, 0.82]],
  10: [[0.28, 0.18], [0.72, 0.18], [0.5, 0.29], [0.28, 0.39], [0.72, 0.39], [0.28, 0.61], [0.72, 0.61], [0.5, 0.71], [0.28, 0.82], [0.72, 0.82]],
};

function drawFace(ctx: CanvasRenderingContext2D, card: number, x: number, y: number, w: number, h: number) {
  const r = rankOf(card);
  const s = SUIT_KEYS[suitOf(card)]!;
  const color = s === 'h' || s === 'd' ? RED : BLACK;
  const label = RANK_LABEL[r - 2]!;
  ctx.save();
  ctx.translate(x, y);
  // face
  roundRect(ctx, 3, 3, w - 6, h - 6, w * 0.07);
  ctx.fillStyle = IVORY;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#d8ceb5';
  ctx.stroke();
  // Jumbo corner indices (both corners, the lower one rotated), as on casino poker decks: the rank and suit
  // stay readable when the card is small on screen.
  const ix0 = w * 0.15;
  for (const flip of [false, true]) {
    ctx.save();
    if (flip) {
      ctx.translate(w, h);
      ctx.rotate(Math.PI);
    }
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const fs = label === '10' ? w * 0.29 : w * 0.33;
    ctx.font = `800 ${fs}px ${UI}`;
    if (label === '10') {
      ctx.save();
      ctx.translate(ix0, h * 0.178);
      ctx.scale(0.74, 1);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    } else ctx.fillText(label, ix0, h * 0.185);
    suit(ctx, s, ix0, h * 0.268, w * 0.17);
    ctx.restore();
  }
  ctx.fillStyle = color;
  const ix = w * 0.24;
  const iy = h * 0.12;
  const iw = w - 2 * ix;
  const ih = h - 2 * iy;
  if (r <= 10) {
    for (const [px, py] of PIPS[r]!) suit(ctx, s, ix + px * iw, iy + py * ih, w * 0.17, py > 0.55);
  } else if (r === 14) {
    // Ace: one large suit framed by an art-deco medallion.
    ctx.strokeStyle = '#b8954a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      ctx.beginPath();
      ctx.moveTo(w / 2 + Math.cos(a) * w * 0.31, h / 2 + Math.sin(a) * w * 0.31);
      ctx.lineTo(w / 2 + Math.cos(a) * w * (i % 2 ? 0.34 : 0.37), h / 2 + Math.sin(a) * w * (i % 2 ? 0.34 : 0.37));
      ctx.stroke();
    }
    ctx.fillStyle = color;
    suit(ctx, s, w / 2, h / 2, w * 0.4);
  } else {
    // Court cards: typographic deco panel with the letter and suit emblems (narrow enough to clear the indices).
    const px = w * 0.3;
    const py = h * 0.13;
    const pw = w - 2 * px;
    const ph = h - 2 * py;
    const grad = ctx.createLinearGradient(0, py, 0, py + ph);
    grad.addColorStop(0, color === RED ? '#fbe9e4' : '#efeadb');
    grad.addColorStop(1, color === RED ? '#f3d6cf' : '#e2dccb');
    roundRect(ctx, px, py, pw, ph, 6);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#b8954a';
    ctx.lineWidth = 3;
    ctx.stroke();
    roundRect(ctx, px + 6, py + 6, pw - 12, ph - 12, 4);
    ctx.lineWidth = 1;
    ctx.stroke();
    // chevrons
    ctx.fillStyle = '#c9a24a';
    for (const yy of [py + 16, py + ph - 16]) {
      ctx.beginPath();
      ctx.moveTo(w / 2 - 22, yy);
      ctx.lineTo(w / 2, yy + (yy < h / 2 ? 9 : -9));
      ctx.lineTo(w / 2 + 22, yy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${w * 0.34}px ${DISPLAY}`;
    // Fit and centre the glyph's real outline (the Q's tail reaches past its advance width) inside the panel.
    const m = ctx.measureText(label);
    const left = m.actualBoundingBoxLeft || m.width / 2;
    const right = m.actualBoundingBoxRight || m.width / 2;
    const fit = Math.min(1, (pw - 18) / (left + right));
    ctx.save();
    ctx.translate(w / 2, h / 2 + w * 0.02);
    ctx.scale(fit, fit);
    ctx.fillText(label, (left - right) / 2, 0);
    ctx.restore();
    suit(ctx, s, w / 2, py + ph * 0.24, w * 0.12);
    suit(ctx, s, w / 2, py + ph * 0.76, w * 0.12, true);
  }
  ctx.restore();
}

function drawBack(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string, dark: string) {
  ctx.save();
  ctx.translate(x, y);
  roundRect(ctx, 3, 3, w - 6, h - 6, w * 0.07);
  ctx.fillStyle = '#fbf6ea';
  ctx.fill();
  const m = w * 0.075;
  roundRect(ctx, m, m, w - 2 * m, h - 2 * m, w * 0.04);
  ctx.save();
  ctx.clip();
  const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, h * 0.7);
  g.addColorStop(0, base);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // gold lattice
  ctx.strokeStyle = 'rgba(230, 200, 120, 0.55)';
  ctx.lineWidth = 1.2;
  const step = w * 0.09;
  for (let k = -h; k < w + h; k += step) {
    ctx.beginPath();
    ctx.moveTo(k, 0);
    ctx.lineTo(k + h, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(k, h);
    ctx.lineTo(k + h, 0);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = '#c9a24a';
  ctx.lineWidth = 3;
  roundRect(ctx, m, m, w - 2 * m, h - 2 * m, w * 0.04);
  ctx.stroke();
  // medallion with monogram
  const cx = w / 2;
  const cy = h / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, w * 0.23, 0, Math.PI * 2);
  ctx.fillStyle = dark;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#e6c878';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, w * 0.19, 0, Math.PI * 2);
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#f3dfa2';
  ctx.font = `800 ${w * 0.16}px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('JC', cx, cy + 2);
  ctx.restore();
}

export function buildCardAtlas(tileW = 240): CardAtlas {
  const tileH = Math.round(tileW * 1.4);
  const canvas = document.createElement('canvas');
  canvas.width = tileW * ATLAS_COLS;
  canvas.height = tileH * ATLAS_ROWS;
  const ctx = canvas.getContext('2d')!;
  const at = (tile: number) => [(tile % ATLAS_COLS) * tileW, Math.floor(tile / ATLAS_COLS) * tileH] as const;
  for (let c = 0; c < 52; c++) {
    const [x, y] = at(c);
    drawFace(ctx, c, x, y, tileW, tileH);
  }
  drawBack(ctx, ...at(TILE_BACK_RED), tileW, tileH, '#7a1628', '#3a0a12');
  drawBack(ctx, ...at(TILE_BACK_BLUE), tileW, tileH, '#203a66', '#0e1a33');
  return {
    canvas,
    tileW,
    tileH,
    uv(tile) {
      const col = tile % ATLAS_COLS;
      const row = Math.floor(tile / ATLAS_COLS);
      const u0 = (col * tileW) / canvas.width;
      const u1 = ((col + 1) * tileW) / canvas.width;
      const v1 = 1 - (row * tileH) / canvas.height;
      const v0 = 1 - ((row + 1) * tileH) / canvas.height;
      return { u0, v0, u1, v1 };
    },
  };
}
