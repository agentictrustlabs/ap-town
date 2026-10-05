// Drawing one thing: a building (three faces, windows, a roof, a flag, a trim, figures), a tree, a figure. Shared by
// the fitted scene (IsoScene) and the map with a camera (TownMap). Lifted from the field town, unchanged in its look.
import type { ReactNode } from 'react';
import { GLOW, INK, U, iso, pt, shade } from './iso';
import type { SceneBuilding, SceneTree } from './scene';

export const rect = (p: { x: number; y: number; w: number; d: number }, z = 0): string => `${pt(p.x, p.y, z)} ${pt(p.x + p.w, p.y, z)} ${pt(p.x + p.w, p.y + p.d, z)} ${pt(p.x, p.y + p.d, z)}`;

export function Pawn({ x, y, tone, s = 1 }: { x: number; y: number; tone: string; s?: number }): ReactNode {
  return (
    <g>
      <ellipse cx={x} cy={y + 2 * s} rx={8 * s} ry={3.6 * s} fill="#000" opacity={0.35} />
      <rect x={x - 5 * s} y={y - 15 * s} width={10 * s} height={14 * s} rx={5 * s} fill={tone} stroke="#0b1830" strokeWidth={1} />
      <circle cx={x} cy={y - 20 * s} r={5 * s} fill={shade(tone, 0.45)} stroke="#0b1830" strokeWidth={1} />
    </g>
  );
}

export function Tree({ x, y, s }: SceneTree): ReactNode {
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

export function Box({ b }: { b: SceneBuilding }): ReactNode {
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

