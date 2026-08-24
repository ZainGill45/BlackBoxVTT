import { describe, expect, it, vi } from 'vitest';
import type { CampaignRuntimeRegistry } from '../../../main/campaignRuntime';
import { SceneManager } from '../../../main/sceneManager';
import { createEmptySceneManifest } from '../../../shared/scenes';
import { makeScene, testCampaignId } from '../../support/scenes';

const sceneId = '11111111-1111-4111-8111-111111111111';
const tokenId = '22222222-2222-4222-8222-222222222222';
const entryId = '33333333-3333-4333-8333-333333333333';
const operationId = '44444444-4444-4444-8444-444444444444';

describe('SceneManager authored-data notifications', () => {
  it('names only linked Journal entries actually changed by a scene mutation', async () => {
    const scene = makeScene({ id: sceneId });
    const manifest = {
      ...createEmptySceneManifest(),
      scenes: [scene],
    };
    const adjustTokenHealth = vi.fn(async () => ({
      authoredDataChangedEntryIds: [entryId],
      changed: manifest,
      result: { ok: true as const, value: scene },
    }));
    const undo = vi.fn(async () => ({
      authoredDataChangedEntryIds: [],
      changed: manifest,
      result: { ok: true as const, value: scene },
    }));
    const runtimes = {
      resolve: vi.fn(async () => ({ scenes: { adjustTokenHealth, undo } })),
    } as unknown as CampaignRuntimeRegistry;
    const manager = new SceneManager({ runtimes });
    const changed = vi.fn();
    manager.on('health-changed', changed);

    await manager.adjustTokenHealth({
      campaignId: testCampaignId,
      command: 'Current-1',
      operationId,
      sceneId,
      tokenId,
    });
    await manager.undo({ campaignId: testCampaignId, sceneId });

    expect(changed).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledWith({
      campaignId: testCampaignId,
      entryId,
      type: 'content',
    });
  });
});
