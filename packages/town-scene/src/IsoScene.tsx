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
import { GLOW, GROUND, GROUND_LINE, INK, U, iso, pt, shade } from './iso';
import { depthOf, type SceneBuilding, type ScenePlate, type SceneTree, type TownSceneV1 } from './scene';

const rect = (p: { x: number; y: number; w: number; d: number }, z = 0): string => `${pt(p.x, p.y, z)} ${pt(p.x + p.w, p.y, z)} ${pt(p.x + p.w, p.y + p.d, z)} ${pt(p.x, p.y + p.d, z)}`;

function Pawn({ x, y, tone, s = 1 }: { x: number; y: number; tone: string; s?: number }): ReactNode {
  return (
    <g>
      <ellipse cx={x} cy={y + 2 * s} rx={8 * s} ry={3.6 * s} fill="#000" opacity={0.35} />
      <rect x={x - 5 * s} y={y - 15 * s} width={10 * s} height={14 * s} rx={5 * s} fill={tone} stroke="#0b1830" strokeWidth={1} />
      <circle cx={x} cy={y - 20 * s} r={5 * s} fill={shade(tone, 0.45)} stroke="#0b1830" strokeWidth={1} />
    </g>
  );
}

function Tree({ x, y, s }: SceneTree): ReactNode {
  const b = iso(x, y); const h = 24 * s;
  return (
    <g>
      <ellipse cx={b.x + 2} cy={b.y + 2} rx={7 * s} ry={3.4 * s} fill="#000" opacity={0.25} />
      <line x1={b.x} y1={b.y} x2={b.x} y2={b.y - h * 0.4} stroke="#6b4a2b" strokeWidth={2 * s} />
      <polygon points={`${b.x - 8 * s},${b.y - h * 0.35} ${b.x + 8 * s},${b.y - h * 0.35} ${b.x},${b.y - h}`} fill="#2e8b6a" />
      <polygon points={`${b.x},${b.y - h * 0.35} ${b.x + 8 * s},${b.y - h * 0.35} ${b.x},${b.y - h}`} fill="#1f6149" />
    </g>
  );
}

function Box({ b }: { b: SceneBuilding }): ReactNode {
  const { x, y, w, d, h } = b;
  const base = b.tone;
  const top = shade(base, 0.36); const left = shade(base, 0.02); const right = shade(base, -0.32);
  const roofL = shade(base, -0.1); const roofR = shade(base, -0.42);
  const out: ReactNode[] = [];
  out.push(<polygon key="sh" points={`${pt(x + 0.12, y + d + 0.04)} ${pt(x + w + 0.5, y + d + 0.04)} ${pt(x + w + 0.5, y + d + 0.4)} ${pt(x + 0.12, y + d + 0.4)}`} fill="#000" opacity={0.26} />);
  out.push(<polygon key="l" points={`${pt(x, y + d)} ${pt(x + w, y + d)} ${pt(x + w, y + d, h)} ${pt(x, y + d, h)}`} fill={left} className="ts-face" />);
  out.push(<polygon key="r" points={`${pt(x + w, y + d)} ${pt(x + w, y)} ${pt(x + w, y, h)} ${pt(x + w, y + d, h)}`} fill={right} className="ts-face" />);
  out.push(<polygon key="t" points={`${pt(x, y, h)} ${pt(x + w, y, h)} ${pt(x + w, y + d, h)} ${pt(x, y + d, h)}`} fill={top} className="ts-face" />);
  if (b.trim) {
    out.push(<polygon key="tl" points={`${pt(x, y + d, 0.04)} ${pt(x + w, y + d, 0.04)} ${pt(x + w, y + d, 0.22)} ${pt(x, y + d, 0.22)}`} fill={b.trim} />);
    out.push(<polygon key="tr" points={`${pt(x + w, y + d, 0.04)} ${pt(x + w, y, 0.04)} ${pt(x + w, y, 0.22)} ${pt(x + w, y + d, 0.22)}`} fill={shade(b.trim, -0.3)} />);
  }
  // Windows: lit where somebody is home.
  const rows = Math.max(1, Math.min(4, Math.floor(h / 0.5)));
  const win = b.lit ? GLOW : '#1b2740';
  for (let r = 0; r < rows; r++) {
    const z0 = 0.26 + r * 0.46; const z1 = Math.min(h - 0.08, z0 + 0.24);
    if (z1 <= z0) continue;
    const nL = Math.max(1, Math.round(w * 1.6)); const nR = Math.max(1, Math.round(d * 1.6));
    for (let i = 0; i < nL; i++) { const t0 = (i + 0.28) / nL; const t1 = (i + 0.72) / nL; out.push(<polygon key={`wl${r}${i}`} points={`${pt(x + w * t0, y + d, z0)} ${pt(x + w * t1, y + d, z0)} ${pt(x + w * t1, y + d, z1)} ${pt(x + w * t0, y + d, z1)}`} fill={win} opacity={b.lit ? 0.92 : 0.7} />); }
    for (let i = 0; i < nR; i++) { const t0 = (i + 0.28) / nR; const t1 = (i + 0.72) / nR; out.push(<polygon key={`wr${r}${i}`} points={`${pt(x + w, y + d * (1 - t0), z0)} ${pt(x + w, y + d * (1 - t1), z0)} ${pt(x + w, y + d * (1 - t1), z1)} ${pt(x + w, y + d * (1 - t0), z1)}`} fill={shade(win, -0.28)} opacity={b.lit ? 0.9 : 0.7} />); }
  }
  const rh = Math.max(0.35, Math.min(0.75, h * 0.6));
  if (b.roof === 'gable' || b.roof === 'spire') {
    const r0 = pt(x, y + d / 2, h + rh); const r1 = pt(x + w, y + d / 2, h + rh);
    out.push(<polygon key="g1" points={`${pt(x, y, h)} ${pt(x + w, y, h)} ${r1} ${r0}`} fill={shade(base, 0.12)} />);
    out.push(<polygon key="g2" points={`${pt(x, y + d, h)} ${pt(x + w, y + d, h)} ${r1} ${r0}`} fill={roofL} />);
    out.push(<polygon key="g3" points={`${pt(x + w, y + d, h)} ${pt(x + w, y, h)} ${r1}`} fill={roofR} />);
  }
  if (b.roof === 'dome') {
    const c = iso(x + w / 2, y + d / 2, h); const rx = w * U * 0.62; const ry = rx * 0.5;
    out.push(<ellipse key="d0" cx={c.x} cy={c.y} rx={rx} ry={ry} fill={roofR} />);
    out.push(<path key="d1" d={`M ${c.x - rx} ${c.y} A ${rx} ${rx * 0.9} 0 0 1 ${c.x + rx} ${c.y} Z`} fill={shade(base, 0.2)} />);
    out.push(<path key="d2" d={`M ${c.x - rx * 0.55} ${c.y - rx * 0.72} A ${rx * 0.9} ${rx * 0.8} 0 0 1 ${c.x + rx * 0.2} ${c.y - rx * 0.86}`} fill="none" stroke={shade(base, 0.6)} strokeWidth={2} opacity={0.7} />);
  } else if (b.roof === 'spire') {
    const tw = Math.min(0.5, w * 0.34); const tx = x + w - tw - 0.05; const ty = y + d - tw - 0.05; const th = h + rh + 0.55;
    out.push(<polygon key="tl2" points={`${pt(tx, ty + tw)} ${pt(tx + tw, ty + tw)} ${pt(tx + tw, ty + tw, th)} ${pt(tx, ty + tw, th)}`} fill={shade(base, 0.08)} />);
    out.push(<polygon key="tr2" points={`${pt(tx + tw, ty + tw)} ${pt(tx + tw, ty)} ${pt(tx + tw, ty, th)} ${pt(tx + tw, ty + tw, th)}`} fill={shade(base, -0.3)} />);
    const apex = iso(tx + tw / 2, ty + tw / 2, th + 0.85);
    out.push(<polygon key="sl" points={`${pt(tx, ty + tw, th)} ${pt(tx + tw, ty + tw, th)} ${apex.x.toFixed(1)},${apex.y.toFixed(1)}`} fill={roofL} />);
    out.push(<polygon key="sr" points={`${pt(tx + tw, ty + tw, th)} ${pt(tx + tw, ty, th)} ${apex.x.toFixed(1)},${apex.y.toFixed(1)}`} fill={roofR} />);
    out.push(<path key="x" d={`M ${apex.x} ${apex.y} v ${-U * 0.5} M ${apex.x - U * 0.16} ${apex.y - U * 0.34} h ${U * 0.32}`} stroke={INK} strokeWidth={2} strokeLinecap="round" />);
  } else if (b.roof === 'slab') {
    out.push(<polygon key="s" points={`${pt(x - 0.1, y - 0.1, h + 0.14)} ${pt(x + w + 0.1, y - 0.1, h + 0.14)} ${pt(x + w + 0.1, y + d + 0.1, h + 0.14)} ${pt(x - 0.1, y + d + 0.1, h + 0.14)}`} fill={shade(base, 0.5)} />);
  }
  if (b.flag) {
    const m = iso(x + 0.25, y + 0.25, h); const mt = iso(x + 0.25, y + 0.25, h + 1.0);
    out.push(<line key="pole" x1={m.x} y1={m.y} x2={mt.x} y2={mt.y} stroke={INK} strokeWidth={2} />);
    out.push(<path key="flag" d={`M ${mt.x} ${mt.y} l ${U * 0.62} ${U * 0.16} l ${-U * 0.62} ${U * 0.2} Z`} fill={shade(b.flag, 0.25)} />);
  }
  for (let i = 0; i < Math.min(3, b.figures ?? 0); i++) {
    const p = iso(x + w + 0.28 + i * 0.3, y + d - 0.1, 0);
    out.push(<Pawn key={`f${i}`} x={p.x} y={p.y} tone={shade(base, 0.2)} s={0.8} />);
  }
  return <>{out}</>;
}

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
