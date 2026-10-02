/**
 * Pure table geometry (metres, Y up, felt at y = 0, dealer at −Z, players toward +Z).
 * Shared by the scene, the HUD anchors and the dealer gestures. No Three.js imports so it is unit-testable.
 */
export interface V3 {
  x: number;
  y: number;
  z: number;
}
export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });

export const CARD_W = 0.0635;
export const CARD_H = 0.0889;
export const CHIP_R = 0.0195;
export const CHIP_H = 0.0034;

export const DEALER_POS = v3(0, 0, -0.6);

// ───────────────────────── Blackjack (kidney table) ─────────────────────────
/** The players' edge is an arc through (±0.95, −0.42) and (0, 0.62). */
export const BJ_TABLE = {
  halfWidth: 0.95,
  dealerEdgeZ: -0.42,
  arcCenterZ: -0.3339,
  arcRadius: 0.9539,
  spotArcCenterZ: -0.35,
  spotRadius: 0.78,
  cardRadius: 0.655,
  stackRadius: 0.9,
  insuranceRadius: 0.55,
  spots: 7,
  heroSpot: 3,
} as const;

export const BJ_SHOE = v3(0.6, 0.06, -0.3);
export const BJ_DISCARD = v3(-0.6, 0.04, -0.3);
export const BJ_RACK = v3(0, 0.0, -0.375);

/** Spot angle in degrees: spot 0 is first base (players' right, dealer's left, +X). */
export function bjSpotAngle(spot: number): number {
  return 60 - spot * 20;
}

function onArc(radius: number, deg: number, centerZ = BJ_TABLE.spotArcCenterZ, y = 0): V3 {
  const a = (deg * Math.PI) / 180;
  return v3(radius * Math.sin(a), y, centerZ + radius * Math.cos(a));
}

export function bjSpotCenter(spot: number): V3 {
  return onArc(BJ_TABLE.spotRadius, bjSpotAngle(spot));
}

/** Facing angle (rotation about Y) for things laid in front of a spot so they point at the player. */
export function bjSpotYaw(spot: number): number {
  return (bjSpotAngle(spot) * Math.PI) / 180;
}

/**
 * Where card `slot` of hand `hand` (of `hands` total) lands for a spot. Cards fan slightly so ranks stay
 * readable; split hands spread sideways along the arc.
 */
export function bjCardPos(spot: number, hand: number, hands: number, slot: number): V3 {
  const deg = bjSpotAngle(spot);
  const spread = hands > 1 ? (hand - (hands - 1) / 2) * 7.2 : 0;
  const base = onArc(BJ_TABLE.cardRadius, deg + spread);
  const yaw = ((deg + spread) * Math.PI) / 180;
  // fan: each next card shifts toward the player's right and slightly toward the dealer
  const dx = 0.016 * slot;
  const dz = -0.011 * slot;
  return v3(base.x + Math.cos(yaw) * dx + Math.sin(yaw) * dz, 0.0006 * (slot + 1), base.z - Math.sin(yaw) * dx + Math.cos(yaw) * dz);
}

export function bjBetPos(spot: number, hand: number, hands: number): V3 {
  const deg = bjSpotAngle(spot) + (hands > 1 ? (hand - (hands - 1) / 2) * 7.2 : 0);
  return onArc(BJ_TABLE.spotRadius, deg);
}

export function bjStackPos(spot: number): V3 {
  return onArc(BJ_TABLE.stackRadius, bjSpotAngle(spot) - 4);
}

export function bjInsurancePos(spot: number): V3 {
  return onArc(BJ_TABLE.insuranceRadius, bjSpotAngle(spot));
}

export function bjDealerCardPos(slot: number): V3 {
  return v3(-0.04 + slot * 0.075, 0.0006 * (slot + 1), -0.14);
}

/** Kidney outline (players' arc + dealer's straight edge), as XZ points, counter-clockwise from above. */
export function bjOutline(segments = 64): { x: number; z: number }[] {
  const { halfWidth, dealerEdgeZ, arcCenterZ, arcRadius } = BJ_TABLE;
  const start = Math.atan2(halfWidth, dealerEdgeZ - arcCenterZ); // angle from +Z toward +X
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = start - (2 * start * i) / segments;
    pts.push({ x: arcRadius * Math.sin(a), z: arcCenterZ + arcRadius * Math.cos(a) });
  }
  return pts; // from (+0.95, −0.42) around through (0, 0.62) to (−0.95, −0.42); closing edge is the dealer side
}

// ───────────────────────── Texas Hold'em (stadium table) ─────────────────────────
export const HE_TABLE = {
  halfWidth: 1.05,
  halfDepth: 0.52,
  centerZ: 0.03,
  spotA: 0.9,
  spotB: 0.45,
  spots: 9,
  heroSpot: 0,
} as const;

/** Visible Hold'em spot angles (deg from +Z, positive toward +X): hero at 0, then alternating right/left. */
export const HE_SPOT_ANGLES = [0, 36, -36, 72, -72, 108, -108, 142, -142] as const;

function onEllipse(a: number, b: number, deg: number, y = 0): V3 {
  const r = (deg * Math.PI) / 180;
  return v3(a * Math.sin(r), y, HE_TABLE.centerZ + b * Math.cos(r));
}

export function heSpotCenter(spot: number): V3 {
  return onEllipse(HE_TABLE.spotA, HE_TABLE.spotB, HE_SPOT_ANGLES[spot] ?? 0);
}
export function heHolePos(spot: number, slot: number): V3 {
  const deg = HE_SPOT_ANGLES[spot] ?? 0;
  const p = onEllipse(HE_TABLE.spotA * 0.78, HE_TABLE.spotB * 0.72, deg);
  const yaw = (deg * Math.PI) / 180;
  const off = (slot - 0.5) * 0.04;
  return v3(p.x + Math.cos(yaw) * off, 0.0006 * (slot + 1), p.z - Math.sin(yaw) * off);
}
export function heBetPos(spot: number): V3 {
  return onEllipse(HE_TABLE.spotA * 0.58, HE_TABLE.spotB * 0.5, HE_SPOT_ANGLES[spot] ?? 0);
}
export function heStackPos(spot: number): V3 {
  const deg = (HE_SPOT_ANGLES[spot] ?? 0) + 9;
  return onEllipse(HE_TABLE.spotA * 0.98, HE_TABLE.spotB * 0.98, deg);
}
export function heButtonPos(spot: number): V3 {
  const deg = (HE_SPOT_ANGLES[spot] ?? 0) - 12;
  return onEllipse(HE_TABLE.spotA * 0.68, HE_TABLE.spotB * 0.62, deg, 0.002);
}
export function heBoardPos(slot: number): V3 {
  return v3(-0.2 + slot * 0.1, 0.0006, -0.06);
}
export const HE_POT = v3(0, 0, 0.1);
export const HE_DECK = v3(0.24, 0.07, -0.36); // in the dealer's left hand area
export const HE_MUCK = v3(-0.3, 0.004, -0.3);

export function heOutline(segments = 72): { x: number; z: number }[] {
  // Stadium: two semicircles joined by straight edges.
  const { halfWidth, halfDepth, centerZ } = HE_TABLE;
  const r = halfDepth;
  const cx = halfWidth - r;
  const pts: { x: number; z: number }[] = [];
  const half = Math.floor(segments / 2);
  for (let i = 0; i <= half; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / half;
    pts.push({ x: cx + r * Math.cos(a), z: centerZ + r * Math.sin(a) });
  }
  for (let i = 0; i <= half; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / half;
    pts.push({ x: -cx + r * Math.cos(a), z: centerZ + r * Math.sin(a) });
  }
  return pts;
}

// ───────────────────────── Seat mapping for unlimited seats ─────────────────────────
/**
 * Maps engine seats to visible spots. The local player (hero) always sits at the hero spot; neighbours in
 * table order fill the remaining spots; everyone else is shown only in the HTML players panel.
 * `order` is the seats in table order (blackjack: by join order; hold'em: by position).
 */
export function mapSeats(order: readonly number[], hero: number | null, spots: number, heroSpot: number, circular: boolean): Map<number, number> {
  const m = new Map<number, number>();
  if (order.length === 0) return m;
  if (hero == null || !order.includes(hero)) {
    // Spectator: fill spots in order, centred.
    const take = order.slice(0, spots);
    const start = Math.max(0, Math.floor((spots - take.length) / 2));
    take.forEach((s, i) => m.set(s, circular ? i : start + i));
    if (circular) {
      m.clear();
      take.forEach((s, i) => m.set(s, i));
    }
    return m;
  }
  const hi = order.indexOf(hero);
  m.set(hero, heroSpot);
  if (circular) {
    // Hold'em visible spot list alternates right/left: 0 hero, 1 right, 2 left, 3 right, ...
    let right = 1;
    let left = 1;
    for (let spot = 1; spot < spots && right + left - 1 <= order.length - 1; spot++) {
      // Play runs clockwise, so the next seats sit on the hero's left (−X) and earlier seats on the right.
      const goRight = spot % 2 === 1;
      const idx = goRight ? (hi - right++ + order.length * 2) % order.length : (hi + left++) % order.length;
      const seat = order[idx]!;
      if (m.has(seat)) break;
      m.set(seat, spot);
    }
    return m;
  }
  // Linear (blackjack arc). Spot numbers grow toward the players' left; table order runs first base → third base.
  for (let k = 1; k < spots; k++) {
    const before = order[hi - k];
    const after = order[hi + k];
    if (before !== undefined && heroSpot - k >= 0) m.set(before, heroSpot - k);
    if (after !== undefined && heroSpot + k < spots) m.set(after, heroSpot + k);
  }
  return m;
}
