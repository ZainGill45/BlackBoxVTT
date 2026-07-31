export class LatestSnapshotRateLimiter<T> {
  private lastEmittedAt: number | null = null;
  private pending: T | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly getRate: () => number,
    private readonly emit: (value: T) => void,
  ) {}

  push(value: T): void {
    this.pending = value;
    this.schedule();
  }

  rateChanged(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.schedule();
  }

  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
  }

  private schedule(): void {
    if (this.pending === null || this.timer) {
      return;
    }
    const now = Date.now();
    const nextAt =
      this.lastEmittedAt === null
        ? now
        : this.lastEmittedAt + 1_000 / this.getRate();
    const delay = nextAt - now;
    if (delay <= 0) {
      const value = this.pending;
      this.pending = null;
      this.lastEmittedAt = now;
      this.emit(value);
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.schedule();
    }, Math.ceil(delay));
  }
}
