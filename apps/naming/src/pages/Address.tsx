import type { ReactNode } from 'react';
import { useApi } from '../api';
import type { AddressView } from '../api-types';
import { Link, nameHref } from '../router';
import { addressScene } from '../scenes';
import { Banners, Chip, Copy, Glyph, Loading, Scene, Stamped } from '../ui';

export function AddressPage({ address }: { address: string }): ReactNode {
  const v = useApi<AddressView>(`/api/address/${address}`);
  return (
    <Loading v={v}>{(a) => (
      <>
        <section className="title">
          <Glyph kind={a.kind} lit={!!a.presented} size={72} />
          <div>
            <h1>{a.presented ?? 'No presented name'}</h1>
            <p className="title-addr"><span className="mono break">{a.address}</span> <Copy value={a.address} label="address" /></p>
            <p className="lede">{a.presented
              ? `Show this agent as ${a.presented}. The name points back at this address, checked on chain.`
              : a.isAccount ? 'Show this agent by its address. It presents no name that points back at it.' : 'There is no agent at this address.'}</p>
            <p className="quiet">{a.declared.agentType ? `It declares itself ${a.declared.noun ?? a.declared.agentType}${a.declared.serviceRole ? ` (role: ${a.declared.serviceRole})` : ''}.` : a.isAccount ? 'It has declared no type.' : ''}</p>
          </div>
        </section>
        <Banners banners={a.banners} />
        <section>
          <h2>Names it holds</h2>
          {a.held.length === 0 ? <p className="quiet">This address has claimed no name under any open ending in this town.</p> : (
            <>
              <Scene small scene={addressScene(a)} legend="One building per name this agent claimed. The lit one is the name it presents." />
              <ul className="rows">
                {a.held.map((h) => (
                  <li key={h.name} className="row">
                    <Glyph kind={h.kind} lit={h.presented} />
                    <span className="row-main"><Link href={nameHref(h.name)} className="row-name">{h.name}</Link><span className="row-sub">{h.presented ? 'the name it presents' : 'held, not presented'}</span></span>
                    {h.presented && <Chip kind="registered" />}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="quiet">An agent claims at most one name per ending, and a claim is never released.</p>
        </section>
        <Stamped s={a} />
      </>
    )}</Loading>
  );
}
