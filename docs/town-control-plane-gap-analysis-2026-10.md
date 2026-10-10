# The town as a control plane — gap analysis against the field (2026-10)

**Companion to** [spec 434](../specs/434-ap-model-gateway-and-the-town-pulse.md) (models, spend, the Pulse) and
[spec 435](../specs/435-town-governance-plane-standing-estate-picture-mcp-catalog.md) (who and what: standing, the
estate picture, the MCP catalog, the admin lens). **Method:** each product's own documentation first, trade coverage
second; a claim we could not verify from the vendor's pages is marked *(unverified)*. Dated 2026-10-10; this field
moves monthly, so every row carries the date it was read.

## 0. The one-line verdicts

| Product | What it is | Verdict for the town |
| --- | --- | --- |
| **Prediction Guard** (control plane) | a self-hosted "control plane that runs inside your infrastructure beside your agents": sovereign control over agent behaviour, supply chain, observability, audit and cost; an OpenAI-, Anthropic- and MCP-compatible API on top; human and agent identities tracked; runtime controls that "enforce agent behavioral policies without human or agentic users needing to make the right decisions"; an Agent Control Kit on Docker Hub | the closest single analogue to 434 + 435 together. We match the gateway, the MCP integration, the identity tracking and the audit; we differ on WHOSE record it is (theirs: a tenant's central log; ours: receipts in the owner's vault, identity as a chain address) and on where credentials live (their proxy holds them; our holder's connector record does). Adopt: the **estate manifest export** (an AIBOM analogue) and a one-screen **quarantine**. |
| **Microsoft Agent 365 + Entra Agent ID** | a shared agent registry across platforms (AWS Bedrock, Vertex, Databricks, Salesforce surfaced in one list); an agent moves from unmanaged to managed by getting an Entra identity; **sponsors** and owners distinct from registry ownership, with sponsor-transfer lifecycle workflows; Conditional Access for agents today = identity-level allow/block on agent risk; licensing gates governance | the "shadow agent" column and the sponsor role are the two ideas worth taking. Our steward IS their sponsor — but ours is a countersigned, revocable, expiring credential (435 `TownStanding`), not an IdP attribute. Adopt: **standing certification campaigns** driven by expiry. |
| **Okta Agent Gateway** (research release) + Cross App Access | an identity-native proxy between agents and MCP servers: every tool call carries a credential naming both the agent and the user, RFC 8693 token exchange, delegation links + resource connections that define exactly which tools are exposed, the agent never sees downstream credentials, one audit trail; XAA as the enterprise-managed authorization extension for MCP; Agent-to-Agent Connections with an auditable handoff chain | we match and exceed on the wire: a session wire names agent, delegate key, skill selector and target, and the mandate carries the intent digest (spec 336/372). Our gap is *saying it*: the catalog and receipt pages should show "ran under wire X, selector Y" the way their audit trail does. |
| **AWS Bedrock AgentCore Gateway + Policy** | tools as first-class resources; Cedar permit/forbid evaluated in ENFORCE mode before routing each tool call against the caller's JWT claims; denied tools hidden at discovery; Lambda interceptors for custom authorization; MCP 2026-07-28 support; multi-account | the same two-layer idea (hide at discovery, refuse at call) we run as `composeOfferedTools` + the per-step verifier. Their policy is attribute-based on a JWT; ours is a signed mandate per step. Adopt: **discovery-time filtering made visible** on the catalog page (what this principal would even be offered). |
| **Kong Konnect MCP Registry + AI Gateway** | the registry catalogues MCP servers beside their APIs with ownership and inherited policy (announced 2026-02; technical preview per one source); unauthorized tools hidden at discovery; plugin-based tool ACLs; **tool bundles** | adopt **tool bundles** as a town-published connector set a steward attaches in one act (435 §6). |
| **Obot** (curated MCP catalog) | a curated, searchable directory of approved MCP servers with live documentation, capabilities and IT-verified **trust levels**; per-user OAuth; **rug-pull detection**; policy-as-code | adopt **trust level on catalog entries** computed from public facts (manifest signed by the SA, probe green, admission current) and **manifest-digest pinning** as the anti-rug-pull control, surfaced on the catalog page (435 §5). |
| **LiteLLM** (OpenAI-format proxy) | 100+ providers; **virtual keys**, budgets, spend tracking, rate limits per key/team; retries, fallbacks, load balancing; self-hosted (MIT core, enterprise features licensed) | the closest analogue to 434's gateway core. Our app key is their virtual key; our per-principal × profile limits are their key budgets. Differ: their key is the identity; ours maps to a Service SA and (later) a session wire. Adopt nothing new; confirm parity on the limits table (§2). |
| **Portkey** | config-driven routing (fallback, load balancing, retries as data), guardrails, every request attributed to feature/user/model in a dashboard; 1,600+ models | **routing as data** is exactly 434's profile record; their attribution dashboard is 434's Inference panel. Differ: attribution there is a tag the caller sends; here it is the principal the gateway proved plus an asserted agent kept separate. |
| **Cloudflare AI Gateway** | managed; caching, rate limits, spend limits, cost analytics, model fallback, dynamic routing; ~20 providers; unified billing | the lightest option and the one our Workers sit beside. Not adopted as the gateway: it has no principal model beyond an account, and receipts would not be ours. Named as a possible upstream cache in front of a provider adapter, later. |
| **MCP gateway field generally** (agentgateway, Lunar, Maxim, NeuralTrust, Speakeasy write-ups) | the consensus split: a **registry** is the system of record for approval, owner and version; a **gateway** is the runtime enforcement point for authn, per-tool policy, credential exchange and telemetry; tool annotations are server metadata, not trust | our shape already: registry-kit as record, the runtime + `tool-policy` as enforcement, the holder's connector record for credentials. The field's gap we share: SIEM / OpenTelemetry export — spec 390 spans exist, no exporter runs in production. Say so on the lens; do not pretend. |

## 1. The two control planes, side by side

| Capability | Field consensus | Town today (2026-10-10) | After 434 | After 435 |
| --- | --- | --- | --- | --- |
| Agent identity | tenant record / IdP object (Entra, Okta) or a proxy-issued key (PG, LiteLLM) | ERC-4337 Smart Agent address; typed name on chain | unchanged | unchanged |
| Owner / sponsor | an attribute on the record (Entra sponsor; PG identity tracking) | custodian public on chain; steward a PRIVATE vault credential (ADR-0025) | unchanged | opt-in **joint `TownStanding` attestation** publishes steward; revocable by either party; expires |
| Shadow / unmanaged column | "Has Agent ID: No" (Entra); unregistered agents (PG) | none | none | the **standing checklist** per agent (custody · steward disclosed · admission · card · endpoint · manifest · expiry) |
| Registry of record | Entra Agent Registry; Kong MCP Registry; Obot catalog | registry-kit admission receipts; `town.yaml` for services | `town.yaml` row for `inference` + client records | **MCP catalog** = registry query over `mcp` surfaces with signed manifests |
| Model gateway | OpenAI-compatible endpoint (PG, LiteLLM, Portkey, CF) | five Workers call providers directly | `inference.svc`: contract + OpenAI-compatible door | unchanged |
| Virtual keys / budgets | per key / team (LiteLLM); spend limits (CF) | `SpendWindow` in one Worker, TPM only | app key → Service SA; per principal × profile tokens/USD/rpm/concurrency; reserve → settle | unchanged |
| Routing as data | Portkey configs; LiteLLM router | `routeProvider` code | **profiles** (ordered models, fallback classes, privacy) as vault records with versions | unchanged |
| Fallback | automatic (all) | forbidden (388) | **declared + receipted** within a profile | unchanged |
| Kill switch | PG runtime controls *(unverified: named kill switch)*; Entra block on risk | model: edit five configs; wire: revoke on chain | **model catalog switch** empties every profile at once | **quarantine**: registry `suspended` + wire revocation from one screen, dispatched to Home |
| Per-tool policy | Cedar (AWS), plugins (Kong), per-tool RBAC (field) | `tool-policy` + per-step mandate verifier | unchanged | unchanged; **trust level** and **manifest pin** on the catalog |
| Credential custody for tools | the proxy holds them (PG, Okta, AWS token isolation) | the holder's `connector.mcp:` record, envelope-encrypted under the holder's SA | unchanged | unchanged (stated as the difference) |
| Discovery-time filtering | hide denied tools (AWS, Kong) | `composeOfferedTools` narrows the offer | unchanged | shown on the catalog page per principal |
| Audit | central immutable log (PG); unified trail (Okta) | receipts + `run.provenance` in the OWNER's vault; OTel spans without an exporter | **inference receipts** in `inference.svc`'s vault, `receiptRef` in provenance | tool-call receipts rendered "ran under wire X" (later) |
| Topology / live view | PG live topology; Entra registry views | `/operations` snapshot | **Pulse**: sampled history, estates, homes, inference | **estate picture**: agents with A2A · MCP · playbook badges, lit by standing |
| SBOM / AIBOM | PG supply chain *(unverified: AIBOM export)*; VeriGuard AI-BOM | none | model profile versions on every receipt | **estate manifest export**: agents, card digests, playbook digests, connector manifest digests, profile versions |
| Certification / review | Entra access reviews, sponsor lifecycle workflows | none | none | **re-attest list** from `TownStanding` expiry |
| Confused deputy | credential names agent + user (Okta); Cedar on JWT (AWS) | wire names agent + delegate key + selector + target; mandate carries the intent digest | principal proved by the gateway; `context.agent` asserted and kept separate | unchanged |
| SIEM / OTel export | yes (field) | no exporter | no | no — named as the shared gap |

## 2. Limits parity (434 §5 against LiteLLM's key budgets)

| LiteLLM virtual key | 434 entitlement (per principal × profile) |
| --- | --- |
| `max_budget` (USD) | `microUsdPerDay` |
| `tpm_limit` / `rpm_limit` | `tokensPerDay` (coarser: the day is the window the receipts roll on) + `requestsPerMinute` |
| `max_parallel_requests` | `concurrency` |
| `models` allow-list | `profiles` (a principal is entitled to profiles, never to models) |
| team / user attribution | principal (proved) + `assertedAgent` (evidence) |
| key expiry | the client record's `validUntil`; the session wire's expiry for class (b) |

Not adopted: per-key model allow-lists (a profile is the unit), key-level spend alerts (the Pulse shows utilisation; alerts
are §13 later).

## 3. What we keep different, on purpose

1. **Identity is an address, not a record.** A tenant can delete a record; nobody can delete an address, and a stranger can
   verify who custodies it. This is the thesis (ADR-0010) and the reason the town can list without granting (429 D2).
2. **Receipts live with the owner, not the operator.** An estate that leaves the town takes its runs, receipts and
   provenance with it (spec 323, ADR-0055). The town's `HeartbeatDO` and `BudgetDO` are caches of that truth.
3. **Credentials for tools stay with the holder.** A proxy that holds every credential is one breach from every tool.
   The holder's connector record under the holder's mandate is the per-act boundary.
4. **Authority is a signature per step, not an attribute at the gate.** Cedar on a JWT and Conditional Access on an
   identity decide once at the door; the per-step verifier re-verifies the mandate against the intent digest every time.
5. **No score.** Four separate signals (429 D7), a standing checklist and a trust level that is computed and displayed,
   never stored as authority and never merged into one number.

## 4. Sources (read 2026-10-10)

- Prediction Guard: https://predictionguard.com/ · https://predictionguard.com/build-agents
- Microsoft: https://learn.microsoft.com/en-us/entra/agent-id/agent-registry-convergence ·
  https://learn.microsoft.com/en-us/training/modules/establish-agent-identities-entra-agent-id/ ·
  https://techcommunity.microsoft.com/blog/microsoftmechanicsblog/microsoft-entra-agent-id-explained/4494408 ·
  https://guardz.com/blog/the-anatomy-of-entra-agent-id/
- Okta: https://developer.okta.com/docs/concepts/agent-gateway/ ·
  https://www.okta.com/blog/product-innovation/okta-agent-gateway-runtime-security/ ·
  https://www.okta.com/newsroom/press-releases/ai-innovations-oktane-2026/
- AWS: https://aws.amazon.com/blogs/machine-learning/how-agentcore-gateway-supports-the-mcp-2026-07-28-spec/ ·
  https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/use-gateway-with-policy.html
- Kong / Obot / field: https://obot.ai/blog/the-13-best-mcp-gateways-for-enterprise-teams/ ·
  https://www.speakeasy.com/blog/best-mcp-gateways-for-enterprise-2026 · https://neuraltrust.ai/blog/best-mcp-gateways ·
  https://agentic-community.github.io/mcp-gateway-registry/ ·
  https://developer.microsoft.com/blog/securing-mcp-a-control-plane-for-agent-tool-execution/
- LLM gateways: https://dupple.com/learn/best-llm-gateways · https://zuplo.com/learning-center/best-ai-gateway-buyers-guide ·
  https://contabo.com/blog/litellm-vs-ai-gateways/
