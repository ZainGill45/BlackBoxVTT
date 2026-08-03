import path from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  MAX_CHAT_MESSAGE_BYTES,
  chatUtf8ByteLength,
  type ChatError,
  type ChatResult,
} from '../shared/chat';
import {
  chatRollCardSchema,
  type ChatRollCardV1,
  type ChatRollDefinition,
} from '../shared/chatRoll';

const MAX_CAMPAIGN_ROLLS = 32;
const MAX_ACTOR_ROLLS = 2;
const QUEUE_TIMEOUT_MS = 5_000;
const EXECUTION_TIMEOUT_MS = 5_000;

interface QueuedRoll {
  actorKey: string;
  definition: ChatRollDefinition;
  id: string;
  key: string;
  queueTimer: ReturnType<typeof setTimeout>;
  rejectAt: number;
  resolve: (result: ChatResult<ChatRollCardV1>) => void;
  signature: string;
}

interface InFlightRoll {
  actorKey: string;
  promise: Promise<ChatResult<ChatRollCardV1>>;
  signature: string;
}

interface DiceRollExecutorOptions {
  createWorker?: () => Worker;
  now?: () => number;
}

function failure(
  code: ChatError['code'],
  message: string,
): ChatResult<ChatRollCardV1> {
  return { error: { code, message }, ok: false };
}

/** Serializes authoritative roll work and replaces unhealthy workers. */
export class DiceRollExecutor {
  private active = false;
  private closed = false;
  private readonly createWorker: () => Worker;
  private readonly inFlight = new Map<string, InFlightRoll>();
  private readonly now: () => number;
  private readonly queue: QueuedRoll[] = [];
  private worker: Worker | null = null;

  constructor({
    createWorker = () =>
      new Worker(path.join(__dirname, 'diceRollWorker.js')),
    now = Date.now,
  }: DiceRollExecutorOptions = {}) {
    this.createWorker = createWorker;
    this.now = now;
  }

  roll(
    actorKey: string,
    clientMessageId: string,
    definition: ChatRollDefinition,
    signature: string,
  ): Promise<ChatResult<ChatRollCardV1>> {
    const key = `${actorKey}:${clientMessageId}`;
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing.signature === signature
        ? existing.promise
        : Promise.resolve(
            failure('invalid_input', 'Roll retry does not match the original request.'),
          );
    }
    if (this.closed) {
      return Promise.resolve(failure('unavailable', 'The dice roller is unavailable.'));
    }
    const actorCount = [...this.inFlight.values()].filter(
      (roll) => roll.actorKey === actorKey,
    ).length;
    if (
      this.inFlight.size >= MAX_CAMPAIGN_ROLLS ||
      actorCount >= MAX_ACTOR_ROLLS
    ) {
      return Promise.resolve(failure('unavailable', 'The dice roller is busy.'));
    }
    let resolve!: QueuedRoll['resolve'];
    const promise = new Promise<ChatResult<ChatRollCardV1>>((next) => {
      resolve = next;
    });
    this.inFlight.set(key, { actorKey, promise, signature });
    this.queue.push({
      actorKey,
      definition: structuredClone(definition),
      id: clientMessageId,
      key,
      queueTimer: setTimeout(
        () => this.expireQueued(key),
        QUEUE_TIMEOUT_MS,
      ),
      rejectAt: this.now() + QUEUE_TIMEOUT_MS,
      resolve,
      signature,
    });
    void this.drain();
    return promise;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const queued of this.queue.splice(0)) {
      clearTimeout(queued.queueTimer);
      queued.resolve(failure('unavailable', 'The dice roller stopped.'));
      this.inFlight.delete(queued.key);
    }
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate();
  }

  private async drain(): Promise<void> {
    if (this.active || this.closed) return;
    const job = this.queue.shift();
    if (!job) return;
    clearTimeout(job.queueTimer);
    if (job.rejectAt <= this.now()) {
      job.resolve(failure('timeout', 'The dice roll waited too long to start.'));
      this.inFlight.delete(job.key);
      void this.drain();
      return;
    }
    this.active = true;
    let result: ChatResult<ChatRollCardV1>;
    try {
      result = await this.execute(job);
    } catch {
      this.worker = null;
      result = failure('unavailable', 'The dice worker could not start.');
    }
    this.active = false;
    job.resolve(result);
    this.inFlight.delete(job.key);
    void this.drain();
  }

  private expireQueued(key: string): void {
    const index = this.queue.findIndex((job) => job.key === key);
    if (index < 0) return;
    const [job] = this.queue.splice(index, 1);
    job.resolve(failure('timeout', 'The dice roll waited too long to start.'));
    this.inFlight.delete(job.key);
  }

  private execute(job: QueuedRoll): Promise<ChatResult<ChatRollCardV1>> {
    const worker = this.worker ?? this.startWorker();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: ChatResult<ChatRollCardV1>, replace = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
        if (replace) {
          this.worker = null;
          void worker.terminate();
        }
        resolve(result);
      };
      const onMessage = (message: unknown) => {
        if (!message || typeof message !== 'object') return;
        const response = message as Record<string, unknown>;
        if (response.id !== job.id) return;
        if (response.type === 'success') {
          const parsed = chatRollCardSchema.safeParse(response.card);
          const oversized =
            parsed.success &&
            chatUtf8ByteLength(
              JSON.stringify({ card: parsed.data, kind: 'roll' }),
            ) >
              MAX_CHAT_MESSAGE_BYTES;
          finish(
            parsed.success && !oversized
              ? { ok: true, value: parsed.data }
              : failure(
                  oversized ? 'invalid_input' : 'unavailable',
                  oversized
                    ? 'The dice result exceeds the chat payload limit.'
                    : 'The dice worker returned an invalid result.',
                ),
            !parsed.success || oversized,
          );
        } else {
          finish(
            failure(
              response.type === 'invalid_input' ? 'invalid_input' : 'unavailable',
              typeof response.error === 'string'
                ? response.error
                : 'The dice roll failed.',
            ),
          );
        }
      };
      const onError = () =>
        finish(failure('unavailable', 'The dice worker failed.'), true);
      const onExit = () =>
        finish(failure('unavailable', 'The dice worker stopped.'), true);
      const timer = setTimeout(
        () =>
          finish(
            failure('timeout', 'The dice roll exceeded the 5-second limit.'),
            true,
          ),
        EXECUTION_TIMEOUT_MS,
      );
      worker.on('message', onMessage);
      worker.once('error', onError);
      worker.once('exit', onExit);
      try {
        worker.postMessage({ definition: job.definition, id: job.id });
      } catch {
        finish(failure('unavailable', 'The dice worker failed.'), true);
      }
    });
  }

  private startWorker(): Worker {
    const worker = this.createWorker();
    this.worker = worker;
    worker.on('error', () => {
      if (this.worker === worker) this.worker = null;
    });
    worker.on('exit', () => {
      if (this.worker === worker) this.worker = null;
    });
    return worker;
  }
}
