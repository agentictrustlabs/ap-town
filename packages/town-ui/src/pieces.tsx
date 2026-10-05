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
