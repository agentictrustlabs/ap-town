import { describe, expect, it } from 'vitest';
import { PLACE_SHAPES } from '@ap-town/town-scene';
import type { NameView, TownView } from '../src/api-types';
import { lotScene, townScene } from '../src/scenes';

const stamp = { town: 't', chainId: 1, block: 1 };

describe('the town of names', () => {
  it('draws one landmark per root with its count — kinds and counts, never particular agents (owner, 2026-10-06)', () => {
    const t: TownView = {
      ...stamp, estates: [], fees: null, total: 3,
      roots: [
        { tld: 'me', priced: false, baseCoins: null, names: 'a person', kind: 'person', legacy: false, count: 2, issuing: '', subregistry: null, open: true, estates: [], sample: [{ name: 'a.me', label: 'a', owner: '0x1', kind: 'person' }, { name: 'b.me', label: 'b', owner: '0x2', kind: 'person' }] },
        { tld: 'org', priced: false, baseCoins: null, names: 'an organization', kind: 'org', legacy: false, count: 1, issuing: '', subregistry: null, open: true, estates: [], sample: [{ name: 'c.org', label: 'c', owner: '0x3', kind: 'org' }] },
      ],
    };
    const s = townScene(t);
    expect(s.plates.map((p) => p.label)).toEqual(['People · 2', 'Organizations · 1']);
    expect(s.buildings.map((b) => b.href).sort()).toEqual(['/root/me', '/root/org']);
    expect(s.buildings.map((b) => b.label)).toEqual(['.me', '.org']);
    expect(s.buildings.find((b) => b.id === 'org')!.roof).toBe(PLACE_SHAPES.org.roof);
    expect(JSON.stringify(s)).not.toContain('a.me');
  });

  it('a name with a warning is drawn with dark windows', () => {
    const base = { ...stamp, input: 'x.me', status: 'registered', name: 'x.me', onChainName: 'x.me', form: 'canonical', tld: 'me', kind: 'person', names: 'a person', legacy: false, node: '0x0', agent: null, displayName: null, owner: null, ownerName: null, presented: null, presentsThis: false, declared: null, typeCheck: null, records: [], signals: null, can: [], children: [], childCount: 0, details: null, availability: null, estates: [] } as unknown as NameView;
    expect(lotScene({ ...base, banners: [] }).buildings[0]!.lit).toBe(true);
    expect(lotScene({ ...base, banners: [{ tone: 'warn', title: 'Type mismatch', body: '' }] }).buildings[0]!.lit).toBe(false);
  });
});
