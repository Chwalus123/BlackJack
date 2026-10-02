import * as THREE from 'three';

/** The only generated texture of the dealer: the small brass name badge ("KRUPIER" / "DEALER"). */
export const BADGE_TEXT: Record<'pl' | 'en', string> = { pl: 'KRUPIER', en: 'DEALER' };

const W = 256;
const H = 64;

function canDraw(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

function draw(canvas: HTMLCanvasElement, text: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // Brushed brass plate with an engraved double border.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#f1d98f');
  g.addColorStop(0.45, '#d4ae58');
  g.addColorStop(1, '#a8843a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#ffffff';
  for (let y = 2; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#5a4114';
  ctx.lineWidth = 3;
  ctx.strokeRect(5, 5, W - 10, H - 10);
  ctx.lineWidth = 1;
  ctx.strokeRect(10, 10, W - 20, H - 20);
  // Art-deco chevrons either side of the name.
  ctx.fillStyle = '#5a4114';
  for (const sx of [1, -1]) {
    const cx = sx > 0 ? 24 : W - 24;
    ctx.beginPath();
    ctx.moveTo(cx - 6 * sx, H / 2);
    ctx.lineTo(cx, H / 2 - 8);
    ctx.lineTo(cx + 6 * sx, H / 2);
    ctx.lineTo(cx, H / 2 + 8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#2a1d0a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 34;
  const font = (s: number) => `700 ${s}px 'Cinzel Variable', 'Cinzel', Georgia, 'Times New Roman', serif`;
  ctx.font = font(size);
  const max = W - 76;
  while (size > 14 && ctx.measureText(text).width > max) ctx.font = font(--size);
  // Wide letter spacing, drawn glyph by glyph for older canvases.
  const glyphs = [...text];
  const spacing = 3;
  const widths = glyphs.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (glyphs.length - 1);
  const x0 = W / 2 - total / 2;
  ctx.textAlign = 'left';
  // light "engraving" highlight under the dark letters
  for (let pass = 0; pass < 2; pass++) {
    let px = x0;
    ctx.fillStyle = pass === 0 ? 'rgba(255,240,200,0.55)' : '#2a1d0a';
    glyphs.forEach((c, i) => {
      ctx.fillText(c, px, H / 2 + 2 + (pass === 0 ? 1 : 0));
      px += widths[i]! + spacing;
    });
  }
}

export interface Badge {
  texture: THREE.Texture | null;
  setText(locale: 'pl' | 'en'): void;
  dispose(): void;
}

export function createBadge(locale: 'pl' | 'en'): Badge {
  if (!canDraw()) return { texture: null, setText: () => undefined, dispose: () => undefined };
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  let current = locale;
  let disposed = false;
  const redraw = () => {
    if (disposed) return;
    draw(canvas, BADGE_TEXT[current]);
    texture.needsUpdate = true;
  };
  redraw();
  // Redraw once the display font has loaded (it may still be streaming in when the dealer is built).
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts?.load) {
    fonts
      .load("700 34px 'Cinzel Variable'")
      .then(redraw)
      .catch(() => undefined);
  }
  return {
    texture,
    setText(l) {
      current = l;
      redraw();
    },
    dispose() {
      disposed = true;
      texture.dispose();
    },
  };
}
