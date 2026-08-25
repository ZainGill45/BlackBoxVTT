import { describe, expect, it } from 'vitest';
import {
  DIAGNOSTIC_EVENT_LIMIT,
} from '../../../shared/diagnostics';
import { DiagnosticService } from '../../../main/diagnostics/diagnosticService';

function createService(development = false) {
  return new DiagnosticService({
    development,
    instance: {
      appVersion: '1.0.0',
      electronVersion: '43.2.0',
      environment: development ? 'development' : 'production',
      label: development ? 'alice' : 'production',
      platform: 'win32',
      processId: 42,
      profileKind: development ? 'persistent' : 'production',
    },
    redactRoots: ['C:\\Users\\Alice'],
  });
}

describe('DiagnosticService', () => {
  it('merges context and publishes source-attributed events', () => {
    const service = createService();
    const received: unknown[] = [];
    service.on('event', (event) => received.push(event));

    service.updateContext({ campaignId: 'campaign', role: 'gm', screen: 'play' });
    service.record('renderer', {
      category: 'ui',
      level: 'info',
      message: 'Campaign opened.',
    });

    expect(service.snapshot().context).toMatchObject({
      campaignId: 'campaign',
      role: 'gm',
      screen: 'play',
    });
    expect(received).toMatchObject([
      { category: 'ui', id: 1, source: 'renderer' },
    ]);
  });

  it('redacts secret fields and production profile paths', async () => {
    const service = createService();
    service.registerProvider('campaign', () => ({
      nested: { password: 'never expose me' },
      path: 'C:\\Users\\Alice\\campaign.sqlite',
    }));
    service.record('main', {
      category: 'storage',
      level: 'error',
      message: 'Failed at C:\\Users\\Alice\\campaign.sqlite',
    });

    await expect(service.inspect({ provider: 'campaign' })).resolves.toEqual({
      provider: 'campaign',
      value: {
        nested: { password: '[redacted]' },
        path: '[profile]\\campaign.sqlite',
      },
    });
    expect(service.snapshot().events[0].message).toContain('[profile]');
  });

  it('refuses development providers and authored content in production', async () => {
    const service = createService();

    await expect(service.inspect({ provider: 'renderer' })).rejects.toThrow(
      'development-only',
    );
    await expect(
      service.inspect({ content: true, provider: 'campaign' }),
    ).rejects.toThrow('development-only');
  });

  it('evicts the oldest events and counts them by severity', () => {
    const service = createService(true);
    for (let index = 0; index <= DIAGNOSTIC_EVENT_LIMIT; index += 1) {
      service.record('main', {
        category: 'test',
        level: index === 0 ? 'warn' : 'info',
        message: `event ${index}`,
      });
    }

    const snapshot = service.snapshot();
    expect(snapshot.events).toHaveLength(DIAGNOSTIC_EVENT_LIMIT);
    expect(snapshot.events[0].message).toBe('event 1');
    expect(snapshot.stats.discarded.warn).toBe(1);
  });

  it('clears the timeline and overflow counters', () => {
    const service = createService();
    service.record('main', { category: 'test', level: 'info', message: 'one' });

    service.clear();

    expect(service.snapshot().events).toEqual([]);
    expect(service.snapshot().stats).toEqual({
      bytes: 0,
      discarded: { debug: 0, error: 0, info: 0, warn: 0 },
      events: 0,
      truncated: 0,
    });
  });
});

