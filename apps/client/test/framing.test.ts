import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { basePose, frameHoldemCamera, HE_FRAME, type Insets } from '../src/three/framing';
import { CARD_W, DEALER_POS, HE_BOARD_SCALE, HE_TABLE, heBoardPos, heStackPos } from '../src/three/layout';

/** Screen sizes with the Hold'em dock height measured in the browser for each layout. */
const SCREENS: { name: string; w: number; h: number; dock: number }[] = [
  { name: 'laptop', w: 1280, h: 800, dock: 150 },
  { name: 'full HD', w: 1920, h: 1080, dock: 150 },
  { name: 'small laptop', w: 1366, h: 768, dock: 150 },
  { name: 'tablet landscape', w: 1024, h: 768, dock: 200 },
  { name: 'tablet portrait', w: 768, h: 1024, dock: 300 },
  { name: 'phone portrait', w: 390, h: 844, dock: 300 },
  { name: 'phone landscape', w: 844, h: 390, dock: 110 },
  { name: 'small phone portrait', w: 375, h: 667, dock: 250 },
  { name: 'small phone landscape', w: 667, h: 375, dock: 160 },
];

function framed(w: number, h: number, insets: Insets) {
  const camera = new THREE.PerspectiveCamera(42, w / h, 0.05, 30);
  frameHoldemCamera(camera, basePose('holdem', w / h), w, h, insets);
  camera.updateMatrixWorld();
  const px = (x: number, y: number, z: number) => {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
  };
  return { camera, px };
}

describe("Hold'em camera framing", () => {
  for (const s of SCREENS) {
    it(`${s.name} (${s.w}×${s.h}): dealer, table and hero plate fit between the top bar and the dock`, () => {
      const insets: Insets = { top: 48, right: 0, bottom: s.dock, left: 0 };
      const { px } = framed(s.w, s.h, insets);
      const top = HE_FRAME.topFor(s.w, insets);
      const head = px(DEALER_POS.x, HE_FRAME.headTopY, DEALER_POS.z);
      expect(head.y).toBeGreaterThanOrEqual(top - 0.5);
      const plate = heStackPos(HE_TABLE.heroSpot);
      const plateBottom = px(plate.x, plate.y, plate.z).y + HE_FRAME.plateDrop(s.w, s.h);
      const rail = px(0, 0, HE_FRAME.railZ).y;
      // Only when the free band is below the minimum share may the scene reach under the dock.
      const squeezed = s.h - top - s.dock - 2 * HE_FRAME.pad < s.h * HE_FRAME.minShare;
      if (!squeezed) {
        expect(plateBottom).toBeLessThanOrEqual(s.h - s.dock + 0.5);
        expect(rail).toBeLessThanOrEqual(s.h - s.dock + 0.5);
      }
      // the table's playing width is on screen
      for (const side of [-1, 1]) {
        const edge = px(side * 0.98, 0, HE_TABLE.centerZ);
        expect(edge.x).toBeGreaterThanOrEqual(-0.5);
        expect(edge.x).toBeLessThanOrEqual(s.w + 0.5);
      }
    });
  }

  // Before the board was enlarged and the camera refitted, a board card was 30.5 px wide on this screen.
  it('community cards are large on a laptop screen (at least 25% wider than before)', () => {
    const { px } = framed(1280, 800, { top: 48, right: 0, bottom: 150, left: 0 });
    for (let i = 0; i < 5; i++) {
      const c = heBoardPos(i);
      const half = (CARD_W * HE_BOARD_SCALE) / 2;
      const width = px(c.x + half, 0, c.z).x - px(c.x - half, 0, c.z).x;
      expect(width).toBeGreaterThanOrEqual(38);
    }
  });

  it('a taller dock never pushes the hero plate under it, it zooms the table out instead', () => {
    const w = 1280;
    const h = 800;
    let last = Infinity;
    for (const dock of [100, 150, 200, 250]) {
      const { px } = framed(w, h, { top: 48, right: 0, bottom: dock, left: 0 });
      const c = heBoardPos(2);
      const width = px(c.x + 0.05, 0, c.z).x - px(c.x - 0.05, 0, c.z).x;
      expect(width).toBeLessThanOrEqual(last + 1e-6);
      last = width;
      const plate = heStackPos(HE_TABLE.heroSpot);
      expect(px(plate.x, plate.y, plate.z).y + HE_FRAME.plateDrop(w, h)).toBeLessThanOrEqual(h - dock + 0.5);
    }
  });

  it('board slots stay apart and the pot sits clear of the cards', async () => {
    const { CARD_H, HE_POT } = await import('../src/three/layout');
    const w = CARD_W * HE_BOARD_SCALE;
    const hgt = CARD_H * HE_BOARD_SCALE;
    for (let i = 0; i < 4; i++) expect(heBoardPos(i + 1).x - heBoardPos(i).x).toBeGreaterThan(w + 0.01);
    // the felt's pot ring (radius 0.06) keeps at least 5 mm of felt from the board outline (drawn 4 mm out)
    const outlineFront = heBoardPos(2).z + hgt / 2 + 0.004;
    expect(HE_POT.z - 0.06 - outlineFront).toBeGreaterThan(0.005);
  });
});
