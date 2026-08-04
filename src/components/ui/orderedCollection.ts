export interface OrderedCollectionSnapshot {
  activeId: string;
  originalIds: readonly string[];
  orderedIds: readonly string[];
}

/** Domain-neutral click-to-place ordering state. Consumers own persistence. */
export class OrderedCollectionController {
  private snapshot: OrderedCollectionSnapshot | null = null;

  constructor(
    private readonly getIds: () => readonly string[],
    private readonly commitOrder: (orderedIds: readonly string[]) => Promise<boolean>,
  ) {}

  get active(): OrderedCollectionSnapshot | null {
    return this.snapshot;
  }

  begin(activeId: string): OrderedCollectionSnapshot | null {
    const ids = [...this.getIds()];
    if (!ids.includes(activeId)) return null;
    this.snapshot = { activeId, orderedIds: ids, originalIds: ids };
    return this.snapshot;
  }

  placeAt(index: number): OrderedCollectionSnapshot | null {
    if (!this.snapshot) return null;
    const without = this.snapshot.orderedIds.filter((id) => id !== this.snapshot!.activeId);
    const target = Math.max(0, Math.min(index, without.length));
    without.splice(target, 0, this.snapshot.activeId);
    this.snapshot = { ...this.snapshot, orderedIds: without };
    return this.snapshot;
  }

  step(direction: 'down' | 'up'): OrderedCollectionSnapshot | null {
    if (!this.snapshot) return null;
    const current = this.snapshot.orderedIds.indexOf(this.snapshot.activeId);
    return this.placeAt(current + (direction === 'down' ? 1 : -1));
  }

  cancel(): void {
    this.snapshot = null;
  }

  async commit(): Promise<boolean> {
    if (!this.snapshot) return false;
    const next = [...this.snapshot.orderedIds];
    const saved = await this.commitOrder(next);
    if (saved) this.snapshot = null;
    return saved;
  }
}
