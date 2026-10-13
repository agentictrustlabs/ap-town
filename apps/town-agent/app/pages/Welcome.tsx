// THE FRONT DOOR — what a stranger sees, and the only page they see (the owner's decision, 2026-10-13).
//
// Everything else in this portal reads the town's operational record: which services answer, what they metered,
// what they cost, what each estate's agents did. That is the town's own account of itself, and from here on it
// is for the people of the town. The API is gated too — a page behind a sign-in whose data answers anybody is
// not gated, it is decorated.
//
// WHAT THIS PAGE STILL SAYS, because a door nobody can read is not a door: what a town IS, what it holds, what
// it will never do, and how to come in. It names no service, reports no number and probes nothing — everything
// here is true of the town by its own design, not by today's readings.
import type { ReactNode } from 'react';
import { Link, SectionHead } from '@ap-town/town-ui';
import { ConnectButton } from '../Connect';
import type { TownData } from '../types';

export function Welcome({ t }: { t: TownData }): ReactNode {
  const estates = t.estates.map((e) => ({ id: e.id, home: e.home }));
  return (
    <>
      <section className="hero">
        <h1>The {t.town} town.</h1>
        <p className="lede">
          One chain, the estates on it, and the things they share: names, a registry, a public graph, skills, key
          custody, model access, chain access. Shared by all, owned by none.{' '}
          <strong>Nothing in a town grants anything</strong> — a name resolves, a registry lists, a graph holds what
          the chain can prove, a gateway meters. Whether you may act is your own delegation&rsquo;s business, and it
          is answered somewhere else.
        </p>
        <div className="welcome-act">
          <ConnectButton estates={estates} prominent />
          <span className="quiet">Sign in at your own Home. The town holds no account and never sees your credential.</span>
        </div>
      </section>

      <section>
        <SectionHead eyebrow="Why there is a door at all" title="This portal is the town's own account of itself">
          Which services are answering, what the two gateways metered, what the infrastructure costs, what each
          estate&rsquo;s agents did today. That is operational truth about a working deployment, so it is for the
          people of the town rather than for the internet. Connecting proves who you are; it gives you nothing.
        </SectionHead>
        <div className="cards">
          <article className="card"><span className="card-title">Find</span><span className="card-sub">Say what you need. The registry ranks the agents it knows by fit and by public evidence — relevance is not trust, and a listing is not a permission.</span></article>
          <article className="card"><span className="card-title">MCP</span><span className="card-sub">The tool servers this town knows, each pinned by the digest of a signed manifest. A runtime refuses what has drifted from it.</span></article>
          <article className="card"><span className="card-title">Pulse</span><span className="card-sub">Services, estates, Homes, inference, chain, applications, infrastructure and cost — every figure labelled with how current it can be, and a partial read left partial.</span></article>
          <article className="card"><span className="card-title">Ask</span><span className="card-sub">A question put to the town&rsquo;s own agent, answered from the records it keeps, with the records named. Counts, never a person.</span></article>
        </div>
      </section>

      <section>
        <SectionHead eyebrow="What a town will not do" title="Four signals, and never a score">
          Listed, healthy, compatible — three facts the town can check. The fourth, <em>authorized</em>, is never one
          of them: whether you may use a service is decided by your own delegation, checked by that service against
          the chain. The town cannot answer it and does not pretend to.
        </SectionHead>
        <p className="quiet">
          The public graph holds only what anyone could rebuild from the chain. The Pulse is counts, never a person:
          an estate reports numbers, and its people&rsquo;s records stay in their vaults. No estate is privileged.{' '}
          <a href="/.well-known/agent-card.json" rel="noreferrer">The town&rsquo;s own agent card</a> is public, because
          an agent nobody can resolve is not an agent.
        </p>
      </section>

      <section>
        <SectionHead eyebrow="If you have no Home here" title="Then this is not your town — yet" />
        <p className="quiet">
          An estate&rsquo;s Home is where a person signs in, holds their keys and keeps their records; the town is the
          shared infrastructure beneath several of them. Ask whoever runs the estate you belong to for an account,
          then come back and connect. If you came looking for a particular agent, its card and its door are public
          and do not need this portal at all — resolve its name and ask it directly.{' '}
          <Link href="/connected">Returning from a sign-in?</Link>
        </p>
      </section>
    </>
  );
}
