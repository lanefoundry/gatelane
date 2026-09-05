import type { Dataset, Env } from "@gatelane/shared";

export async function freezeSlice(
  env: Env,
  opts: { name: string; windowStart: string; windowEnd: string; description?: string },
): Promise<Dataset> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const captures = await env.DB.prepare(
    `SELECT id FROM captures WHERE created_at >= ? AND created_at <= ? ORDER BY created_at`,
  )
    .bind(opts.windowStart, opts.windowEnd)
    .all<{ id: string }>();

  const items = captures.results ?? [];

  const dataset: Dataset = {
    id,
    name: opts.name,
    description: opts.description ?? "",
    frozenAt: now,
    windowStart: opts.windowStart,
    windowEnd: opts.windowEnd,
    itemCount: items.length,
    createdAt: now,
  };

  await env.DB.prepare(
    `INSERT INTO datasets (id, name, description, frozen_at, window_start, window_end, item_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(dataset.id, dataset.name, dataset.description, dataset.frozenAt, dataset.windowStart, dataset.windowEnd, dataset.itemCount, dataset.createdAt)
    .run();

  for (let i = 0; i < items.length; i++) {
    const itemId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO dataset_items (id, dataset_id, capture_id, ordinal) VALUES (?, ?, ?, ?)`,
    )
      .bind(itemId, dataset.id, items[i].id, i)
      .run();
  }

  return dataset;
}

export async function createDataset(
  env: Env,
  opts: { name: string; captureIds: string[]; description?: string },
): Promise<Dataset> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const dataset: Dataset = {
    id,
    name: opts.name,
    description: opts.description ?? "",
    frozenAt: now,
    windowStart: now,
    windowEnd: now,
    itemCount: opts.captureIds.length,
    createdAt: now,
  };

  await env.DB.prepare(
    `INSERT INTO datasets (id, name, description, frozen_at, window_start, window_end, item_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(dataset.id, dataset.name, dataset.description, dataset.frozenAt, dataset.windowStart, dataset.windowEnd, dataset.itemCount, dataset.createdAt)
    .run();

  for (let i = 0; i < opts.captureIds.length; i++) {
    const itemId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO dataset_items (id, dataset_id, capture_id, ordinal) VALUES (?, ?, ?, ?)`,
    )
      .bind(itemId, dataset.id, opts.captureIds[i], i)
      .run();
  }

  return dataset;
}
