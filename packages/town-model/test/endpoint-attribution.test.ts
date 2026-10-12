// ATTRIBUTING AN ENDPOINT TO WHAT RUNS IT — and to the APP, not just the repository.
//
// The agent page shows an agent's `atl:mcpEndpoint` and `atl:a2aEndpoint` and says what serves each. Two
// gaps found live on people-groups.svc (2026-10-12):
//
//   · the MCP host was UNATTRIBUTED. `demo-gc-pg.r-pedersen.workers.dev` is a Worker in another repository
//     on another account, and nothing in the manifest declared it — so the page said, correctly and
//     uselessly, that the town declares nothing serving that host. The town does not guess; it is told.
//   · the A2A host attributed to a REPOSITORY ROOT. `*.faithnet.ai` resolves through the estate's lane to
//     `demo-a2a-faithnet`, which deploys from ap-home — a monorepo with half a dozen apps in it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { attributeEndpoint, parseTown, sourceUrlOf } from '../src/index';

const town = parseTown(readFileSync(new URL('../../../towns/faithchain/town.yaml', import.meta.url), 'utf8')).town!;

describe('endpoint attribution, down to the app', () => {
  it('a declared MCP server names its service, its Worker and its repository', () => {
    const a = attributeEndpoint(town, 'https://demo-gc-pg.r-pedersen.workers.dev/mcp');
    expect(a).toMatchObject({ how: 'mcp-server', mcpServerId: 'people-groups', serviceId: 'people-groups-mcp', repo: 'agentictrustlabs/ap-demos', worker: 'demo-gc-pg' });
    // THE REPOSITORY, NOT A DIRECTORY INSIDE IT. `app` is reserved for services ap-town deploys, where
    // `check:town` verifies `<app>/wrangler.toml` against disk. A path into somebody else's repository is a
    // claim this town cannot check and would keep asserting after they moved the directory.
    expect(a.app).toBeUndefined();
    expect(sourceUrlOf(a)).toBe('https://github.com/agentictrustlabs/ap-demos');
  });

  it("an agent's host under the estate zone names the Worker its lane serves it at", () => {
    const a = attributeEndpoint(town, 'https://people-groups-svc.faithnet.ai');
    expect(a).toMatchObject({ how: 'estate-zone', estate: 'faithnet', worker: 'demo-a2a-faithnet', repo: 'agentictrustlabs/ap-home' });
    expect(sourceUrlOf(a)).toBe('https://github.com/agentictrustlabs/ap-home');
  });

  it('an undeclared host is still unattributed, and says the town does not guess', () => {
    const a = attributeEndpoint(town, 'https://something-nobody-declared.workers.dev/mcp');
    expect(a.how).toBe('unattributed');
    expect(a.repo).toBeUndefined();
    expect(sourceUrlOf(a)).toBeNull();
    expect(a.note).toContain('does not guess');
  });

  it('a hostname that merely LOOKS like one of ours is not a declaration', () => {
    // `demo-gc-pg` is declared; `demo-gc-pg-staging` is a different host and nobody said anything about it.
    expect(attributeEndpoint(town, 'https://demo-gc-pg-staging.r-pedersen.workers.dev/mcp').how).toBe('unattributed');
  });

  it('what is not a URL is not attributed either', () => {
    expect(attributeEndpoint(town, 'people-groups.svc').how).toBe('unattributed');
  });
});
