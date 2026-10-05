// Isometric projection and colour helpers — fixed units; a camera (or a fitted viewBox) scales the group.
// Lifted from pokernight `apps/web/src/components/fieldops/FieldTown.tsx` (the field town), unchanged in its numbers
// so a scene drawn here and one drawn there read as the same place.

/** Half a tile's width on screen, before any scaling. */
export const U = 22;
/** How tall a tile of height reads. */
export const ZK = 0.92;

export const iso = (x: number, y: number, z = 0): { x: number; y: number } => ({ x: (x - y) * U, y: (x + y) * (U / 2) - z * U * ZK });
export const pt = (x: number, y: number, z = 0): string => { const p = iso(x, y, z); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; };

/** Lighten (k > 0) or darken (k < 0) a `#rrggbb` colour. */
export const shade = (hex: string, k: number): string => {
  const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255;
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k))));
  return `#${((f(r) << 16) | (f(g) << 8) | f(b)).toString(16).padStart(6, '0')}`;
};

/** A stable 0..1 number from a string — for the small variations that keep a street from looking stamped. */
export const hash01 = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };

export const INK = '#e8eef7';
export const MUTED = '#93a4bd';
export const GLOW = '#ffd27a';
export const GROUND = '#0d1626';
export const GROUND_LINE = '#182540';
