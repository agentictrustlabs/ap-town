// WHITE-LABEL CONFIG for this registry deployment (ADR-0021: vertical vocabulary lives in the app, never in a package).
// The words a person in THIS community uses for a capability, mapped to the word the declared ids are built from. The
// resolution rule itself is generic (`capability-resolution.ts`); this table is the one vertical thing it consumes.
export const CAPABILITY_SYNONYMS: Record<string, string> = {
  'study plan': 'curricula',
  'study plans': 'curricula',
  'study materials': 'curricula',
  'study material': 'curricula',
  'course': 'curricula',
  'courses': 'curricula',
  'curriculum': 'curricula',
  'bible study': 'bible study',
  'theological training': 'theological training',
};
