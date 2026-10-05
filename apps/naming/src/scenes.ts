// The town of names (spec 430 D6): what the naming service's data looks like as people and places. Pure builders —
// API data in, a scene out. The renderer and the shapes are the town's own (@ap-town/town-scene).
import { LOT, ROAD, PLACE_SHAPES, placeOnLot, street, town, type PlaceInput, type PlaceKind, type TownSceneV1 } from '@ap-town/town-scene';
import type { AddressView, NameRow, NameView, RootPage, TownView } from './api-types';
import { nameHref, rootHref } from './router';

const place = (r: NameRow, over: Partial<PlaceInput> = {}): PlaceInput => ({ id: r.name, kind: r.kind, label: r.name, href: nameHref(r.name), lit: true, ...over });

/** The whole town: a street per root, a few of its names standing on it, the root's street as a link. */
export function townScene(t: TownView): TownSceneV1 {
  const perRow = 4; const cols = 3; const gap = 1.6;
  const blockW = cols * LOT; const blockD = 2 * LOT + ROAD;
  const parts = t.roots.map((r, i) => street(r.sample.slice(0, cols * 2).map((n) => place(n)), {
    cols, tone: PLACE_SHAPES[r.kind].tone, label: `.${r.tld} · ${r.count}`, href: rootHref(r.tld),
    ox: (i % perRow) * (blockW + gap), oy: Math.floor(i / perRow) * (blockD + gap),
  }));
  return town(parts, `The names of the ${t.town} town: ${t.roots.map((r) => `${r.count} under .${r.tld}`).join(', ')}.`);
}

/** One root's street: this page of its names. */
export function rootScene(p: RootPage): TownSceneV1 {
  const cols = p.names.length > 24 ? 8 : p.names.length > 8 ? 6 : Math.max(3, p.names.length);
  return town([street(p.names.map((n) => place(n)), { cols, tone: PLACE_SHAPES[p.root.kind].tone, label: `.${p.root.tld}` })],
    `The .${p.root.tld} street: ${p.names.length} of its ${p.root.count} names, each ${PLACE_SHAPES[p.root.kind].noun}.`);
}

/** A name's own lot: its building, larger, with the names under it standing behind. */
export function lotScene(v: NameView): TownSceneV1 {
  const tone = PLACE_SHAPES[v.kind].tone;
  const kids = v.children.slice(0, 12).map((c) => place(c));
  const back = kids.length ? street(kids, { cols: Math.min(4, Math.max(3, kids.length)), tone, label: 'names under it', trees: false }) : null;
  const w = back ? back.w : 3 * LOT;
  const oy = back ? back.d + 0.8 : 0;
  const ok = v.banners.every((b) => b.tone !== 'warn');
  const subject = placeOnLot({ id: v.name, kind: v.kind, label: v.name, ...(v.displayName ? { sub: v.displayName } : {}), lit: ok, pinned: true, scale: 1.5 }, (w - LOT) / 2, oy + 0.6);
  const parts = { plates: [...(back?.plates ?? []), { id: 'lot', x: 0, y: oy, w, d: LOT + 1.2, tone }], buildings: [...(back?.buildings ?? []), subject], trees: [{ x: 0.9, y: oy + 1.1, s: 1 }, { x: w - 0.9, y: oy + 2.9, s: 0.8 }, ...(back?.trees ?? [])], w, d: oy + LOT + 1.2 };
  return town([parts], `${v.name}: ${PLACE_SHAPES[v.kind].noun}${v.children.length ? `, with ${v.childCount} name(s) under it` : ''}.`);
}

/** An agent's places: every name it holds, side by side. */
export function addressScene(v: AddressView): TownSceneV1 {
  const places = v.held.map((h): PlaceInput => ({ id: h.name, kind: h.kind, label: h.name, href: nameHref(h.name), lit: h.presented, pinned: true, ...(h.presented ? { sub: 'presented' } : {}) }));
  return town([street(places, { cols: Math.max(3, places.length), tone: PLACE_SHAPES[v.kind].tone, trees: true })], `The names this agent holds: ${v.held.map((h) => h.name).join(', ') || 'none'}.`);
}

/** One building, for a glyph beside a line of text. */
export function glyphScene(kind: PlaceKind, lit = true): TownSceneV1 {
  return { title: PLACE_SHAPES[kind].noun, plates: [], buildings: [placeOnLot({ id: 'g', kind, lit }, 0, 0)] };
}
