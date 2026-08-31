/**
 * Frozen dataset — content-addressed, immutable, versioned.
 *
 * A dataset is the input to a gate run. Three sources:
 * - `redteam` — curated attacks from garak / PyRIT / Promptfoo / DeepTeam
 * - `prod` — frozen production slice from capture SDK
 * - `compliance` — curated cases mapped to NIST / AI Basic Act / EU AI Act
 *
 * @see docs/prd.md §5.2 — Three dataset sources
 */

export type DatasetSourceKind = 'redteam' | 'prod' | 'compliance';

export type FrozenDataset = {
  /** Content hash of the dataset. */
  readonly content_hash: string;
  /** Schema version. */
  readonly version: string;
  /** Where this dataset came from. */
  readonly source_kind: DatasetSourceKind;
  /** Free-form reference to the upstream source (e.g. "garak@0.14.0+owasp-agentic-v1"). */
  readonly source_ref: string;
  /** Optional slice filter (time range, user cohort, etc.). */
  readonly slice_filter?: Record<string, unknown>;
  /** When the dataset was frozen. ISO 8601 timestamp. */
  readonly frozen_at: string;
  /** Number of items in the dataset. */
  readonly item_count: number;
  /** Items themselves (lazy-loaded). */
  readonly items?: ReadonlyArray<DatasetItem>;
};

export type DatasetItem = {
  readonly id: string;
  /** For red-team: the attack payload. For prod: the captured user input. For compliance: the test case. */
  readonly input: unknown;
  /** Optional expected outcome (for compliance / eval datasets). */
  readonly expected?: unknown;
  /** OWASP Agentic Top 10 mapping, if known. */
  readonly mapped_asi?: 'ASI01' | 'ASI02' | 'ASI03' | 'ASI04' | 'ASI05' | 'ASI06' | 'ASI07' | 'ASI08' | 'ASI09' | 'ASI10';
  /** MITRE ATLAS technique ID, if known. */
  readonly mapped_atlas?: string;
};

/** Compute a placeholder content hash from item count + source ref. Stub. */
export async function hashDataset(
  source_kind: DatasetSourceKind,
  source_ref: string,
  item_count: number,
): Promise<string> {
  const data = new TextEncoder().encode(`${source_kind}|${source_ref}|${item_count}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

/** Build a stub FrozenDataset. Items optional. */
export async function freezeDataset(args: {
  source_kind: DatasetSourceKind;
  source_ref: string;
  slice_filter?: Record<string, unknown>;
  items?: ReadonlyArray<DatasetItem>;
}): Promise<FrozenDataset> {
  const item_count = args.items?.length ?? 0;
  const content_hash = await hashDataset(args.source_kind, args.source_ref, item_count);
  return {
    content_hash,
    version: '0.0.0-dev',
    source_kind: args.source_kind,
    source_ref: args.source_ref,
    ...(args.slice_filter !== undefined ? { slice_filter: args.slice_filter } : {}),
    frozen_at: new Date().toISOString(),
    item_count,
    ...(args.items !== undefined ? { items: args.items } : {}),
  };
}