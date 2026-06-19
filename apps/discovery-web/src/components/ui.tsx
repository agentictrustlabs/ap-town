// Minimal control kit for demo-discovery (no UI framework — CSS lives in index.html).
import type { ReactNode } from 'react';

export function Pill({ kind, children }: { kind: 'ok' | 'err' | 'warn' | 'neutral'; children: ReactNode }) {
  return <span className={`pill pill-${kind}`}>{children}</span>;
}

export function StatusPill({ status, live }: { status: string; live?: boolean }) {
  if (status === 'active' && live !== false) return <Pill kind="ok">● active</Pill>;
  if (status === 'expired' || live === false) return <Pill kind="warn">○ {status === 'active' ? 'expired' : status}</Pill>;
  if (status === 'revoked') return <Pill kind="err">✕ revoked</Pill>;
  if (status === 'suspended') return <Pill kind="warn">⏸ suspended</Pill>;
  return <Pill kind="neutral">{status}</Pill>;
}

export function VerifyPill({ ok, reason }: { ok: boolean; reason?: string }) {
  return ok ? <Pill kind="ok">✓ verified</Pill> : <Pill kind="err">✕ {reason ?? 'invalid'}</Pill>;
}

export function Spinner() {
  return <span className="spinner" aria-label="loading" />;
}

export function short(hex: string, n = 6): string {
  if (!hex) return '—';
  if (hex.startsWith('sha256:')) { const h = hex.slice(7); return `sha256:${h.slice(0, n)}…${h.slice(-4)}`; }
  if (hex.startsWith('0x')) return `${hex.slice(0, 2 + n)}…${hex.slice(-4)}`;
  return hex;
}
