/**
 * freeze-slice.ts — Freeze production traffic into a FrozenDataset.
 *
 * Reads captured calls from the active StorageAdapter (D1/R2 via HttpStorage,
 * filesystem, or in-memory for tests), filters by time window and optional
 * criteria, then produces a content-addressed FrozenDataset via SDK's freezeDataset.
 *
 * @see docs/prd.md §5.2 — Three dataset sources (prod slice)
 */

import type { CapturedCall, StorageAdapter } from '@lanefoundry/gatelane-sdk';
import { getStorage, setStorage, freezeDataset, type FrozenDataset, type DatasetItem } from '@lanefoundry/gatelane-sdk';

/** Configuration for freezing a production slice. */
export type FreezeSliceArgs = {
  /** Time window start (ISO 8601). Only calls >= this time are included. */
  since: string;
  /** Time window end (ISO 8601). Only calls < this time are included. */
  until?: string;
  /** Optional filter on source_kind (e.g., 'agent', 'tool', 'judge'). */
  sourceKind?: string;
  /** Maximum number of items to include. Default: 10000. */
  limit?: number;
  /** Reference to the upstream source (e.g., "prod-capture@v1.2.3"). */
  sourceRef: string;
  /** Optional custom storage adapter. If not provided, uses active storage. */
  storage?: StorageAdapter;
  /** Optional transform to convert a CapturedCall into a DatasetItem. */
  transform?: (call: CapturedCall) => DatasetItem;
};

/** Result of a freeze operation. */
export type FreezeSliceResult = {
  /** The frozen dataset. */
  dataset: FrozenDataset;
  /** Number of items included. */
  itemCount: number;
  /** Time range covered. */
  timeRange: { since: string; until: string };
  /** Content hash of the dataset (for deduplication / audit). */
  contentHash: string;
};

/** Default transform: extract user-facing input from captured call. */
export function defaultTransform(call: CapturedCall): DatasetItem {
  const input = call.input;
  return {
    id: call.id,
    input: input.prompt ?? input,
    expected: call.output,
    mapped_asi: input.metadata?.['mapped_asi'] as DatasetItem['mapped_asi'] | undefined,
    mapped_atlas: input.metadata?.['mapped_atlas'] as string | undefined,
  };
}

/**
 * Freeze a production slice from capture storage into a FrozenDataset.
 *
 * Steps:
 * 1. Resolve storage adapter (use provided or active).
 * 2. List captured calls matching the time window and filters.
 * 3. Transform each call into a DatasetItem.
 * 4. Call SDK's freezeDataset to produce content-addressed FrozenDataset.
 */
export async function freezeSlice(args: FreezeSliceArgs): Promise<FreezeSliceResult> {
  const storage = args.storage ?? getStorage();
  const limit = args.limit ?? 10000;
  const since = args.since;
  const until = args.until ?? new Date().toISOString();

  // Fetch captured calls from storage
  const calls = await storage.list({
    source_kind: args.sourceKind,
    since,
    limit,
  });

  // Filter by until timestamp
  const filteredCalls = calls.filter((call) => {
    const startedAt = Date.parse(call.started_at);
    return startedAt < Date.parse(until);
  });

  // Transform calls to dataset items
  const transform = args.transform ?? defaultTransform;
  const items = filteredCalls.map(transform);

  // Build the frozen dataset via SDK
  const dataset = await freezeDataset({
    source_kind: 'prod',
    source_ref: args.sourceRef,
    slice_filter: {
      since,
      until,
      source_kind: args.sourceKind,
      limit,
    },
    items,
  });

  return {
    dataset,
    itemCount: items.length,
    timeRange: { since, until },
    contentHash: dataset.content_hash,
  };
}

/**
 * Convenience: freeze using the HTTP storage adapter (production Worker).
 * Requires GATELANE_ENDPOINT and GATELANE_CAPTURE_TOKEN env vars.
 */
export async function freezeSliceFromWorker(args: Omit<FreezeSliceArgs, 'storage'> & {
  endpoint: string;
  token: string;
}): Promise<FreezeSliceResult> {
  // Dynamic import to avoid requiring @cloudflare/workers-types at build time
  const { HttpStorage } = await import('@lanefoundry/gatelane-sdk/storage-http');
  const storage = new HttpStorage({ endpoint: args.endpoint, token: args.token });
  const previousStorage = setStorage(storage);
  try {
    return await freezeSlice({ ...args, storage });
  } finally {
    setStorage(previousStorage);
  }
}