// People and places: how each kind of agent is drawn. One table, shared by every town view, so a person is the same
// house on the naming service's street as in the portal's town. The KIND strings are the derived agent types
// (ADR-0061) plus `legacy` for an untyped root.
import type { Roof } from './scene';

export type PlaceKind = 'person' | 'household' | 'org' | 'team' | 'church' | 'circle' | 'service' | 'workspace' | 'treasury' | 'registry' | 'legacy';

export interface PlaceShape {
  /** What it is, in a word a visitor would use. */
  noun: string;
  /** Footprint and wall height in tiles. */
  w: number; d: number; h: number;
  roof: Roof;
  tone: string;
  flag?: boolean;
  trim?: string;
  figures?: number;
}

export const PLACE_SHAPES: Readonly<Record<PlaceKind, PlaceShape>> = {
  person: { noun: 'a house', w: 1.2, d: 1.2, h: 0.9, roof: 'gable', tone: '#d9a15f', figures: 1 },
  household: { noun: 'a wide house', w: 1.9, d: 1.3, h: 0.9, roof: 'gable', tone: '#c98a6b', figures: 2 },
  org: { noun: 'a hall with a dome', w: 2.0, d: 2.0, h: 1.5, roof: 'dome', tone: '#7f9bd1' },
  team: { noun: 'an office flying a flag', w: 1.6, d: 1.4, h: 1.2, roof: 'flat', tone: '#5fb39a', flag: true },
  church: { noun: 'a hall with a spire', w: 1.9, d: 1.4, h: 1.2, roof: 'spire', tone: '#c9cfdb' },
  circle: { noun: 'a small round hall', w: 1.2, d: 1.2, h: 0.8, roof: 'dome', tone: '#b48fd6' },
  service: { noun: 'a workshop', w: 1.7, d: 1.3, h: 1.0, roof: 'slab', tone: '#8a97ad' },
  workspace: { noun: 'a low studio', w: 2.0, d: 1.5, h: 0.7, roof: 'flat', tone: '#6fb3c9' },
  treasury: { noun: 'a vault', w: 1.4, d: 1.4, h: 1.1, roof: 'slab', tone: '#d6b24a', trim: '#8a6d1c' },
  registry: { noun: 'a tall narrow hall', w: 1.1, d: 1.1, h: 2.2, roof: 'flat', tone: '#9aa7e8' },
  legacy: { noun: 'a plain block', w: 1.3, d: 1.3, h: 0.8, roof: 'flat', tone: '#5b6678' },
};

export const isPlaceKind = (k: string): k is PlaceKind => Object.prototype.hasOwnProperty.call(PLACE_SHAPES, k);
