/**
 * Serializes writes to one store. Repositories read-modify-write whole JSON
 * manifests, so two mutations running concurrently would let the second
 * overwrite the first's changes with a stale copy.
 *
 * A rejected operation does not poison the queue: the next one runs either
 * way, and the caller still sees the original rejection.
 */
export class MutationQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
