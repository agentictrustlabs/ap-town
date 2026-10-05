// Laying a street out: lots on both sides of a road, in rows. Pure and deterministic — the same list is the same
// street every time, so a name keeps its lot between visits.
import { hash01 } from './iso';
import { depthOf, type SceneBuilding, type ScenePlate, type SceneTree, type TownSceneV1 } from './scene';
import { PLACE_SHAPES, type PlaceKind } from './shapes';

/** A lot's side in tiles, and the road's width. */
export const LOT = 3;
export const ROAD = 1.2;

export interface PlaceInput {
  id: string;
  kind: PlaceKind;
  label?: string;
  sub?: string;
  href?: string;
  lit: boolean;
  pinned?: boolean;
  /** Override the shape's tone (a mismatch drawn grey, say). */
  tone?: string;
  /** Scale the whole building (the subject of a page drawn larger than its neighbours). */
  scale?: number;
}

/** One building on the lot whose near corner is (lx, ly), centred on the lot. */
export function placeOnLot(p: PlaceInput, lx: number, ly: number, lot = LOT): SceneBuilding {
  const s = PLACE_SHAPES[p.kind];
  const k = p.scale ?? 1;
  const w = s.w * k; const d = s.d * k;
  return {
    id: p.id, x: lx + (lot - w) / 2, y: ly + (lot - d) / 2, w, d, h: s.h * k,
    tone: p.tone ?? s.tone, roof: s.roof, lit: p.lit,
    ...(s.flag ? { flag: s.tone } : {}), ...(s.trim ? { trim: s.trim } : {}), ...(s.figures ? { figures: s.figures } : {}),
    ...(p.label ? { label: p.label } : {}), ...(p.sub ? { sub: p.sub } : {}), ...(p.href ? { href: p.href } : {}), ...(p.pinned ? { pinned: true } : {}),
  };
}

export interface StreetOpts {
  /** Lots per row on each side of the road. */
  cols: number;
  /** The plate's tone and label (the street's name). */
  tone: string;
  label?: string;
  href?: string;
  /** Where the street starts. */
  ox?: number; oy?: number;
  /** Trees on the empty lots. */
  trees?: boolean;
}

/**
 * A street: a road down the middle, a row of lots on each side, further rows behind as the list grows.
 * Returns the pieces and the ground it covers, so several streets can be set beside each other.
 */
export function street(places: PlaceInput[], opts: StreetOpts): { plates: ScenePlate[]; buildings: SceneBuilding[]; trees: SceneTree[]; w: number; d: number } {
  const ox = opts.ox ?? 0; const oy = opts.oy ?? 0;
  const cols = Math.max(1, opts.cols);
  const rows = Math.max(1, Math.ceil(places.length / cols));
  // Rows alternate sides of a road: [lots][road][lots] is one block, and blocks repeat down the y axis.
  const blocks = Math.ceil(rows / 2);
  const w = cols * LOT;
  // A single row is a row of lots with the road in front of it, not a road with an empty far side.
  const single = rows === 1;
  const d = single ? LOT + ROAD : blocks * (2 * LOT + ROAD);
  const idp = opts.label ?? 'street';
  const plates: ScenePlate[] = [{ id: `${idp}:ground`, x: ox, y: oy, w, d, tone: opts.tone, ...(opts.label ? { label: opts.label } : {}), ...(opts.href ? { href: opts.href } : {}) }];
  for (let b = 0; b < blocks; b++) plates.push({ id: `${idp}:road${b}`, x: ox, y: oy + b * (2 * LOT + ROAD) + LOT, w, d: ROAD, tone: '#0a1220', road: true });
  const buildings: SceneBuilding[] = [];
  const trees: SceneTree[] = [];
  for (let r = 0; r < rows; r++) {
    const block = Math.floor(r / 2); const far = r % 2 === 0;
    const ly = oy + block * (2 * LOT + ROAD) + (far ? 0 : LOT + ROAD);
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const lx = ox + c * LOT;
      const p = places[i];
      if (p) buildings.push(placeOnLot(p, lx, ly));
      else if (opts.trees !== false) {
        const j = hash01(`${idp}:${i}`);
        trees.push({ x: lx + 0.8 + j * 1.4, y: ly + 0.8 + (1 - j) * 1.4, s: 0.7 + j * 0.5 });
      }
    }
  }
  return { plates, buildings, trees, w, d };
}

/** Put streets side by side (wrapping), with a gap between — a town of districts. */
export function town(parts: Array<ReturnType<typeof street>>, title: string): TownSceneV1 {
  return {
    title,
    plates: parts.flatMap((p) => p.plates),
    buildings: parts.flatMap((p) => p.buildings).sort((a, b) => depthOf(a) - depthOf(b)),
    trees: parts.flatMap((p) => p.trees),
  };
}
