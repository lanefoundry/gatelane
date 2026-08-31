/**
 * freeze-slice.ts — Freeze production traffic into a FrozenDataset.
 *
 * Reads captured calls from the active StorageAdapter (D1/R2 via HttpStorage,
 * filesystem, or in-memory for tests), filters by time window and optional
 * criteria, then produces a content-addressed FrozenDataset via SDK's freezeDataset.
 *
 * @see docs/prd.md §5.2 — Three dataset sources (prod slice)
 */
import { getStorage, setStorage, freezeDataset } from '@lanefoundry/gatelane-sdk';
/** Default transform: extract user-facing input from captured call. */
export function defaultTransform(call) {
    const input = call.input;
    return {
        id: call.id,
        input: input.prompt ?? input,
        expected: call.output,
        mapped_asi: input.metadata?.['mapped_asi'],
        mapped_atlas: input.metadata?.['mapped_atlas'],
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
export async function freezeSlice(args) {
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
export async function freezeSliceFromWorker(args) {
    // Dynamic import to avoid requiring @cloudflare/workers-types at build time
    const { HttpStorage } = await import('@lanefoundry/gatelane-sdk/storage-http');
    const storage = new HttpStorage({ endpoint: args.endpoint, token: args.token });
    const previousStorage = setStorage(storage);
    try {
        return await freezeSlice({ ...args, storage });
    }
    finally {
        setStorage(previousStorage);
    }
}
//# sourceMappingURL=freeze-slice.js.map