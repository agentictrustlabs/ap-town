import type { ReactNode } from 'react';
import type { Loaded } from './api';

export function Loading<T>({ v, children, what = 'Reading' }: { v: Loaded<T>; children: (data: T) => ReactNode; what?: string }): ReactNode {
  if (v.state === 'loading') return <p className="loading" role="status">{what}…</p>;
  if (v.state === 'error') return <div className="banner banner-warn" role="alert"><strong>This could not be read.</strong> {v.error.detail ?? v.error.error}</div>;
  return <>{children(v.data)}</>;
}

export function Chip({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'muted' | 'free'; children: ReactNode }): ReactNode {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

/**
 * A SECTION HEAD. A small word saying what kind of thing this is, a big one saying which, an optional line of
 * explanation that keeps the prose measure, and room on the right for the one action the section affords.
 * Every section on a page using this reads as part of the same page.
 */
export function SectionHead({ eyebrow, title, children, action, id }: { eyebrow?: string; title: ReactNode; children?: ReactNode; action?: ReactNode; id?: string }): ReactNode {
  return (
    <div className="shead">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2 {...(id ? { id } : {})}>{title}</h2>
        {children && <p className="quiet">{children}</p>}
      </div>
      {action && <div className="shead-act">{action}</div>}
    </div>
  );
}

/** One figure in the band: what it counts, the count, and the words that keep it honest. */
export interface BandFigure { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'bad' }

/**
 * THE BAND — the handful of figures that answer "how is this doing?" before a word of the page is read.
 * It is a summary of what is already on the page, never a new claim: every figure here is also shown in full
 * further down, so the band can be skipped without losing anything.
 */
export function Band({ figures }: { figures: BandFigure[] }): ReactNode {
  if (!figures.length) return null;
  return (
    <div className="band">
      {figures.map((f) => (
        <div key={f.label} className="band-cell">
          <span className="band-label">{f.label}</span>
          <span className={`band-n${f.tone ? ` band-n-${f.tone}` : ''}`}>{f.value}</span>
          {f.sub && <span className="band-sub">{f.sub}</span>}
        </div>
      ))}
    </div>
  );
}

/** Nothing to show, said with the same care as something to show. */
export function Empty({ title, children }: { title: string; children?: ReactNode }): ReactNode {
  return <div className="empty"><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
