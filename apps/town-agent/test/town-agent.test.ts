import { describe as d, expect, it } from 'vitest';
import { TOWNS } from '@ap-town/town-model';
import { answer, cardFor, intentOf } from '../worker/index';
import type { MessageV1 } from '@agenticprimitives/a2a/standard';

const town = TOWNS.faithchain!;
const msg = (parts: MessageV1['parts']): MessageV1 => ({ messageId: 'm', role: 'ROLE_USER', parts });
const up = async () => ({ status: 200 });

d('town agent', () => {
  it('the card is A2A 1.0 with a JSONRPC interface and two skills', () => {
    const c = cardFor(town, 'https://town.example');
    expect(c.supportedInterfaces[0]).toEqual({ url: 'https://town.example/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' });
    expect(c.skills.map((s) => s.id)).toEqual(['town.describe', 'town.service']);
  });

  it('reads intent from a data part, then from text, else describes the town', () => {
    expect(intentOf(msg([{ data: { skill: 'town.service', id: 'skills' } }]), town)).toEqual({ skill: 'town.service', id: 'skills' });
    expect(intentOf(msg([{ data: { skill: 'town.service', id: 'nope' } }]), town)).toEqual({ skill: 'unknown-service', id: 'nope' });
    expect(intentOf(msg([{ text: 'is the chain gateway up?' }]), town)).toEqual({ skill: 'town.service', id: 'chain-gateway' });
    expect(intentOf(msg([{ text: 'what is here?' }]), town)).toEqual({ skill: 'town.describe' });
  });

  it('every service view carries the three signals and says listing is not permission', async () => {
    const parts = await answer(town, msg([{ text: 'what is here?' }]), up, null);
    const data = parts[1]!.data as { services: Array<{ signals: Record<string, unknown>; authorized: string }> };
    expect(data.services.length).toBe(town.services.length);
    for (const s of data.services) {
      expect(Object.keys(s.signals).filter((k) => !k.endsWith('Detail')).sort()).toEqual(['compatible', 'healthy', 'listed']);
      expect(s.authorized).toMatch(/does not grant/);
      expect(s.signals).not.toHaveProperty('authorized');
    }
  });

  it('a probe failure is "down" with its reason; a service without a probe is "unobserved"', async () => {
    const parts = await answer(town, msg([{ text: 'x' }]), async () => ({ error: 'TimeoutError' }), null);
    const services = (parts[1]!.data as { services: Array<{ id: string; signals: { healthy: string; healthDetail?: string } }> }).services;
    expect(services.find((s) => s.id === 'registry')!.signals).toMatchObject({ healthy: 'down', healthDetail: 'TimeoutError' });
    expect(services.find((s) => s.id === 'discovery-mcp')!.signals.healthy).toBe('unobserved');
  });
});
