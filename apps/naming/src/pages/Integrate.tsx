import type { ReactNode } from 'react';

const origin = typeof window === 'undefined' ? '' : window.location.origin;

function Code({ children }: { children: string }): ReactNode { return <pre className="code"><code>{children}</code></pre>; }

export function Integrate(): ReactNode {
  return (
    <>
      <section>
        <h1>Use names in your app</h1>
        <p className="lede">Five rules, in the order you will need them. They are the same whether you are a wallet, a Home or an app that only shows who did something.</p>
      </section>
      <section className="steps">
        <div>
          <h2>1. Show a name only when it points back</h2>
          <p>An agent picks the name it presents. That choice only counts when the name resolves to the same agent. The chain checks both in one call, so you never compare anything yourself. When there is no answer, show the address.</p>
          <Code>{`GET ${origin}/api/display/0x1dba4a27c53d7babda99513080223fb3bfc4bad1
→ { "address": "0x1dba…bad1", "name": "nathan.me", "block": 78610 }

// or, from the chain directly
import { AgentNamingClient } from '@agenticprimitives/agent-naming';
const name = await naming.reverseResolve(address);   // null → show the address`}</Code>
          <p className="quiet">Never show a name you only resolved forward. Anyone can point a name at somebody else’s address.</p>
        </div>
        <div>
          <h2>2. Accept a name wherever you accept an address</h2>
          <p>Treat any text with a dot, or with an @, as a possible name. Parse it, then resolve it with the type check on, so a name whose ending disagrees with the agent fails instead of resolving.</p>
          <Code>{`import { parseAgentName } from '@agenticprimitives/agent-naming';
const p = parseAgentName(input);              // throws with the rule broken
const r = await naming.resolveTyped(p.normalized);
if (!r) reject('not a valid name');           // unregistered, or the type disagrees
send(r.address);`}</Code>
        </div>
        <div>
          <h2>3. Say what it is from the chain, not from the ending</h2>
          <p>The ending names a type: .me a person, .org an organization, .svc a service. It is a claim. The agent’s own type record decides, and <span className="mono">checkTypedName</span> tells you why when they disagree.</p>
          <Code>{`GET ${origin}/api/name/missio-nexus.org
→ { "status": "registered", "typeCheck": { "ok": true }, "signals": { … } }`}</Code>
        </div>
        <div>
          <h2>4. Reach it through its records</h2>
          <p>A name’s records carry where the agent is: its A2A endpoint and its signed card. Read them; do not build a host from the name.</p>
        </div>
        <div>
          <h2>5. Four facts, never one score</h2>
          <p>Named, typed, listed and reachable are separate. None of them is permission. Whether an agent will act for you is a delegation it signs, checked on chain when you ask.</p>
          <ul className="plain">
            <li>Do not treat a name, or a listing, as a permission.</li>
            <li>Do not cache a resolution as if it were authority.</li>
            <li>Do not scan logs for names. Ask the resolver.</li>
            <li>Do not hardcode contract addresses. Read them from the deployment.</li>
          </ul>
        </div>
      </section>
      <section>
        <h2>The read API</h2>
        <p className="quiet">Public, read-only, cached for seconds. Every answer carries the block it was read at.</p>
        <table className="table">
          <thead><tr><th scope="col">Route</th><th scope="col">Answers</th></tr></thead>
          <tbody>
            <tr><th scope="row" className="mono">GET /api/display/0x…</th><td>The name to show for an address, or nothing.</td></tr>
            <tr><th scope="row" className="mono">GET /api/name/&lt;name&gt;</th><td>Status, the agent, records, the type check, the four signals, who can do what.</td></tr>
            <tr><th scope="row" className="mono">GET /api/address/0x…</th><td>The presented name, the declared type, every name held.</td></tr>
            <tr><th scope="row" className="mono">GET /api/search?q=</th><td>What the text is: a name, a label, an address, a host, or why it is none.</td></tr>
            <tr><th scope="row" className="mono">GET /api/root/&lt;ending&gt;</th><td>An ending and its names, paged.</td></tr>
            <tr><th scope="row" className="mono">GET /api/town</th><td>The chain, the estates and every ending.</td></tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
