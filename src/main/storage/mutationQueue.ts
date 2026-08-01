/**
 * Serializes asynchronous repository operations that span reads, validation,
 * hashing/encryption, SQLite transactions, or filesystem effects. A rejected
 * operation does not poison the queue, and the caller sees its rejection.
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
