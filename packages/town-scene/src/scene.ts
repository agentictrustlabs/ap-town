// The scene: what stands where. Pure data — a builder decides it, the renderer draws it, a test can read it.
// Nothing here knows what a building MEANS; the vocabulary of meaning (an agent type → a shape) is in `shapes.ts`.

export type Roof = 'flat' | 'gable' | 'dome' | 'spire' | 'slab';

export interface SceneBuilding {
  id: string;
  /** The lot's near corner on the ground, the footprint in tiles, the wall height in tiles. */
  x: number; y: number; w: number; d: number; h: number;
  tone: string;
  roof: Roof;
  /** Windows lit: somebody is home (the builder says what that means and puts it in the legend). */
  lit: boolean;
  /** A flag in this colour on the roof. */
  flag?: string;
  /** A band of this colour at the foot of the walls. */
  trim?: string;
  /** Figures standing at the door. */
  figures?: number;
  label?: string;
  /** A smaller second line, shown with the label. */
  sub?: string;
  /** Where pressing it goes. A building with an href is a link. */
  href?: string;
  /** Always show the label (otherwise it shows on hover and focus). */
  pinned?: boolean;
}

export interface ScenePlate {
  id: string;
  x: number; y: number; w: number; d: number;
  tone: string;
  label?: string;
  href?: string;
  /** A road rather than a lot: drawn flat and dark, no outline. */
  road?: boolean;
}

export interface SceneTree { x: number; y: number; s: number }

export interface TownSceneV1 {
  plates: ScenePlate[];
  buildings: SceneBuilding[];
  trees?: SceneTree[];
  /** One sentence saying what the picture shows — the SVG's accessible name. */
  title: string;
}

/** Painter's order: what is further back is drawn first. */
export const depthOf = (b: { x: number; y: number; w: number; d: number }): number => b.x + b.y + (b.w + b.d) / 2;
