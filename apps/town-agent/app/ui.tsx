import type { ReactNode } from 'react';
import { IsoScene, TownMap, type PlaceKind, type TownSceneV1 } from '@ap-town/town-scene';
import { Link, useRoute } from '@ap-town/town-ui';
import { glyphScene, lit, shapeOf } from './scenes';
import type { ServiceView } from './types';

export function Glyph({ kind, on = true, size = 44 }: { kind: PlaceKind; on?: boolean; size?: number }): ReactNode {
  return <span className="glyph" style={{ width: size, height: size }} aria-hidden="true"><IsoScene scene={glyphScene(kind, on)} bare /></span>;
}

export function Scene({ scene, legend }: { scene: TownSceneV1; legend?: string }): ReactNode {
  const { go } = useRoute();
  return <figure className="scene"><IsoScene scene={scene} onNavigate={go} />{legend && <figcaption>{legend}</figcaption>}</figure>;
}

export function Map({ scene, legend, height }: { scene: TownSceneV1; legend?: string; height?: number }): ReactNode {
  const { go } = useRoute();
  return <figure className="scene"><TownMap scene={scene} onNavigate={go} height={height ?? 520} />{legend && <figcaption>{legend}</figcaption>}</figure>;
}

export const HEALTH_WORD: Record<ServiceView['signals']['healthy'], string> = { up: 'up', self: 'up (this one)', down: 'down', unobserved: 'not probed' };

export function Health({ s }: { s: ServiceView }): ReactNode {
  return <span className="health"><span className={`dot dot-${s.signals.healthy}`} aria-hidden="true" /> {HEALTH_WORD[s.signals.healthy]}</span>;
}

export function ServiceCard({ s }: { s: ServiceView }): ReactNode {
  return (
    <Link href={`/service/${s.id}`} className="card">
      <span className="card-head"><Glyph kind={shapeOf(s)} on={lit(s)} /><span><span className="card-title">{s.id}</span><br /><span className="card-sub">{s.kind}{s.agentName ? ` · ${s.agentName}` : ''}</span></span></span>
      <span className="card-sub">{s.description}</span>
      <span className="card-foot"><Health s={s} />{s.hosts[0] && <span className="mono">{s.hosts[0]}</span>}</span>
    </Link>
  );
}
