import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DrawingPreviewUpdate } from '../../../../shared/network';
import type { CampaignSceneService } from '../../../../main/campaignTable/sceneService';
import type { HostClient } from '../../../../main/network/hostClient';
import { HostSceneRealtime } from '../../../../main/network/hostSceneRealtime';
import { udpMessageTypes } from '../../../../main/network/udpProtocol';
import { makeScene, testCampaignId } from '../../../support/scenes';

const operationId = '99999999-9999-4999-8999-999999999999';

function drawingPreview(sequence: number): DrawingPreviewUpdate {
  return {
    active: true,
    campaignId: testCampaignId,
    closed: false,
    kind: 'freeform',
    layer: 'map',
    operationId,
    points: [{ x: 100 + sequence, y: 100 }],
    sceneId: '11111111-1111-4111-8111-111111111111',
    sequence,
    style: {
      edge: 'hard',
      fillColor: '#ffffff',
      fillEnabled: false,
      fillOpacity: 0.25,
      hardness: 1,
      strokeColor: '#ffffff',
      strokeOpacity: 1,
      strokeWidth: 12,
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('HostSceneRealtime', () => {
  it('coalesces GM drawing UDP previews at the configured update rate', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T00:00:00.000Z'));
    const client = {
      state: 'ready',
      udpRecoveryStartedAt: null,
      user: {
        id: '88888888-8888-4888-8888-888888888888',
        username: 'Player',
      },
    } as HostClient;
    const sendUdp = vi.fn();
    const realtime = new HostSceneRealtime({
      campaignId: testCampaignId,
      clients: new Set([client]),
      events: {
        onDrawingPreview: vi.fn(),
        onMapPing: vi.fn(),
        onMeasurementUpdate: vi.fn(),
        onShapePreview: vi.fn(),
        onTransformCancelled: vi.fn(),
        onTransformPreview: vi.fn(),
        onTransformStarted: vi.fn(),
      },
      scenes: {
        readActiveScene: vi.fn(async () => makeScene()),
      } as unknown as CampaignSceneService,
      sendUdp,
      transformPreviewRate: 32,
    });

    await realtime.broadcastDrawingPreview(drawingPreview(1));
    await realtime.broadcastDrawingPreview(drawingPreview(2));
    await realtime.broadcastDrawingPreview(drawingPreview(3));
    await vi.advanceTimersByTimeAsync(0);
    expect(sendUdp).toHaveBeenCalledTimes(1);
    expect(sendUdp).toHaveBeenLastCalledWith(
      client,
      udpMessageTypes.serverDrawingPreview,
      expect.any(Buffer),
    );

    await vi.advanceTimersByTimeAsync(31);
    expect(sendUdp).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sendUdp).toHaveBeenCalledTimes(2);

    realtime.reset();
  });
});
