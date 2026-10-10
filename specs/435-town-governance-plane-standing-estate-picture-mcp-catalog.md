# Spec 435 — The Town Governance Plane: standing · the estate picture · the MCP catalog · the admin lens

**Status:** DRAFT 2026-10-10 (owner's brief: "following best industry practices and alignment with other products in
this space … a gap analysis with Prediction Guard and other leading products that provide a 'town'-like context control
plane"; first assessment `~/.cursor/plans/town_governance_plane_a91d43a3.plan.md`). **Owner:** ap-town (the data plane,
the portal, the admin lens) · Ring 0 (`attestations`, `agent-resolution`, `registry-kit`, `context`, `discovery`, the
ontology) · ap-home (the ceremonies). **Frame:** [spec 436](436-home-estate-town-federation-the-four-contexts.md) (the estate as the key context; the
estate picture here is the public face of the estate console's Residents column, and the admin lens at the town is a
lens on that console). **Companion:** [spec 434](434-ap-model-gateway-and-the-town-pulse.md) owns models
and spend; this spec owns *who* and *what*. **Field comparison:**
[docs/town-control-plane-gap-analysis-2026-10.md](../docs/town-control-plane-gap-analysis-2026-10.md).
**Depends on:** 429 (D2, D7), ADR-0025 (related-agent links are private), ADR-0040 (the KB holds chain-derivable facts),
ADR-0056 / spec 338 (resolution is not authority; the sequenced service publication), spec 404 (MCP connectors),
spec 353 (app-scoped Ask), spec 406 (operator view), ADR-0057 (MCP is private, absent from cards), the
`AttestationRegistry` (joint attestations, `schemaId`, `refUID`), `@agenticprimitives/attestations`.

---

## 0. Decisions in one screen

| # | Decision |
| --- | --- |
| S1 | **The agent ↔ steward ↔ custodian bridge is three public facts, none of them authority.** Custodian = who can make this agent act (public on chain already). Chartered-under = whose service or treasury this is (public when consented). Steward = who oversees it — published **only by an opt-in joint attestation** both the agent and the steward sign: `TownStanding`. |
| S2 | **ADR-0025 is amended, not broken.** The default stays private. `TownStanding` is the person's consent to be named, revocable by either party, expiring. A town UX reads it as evidence; no gate reads it. |
| S3 | **Estate membership is derived from public bindings, never asserted by the town.** Attested when a live `TownStanding` names the estate; *inferred* (labelled so, never promoted) when the name sits under the estate's `nameRoots` or the A2A host is the estate's. |
| S4 | **MCP strategy: the registry is the record, the runtime is the enforcement point, the attach is the holder's act.** Town-shared and estate MCPs publish an `mcp` surface with a **signed tool manifest**; per-agent attachments stay spec 404 records pinned by manifest digest; a drifted manifest is refused at call time. |
| S5 | **"Available to an agent" = catalog entry exists AND the agent's vault holds a connector record for it.** The town shows the first to anyone and the second only to the steward, by reference. |
| S6 | **The admin lens never copies private state.** The steward signs in through Home; private legs are read by reference under the person's grant; every action is an intent posted to the steward's Home Ask under a `town-portal` scope and parks for signature like any act. |
| S7 | **Risk is the absence of a birthright, computed from public facts.** The standing checklist is our "shadow agent" column; the steward lens adds the private legs. Never a score. |
| S8 | **Adopted from the field, named:** trust level on catalog entries (computed, displayed, never stored as authority) · manifest-digest pinning as the anti-rug-pull control · tool bundles a steward attaches in one act · quarantine from one screen · the estate manifest export (an AIBOM analogue) · certification campaigns driven by standing expiry · "ran under wire X" on receipts. |

---

## 1. What exists today

**Public, on chain:** custody membership (`CustodianAdded` / `PasskeyAdded`, `isCustodian`; ADR-0040 lets the KB hold
it as an opaque `ap:CustodyMember`); org ↔ org relationship edges including `CHARTERED_UNDER` (`ap:charteredUnder`,
consent-gated); name records `atl:agentType`, `atl:a2aEndpoint`, `atl:mcpEndpoint`, `atl:cardUri`,
`atl:capabilities`; the `AttestationRegistry` (EAS-aligned: unilateral and **joint** attestations, `schemaId` as an
opaque tag, `refUID` as a back-pointer, epoch-bucketed, holder or either-party revoke) with the credential types in
`@agenticprimitives/attestations` (`Association`, `Evidence`, `Outcome`, `Validation`, `TrustUpdate`, `JointAgreement`,
`PaymentReceipt`, `CapabilityEndorsement`); spec 338's sequenced `AgentServicePublicationV1` with its
`ServiceSurfacePublicationV1[]` (surfaceId · protocol · uri · exposure · audience · securityRequirements ·
transportKeyBinding · endpointControlProof); registry-kit admission receipts.

**Private, by rule:** stewardship (person → org/service) is a vault credential "never published by default" (ADR-0025;
`deriveStanding` in `@agenticprimitives/context`); playbooks (`archetype.assignment`); attached MCPs
(`connector.mcp:<id>`, spec 404, tool kinds declared by the holder); MCP tool lists — "MCP endpoints appear in no Agent
Card" (ADR-0057).

**Town UX:** `/agent/:id` renders registry facts, offerings and the live card; `/service/:id` renders the `town.yaml`
row and probes; an estate is a `town.yaml` card; no custodian, steward, attestation or MCP section; `discovery-mcp`
serves `check_custody`, `get_trust_fabric`, `get_agent`, `get_offerings`, `list_agents_by_context`, `list_names`,
`lookup_agents`, `search_agents`, `describe_term`, `list_shapes`; the town agent's A2A skills are `town.describe` and
`town.service`. No town MCP catalog, no estate roster.

**Home:** `/estate`, `/trust-graph` (the private managed-agent tree), `/apps/tools` (the connectors card),
`/attestations` (WEA only), an organization's operations over `/harness/ops`. No screen publishes or lists
`AttestationRegistry` rows.

---

## 2. The picture

```
PUBLIC GROUND (chain + the town's KB)                       ESTATE HOME (private lens)
  custody events ──► ap:CustodyMember                          stewardship credential + wire
  CHARTERED_UNDER edges                                        connector.mcp:<id> records + tool-policy
  atl: records · released card                                 archetype.assignment (playbook)
  TownStanding joint attestation  ◄── publish-standing ceremony (Home: sign as agent under custody, countersign as steward)
  MCP surface publication: endpoint + signed tool-manifest digest
  town registry: admission receipt · lifecycle status
        │                                                             │ by reference, under the person's grant
        ▼                                                             ▼
AP-TOWN PORTAL   /estate/:id · /agent/:id Standing · /mcp        /estate/:id/admin  (steward signed in via Home)
                 — anyone                                        acts → the steward's Home Ask (town-portal scope) → parks for signature
TOWN AGENT       A2A skills town.estate · town.standing · town.mcp over the same public reads
```

---

## 3. `TownStanding` — the joint attestation (S1, S2)

A new `CREDENTIAL_TYPE.TownStanding` (`hashName('TownStandingCredential')`) issued through the registry's joint-
attestation path: party[0] = the agent SA, party[1] = the steward SA, `schemaId = keccak256("ap:TownStanding:v1")`,
`refUID` = the town registry admission receipt UID (so a standing cannot outlive its listing), epoch-bucketed as every
attestation is, revocable by either party.

```ts
interface TownStandingV1 {                      // the off-chain VC body; its hash is the credentialHash on chain
  town: string;                                 // 'faithchain'
  estate: string;                               // 'faithnet'
  agent: Address; steward: Address;
  surfaces: { a2a?: string; mcp?: string; card?: string };     // what the steward vouches is this agent's
  capabilityIds?: string[];
  issuedAt: string; validUntil: string;         // campaign-style: expiring, re-attested
}
```

Who signs: the agent, under its custody (the same custodian ceremony that signs any act of the agent), and the
steward, as themself. One person often holds both signatures — the custodian of a service and its steward are
frequently the same person — and the ceremony keeps the two roles legible (the person–org rule): it says "signing as
`ligonier.svc` under your custody" and then "countersigning as `ruth.me`, its steward", never one click.

What it is for: a town UX reads it as evidence that someone answers for this agent; the Pulse and the estate picture
show "steward disclosed"; the certification campaign (§8) reads its expiry. **No gate reads it**: `mayOverseeAgent` at
Home still derives standing from the private credential and the wire; an attestation that lapses changes a chip, not an
authority. ADR-0025's rule "person ↔ org is never public by default" stands; this is the opt-in, revocable exception
the ADR's amendment names.

The agent's own copy of the VC is a vault record `town.standing:<uid>` (so a Home can show and renew it without the KB).

---

## 4. The estate picture (S3)

`estateOf(agent, townManifest, publicBindings)` in `@agenticprimitives/context`, over public reads only:

| Rule | Result | Shown as |
| --- | --- | --- |
| a live `TownStanding` names `estate` | attested | solid chip |
| the typed name sits under the estate's `nameRoots` in the town's registry | inferred | hollow chip, "inferred from its name" |
| `atl:a2aEndpoint` host = the estate's `a2a` host | inferred | hollow chip, "inferred from its endpoint" |
| none | unplaced | listed under "not placed" |

Inferred never promotes to attested. Ontology: `apctx:Town` and `apctx:Estate` as contexts (`prov:Entity`, like
`aporg:Workspace`); `ap:inEstate` with the comment "derived from public bindings, never authority"; `apexec:estate` on
runs stays as it is.

`/estate/:id` (anyone): agents grouped person / org / service, each with A2A · MCP · playbook badges (playbook = the
digest the agent's released card pins, never the assignment record), standing chips (custody *n*, steward disclosed or
not, admission current, card released), attested vs inferred membership, and the isometric scene lighting houses by
standing. Counts come from the public graph; names from the registry; nothing from any vault.

---

## 5. The MCP catalog (S4, S5)

**Publication.** Spec 338's `ServiceSurfacePublicationV1` gains, for `protocol: 'mcp'`, two fields:
`toolManifestDigest` (keccak256 of the canonical manifest) and `toolManifestUri`. The manifest
(`McpToolManifestV1 { server: { name, version, protocolVersion }, tools: [{ name, description, inputSchemaDigest,
kindHint? }], issuedAt }`) is signed by the service's SA (ERC-1271) and carries no secrets. A town-shared MCP
(discovery-mcp, discovery-connector, a future one) and an estate MCP (the vault's, a content catalog on a `.svc`) publish
the same way; the catalog is a **registry query** over `mcp` surfaces, not a YAML.

**Trust level** (computed per entry at read time, displayed, never stored, never a score):

| Level | Facts |
| --- | --- |
| town-verified | manifest signature verifies against the SA · probe green · admission current · standing disclosed |
| listed | admission current, one of the others missing (which one is shown) |
| unverified | published surface, no admission |

**Pinning.** A holder's attach (spec 404, unchanged) compiles the `ToolSpec`s and records the manifest digest on
`connector.mcp:<id>`. At call time the runtime compares the served manifest's digest to the pinned one; a drift is
**refused** with the reason — never re-fetched, never silently re-compiled (ADR-0013). Re-attach is the explicit act,
and the admin lens makes it one click. This is the anti-rug-pull control, and the catalog page says so beside the digest.

**Bundles.** A town-published `mcp.bundle:<id>` (a list of catalog entries + a suggested tool policy) a steward attaches
to an agent in one act (`connector.bundle.attach`, risk high, under the holder's mandate). The bundle is a convenience
over spec 404; each attach still writes its own connector record and pin.

**Discovery-time filtering, shown.** For a signed-in steward, the catalog page can show, per agent of theirs, which
entries that agent would even be offered (`composeOfferedTools` over its playbook) — the AWS/Kong "hide at discovery"
idea, made visible rather than silent.

`/mcp` (anyone): town-shared and per-estate catalog with trust level, manifest digest and time, tools (names and
descriptions only), and an "attach at Home" hand-off that carries the entry id to the steward's Home.

---

## 6. The admin lens (S6)

`/estate/:id/admin`, the steward signed in through Home (`@agenticprimitives/connect-client`, relying app
`town-portal`; the Home's session, never a town session). Three rules:

1. **Reads are by reference under the person's grant.** Standing is `deriveStanding` on the Home side, exposed through
   `/connect/*`; connectors (`connector.mcp:*` with pinned digests and the tool-policy summary), the playbook digest,
   vault-key and grant freshness come from `/harness/ops` at estate scope (spec 406). The town renders; it stores none
   of it (the vault-is-the-record rule).
2. **Acts are intents, not calls.** "Attach discovery-mcp to ligonier.svc", "publish standing for missio.org",
   "renew standing", "revoke this connector", "quarantine this agent" are posted to the steward's Home Ask with an
   `AskScopeV1` for `town-portal` (spec 353: scope is honesty, the mandate is authority). The harness parks for the
   signature as usual; the town shows the parked run and links to it.
3. **Nothing in the town decides.** A non-steward sees the public lens; the stewardship check is the Home's
   (`mayOverseeAgent` over the private credential and the wire), returned to the town as a yes/no per agent.

Panels: per-agent private legs (vault key bound · grant current · playbook assigned · connectors with pins) beside the
public checklist; the **re-attest list** (standings expiring within 30 days); **quarantine** (registry lifecycle →
`suspended` + revoke the agent's standing wires, two acts, one screen, dispatched to Home); **bundle attach**; the
**estate manifest export**.

**Estate manifest export** (the AIBOM analogue, S8): a signed JSON the steward can hand to an auditor — every agent of
the estate with its address, typed name, card digest, playbook digest, connector manifest digests, model profile
versions in force (from 434's receipts), standing UID and expiry, generation. Public facts plus the digests of private
ones; never the records themselves.

---

## 7. Ask skills

The town agent gains A2A skills over the same public reads: `town.estate` ("who is in faithnet, grouped"),
`town.standing` ("who answers for ligonier.svc"), `town.mcp` ("which MCPs does the town share; what tools does
discovery-mcp publish"). `discovery-mcp` gains `get_estate`, `get_standing`, `list_mcp_services`, `get_mcp_manifest`.

The steward's own Home Ask, under the `town-portal` scope, answers the private half: "agents in faithnet without a steward
disclosure", "attach discovery-mcp to ligonier.svc", "renew standing for missio.org" — harness acts under the steward's
standing, parked for signature.

---

## 8. The standing checklist and certification (S7, S8)

Per estate agent, from public facts: custody set ≥ 1 · steward disclosed (`TownStanding` live) · registry admission
current · card released · A2A endpoint answers · MCP manifest signed (when `atl:mcpEndpoint` is set) · standing not
expiring within 30 days. The steward lens adds: vault key bound · interactions grant current · playbook assigned ·
every connector pinned and unchanged. An absent leg is shown as the birthright it is (spec 433 §1.1), never as a number.

Certification: `TownStanding.validUntil` drives the re-attest list; a renewal is the same joint ceremony with a new
`validUntil`, the old attestation revoked by the agent in the same act. This is Entra's access-review idea with a
countersignature instead of a click.

---

## 9. Waves and gates

| Wave | Where | What | Gate |
| --- | --- | --- | --- |
| **W0** | ap-town · Ring 0 | this spec; ADR-0025 amendment (opt-in joint publication); spec 338 amendment (`mcp` surface fields); ontology `apctx:Town`, `apctx:Estate`, `ap:inEstate`, `apatt:TownStanding`, `apar:McpToolManifest`, `ap:StandingCheck`; vault bindings `town.standing:`, `mcp.manifest:`, `mcp.bundle:` | `check:ontology-bindings`; INDEX rows |
| **W1** | Ring 0 | `attestations`: `TownStandingV1`, `buildTownStandingJointRequest`, `verifyTownStanding` (both parties ERC-1271, unrevoked, unexpired, `refUID` admission current) · `agent-resolution`: `McpToolManifestV1`, surface fields, `pinManifest` / `verifyPinnedManifest` · `registry-kit`: catalog query over `mcp` surfaces + `trustLevel` · `context`: `estateOf`, `standingChecklist`, the `town-portal` `AskScopeV1` preset · `discovery` vocabulary `apdisc:inEstate`, `apdisc:hasTownStanding`, `apdisc:mcpManifestDigest` | package checks; a manifest drift is refused in a unit test; the joint request round-trips the registry's UID rule |
| **W2** | ap-home | the Standing page: publish / renew / revoke as a two-role ceremony; connectors exposed to the steward through `/connect/*` under grant; `/estate` gains the checklist and the manifest export; the runtime refuses a drifted manifest at call time | one real `TownStanding` on faithchain (ruth.me ↔ scripture-resolver.svc); a drifted test MCP is refused with the reason in the run |
| **W3** | ap-town | `discovery-indexer` projects standings, manifests, derived `inEstate` (the only writer, chain-derivable only — ADR-0040 holds: a standing is on chain, a manifest is a signed public document) · `discovery-mcp` tools · `town-model` `TownEstatePicture`, `AgentStanding`, `McpCatalogEntry` | the KB answers `get_standing` for the W2 attestation; reading the whole KB still reveals nothing the chain would not |
| **W4** | ap-town | `/estate/:id`, `/agent/:id` Standing section, `/mcp`, the three A2A skills; the scene lights by standing | the public pages render with no session; inferred and attested are visibly different |
| **W5** | ap-town · ap-home | `/estate/:id/admin` and the `town-portal` Ask scope: private legs by reference, re-attest list, quarantine, bundle attach, manifest export | a quarantine shows as two parked acts at Home; a non-steward gets the public lens only; the export verifies against the chain |

W1 can run beside 434's W1; W2 needs W1; W3–W5 need W2's first attestation to have something to show.

---

## 10. Not in v1 (named)

Tool-call receipts rendered on the catalog page ("ran under wire X, selector Y") · an OpenTelemetry exporter for the
lens (spec 390 spans exist; no exporter runs — the lens links to the gap, it does not pretend) · multi-estate towns ·
cross-town standing · client entitlement editing (434) · a second renderer for the scene.

---

## 11. Risks and open points

- **Two roles, one person.** The joint ceremony must not collapse custodian-of-the-service and steward into one press;
  the demo-person-org rule is the test.
- **Derived membership can be wrong** for agents hosted elsewhere; the label stays "inferred" and the portal never
  promotes it.
- **Pinning makes MCP server updates explicit re-attach acts.** That is the intended cost; the lens must make re-attach
  one click, and the town's own MCPs must publish a new manifest before they change a tool.
- **One indexer.** The projections live in ap-town's `discovery-indexer`; the ap-discovery fork must not grow a second
  implementation.
- **Privacy of the export.** The estate manifest carries digests of private records; a digest of a playbook is public-
  safe, a digest of a connector record names a server the steward attached — the export is the steward's to hand over,
  never published by the town.

---

## Reference: smart-agent patterns to port

From `/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`):

- **Attestation as the public, revocable statement of a relationship** — the registries there (`GrantProposalRegistry`,
  `GeoClaimRegistry`) keep the signed claim on chain and let indexers derive views; `TownStanding` is the same shape on
  our EAS-aligned `AttestationRegistry`, with the joint path so both parties sign.
- **Permissions previewed from the same table that enforces them** (`packages/sdk/src/permissions/build.ts`,
  `TOOL_POLICIES`): the standing checklist and the trust level are computed by the same functions the Pulse and the
  admin lens display — one source, two surfaces.
- **Scope lists on a session** (`scope.mcpTools`, `targets`, `selectors`): the per-tool allow-list a session carries is
  what our `tool-policy` + connector record + pinned manifest express; the divergence is that ours is anchored to a
  signed manifest digest, so the list cannot drift under the holder.
- **Deliberate divergence:** smart-agent publishes org relationships on chain by default; we keep person ↔ org private
  (ADR-0025) and publish stewardship only by the joint, expiring `TownStanding`, because a person's affiliations are
  theirs to disclose.
