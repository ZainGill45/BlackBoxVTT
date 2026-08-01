import { describe, expect, it } from 'vitest';
import { MutationQueue } from '../../../../main/storage/mutationQueue';

describe('MutationQueue', () => {
  it('runs asynchronous mutations in submission order', async () => {
    const queue = new MutationQueue();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.run(async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:end');
    });
    const second = queue.run(async () => {
      events.push('second');
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second']);
  });

  it('continues after a rejected mutation without hiding its error', async () => {
    const queue = new MutationQueue();
    const rejected = queue.run(async () => {
      throw new Error('failed');
    });
    const next = queue.run(async () => 'completed');

    await expect(rejected).rejects.toThrow('failed');
    await expect(next).resolves.toBe('completed');
  });
});
