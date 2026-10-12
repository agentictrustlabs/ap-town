// THE MCP SERVERS, AS A LIST — spec 435 §5, shared by the town's /mcp page and each estate's page.
//
// WHAT EVERY ROW SAYS, AND WHY EACH LINE IS THERE.
//
//   exposure    whether there is a door and who it admits. The question a reader actually has is "can I call
//               this?", and the answer is almost always no — MCP is a PRIVATE capability interface behind an
//               admitted runtime (ADR-0057), so a page that listed endpoints without saying this would read
//               as an invitation to every one of them.
//   up          only where a probe is declared. `null` is NOT down: a binding-only server has no door to
//               knock on, and rendering that as a red dot would report healthy infrastructure as broken.
//   no tools    deliberately. A tool list belongs to a server's own SIGNED manifest (spec 435 §5 W1), read
//               from the registry, so a reader checks the server rather than the file somebody edited. A
//               tool list typed into a manifest is a claim by its editor, which is the one thing an
//               anti-rug-pull control must not be. Until that lands, the absence is stated.
import type { ReactNode } from 'react';
import { Chip, Empty, SectionHead } from '@ap-town/town-ui';
import type { McpServerRow } from '../types';

const EXPOSURE_WORDS: Record<McpServerRow['exposure'], string> = {
  binding: 'no door — only a Worker bound to it can reach it',
  authenticated: 'has a door; admits only an authenticated principal',
  open: 'has a door that answers an anonymous client, read-only',
};

function Door({ m }: { m: McpServerRow }): ReactNode {
  if (m.up === null || m.up === undefined) return <span className="quiet">not probed</span>;
  return <span className="quiet">{m.up ? 'answers' : `did not answer${m.status ? ` (${m.status})` : ''}`}</span>;
}

export function McpList({ servers, eyebrow, title, children }: {
  servers: McpServerRow[];
  eyebrow: string;
  title: string;
  children?: ReactNode;
}): ReactNode {
  return (
    <section>
      <SectionHead eyebrow={eyebrow} title={title}>{children}</SectionHead>
      {servers.length === 0 ? (
        <Empty title="It declares no MCP server.">
          That is a fact about this manifest, not about the deployment: an agent here may still serve a door of its
          own, and those are on the chain rather than in this file.
        </Empty>
      ) : (
        <ul className="plain">
          {servers.map((m) => (
            <li key={`${m.scale}:${m.estate ?? ''}:${m.id}`} className="panel" style={{ marginBottom: '.6rem' }}>
              <p style={{ margin: '0 0 .3rem' }}>
                <strong>{m.id}</strong>{' '}
                <Chip tone={m.exposure === 'open' ? 'warn' : m.exposure === 'binding' ? 'muted' : 'ok'}>{m.exposure}</Chip>{' '}
                {m.estate && <span className="quiet">· {m.estate}</span>}
                {m.serviceId && !m.estate && <span className="quiet">· the {m.serviceId} service</span>}
              </p>
              <p style={{ margin: '0 0 .3rem' }}>{m.description}</p>
              <p className="quiet" style={{ margin: 0 }}>
                {EXPOSURE_WORDS[m.exposure]}
                {m.url ? <> · <span className="mono break">{m.url}</span></> : null}
                {m.worker ? <> · Worker <span className="mono">{m.worker}</span></> : null}
                {' · '}<Door m={m} />
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="quiet">
        No tool list here. What tools a server offers is its own signed manifest&rsquo;s answer, read from the
        registry so a reader checks the server and not this file; that manifest is still to come (spec 435 §5).
        An endpoint is where a server listens &mdash; never that you may use it.
      </p>
    </section>
  );
}
