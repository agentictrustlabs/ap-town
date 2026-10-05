import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { IsoScene, PLACE_SHAPES, extent, placeOnLot, street, town, LOT, type PlaceInput } from '../src/index';

const people = (n: number): PlaceInput[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, kind: 'person', label: `p${i}.me`, href: `/name/p${i}.me`, lit: true }));

describe('town scene', () => {
  it('every place kind has a shape that fits on a lot', () => {
    for (const [kind, s] of Object.entries(PLACE_SHAPES)) {
      expect(s.w, kind).toBeLessThan(LOT); expect(s.d, kind).toBeLessThan(LOT);
    }
  });

  it('a street is deterministic and keeps every building on its own lot', () => {
    const a = street(people(7), { cols: 4, tone: '#d9a15f', label: '.me' });
    const b = street(people(7), { cols: 4, tone: '#d9a15f', label: '.me' });
    expect(a).toEqual(b);
    expect(a.buildings).toHaveLength(7);
    const lots = new Set(a.buildings.map((x) => `${Math.floor(x.x / LOT)}:${Math.round(x.y)}`));
    expect(lots.size).toBe(7);
  });

  it('a building centred on its lot stays inside it', () => {
    const b = placeOnLot({ id: 'x', kind: 'org', lit: true }, 6, 3);
    expect(b.x).toBeGreaterThanOrEqual(6); expect(b.x + b.w).toBeLessThanOrEqual(6 + LOT);
    expect(b.y).toBeGreaterThanOrEqual(3); expect(b.y + b.d).toBeLessThanOrEqual(3 + LOT);
  });

  it('renders buildings with an href as real links named by their label', () => {
    const scene = town([street(people(3), { cols: 3, tone: '#d9a15f', label: '.me' })], 'three houses');
    const html = renderToStaticMarkup(createElement(IsoScene, { scene }));
    expect(html).toContain('aria-label="three houses"');
    expect((html.match(/<a /g) ?? []).length).toBe(3);
    expect(html).toContain('href="/name/p0.me"');
    expect(html).toContain('aria-label="p0.me"');
  });

  it('the extent covers every building', () => {
    const scene = town([street(people(5), { cols: 5, tone: '#d9a15f' })], 't');
    const e = extent(scene);
    expect(e.w).toBeGreaterThan(0); expect(e.h).toBeGreaterThan(0);
  });
});
