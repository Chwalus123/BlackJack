import { styleFor } from '../../shared/chips';
import { DISPLAY } from './fonts';

/**
 * Per-denomination chip texture: left half = cap (top/bottom face), right half = edge band.
 * The chip geometry maps its UVs to these halves, so each denomination needs one material.
 */
export function buildChipTexture(denom: number, size = 128): HTMLCanvasElement {
  const st = styleFor(denom);
  const c = document.createElement('canvas');
  c.width = size * 2;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const r = size / 2;
  // cap
  ctx.save();
  ctx.translate(r, r);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = st.base;
  ctx.fill();
  ctx.fillStyle = st.stripe;
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 3);
    ctx.fillRect(-r * 0.11, -r, r * 0.22, r * 0.26);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.66, 0, Math.PI * 2);
  ctx.fillStyle = st.inlay;
  ctx.fill();
  ctx.lineWidth = r * 0.04;
  ctx.strokeStyle = st.stripe;
  ctx.setLineDash([r * 0.08, r * 0.06]);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.58, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = st.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${r * (st.label.length > 2 ? 0.42 : 0.56)}px ${DISPLAY}`;
  ctx.fillText(st.label, 0, r * 0.04);
  ctx.restore();
  // edge band
  ctx.fillStyle = st.base;
  ctx.fillRect(size, 0, size, size);
  ctx.fillStyle = st.stripe;
  for (let i = 0; i < 6; i++) ctx.fillRect(size + (i * size) / 6 + size / 24, 0, size / 12, size);
  return c;
}
