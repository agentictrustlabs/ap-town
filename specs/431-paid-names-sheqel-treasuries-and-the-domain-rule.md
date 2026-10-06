# Spec 431 — Paid names: a treasury of Sheqel per person, a price per name, and the domain rule

**Status:** Approved 2026-10-05 ("go with your recommendations and build all the waves"; §7 decided as recommended). W1 built (spec 432, Ring 0 PR #658); W2 and W3 built; W4 pending the deployer key (runbook: `operations/runbooks/431-priced-names-cutover.md`).
**Owner's brief (2026-10-05):** people "purchase" a name on the naming app from their Home treasury of Sheqel. Give
each person a treasury with 1,000 SHQ. Names cost SHQ by the name: `.me` and `.org` with fewer letters are more
expensive, everything under 50. A base name like `ibm` cannot be taken unless the person's Home holds a valid email at
`ibm.com` or `ibm.org` — which drives them to add an email recovery to their Home.
**Builds on:** spec 430 (the naming service reads; the Home signs), spec 429 D2 (nothing in the town grants), ADR-0061
(the suffix names the type), spec 283 (treasury service agent), the rule *assets live only in treasuries*
(spec 420: a balance on a person agent is ignored), spec 422 (the Security section: email is a channel, never custody),
ADR-0012 (no log scans in a read path), ADR-0013 (one mechanism).
**Amends:** spec 430 §1.2 said "no pricing on this chain". That was a description of the contracts as they were, not a
principle; this spec adds a price and says why it is still not a market (§1).

---

## 0. Decisions in one screen

| # | Decision |
| --- | --- |
| D1 | **A claim under a typed root costs Sheqel**, paid by the person's **treasury** to the town's naming treasury, in the same signed operation as the claim. One operation, one receipt; no claim without the payment, no payment without the claim. |
| D2 | **Every person has a treasury with 1,000 SHQ.** It is created with the person's Home (a birthright, like channel storage), funded by the open mint, and backfilled for every person who already has a Home. Sheqel is a test coin with an open mint; the 1,000 is play money that makes the purchase real in shape, not in value. |
| D3 | **The price is a pure function of the label and the ending** (§2), computed identically in the package, on the naming pages and in the contract. Short is dear; `.me` and `.org` cost more than the service endings; nothing costs 50 or more. |
| D4 | **A base name is protected by its domain.** If `<label>.com` or `<label>.org` exists in DNS, the label belongs to whoever can receive mail there: the claim needs a **verified email at that domain on the person's Home**. No email, no name — and the Home says so, and offers to add one. |
| D5 | **The Home issues the ticket; the contract checks it.** A claim carries a `ClaimTicketV1` signed by the estate's naming gate (a service key the Home holds in KMS). The gate signs only after the domain rule passes. The contract trusts a set of gate signers its governor names, one per estate. The town's naming service still holds no key (430 D2): it shows prices and the rule, and hands off. |
| D6 | **Still not a market.** No renewal fees, no expiry, no auctions, no resale, no premium decay. A name costs once, at claim, and is never released (the open subregistry's one-per-agent rule stays). A paid name is still an address card and still grants nobody authority. |
| D7 | **Legacy roots are closed.** `.impact` and `.agent` take no new claims. Scoped names (`x.svc@richcanvas.org`) are issued by their context and cost nothing beyond the context's own name. |

---

## 1. Why a price, and why this is not the market we refused

Spec 430 refused ENS's pricing because rent, premium decay and commit–reveal exist to run a market on a public chain.
A price here does something else: it makes a name a considered act, it gives every person a reason to hold a treasury
and see a receipt, and it is the hook for the domain rule, which is the real point — a person who wants `ibm.me` must
first prove they are IBM's, and the way to prove it is the Home's email channel. So the price is a **product
mechanism**, paid in a test coin with an open mint. Nothing in D1–D7 creates scarcity, transfer, or resale.

## 2. The price

Sheqel (`SHQ`, 6 decimals, open mint, `0xa14E…6141` on faithchain — pokernight's coin). Prices are whole SHQ.

**Base by ending** (what the ending names decides the base; a person's and an organization's name carry the most):

| Ending | Names | Base |
| --- | --- | --- |
| `.me` | a person | 8 |
| `.org` | an organization | 12 |
| `.church` | a church | 6 |
| `.team` | a team | 6 |
| `.svc` | a service | 10 |
| `.registry` | a registry | 20 |
| `.workspace` · `.treasury` · `.circle` · `.household` | plumbing and small bodies | 4 |

**Multiplier by label length** (the label is the part before the dot; three is the minimum):

| Length | × |
| --- | --- |
| 3 | 4 |
| 4 | 3 |
| 5 | 2 |
| 6–7 | 1.5 |
| 8 and up | 1 |

`price = min(49, round(base × multiplier))`. Examples:

| Name | Base × multiplier | Price |
| --- | --- | --- |
| `bob.me` | 8 × 4 | 32 |
| `ibm.org` | 12 × 4 | 48 |
| `nathan.me` (6) | 8 × 1.5 | 12 |
| `alice2.treasury` (6) | 4 × 1.5 | 6 |
| `missio-nexus.org` (12) | 12 × 1 | 12 |
| `discovery.registry` (9) | 20 × 1 | 20 |
| `ap.registry` would be 3 letters | 20 × 4 = 80 | 49 (the cap) |

With 1,000 SHQ a person can afford every name they could legitimately hold (one per ending), and the three-letter
`.org` at 48 is the dearest thing on the chain. The table is data (`packages/town-model` → `naming-price.ts`, mirrored
in the contract's constructor), so the owner can retune it without a redeploy of anything but the table.

## 3. The domain rule

A label is **protected** when `<label>.com` or `<label>.org` exists in DNS — any A, AAAA, MX or NS record — at the
moment the ticket is asked for. The check is a DNS-over-HTTPS lookup the Home's gate makes (a public fact anyone can
reproduce), cached for a day, and the ticket records which domain matched.

To claim a protected label, the person's Home must hold a **verified email** whose domain is that domain or a
subdomain of it: `nathan@ibm.com`, `nathan@mail.ibm.org`. The Home already verifies email by code and records the
facet for the signed-in agent (`/connect/email/verify`, keyed by `sha256(email)`); the gate reads that facet and
compares the domain. Nothing about the email leaves the Home: the ticket carries the label and a `domain` the gate
vouched for, never the address.

What the person sees:

- On the naming service, a protected free name says so: *"ibm is a domain. To claim ibm.me you need a verified email
  at ibm.com or ibm.org on your Home."* — with the price beside it.
- At the Home, the hand-off note says the same and links **Security → Add an email** (spec 422); once verified, the
  claim form unlocks. A person with a matching email already sees nothing but the price.
- A label that is nobody's domain is claimed as today, for its price.

The rule protects *domains*, not *brands*: `coca-cola` is protected because `coca-cola.com` resolves; a made-up word
is not. It is deliberately narrow — a public, reproducible fact, never a list someone curates.

## 4. The flow

1. **Price and rule, shown.** `names.faithnet.io` shows the price on every free name (search rows, the name page, the
   root page) and whether the label is protected, computed with the same function the contract uses.
2. **Hand-off.** "Open your Home" carries `claim`, `tld`, `return` (430 N2).
3. **The treasury.** The Home finds the person's treasury (created at onboarding, or on the spot if a person predates
   this spec — §5 W2). The purchase shows the treasury's balance and the price.
4. **The ticket.** The Home asks its gate (`POST /connect/naming/ticket`, session-gated) for a `ClaimTicketV1`
   `{ chainId, subregistry, label, tld, owner: <person SA>, payer: <treasury SA>, price, domain|null, expiry, nonce }`,
   signed (EIP-712) by the estate's **naming gate key** in KMS. The gate refuses a protected label without a matching
   verified email (`402`-shaped answer: `{ refused: 'domain', domain, need: 'a verified email at …' }`).
5. **One signed operation.** The person, as custodian of their treasury, signs one user operation from the
   **treasury**: `SHQ.approve(subregistry, price)` then `PricedSubregistry.claim(label, owner, ticket, sig)`. The
   contract: verifies the gate signature and the ticket's fields against the call; pulls `price` SHQ from
   `msg.sender` (the treasury, which must equal `ticket.payer`) to the root's fee treasury; registers
   `label.<tld>` with `owner`; records `claimedBy[owner]`, `paid[node] = price`, `paidAt[node]`. One claim per owner
   per root, as today.
6. **Receipt.** The treasury's own ledger shows the payment (the Treasury playbook's receipt rule), the naming service
   shows *purchased for N SHQ on <date>* from the contract's storage (no log scan), and the Home sends the person back
   to the name's page.

The town's naming treasury (`naming.treasury`, a treasury agent custodied by the town operator) receives every fee;
its balance is public and the town's Operations page shows it. Fees buy nothing; they are the sink that makes the
purchase real.

## 5. Waves

| Wave | Where | What | Done when |
| --- | --- | --- | --- |
| **W1** | Ring 0 | **Spec 432** (the contract) + `PricedSubregistry.sol` under `packages/contracts/src/naming/`: `claim(label, owner, ticket, sig)`, the price table in storage (governor-settable), gate signers per estate (governor-settable), `paid`/`paidAt`, `claimedBy[owner]`; `priceOf(label, tld)` as a pure function in `@agenticprimitives/agent-naming` with the table as data; `ClaimTicketV1` typed data in `agent-naming`; tests. Deployed to faithchain by the deployer (generation note in `deployments-faithchain.json`). | Contract tests green; deployed; `priceOf` published |
| **W2** | ap-home | The treasury birthright: a person's Home creates a treasury at onboarding and mints 1,000 SHQ into it (labelled as the demo faucet); `scripts/backfill-431-treasuries.mts` for every existing person home (demo personas by `demo-signin`; social sign-ins on next visit). The naming gate (`/connect/naming/ticket`) with the DNS check and the email-facet rule; the purchase ceremony from the treasury on the naming page and on a persona's naming page; the hand-off note's domain line linking Security → Add an email. | A demo persona buys `label.me` from the naming service's hand-off, the treasury's ledger shows the payment, and a protected label is refused until an email at that domain is verified |
| **W3** | ap-town | Prices and the protected flag on search rows, name pages and root pages (`naming-price.ts` in `town-model`, the DNS check in the naming Worker for display); *purchased for* on a name page; the town's naming treasury on Operations. | Every free name shows its price; `ibm.me` says what it needs |
| **W4** | faithchain | Switch each typed root's subregistry to the priced one (`registry.setSubregistry`, by the root owner — the deployer key); close the legacy roots (`setSubregistry(root, 0)` with the owner issuing nothing). Seed the town's naming treasury. | A free claim is no longer possible under a typed root; the old names are untouched |

W1 and W4 touch the chain and W2 mints a coin into sixty-odd treasuries; none starts without the owner's go.

## 5.1 W5 — Register: connect at the naming service, then a name for yourself or for a new agent

**Owner's brief (2026-10-06):** the naming service gets a *connect* capability so register is easy. Register always
leads to connect (a nameless Home at first), and then the person sets their default name, or adds a second agent
with a name — an organization, a service, or a second person persona like the gaming apps make — with the Home's
part as minimal as it is for organizations and services today.

**Shape.** `names.faithnet.io` becomes a **relying app of the Home** (spec 295 `connect-client`, the way Gather27 and
the field app are): a *Connect* button, a session under the person's `ask-as-me` standing, the person's name and
agents read through it. It still signs nothing and holds no key: every purchase and every charter is a ceremony at
the Home, reached by a hand-off that carries the whole intent and returns.

| Step | At the naming service | At the Home |
| --- | --- | --- |
| **Register** | One button on a free name and on the home page. Not signed in → *Connect* (the Home's front door: Google, email, passkey; a new person gets a nameless Home and comes straight back). | The front door, unchanged. |
| **Your name** | Signed in and nameless → the chosen name is the person's own: *Buy `<label>.me` for N SHQ*. Hand-off `?claim=<label>&tld=me&return=…`. | The purchase card with the label filled in (W2); one tap, two signatures; back to the name page. |
| **A second agent** | Signed in → *Register `<label>.<tld>` as a new agent I keep*: an organization, a service, a team, a church, a circle, a household — or a **second person** (a persona, as the gaming apps charter one). Hand-off `?charter=<kind>&claim=<label>&tld=<tld>&return=…`. | A new ceremony page: create the agent (`createAgentWithBirthrights`, its treasury born with it), fund the treasury (the person's treasury pays the fee for its new agent's name — or the new treasury's birthright does), buy and present the name, return. The Home's part is the signatures and nothing else. |
| **Afterwards** | The name page shows the new agent; *Your agents* on the naming service lists what the connected person holds. | The agent appears under Stewardship as any managed agent does. |

**Rules kept.** The suffix is the type (D4): the register button offers a kind, and the kind decides the ending —
never a free suffix. A second person persona is a second agent the person custodies (ADR-0010: a distinct Smart
Agent), never a second name on the same agent. The domain rule applies to the new agent's label as to any other
(§3), proven by the custodying person's verified email. Nothing the naming service holds authorizes anything: its
session lets it read as the person; the Home's signatures do the rest.

**Waves.** W5a: `connect-client` in `apps/naming` (Connect, session, *Your agents*), the Register button with the
kind picker, the hand-off that carries `charter`. W5b: the Home's charter-and-buy ceremony page
(`/naming/register`), including the second-person persona. W5c: *Your agents* and *bought for* on the naming
service read through the session.

## 6. What this does not do

- **No transfer market.** A paid name is still one per agent per ending, never released, never resold.
- **No refunds and no rent.** The fee is final; nothing expires.
- **No price on scoped names or on legacy roots** (D7).
- **No brand list.** Protection is DNS existence, nothing else (§3).
- **No email leaves the Home.** The ticket says `domain`, the contract stores nothing about it.
- **No authority.** A purchase changes what an agent is called, not what it may do (430 D3).

## 7. Decisions taken at approval (the recommendations)

1. **The table in §2** — the bases and the length multipliers, with the 49 cap. Retune now or ship and adjust?
2. **Who gets a treasury automatically.** Every person home at onboarding (recommended), or only on first purchase?
3. **The 1,000 SHQ on backfill** for the ~69 people already on the chain, from the open mint — fine as a demo faucet?
4. **Closing the legacy roots** (`.impact`, `.agent`) to new claims in W4, or leave them open and free.
5. **Protected-label check breadth:** `.com` and `.org` only (as asked), or also `.net`, `.io`, `.ai`.

## Reference: smart-agent patterns to port

smart-agent (branch `003-intent-marketplace-proposal`) charges nothing for names and has no treasury-per-person; its
payment rail is the intent marketplace's escrow. Ported from it: the one-operation-with-receipt shape (payment and
effect in one signed act). Deliberately different: a signed ticket from the estate's gate as the contract's
precondition — smart-agent has no notion of a Home vouching for a person's email, and no domain rule.
