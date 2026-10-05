import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { crawlRoots, laneBindings, laneRoutesVar, parseTown, validateTown, AUTHORIZATION_IS_NOT_A_TOWN_SIGNAL } from '../src/index';

const faithchain = readFileSync(new URL('../../../towns/faithchain/town.yaml', import.meta.url), 'utf8');

const base = () => ({
  town: 't', status: 'live', chain: { id: 1, generation: '1', rpc: 'https://rpc.example' },
  estates: [{ id: 'a', repo: 'r', home: 'https://h.example', edge: 'https://e.example', a2a: 'https://x.example', nameRoots: ['me'] }],
  services: [] as unknown[],
});

describe('town manifest', () => {
  it('the faithchain manifest is valid', () => {
    const { town, errors } = parseTown(faithchain);
    expect(errors).toEqual([]);
    expect(town?.chain.id).toBe(34348);
  });

  it('refuses a service host claimed twice and a lane claimed by two estates', () => {
    const t = base();
    t.estates.push({ ...t.estates[0]!, id: 'b' });
    (t.estates[0] as any).lanes = { 'edge.example': 'w1' };
    (t.estates[1] as any).lanes = { 'edge.example': 'w2' };
    t.services = [
      { id: 's1', kind: 'commons', repo: 'x/y', hosts: ['a.example'], description: 'one' },
      { id: 's2', kind: 'commons', repo: 'x/y', hosts: ['a.example'], description: 'two' },
    ];
    const { town, errors } = validateTown(t);
    expect(town).toBeNull();
    expect(errors.some((e) => e.includes('already served by s1'))).toBe(true);
    expect(errors.some((e) => e.includes('already a lane of a'))).toBe(true);
  });

  it('a service ap-town deploys must name its app; a referenced one must not', () => {
    const t = base();
    t.services = [
      { id: 'mine', kind: 'commons', repo: 'ap-town', hosts: [], description: 'd' },
      { id: 'theirs', kind: 'application', repo: 'o/r', app: 'apps/x', hosts: [], description: 'd' },
    ];
    const { errors } = validateTown(t);
    expect(errors).toContain('services[0] (mine).app: a service ap-town deploys names its app directory');
    expect(errors).toContain('services[1] (theirs).app: only services ap-town deploys have an app here');
  });

  it('refuses an unknown kind and an estate the town does not have', () => {
    const t = base();
    t.services = [{ id: 's', kind: 'authority', repo: 'o/r', hosts: [], estates: ['zzz'], description: 'd' }];
    const { errors } = validateTown(t);
    expect(errors.some((e) => e.includes('.kind:'))).toBe(true);
    expect(errors.some((e) => e.includes('"zzz" is not an estate'))).toBe(true);
  });
});

describe('generators', () => {
  it('crawl roots are the union over estates, first-seen order', () => {
    const t = base() as any;
    t.estates.push({ ...t.estates[0], id: 'b', nameRoots: ['org', 'me'] });
    expect(crawlRoots(t)).toEqual(['me', 'org']);
  });

  it('lane bindings are per estate, one binding per Worker', () => {
    const { town } = parseTown(faithchain);
    expect(laneBindings(town!)).toEqual([
      { binding: 'LANE_FAITHNET_1', service: 'demo-edge-faithnet', pattern: 'edge.faithnet.io', estate: 'faithnet' },
      { binding: 'LANE_FAITHNET_1', service: 'demo-edge-faithnet', pattern: 'demo-edge-faithnet.richardpedersen3.workers.dev', estate: 'faithnet' },
      { binding: 'LANE_FAITHNET_2', service: 'demo-a2a-faithnet', pattern: '*.faithnet.ai', estate: 'faithnet' },
    ]);
    expect(laneRoutesVar(town!)).toBe('edge.faithnet.io=LANE_FAITHNET_1,demo-edge-faithnet.richardpedersen3.workers.dev=LANE_FAITHNET_1,*.faithnet.ai=LANE_FAITHNET_2');
  });

  it('authorization is never a town signal', () => {
    expect(AUTHORIZATION_IS_NOT_A_TOWN_SIGNAL).toMatch(/does not grant/);
  });
});
