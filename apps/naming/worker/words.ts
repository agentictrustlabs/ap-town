// The words the naming service uses — one place, so the API, the app and the picture say the same thing.
import { derivedTypeForTld, isAgentTld, isLegacyTld } from '@agenticprimitives/agent-naming';
import { isPlaceKind, type PlaceKind } from '@ap-town/town-scene';

/** What a derived agent type is, as a visitor would say it. */
export const NOUN: Readonly<Record<string, string>> = {
  person: 'a person', household: 'a household', org: 'an organization', team: 'a team', church: 'a church', circle: 'a circle',
  service: 'a service', workspace: 'a workspace', treasury: 'a treasury', registry: 'a registry',
};

export function typeOfTld(tld: string | null): string | null {
  if (!tld || !isAgentTld(tld)) return null;
  return derivedTypeForTld(tld);
}

export function kindOfTld(tld: string | null): PlaceKind {
  const t = typeOfTld(tld);
  return t && isPlaceKind(t) ? t : 'legacy';
}

export const kindOfType = (t: string | null | undefined): PlaceKind => (t && isPlaceKind(t) ? t : 'legacy');
export const nounOfTld = (tld: string | null): string | null => { const t = typeOfTld(tld); return t ? NOUN[t] ?? null : null; };
export const isLegacy = (tld: string | null): boolean => !!tld && isLegacyTld(tld);

/** Why a string is not a name here — the grammar's refusal codes, in words. Unknown codes keep the grammar's own text. */
export const RULE_WORDS: Readonly<Record<string, string>> = {
  label_too_short: 'A name needs three characters or more before the dot.',
  unknown_tld: 'That ending is not one this town names agents under.',
  reserved_label: 'That word is reserved and cannot be a name.',
  structure: 'A name is label.type (nathan.me), or label.type@context (vault.svc@richcanvas.org).',
  context_depth: 'A scoped name has one context, not a chain of them.',
  context_type: 'Only an organization or a workspace can be the context after the @.',
  charset: 'A name uses lower-case letters, digits and hyphens only, with no hyphen at either end.',
  empty: 'Type a name, a label or an address.',
};

export const RECORD_LABEL: Readonly<Record<string, string>> = {
  addr: 'Points at', agentKind: 'Kind', displayName: 'Display name', description: 'Description',
  a2aEndpoint: 'A2A endpoint', mcpEndpoint: 'MCP endpoint', serviceUrl: 'Service', siteUrl: 'Site',
  cardUri: 'Agent card', cardDigest: 'Card digest', metadataUri: 'Metadata', metadataHash: 'Metadata digest',
  nativeId: 'Native id', appContext: 'App context', orgRole: 'Role', custodyPolicy: 'Custody policy',
  connectionKind: 'Sign-in method', connectionAddress: 'Sign-in hint', passkeyCredentialDigest: 'Passkey digest',
};
