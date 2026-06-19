// Custody membership tokens for the knowledge base (ADR-0040).
//
// Custodian/passkey membership is PUBLIC on-chain data (the CustodianAdded/PasskeyAdded event logs), so it
// is permitted in the world-readable A-box. We store it as an OPAQUE, but PUBLIC + UNSALTED + on-chain-
// REPRODUCIBLE hash — never a plaintext `agent → custodian` edge (which would be a turnkey control-graph
// index) and never a secret/peppered hash (which would not be on-chain-reproducible, violating ADR-0040).
//
//   token = sha256( lower(credential) | lower(smartAgent) )
//
// `credential` is the on-chain custody identifier a viewer can present for THEMSELVES: an EOA custodian
// address, the passkey-PIA, or a passkey credentialIdDigest. Anyone with the chain can recompute and verify
// any token (it's public); but you cannot enumerate "who custodies agent X" from the graph — the membership
// node carries no link back to the agent, only the hash. The discovery MCP answers custody with an exact-
// match ASK (yes/no), never a SELECT-list. The MCP MUST compute this identically (see demo-discovery-mcp).
import { sha256, stringToBytes, type Hex } from 'viem';

export const CUSTODY_GRAPH = 'urn:ap:custody';
export const CUSTODY_MEMBER_CLASS = 'https://agenticprimitives.dev/ns/core#CustodyMember';

export function custodyToken(credential: string, smartAgent: string): Hex {
  return sha256(stringToBytes(`${credential.toLowerCase()}|${smartAgent.toLowerCase()}`));
}

export const custodyMemberIri = (token: Hex): string => `urn:ap:cm:${token}`;
