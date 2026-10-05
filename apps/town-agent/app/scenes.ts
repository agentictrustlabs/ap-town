// The town, drawn (spec 429 §7.1): an estate is a district — its Home the civic hall, its edge the gate, its people's
// houses along the street; the commons stand at the end of the street, one building per service; applications are
// venues on the edge of town. Lit windows are health; presence is listing. There is no "authorized" colour (D7).
import { LOT, ROAD, PLACE_SHAPES, placeOnLot, street, town, type PlaceInput, type PlaceKind, type TownSceneV1 } from '@ap-town/town-scene';
import type { ServiceView, TownData } from './types';

const SERVICE_SHAPE: Record<string, PlaceKind> = {
  registry: 'registry', naming: 'registry', kms: 'treasury', skills: 'org', 'town-agent': 'workspace', 'chain-gateway': 'service',
  'discovery-indexer': 'service', 'discovery-mcp': 'service', 'discovery-connector': 'service', 'discovery-web': 'workspace',
};
const KIND_SHAPE: Record<ServiceView['kind'], PlaceKind> = { commons: 'service', 'domain-pack': 'circle', 'agent-service': 'service', application: 'household' };

export const shapeOf = (s: ServiceView): PlaceKind => SERVICE_SHAPE[s.id] ?? KIND_SHAPE[s.kind];
export const lit = (s: ServiceView): boolean => s.signals.healthy === 'up' || s.signals.healthy === 'self';

const servicePlace = (s: ServiceView): PlaceInput => ({
  id: `svc:${s.id}`, kind: shapeOf(s), label: s.id, sub: s.hosts[0] ?? s.kind, href: `/service/${s.id}`, lit: lit(s),
});

export function townScene(t: TownData): TownSceneV1 {
  const parts: ReturnType<typeof street>[] = [];
  let ox = 0;
  const namingHost = t.services.find((s) => s.id === 'naming')?.hosts[0];
  // Each estate: a district with its Home and edge in front and its people's houses behind.
  for (const e of t.estates) {
    const houses = (t.names?.roots.find((r) => r.tld === 'me')?.sample ?? []).slice(0, 6).map((n): PlaceInput => ({ id: `name:${n.name}`, kind: 'person', label: n.name, ...(namingHost ? { href: `https://${namingHost}/name/${n.name}` } : {}), lit: true }));
    const civic: PlaceInput[] = [
      { id: `estate:${e.id}:home`, kind: 'org', label: `${e.id} · Home`, sub: new URL(e.home).host, href: e.home, lit: true, pinned: true },
      { id: `estate:${e.id}:edge`, kind: 'service', label: `${e.id} · gate`, sub: new URL(e.edge).host, href: e.edge, lit: true },
    ];
    const s = street([...civic, ...houses], { cols: 4, tone: PLACE_SHAPES.org.tone, label: `the ${e.id} estate`, ox, oy: 0 });
    parts.push(s); ox += s.w + 2;
  }
  const commons = t.services.filter((s) => s.kind === 'commons');
  const apps = t.services.filter((s) => s.kind !== 'commons');
  // The commons beside the estates, the applications beyond them.
  const c = street(commons.map(servicePlace), { cols: Math.min(6, Math.max(3, Math.ceil(commons.length / 2))), tone: PLACE_SHAPES.registry.tone, label: 'the commons', ox, oy: 0 });
  parts.push(c);
  if (apps.length) parts.push(street(apps.map(servicePlace), { cols: Math.max(3, apps.length), tone: PLACE_SHAPES.household.tone, label: 'applications', ox: ox + c.w + 2, oy: 0 }));
  return town(parts, `The ${t.town} town: ${t.estates.length} estate(s), ${commons.length} shared service(s), ${apps.length} application(s). Lit windows are services that answered their probe.`);
}

export function glyphScene(kind: PlaceKind, on = true): TownSceneV1 {
  return { title: PLACE_SHAPES[kind].noun, plates: [], buildings: [placeOnLot({ id: 'g', kind, lit: on }, 0, 0)] };
}
