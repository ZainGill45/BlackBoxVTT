import { EventEmitter } from 'node:events';
import type { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiceRollExecutor } from '../../../main/diceRollExecutor';
import type {
  ChatRollCard,
  ChatRollDefinition,
} from '../../../shared/chatRoll';

const definition: ChatRollDefinition = {
  category: 'Roll',
  sections: [
    { label: '1d20', modifiers: [], notation: '1d20', typeLabel: null },
  ],
  title: null,
};

const card: ChatRollCard = {
  category: 'Roll',
  sections: [
    {
      baseTotal: 10,
      expression: [{ kind: 'number', value: 10 }],
      label: '1d20',
      modifiers: [],
      notation: '1d20',
      total: 10,
      typeLabel: null,
    },
  ],
  title: null,
};

class MockWorker extends EventEmitter {
  readonly postMessage = vi.fn<(message: { id: string }) => void>();
  readonly terminate = vi.fn(async () => {
    this.emit('exit', 1);
    return 1;
  });
}

function executorWith(
  setup: (worker: MockWorker) => void,
): { createWorker: ReturnType<typeof vi.fn>; executor: DiceRollExecutor } {
  const createWorker = vi.fn(() => {
    const worker = new MockWorker();
    setup(worker);
    return worker as unknown as Worker;
  });
  return { createWorker, executor: new DiceRollExecutor({ createWorker }) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DiceRollExecutor', () => {
  it('returns validated results and deduplicates an identical in-flight key', async () => {
    let respond: (() => void) | undefined;
    const { executor } = executorWith((worker) => {
      worker.postMessage.mockImplementation((message) => {
        respond = () => worker.emit('message', { card, id: message.id, type: 'success' });
      });
    });
    const first = executor.roll('gm', 'one', definition, 'same');
    const duplicate = executor.roll('gm', 'one', definition, 'same');

    expect(duplicate).toBe(first);
    respond?.();
    await expect(first).resolves.toEqual({ ok: true, value: card });
    await executor.close();
  });

  it('rejects mismatched reuse and more than two outstanding actor requests', async () => {
    const { executor } = executorWith(() => undefined);
    const first = executor.roll('gm', 'one', definition, 'same');
    await expect(
      executor.roll('gm', 'one', definition, 'different'),
    ).resolves.toMatchObject({ error: { code: 'invalid_input' } });
    void executor.roll('gm', 'two', definition, 'two');
    await expect(
      executor.roll('gm', 'three', definition, 'three'),
    ).resolves.toMatchObject({ error: { code: 'unavailable' } });
    await executor.close();
    await expect(first).resolves.toMatchObject({ error: { code: 'unavailable' } });
  });

  it('times out execution and replaces the worker for the next request', async () => {
    vi.useFakeTimers();
    let workerNumber = 0;
    const { createWorker, executor } = executorWith((worker) => {
      workerNumber += 1;
      if (workerNumber === 2) {
        worker.postMessage.mockImplementation((message) => {
          worker.emit('message', { card, id: message.id, type: 'success' });
        });
      }
    });
    const timedOut = executor.roll('gm', 'one', definition, 'one');
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(timedOut).resolves.toMatchObject({ error: { code: 'timeout' } });

    await expect(
      executor.roll('gm', 'two', definition, 'two'),
    ).resolves.toEqual({ ok: true, value: card });
    expect(createWorker).toHaveBeenCalledTimes(2);
    await executor.close();
  });

  it('replaces a crashed worker', async () => {
    let workerNumber = 0;
    const { createWorker, executor } = executorWith((worker) => {
      workerNumber += 1;
      worker.postMessage.mockImplementation((message) => {
        if (workerNumber === 1) worker.emit('error', new Error('crash'));
        else worker.emit('message', { card, id: message.id, type: 'success' });
      });
    });
    await expect(
      executor.roll('gm', 'one', definition, 'one'),
    ).resolves.toMatchObject({ error: { code: 'unavailable' } });
    await expect(
      executor.roll('gm', 'two', definition, 'two'),
    ).resolves.toEqual({ ok: true, value: card });
    expect(createWorker).toHaveBeenCalledTimes(2);
    await executor.close();
  });

  it('rejects a normalized result beyond the 512 KiB chat ceiling', async () => {
    const oversized = structuredClone(card);
    oversized.sections[0].expression = Array.from(
      { length: 60_000 },
      (_, value) => ({ kind: 'number' as const, value }),
    );
    const { executor } = executorWith((worker) => {
      worker.postMessage.mockImplementation((message) => {
        worker.emit('message', { card: oversized, id: message.id, type: 'success' });
      });
    });
    await expect(
      executor.roll('gm', 'large', definition, 'large'),
    ).resolves.toMatchObject({ error: { code: 'invalid_input' } });
    await executor.close();
  });

  it('expires queued work after five seconds', async () => {
    vi.useFakeTimers();
    const { executor } = executorWith(() => undefined);
    const active = executor.roll('one', 'one', definition, 'one');
    const queued = executor.roll('two', 'two', definition, 'two');
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(active).resolves.toMatchObject({ error: { code: 'timeout' } });
    await expect(queued).resolves.toMatchObject({ error: { code: 'timeout' } });
    await executor.close();
  });

  it('bounds the campaign FIFO at 32 outstanding requests', async () => {
    const { executor } = executorWith(() => undefined);
    const accepted = Array.from({ length: 32 }, (_, index) =>
      executor.roll(`actor-${index}`, `id-${index}`, definition, `sig-${index}`),
    );
    await expect(
      executor.roll('overflow', 'overflow', definition, 'overflow'),
    ).resolves.toMatchObject({ error: { code: 'unavailable' } });
    await executor.close();
    await expect(Promise.all(accepted)).resolves.toHaveLength(32);
  });
});
