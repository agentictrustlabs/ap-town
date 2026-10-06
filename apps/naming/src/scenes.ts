// The town of names (spec 430 D6): what the naming service's data looks like as people and places. Pure builders —
// API data in, a scene out. The renderer and the shapes are the town's own (@ap-town/town-scene).
import { LOT, PLACE_SHAPES, placeOnLot, street, town, type PlaceInput, type PlaceKind, type TownSceneV1 } from '@ap-town/town-scene';
import type { AddressView, NameRow, NameView, RootPage, TownView } from './api-types';
import { nameHref, rootHref } from './router';

const place = (r: NameRow, over: Partial<PlaceInput> = {}): PlaceInput => ({ id: r.name, kind: r.kind, label: r.name, href: nameHref(r.name), lit: true, ...over });

/** The three classes every agent is one of (ADR-0046), as the town's districts. */
const DISTRICTS: ReadonlyArray<{ id: string; label: string; kinds: PlaceKind[] }> = [
  { id: 'people', label: 'People', kinds: ['person'] },
  { id: 'organizations', label: 'Organizations', kinds: ['org', 'team', 'church', 'circle', 'household'] },
  { id: 'services', label: 'Services', kinds: ['service', 'workspace', 'treasury', 'registry'] },
];

/**
 * The whole town at the level of KINDS, in three districts (owner, 2026-10-06: a 3D picture with the CONTEXT of
 * person, organization or service; agent types and counts, never particular agents; not a zoomable map). One
 * landmark per ending, drawn as the kind it names and sized by how many names stand under it, its pill saying the
 * ending and the count; the district plate says which class those kinds are. Each landmark leads to its street.
 */
export function townScene(t: TownView): TownSceneV1 {
  const scaleOf = (n: number): number => (n >= 100 ? 1.9 : n >= 30 ? 1.6 : n >= 10 ? 1.35 : n > 0 ? 1.15 : 0.9);
  const slot = LOT + 1.4; const depth = LOT + 2.2; const gap = 1.6;
  // Two rows, so the picture is a block and not a ribbon: people and services across the top, organizations — the
  // widest district — along the bottom.
  const district = (d: typeof DISTRICTS[number], ox: number, oy: number) => {
    const roots = t.roots.filter((r) => d.kinds.includes(r.kind)).sort((a, b) => d.kinds.indexOf(a.kind) - d.kinds.indexOf(b.kind));
    if (!roots.length) return null;
    const w = Math.max(2, roots.length) * slot + 0.8;
    const total = roots.reduce((n, r) => n + r.count, 0);
    const tone = PLACE_SHAPES[d.kinds[0]!].tone;
    const buildings = roots.map((r, i) => placeOnLot({ id: r.tld, kind: r.kind, label: `.${r.tld}`, sub: `${r.count} ${r.count === 1 ? 'name' : 'names'}`, href: rootHref(r.tld), lit: r.count > 0, pinned: true, scale: scaleOf(r.count) }, ox + 0.4 + i * slot + (roots.length === 1 ? slot / 2 : 0), oy + 0.9));
    const trees = [{ x: ox + 0.5, y: oy + depth - 0.5, s: 0.7 }, { x: ox + w - 0.5, y: oy + 0.5, s: 0.6 }, { x: ox + w - 0.6, y: oy + depth - 0.7, s: 0.8 }];
    return { plates: [{ id: `d-${d.id}`, x: ox, y: oy, w, d: depth, tone, label: `${d.label} · ${total}` }], buildings, trees, w: ox + w, d: oy + depth };
  };
  const people = district(DISTRICTS[0]!, 0, 0);
  const services = district(DISTRICTS[2]!, (people?.w ?? 0) + gap, 0);
  const organizations = district(DISTRICTS[1]!, slot, depth + 3.6); // a row's label sits at its front edge: leave it room, and step the front row aside
  const parts = [people, services, organizations].filter((x): x is NonNullable<typeof x> => !!x);
  return town(parts, `The ${t.town} town by kind: ${DISTRICTS.map((d) => `${d.label.toLowerCase()} ${t.roots.filter((r) => d.kinds.includes(r.kind)).map((r) => `.${r.tld} (${r.count})`).join(', ')}`).join('; ')}.`);
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
