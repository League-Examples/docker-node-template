import { prisma as defaultPrisma } from '../services/prisma';

/**
 * Shared `Lock` table acquire/release helper (architecture-001
 * §Locking/Concurrency Model; this sprint's architecture-update.md R5:
 * lock granularity is per-`resourceKey`, not one global lock).
 *
 * Used by this ticket's filesystem tools (`resourceType: 'directory'`)
 * and, in ticket 003, the catalog tools -- and importable as-is by the
 * Agent Runtime (ticket 005) for its `project_turn` lock, since both are
 * the same `Lock` table with different `resourceType` values, not two
 * mechanisms.
 *
 * A conflicting acquisition is rejected immediately (the `Lock` table's
 * `@@unique([resourceType, resourceKey])` constraint does the rejecting),
 * never queued -- architecture-001 is explicit that a second acquisition
 * attempt gets "a bounded wait with a clear chat-surfaced timeout," which
 * this module supports by throwing a distinguishable, catchable error
 * rather than blocking.
 */

/** Thrown by `acquireLock` when `resourceType`/`resourceKey` is already
 * held by another caller. Distinguishable from other errors so callers
 * (tool handlers, the future `project_turn` lock consumer) can catch it
 * specifically and surface a clear "already locked" message rather than
 * a generic failure. */
export class LockConflictError extends Error {
  readonly resourceType: string;
  readonly resourceKey: string;

  constructor(resourceType: string, resourceKey: string) {
    super(`Resource is already locked: ${resourceType}:${resourceKey}`);
    this.name = 'LockConflictError';
    this.resourceType = resourceType;
    this.resourceKey = resourceKey;
  }
}

export interface LockHandle {
  resourceType: string;
  resourceKey: string;
}

/**
 * Acquire a lock on `(resourceType, resourceKey)`. Attempts a Prisma
 * `create` against the `Lock` table's unique constraint; a unique-
 * constraint violation (Prisma error code `P2002`) means another holder
 * already has this resource locked, and is translated into a
 * `LockConflictError` rather than surfacing the raw Prisma error.
 *
 * `holder` is an optional free-text identifier (e.g. a tool-call id or
 * turn id) recorded on the row for diagnostics; it plays no role in
 * conflict detection, which is keyed purely on `(resourceType,
 * resourceKey)`.
 *
 * `prismaClient` is test-injectable; defaults to the shared app
 * singleton.
 */
export async function acquireLock(
  resourceType: string,
  resourceKey: string,
  holder?: string,
  prismaClient: any = defaultPrisma
): Promise<LockHandle> {
  try {
    await prismaClient.lock.create({
      data: { resourceType, resourceKey, holder: holder ?? null },
    });
    return { resourceType, resourceKey };
  } catch (err: any) {
    if (err?.code === 'P2002') {
      throw new LockConflictError(resourceType, resourceKey);
    }
    throw err;
  }
}

/**
 * Release a previously acquired lock on `(resourceType, resourceKey)`.
 * A no-op (never throws) if no matching row exists -- callers use this
 * from a `finally` block, including after a failed acquisition attempt
 * elsewhere, and must never have the cleanup path itself throw.
 */
export async function releaseLock(
  resourceType: string,
  resourceKey: string,
  prismaClient: any = defaultPrisma
): Promise<void> {
  await prismaClient.lock.deleteMany({ where: { resourceType, resourceKey } });
}

/**
 * Run `fn` while holding a lock on `(resourceType, resourceKey)`,
 * releasing it afterward whether `fn` resolves or throws. Throws
 * `LockConflictError` up-front, without ever running `fn`, if the lock
 * is already held.
 */
export async function withLock<T>(
  resourceType: string,
  resourceKey: string,
  fn: () => Promise<T>,
  options: { holder?: string; prismaClient?: any } = {}
): Promise<T> {
  const { holder, prismaClient } = options;
  await acquireLock(resourceType, resourceKey, holder, prismaClient);
  try {
    return await fn();
  } finally {
    await releaseLock(resourceType, resourceKey, prismaClient);
  }
}
