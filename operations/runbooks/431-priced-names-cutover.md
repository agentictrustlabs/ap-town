# Runbook — priced names cut-over (spec 431 W4)

One forge run and three config changes. The deployer key (the faithchain root owner, `0x1fcd…03bF`) is supplied by
the owner in the shell for the run and never written to a file.

## 1. Deploy the priced subregistries and close the legacy roots

```
cd ~/agenticprimitives/packages/contracts
# a WRITE-capable gateway token for the run (minted for it; deleted after):
#   wrangler kv key put --namespace-id efc60d50844441b5b585873605b1888b "t:<sha256(token)>" '{"app":"ap-town-deploy","readRps":20,"writeRps":5}'
DEPLOYER_ADDRESS=0x1fcd93189311bedE20a02592cC83f31199A303bF \
AGENT_NAME_REGISTRY=0x60E949D52660A9D4143ecB0fdA56c0457f20aED9 \
AGENT_NAME_RESOLVER=0xa5855906C0De3813E74BEe201973071e0c844115 \
COIN=0xa14E4a9447607c1233DcE34dB6Ead47C094f6141 \
FEE_TREASURY=<the town's naming treasury; the deployer until one exists> \
GATE=0x640D577Bcb3fd860743ED315620085704c1483E9 \
forge script script/AddPricedSubregistries.s.sol:AddPricedSubregistries \
  --rpc-url "https://rpc.faithnet.io/?k=<token>" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --legacy
```

It prints `.<tld> -> <priced subregistry>` per root. Then:

## 2. Record the addresses

- `packages/contracts/deployments-faithchain.json`: add `pricedSubregistries` (the printed map), `namingFeeTreasury`,
  `namingCoin: { address, symbol: "SHQ", decimals: 6 }`. Keep `permissionlessSubregistries` (old names still resolve).
  Changeset → release → bump the `contracts` pin in ap-town and ap-home.
- The Home (Vercel `faithnet-home`, production): `NEXT_PUBLIC_CONTRACTS_JSON` = the updated document (the Home reads
  `pricedSubregistries` from it); `NAMING_GATE_PRIVATE_KEY` is already set (the gate above).
- ap-town: nothing to set — the naming Worker reads the deployment from the pinned `contracts` package.

## 3. Verify

- `names.faithnet.io/name/<free>.me` shows a price and (for a domain label) the rule.
- A demo persona buys a name from the hand-off; `names.faithnet.io` shows *bought for N SHQ*; the treasury's ledger
  shows the payment; the town page shows the fee treasury's balance.
- A free claim under a typed root is refused by the chain (the open subregistry is no longer the root's).

## 4. Roll back

`registry.setSubregistry(root, <old permissionless subregistry>)` per root, by the deployer. Names bought stay.
