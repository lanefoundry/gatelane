/**
 * Candidate types — any component swap in the agent's context that can be attacked.
 *
 * gatelane's promotion gate treats all 10 as first-class. The PromotionReport
 * carries the SHA of every candidate.
 *
 * @see docs/prd.md §5.3 — Candidate types table
 */
export type CandidateRef = {
  /** Discriminator + identifier. Format: `<type>:<id>[@<version>]`. */
  readonly ref: string;
  /** SHA captured in the PromotionReport. */
  readonly sha: string;
  /** Optional human-readable label for reports. */
  readonly label?: string;
};

export type CandidateType =
  | 'model'
  | 'prompt'
  | 'skill'
  | 'config'
  | 'tool'
  | 'eval'
  | 'kb'
  | 'memory'
  | 'dispatcher'
  | 'guardrail';

/** Parse a candidate ref string like `tool:mcp-server-foo@1.2.0` into type + id + version. */
export function parseCandidateRef(ref: string): {
  type: CandidateType;
  id: string;
  version?: string;
} {
  const colonIdx = ref.indexOf(':');
  if (colonIdx < 0) {
    throw new Error(`invalid candidate ref: ${ref} (expected <type>:<id>[@<version>])`);
  }
  const type = ref.slice(0, colonIdx) as CandidateType;
  const rest = ref.slice(colonIdx + 1);
  const valid: CandidateType[] = [
    'model',
    'prompt',
    'skill',
    'config',
    'tool',
    'eval',
    'kb',
    'memory',
    'dispatcher',
    'guardrail',
  ];
  if (!valid.includes(type)) {
    throw new Error(
      `invalid candidate type: ${type} (expected one of ${valid.join(', ')})`,
    );
  }
  const atIdx = rest.lastIndexOf('@');
  if (atIdx < 0) {
    return { type, id: rest };
  }
  return { type, id: rest.slice(0, atIdx), version: rest.slice(atIdx + 1) };
}

/** Compute a placeholder SHA for a candidate ref. Stub: SHA-256 of the ref string. */
export async function shaOfCandidateRef(ref: string): Promise<string> {
  // v0.0.0-dev stub: deterministic placeholder so reports are reproducible.
  // Real implementation in W2 will hash the actual artifact content.
  const data = new TextEncoder().encode(ref);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}