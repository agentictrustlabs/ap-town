/**
 * THE TOWN WITH A CAMERA — the same scene as IsoScene, but a MAP: drag to pan, wheel or pinch to zoom, double-press
 * to go in, buttons to fit and to step; labels live in screen space so their type stays one size at any zoom, and
 * the ones that would overlap are left out, most important first. Lifted from the field town (pokernight
 * `FieldTown.tsx`): the camera only rewrites one group's `transform`, set on the element directly, so a pan is one
 * attribute a frame however many buildings there are; what IS re-rendered on a camera move is the thin label layer.
 *
 * DETAIL FOLLOWS DISTANCE. Far away (lod 0): the streets and their names, pinned labels only. Mid (1): every
 * building's label that fits. Close (2): the same, with the second line.
 *
 * A BUILDING WITH AN HREF IS A LINK. A press that travelled is a pan, not a visit.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box, Tree, rect } from './draw';
import { GLOW, GROUND_LINE, INK, U, iso, shade } from './iso';
import { depthOf, type SceneBuilding, type ScenePlate, type TownSceneV1 } from './scene';

export interface Camera { tx: number; ty: number; k: number }
export type Lod = 0 | 1 | 2;
export const lodOf = (k: number): Lod => (k < 0.55 ? 0 : k < 1.1 ? 1 : 2);
const MAX_K = 2.2;

/** The camera that frames the scene's ground in a viewport, with a margin. */
export function fitCamera(scene: TownSceneV1, w: number, h: number, pad = 0.92): Camera {
  const pts: Array<{ x: number; y: number }> = [];
  for (const p of scene.plates) { pts.push(iso(p.x, p.y), iso(p.x + p.w, p.y), iso(p.x + p.w, p.y + p.d), iso(p.x, p.y + p.d)); }
  for (const b of scene.buildings) { pts.push(iso(b.x, b.y, b.h + 1.5), iso(b.x + b.w, b.y + b.d)); }
  if (!pts.length) return { tx: w / 2, ty: h / 2, k: 1 };
  const minX = Math.min(...pts.map((p) => p.x)); const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y)) - 1.2 * U; const maxY = Math.max(...pts.map((p) => p.y)) + 0.8 * U;
  const k = Math.max(0.05, Math.min(MAX_K, Math.min(w / (maxX - minX), h / (maxY - minY)) * pad));
  return { k, tx: w / 2 - ((minX + maxX) / 2) * k, ty: h / 2 - ((minY + maxY) / 2) * k };
}

interface ScreenLabel { id: string; sx: number; sy: number; text: string; sub?: string; w: number; kind: 'plate' | 'pill'; href?: string }

function labelTop(b: SceneBuilding): { x: number; y: number } {
  return iso(b.x + b.w / 2, b.y + b.d / 2, b.h + (b.roof === 'spire' ? 2.1 : b.roof === 'flat' || b.roof === 'slab' ? 0.5 : 1.1) + (b.flag ? 0.7 : 0));
}

export interface TownMapProps {
  scene: TownSceneV1;
  onNavigate?: (href: string) => void;
  selected?: string;
  className?: string;
  /** Height of the stage; the width is the container's. */
  height?: number | string;
}

export function TownMap({ scene, onNavigate, selected, className, height = 520 }: TownMapProps): ReactNode {
  const box = useRef<HTMLDivElement | null>(null);
  const world = useRef<SVGGElement | null>(null);
  const cam = useRef<Camera>({ tx: 0, ty: 0, k: 0.3 });
  const size = useRef({ w: 1000, h: 520 });
  const framed = useRef(false);
  const pending = useRef(false);
  const [view, setView] = useState<Camera>({ tx: 0, ty: 0, k: 0.3 });
  const [active, setActive] = useState<string | null>(null);

  const apply = useCallback((c: Camera) => {
    cam.current = c;
    world.current?.setAttribute('transform', `translate(${c.tx.toFixed(2)} ${c.ty.toFixed(2)}) scale(${c.k.toFixed(4)})`);
    if (pending.current) return;
    pending.current = true;
    requestAnimationFrame(() => { pending.current = false; setView(cam.current); });
  }, []);
  const limits = useCallback(() => ({ min: fitCamera(scene, size.current.w, size.current.h).k * 0.6, max: MAX_K }), [scene]);
  const zoomAt = useCallback((f: number, px: number, py: number) => {
    const c = cam.current; const lim = limits();
    const k = Math.max(lim.min, Math.min(lim.max, c.k * f));
    const wx = (px - c.tx) / c.k; const wy = (py - c.ty) / c.k;
    apply({ k, tx: px - wx * k, ty: py - wy * k });
  }, [apply, limits]);
  const fit = useCallback(() => apply(fitCamera(scene, size.current.w, size.current.h)), [apply, scene]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return;
      size.current = { w: r.width, h: r.height };
      if (!framed.current) { framed.current = true; fit(); }
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [fit]);
  useEffect(() => { framed.current = false; fit(); }, [scene, fit]);

  // Pointer events: capture on press, pan on move, and a press that never travelled is a click.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ moved: number; pinch: number | null } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => { const r = box.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    drag.current = { moved: drag.current?.moved ?? 0, pinch: pts.length === 2 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : null };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId) || !drag.current) return;
    const p = local(e); const prev = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, p);
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && drag.current.pinch) {
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      zoomAt(dist / drag.current.pinch, (pts[0]!.x + pts[1]!.x) / 2, (pts[0]!.y + pts[1]!.y) / 2);
      drag.current.pinch = dist; drag.current.moved += 10;
      return;
    }
    const dx = p.x - prev.x; const dy = p.y - prev.y;
    drag.current.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.current.moved > 4) apply({ ...cam.current, tx: cam.current.tx + dx, ty: cam.current.ty + dy });
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size) { drag.current = { moved: drag.current?.moved ?? 0, pinch: null }; return; }
    // Keep `moved` for the click that follows this pointer-up, then forget it.
    const moved = drag.current?.moved ?? 0;
    drag.current = null;
    lastMoved.current = moved;
  };
  const lastMoved = useRef(0);
  const onWheel = useCallback((e: WheelEvent) => { e.preventDefault(); const r = box.current!.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top); }, [zoomAt]);
  useEffect(() => { const el = box.current; if (!el) return; el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel); }, [onWheel]);
  const onDoubleClick = (e: React.MouseEvent) => { const p = local(e); zoomAt(1.8, p.x, p.y); };

  const go = (href: string) => (ev: React.MouseEvent) => {
    if (lastMoved.current > 5) { ev.preventDefault(); return; }
    if (!onNavigate || /^https?:\/\//.test(href) || ev.metaKey || ev.ctrlKey) return;
    ev.preventDefault(); onNavigate(href);
  };

  const lod = lodOf(view.k);
  const grounds = useMemo(() => scene.plates.filter((p) => !p.road).sort((a, b) => depthOf(a) - depthOf(b)), [scene]);
  const roads = useMemo(() => scene.plates.filter((p) => p.road), [scene]);
  const buildings = useMemo(() => [...scene.buildings].sort((a, b) => depthOf(a) - depthOf(b)), [scene]);

  // Labels in screen space: plates first, then pinned, then by nearness to the middle; the ones that would overlap
  // an earlier one are left out. The active (hovered or focused) building always gets its label.
  const labels = useMemo((): ScreenLabel[] => {
    const { w, h } = size.current;
    const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    const out: ScreenLabel[] = [];
    const want: Array<{ id: string; p: { x: number; y: number }; text: string; sub?: string; kind: 'plate' | 'pill'; href?: string; priority: number }> = [];
    for (const p of grounds) if (p.label) want.push({ id: `plate:${p.id}`, p: iso(p.x + p.w / 2, p.y + p.d + 0.9, 0), text: p.label, kind: 'plate', ...(p.href ? { href: p.href } : {}), priority: 100 });
    for (const b of buildings) {
      if (!b.label) continue;
      const on = b.id === active;
      if (!on && !b.pinned && lod === 0) continue;
      const top = labelTop(b);
      const sx = top.x * view.k + view.tx; const sy = top.y * view.k + view.ty;
      const near = -Math.hypot(sx - w / 2, sy - h / 2) / Math.max(w, h);
      want.push({ id: b.id, p: top, text: b.label, ...(b.sub && (lod === 2 || on) ? { sub: b.sub } : {}), kind: 'pill', ...(b.href ? { href: b.href } : {}), priority: on ? 200 : b.pinned ? 90 : 40 + near });
    }
    want.sort((a, b) => b.priority - a.priority);
    for (const l of want) {
      const sx = l.p.x * view.k + view.tx; const sy = l.p.y * view.k + view.ty;
      if (sx < -120 || sx > w + 120 || sy < -40 || sy > h + 40) continue;
      const text = l.text.length > 28 ? `${l.text.slice(0, 27)}…` : l.text;
      const lw = l.kind === 'plate' ? text.length * 8.4 + 8 : Math.max(44, text.length * 6.6 + 18);
      const r = l.kind === 'plate' ? { x0: sx - lw / 2, y0: sy - 8, x1: sx + lw / 2, y1: sy + 10 } : { x0: sx - lw / 2 - 2, y0: sy - 24, x1: sx + lw / 2 + 2, y1: sy + (l.sub ? 10 : -2) };
      if (l.priority < 200 && placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) continue;
      placed.push(r);
      out.push({ id: l.id, sx, sy, text, ...(l.sub ? { sub: l.sub } : {}), w: lw, kind: l.kind, ...(l.href ? { href: l.href } : {}) });
      if (out.length > 120) break;
    }
    return out;
  }, [grounds, buildings, view, lod, active]);

  const hover = (id: string) => ({ onMouseEnter: () => setActive(id), onMouseLeave: () => setActive((a) => (a === id ? null : a)), onFocus: () => setActive(id), onBlur: () => setActive((a) => (a === id ? null : a)) });

  return (
    <div ref={box} className={className ? `ts-map ${className}` : 'ts-map'} style={{ height }} data-lod={lod}>
      <svg className="ts-map-svg" role="img" aria-label={scene.title} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={onDoubleClick}>
        <title>{scene.title}</title>
        <g ref={world}>
          {grounds.map((p) => <polygon key={p.id} points={rect(p)} fill={shade(p.tone, -0.78)} stroke={shade(p.tone, -0.45)} strokeWidth={1.2} />)}
          {roads.map((p) => <polygon key={p.id} points={rect(p)} fill={p.tone} stroke={GROUND_LINE} strokeWidth={1} />)}
          {(scene.trees ?? []).map((t, i) => <Tree key={`t${i}`} {...t} />)}
          {buildings.map((b) => {
            const ring = selected === b.id ? <polygon points={rect({ x: b.x - 0.35, y: b.y - 0.35, w: b.w + 0.7, d: b.d + 0.7 })} fill="none" stroke={GLOW} strokeWidth={2} strokeDasharray="5 4" /> : null;
            const body = <>{ring}<Box b={b} /></>;
            return b.href
              ? <a key={b.id} href={b.href} onClick={go(b.href)} className="ts-building" aria-label={[b.label, b.sub].filter(Boolean).join(' — ') || b.id} {...hover(b.id)}>{body}</a>
              : <g key={b.id} className="ts-building" {...hover(b.id)}>{body}</g>;
          })}
        </g>
        {/* The label layer, in screen space. */}
        <g className="ts-map-labels" aria-hidden="true">
          {labels.map((l) => l.kind === 'plate'
            ? <text key={l.id} x={l.sx} y={l.sy} textAnchor="middle" fontSize={13} fontWeight={750} fill="#c8d4e8" letterSpacing=".04em" style={{ textTransform: 'uppercase' }}>{l.text}</text>
            : (
              <g key={l.id} className={l.href ? 'ts-map-pill ts-map-link' : 'ts-map-pill'} onClick={l.href ? go(l.href) : undefined}>
                <rect x={l.sx - l.w / 2} y={l.sy - 22} width={l.w} height={l.sub ? 30 : 18} rx={9} fill="#0b1424" stroke="#2a3b5c" strokeWidth={1} opacity={0.94} />
                <text x={l.sx} y={l.sy - 9.5} textAnchor="middle" fontSize={11} fontWeight={650} fill={INK}>{l.text}</text>
                {l.sub && <text x={l.sx} y={l.sy + 2.5} textAnchor="middle" fontSize={9} fill="#9fb0c9">{l.sub}</text>}
              </g>
            ))}
        </g>
      </svg>
      <div className="ts-map-controls" role="group" aria-label="Camera">
        <button type="button" onClick={() => zoomAt(1.5, size.current.w / 2, size.current.h / 2)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomAt(1 / 1.5, size.current.w / 2, size.current.h / 2)} aria-label="Zoom out">−</button>
        <button type="button" onClick={fit} aria-label="Fit the whole town">⤢</button>
      </div>
    </div>
  );
}

export const MAP_CSS = `
.ts-map{position:relative;width:100%;background:#0d1626;border-radius:14px;overflow:hidden;border:1px solid #1c2a44;touch-action:none;user-select:none}
.ts-map-svg{display:block;width:100%;height:100%;cursor:grab}
.ts-map-svg:active{cursor:grabbing}
.ts-map .ts-building:hover .ts-face,.ts-map a.ts-building:focus-visible .ts-face{filter:brightness(1.22)}
.ts-map a{outline:none}
.ts-map-pill{pointer-events:none}
.ts-map-pill.ts-map-link{pointer-events:auto;cursor:pointer}
.ts-map-controls{position:absolute;right:10px;bottom:10px;display:flex;gap:6px}
.ts-map-controls button{width:34px;height:34px;border-radius:9px;border:1px solid #2a3b5c;background:#0b1424;color:#e8eef7;font:600 16px/1 system-ui,sans-serif;cursor:pointer}
.ts-map-controls button:hover{background:#162238}
.ts-map[data-lod="0"] .ts-building{opacity:.96}
`;
