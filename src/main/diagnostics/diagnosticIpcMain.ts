import type { IpcMain } from 'electron';
import { diagnosticIpcChannels } from '../../shared/diagnostics';
import type { DiagnosticService } from './diagnosticService';

const HIGH_FREQUENCY = /(?:drawing|heartbeat|map-ping|measurement|preview|shape|transform)/i;

export function createDiagnosticIpcMain(
  ipc: IpcMain,
  diagnostics: DiagnosticService,
): IpcMain {
  const counts = new Map<string, number>();
  const timer = setInterval(() => {
    if (counts.size === 0) return;
    diagnostics.record('main', {
      category: 'ipc.aggregate',
      details: Object.fromEntries(counts),
      kind: 'operation',
      level: 'debug',
      message: `Aggregated ${[...counts.values()].reduce((total, count) => total + count, 0)} high-frequency IPC operations over 5 seconds.`,
    });
    counts.clear();
  }, 5_000);
  timer.unref();

  return new Proxy(ipc, {
    get(target, property, receiver) {
      if (property === 'handle') {
        return (
          channel: string,
          listener: (event: unknown, ...args: unknown[]) => unknown,
        ) => {
          target.handle(channel, async (event, ...args) => {
            const startedAt = performance.now();
            try {
              const result = await listener(event, ...args);
              record(channel, performance.now() - startedAt, result, null);
              return result;
            } catch (error) {
              record(channel, performance.now() - startedAt, null, error);
              throw error;
            }
          });
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  function record(
    channel: string,
    durationMs: number,
    result: unknown,
    error: unknown,
  ) {
    if (Object.values(diagnosticIpcChannels).includes(
      channel as (typeof diagnosticIpcChannels)[keyof typeof diagnosticIpcChannels],
    )) return;
    if (HIGH_FREQUENCY.test(channel)) {
      counts.set(channel, (counts.get(channel) ?? 0) + 1);
      return;
    }
    const failedResult = result && typeof result === 'object' &&
      'ok' in result && result.ok === false;
    diagnostics.record('main', {
      category: 'ipc',
      details: {
        channel,
        durationMs: Math.round(durationMs * 100) / 100,
        outcome: error ? 'threw' : failedResult ? 'failed' : 'ok',
      },
      kind: 'operation',
      level: error ? 'error' : failedResult ? 'warn' : 'debug',
      message: `${channel} ${error ? 'threw' : failedResult ? 'failed' : 'completed'} in ${durationMs.toFixed(1)} ms.`,
      ...(error instanceof Error ? { stack: error.stack } : {}),
    });
  }
}

