import { describe, expect, it, vi } from 'vitest';
import { OrderedCollectionController } from '../../../../components/ui/orderedCollection';

describe('OrderedCollectionController', () => {
  it('moves stable IDs, commits through the consumer, and supports cancellation', async () => {
    const commit = vi.fn(async () => true);
    const controller = new OrderedCollectionController(() => ['a', 'b', 'c'], commit);
    expect(controller.begin('b')?.orderedIds).toEqual(['a', 'b', 'c']);
    expect(controller.placeAt(0)?.orderedIds).toEqual(['b', 'a', 'c']);
    expect(await controller.commit()).toBe(true);
    expect(commit).toHaveBeenCalledWith(['b', 'a', 'c']);
    expect(controller.active).toBeNull();
    controller.begin('a');
    controller.cancel();
    expect(controller.active).toBeNull();
  });
});
