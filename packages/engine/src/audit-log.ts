import type { AuditLogEntry, Env } from "@gatelane/shared";

export async function writeAuditLog(
  env: Env,
  entry: Omit<AuditLogEntry, "id" | "createdAt">,
): Promise<AuditLogEntry> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO audit_log (id, action, resource_type, resource_id, actor, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, entry.action, entry.resourceType, entry.resourceId, entry.actor, JSON.stringify(entry.detail), createdAt)
    .run();

  return { ...entry, id, createdAt };
}
