/**
 * THE TOWN, DRAWN — an isometric scene in plain SVG.
 *
 * Lifted from the field town (pokernight `FieldTown.tsx`): a dark ground, buildings as three shaded faces with lit
 * windows, a roof by kind, figures at a door, pill labels. What is NOT here yet is that file's camera (pan, zoom,
 * levels of detail); this version fits the whole scene in its box, which is right for a street or a lot. The camera
 * comes with the portal's town view (spec 429 R3).
 *
 * A BUILDING WITH AN HREF IS A LINK — a real `<a>`, reachable by keyboard, with its label as its name. The picture
 * is navigation, never decoration; the page that shows it also lists the same things as text.
 */
import { useState, type ReactNode } from 'react';
import { GLOW, GROUND, GROUND_LINE, INK, iso, shade } from './iso';
import { depthOf, type SceneBuilding, type ScenePlate, type TownSceneV1 } from './scene';
import { Box, Tree, rect } from './draw';

/** The label over a building: a pill, with a smaller line under it. */
function Label({ b, on }: { b: SceneBuilding; on: boolean }): ReactNode {
  if (!b.label) return null;
  const top = iso(b.x + b.w / 2, b.y + b.d / 2, b.h + (b.roof === 'spire' ? 2.1 : b.roof === 'flat' || b.roof === 'slab' ? 0.5 : 1.1) + (b.flag ? 0.7 : 0));
  const text = b.label.length > 26 ? `${b.label.slice(0, 25)}…` : b.label;
  const wpx = Math.max(40, text.length * 6.6 + 16);
  return (
    <g className={b.pinned || on ? 'ts-label ts-on' : 'ts-label'} aria-hidden="true">
      <rect x={top.x - wpx / 2} y={top.y - 22} width={wpx} height={b.sub ? 30 : 18} rx={9} fill="#0b1424" stroke="#2a3b5c" strokeWidth={1} opacity={0.94} />
      <text x={top.x} y={top.y - 9.5} textAnchor="middle" fontSize={11} fontWeight={650} fill={INK}>{text}</text>
      {b.sub && <text x={top.x} y={top.y + 2.5} textAnchor="middle" fontSize={9} fill="#9fb0c9">{b.sub}</text>}
    </g>
  );
}

function plateLabel(p: ScenePlate): ReactNode {
  if (!p.label) return null;
  const at = iso(p.x + 0.3, p.y + p.d + 0.75, 0);
  return <text key={`${p.id}:t`} x={at.x} y={at.y} fontSize={17} fontWeight={750} fill="#dbe6f7" transform={`rotate(26.565 ${at.x} ${at.y})`} className="ts-plate-label">{p.label}</text>;
}

/** The scene's extent on screen, with room for labels and roofs. */
export function extent(scene: TownSceneV1, pad = 46): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const add = (x: number, y: number, z = 0) => { const p = iso(x, y, z); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); };
  for (const p of scene.plates) { add(p.x, p.y); add(p.x + p.w, p.y); add(p.x, p.y + p.d); add(p.x + p.w, p.y + p.d); }
  const head = pad < 20 ? 1.4 : 3.2;
  for (const b of scene.buildings) { add(b.x, b.y, b.h + head); add(b.x + b.w, b.y + b.d); add(b.x, b.y + b.d); add(b.x + b.w, b.y); }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 100, h: 60 };
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 + 14 };
}

export interface IsoSceneProps {
  scene: TownSceneV1;
  /** Called instead of following the link (a single-page app's router). */
  onNavigate?: (href: string) => void;
  /** The id of the building this page is about — drawn with a ring on its lot. */
  selected?: string;
  className?: string;
  /** No ground behind the picture and a tight frame — for a single building used as a glyph beside text. */
  bare?: boolean;
}

export function IsoScene({ scene, onNavigate, selected, className, bare }: IsoSceneProps): ReactNode {
  const e = extent(scene, bare ? 6 : 46);
  const [active, setActive] = useState<string | null>(null);
  const go = onNavigate ? (href: string) => (ev: { preventDefault(): void; metaKey?: boolean; ctrlKey?: boolean }) => { if (ev.metaKey || ev.ctrlKey) return; ev.preventDefault(); onNavigate(href); } : null;
  const grounds = scene.plates.filter((p) => !p.road).sort((a, b) => depthOf(a) - depthOf(b));
  const roads = scene.plates.filter((p) => p.road);
  const buildings = [...scene.buildings].sort((a, b) => depthOf(a) - depthOf(b));
  return (
    <svg className={className ? `ts-scene ${className}` : 'ts-scene'} viewBox={`${e.x.toFixed(0)} ${e.y.toFixed(0)} ${e.w.toFixed(0)} ${e.h.toFixed(0)}`} role={bare ? 'presentation' : 'img'} aria-label={bare ? undefined : scene.title} preserveAspectRatio="xMidYMid meet">
      {!bare && <title>{scene.title}</title>}
      {!bare && <rect x={e.x} y={e.y} width={e.w} height={e.h} fill={GROUND} />}
      {grounds.map((p) => {
        const ground = <polygon points={rect(p)} fill={shade(p.tone, -0.78)} stroke={shade(p.tone, -0.45)} strokeWidth={1.2} />;
        return p.href
          ? <a key={p.id} href={p.href} onClick={go ? go(p.href) : undefined} className="ts-plate" aria-label={p.label ?? p.id}>{ground}{plateLabel(p)}</a>
          : <g key={p.id}>{ground}{plateLabel(p)}</g>;
      })}
      {roads.map((p) => <polygon key={p.id} points={rect(p)} fill={p.tone} stroke={GROUND_LINE} strokeWidth={1} />)}
      {(scene.trees ?? []).map((t, i) => <Tree key={`t${i}`} {...t} />)}
      {buildings.map((b) => {
        const ring = selected === b.id ? <polygon points={rect({ x: b.x - 0.35, y: b.y - 0.35, w: b.w + 0.7, d: b.d + 0.7 })} fill="none" stroke={GLOW} strokeWidth={2} strokeDasharray="5 4" /> : null;
        const body = <>{ring}<Box b={b} /></>;
        const hover = { onMouseEnter: () => setActive(b.id), onMouseLeave: () => setActive((a) => (a === b.id ? null : a)), onFocus: () => setActive(b.id), onBlur: () => setActive((a) => (a === b.id ? null : a)) };
        return b.href
          ? <a key={b.id} href={b.href} onClick={go ? go(b.href) : undefined} className="ts-building" aria-label={[b.label, b.sub].filter(Boolean).join(' — ') || b.id} {...hover}>{body}</a>
          : <g key={b.id} className="ts-building" {...hover}>{body}</g>;
      })}
      {/* Labels last, so no roof covers one. A pinned label always shows; the rest show for the building under the pointer or the focus. */}
      {buildings.filter((b) => b.id !== active).map((b) => <Label key={`${b.id}:l`} b={b} on={false} />)}
      {buildings.filter((b) => b.id === active).map((b) => <Label key={`${b.id}:l`} b={b} on />)}
    </svg>
  );
}

/** The scene's styles: hover and focus show a building's label and lift its faces. Include once per page. */
export const SCENE_CSS = `
.ts-scene{display:block;width:100%;height:auto;border-radius:14px;font-family:inherit}
.ts-scene a{cursor:pointer;outline:none}
.ts-scene .ts-building:hover .ts-face,.ts-scene a.ts-building:focus-visible .ts-face{filter:brightness(1.22)}
.ts-scene a.ts-plate:hover polygon,.ts-scene a.ts-plate:focus-visible polygon{filter:brightness(1.5)}
.ts-scene .ts-label{opacity:0;pointer-events:none;transition:opacity .12s}
.ts-scene .ts-label.ts-on{opacity:1}
.ts-scene .ts-plate-label{pointer-events:none}
`;
