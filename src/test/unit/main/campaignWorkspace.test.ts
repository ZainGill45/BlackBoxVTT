import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CampaignRepository } from '../../../main/campaignRepository';
import { CampaignRuntimeRegistry } from '../../../main/campaignRuntime';
import { CampaignWorkspaceRegistry } from '../../../main/campaignWorkspace';
import { TEST_CAMPAIGN_SYSTEM } from '../../support/gameSystems';

const campaignId = '11111111-1111-4111-8111-111111111111';
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function createRegistry() {
  const directory = await mkdtemp(path.join(tmpdir(), 'blackbox-workspace-'));
  directories.push(directory);
  const campaigns = new CampaignRepository({
    createId: () => campaignId,
    rootDirectory: path.join(directory, 'campaigns'),
    trashItem: vi.fn(async () => undefined),
  });
  const created = await campaigns.create({ name: 'Iron Meridian' });
  expect(created.ok).toBe(true);
  return new CampaignWorkspaceRegistry({
    campaignRepository: campaigns,
    trashItem: (target) => rm(target, { force: true, recursive: true }),
    warn: vi.fn(),
  });
}

describe('CampaignWorkspaceRegistry', () => {
  it('returns one workspace and one repository set under concurrent access', async () => {
    const registry = await createRegistry();

    const [first, second] = await Promise.all([
      registry.get(campaignId),
      registry.get(campaignId),
    ]);

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(second?.assetRepository).toBe(first?.assetRepository);
    expect(second?.sceneRepository).toBe(first?.sceneRepository);
    expect(second?.chatRepository).toBe(first?.chatRepository);
    await registry.closeAll();
  });

  it('releases a workspace so a later open receives fresh handles', async () => {
    const registry = await createRegistry();
    const first = await registry.get(campaignId);

    await registry.close(campaignId);
    const reopened = await registry.get(campaignId);

    expect(reopened).not.toBe(first);
    expect(reopened?.sceneRepository).not.toBe(first?.sceneRepository);
    await registry.closeAll();
  });

  it('does not cache a missing campaign', async () => {
    const registry = await createRegistry();
    const missingId = '22222222-2222-4222-8222-222222222222';

    expect(await registry.get(missingId)).toBeNull();
    expect(await registry.get(missingId)).toBeNull();
  });
});

describe('CampaignRuntimeRegistry', () => {
  it('resolves a joined campaign ahead of local storage and restores local ownership on disconnect', async () => {
    const workspaces = await createRegistry();
    const runtimes = new CampaignRuntimeRegistry(workspaces);
    const joined = {
      assets: {
        actor: { id: 'player-id', role: 'player' as const },
        getPreviewPath: vi.fn(async () => null),
        importFiles: vi.fn(),
        list: vi.fn(),
        prepare: vi.fn(),
        rename: vi.fn(),
        trash: vi.fn(),
      },
      campaignId,
      kind: 'joined' as const,
      system: TEST_CAMPAIGN_SYSTEM,
      scenes: {
        cancelTransform: vi.fn(async () => undefined),
        getActiveScene: vi.fn(() => null),
        redo: vi.fn(),
        setObjects: vi.fn(),
        startTransform: vi.fn(async () => undefined),
        undo: vi.fn(),
        updateTransform: vi.fn(async () => undefined),
      },
    };

    expect((await runtimes.resolve(campaignId))?.kind).toBe('local');
    runtimes.registerJoined(joined);
    const resolved = await runtimes.resolve(campaignId);
    expect(resolved).toMatchObject({
      assets: { actor: joined.assets.actor },
      campaignId,
      kind: 'joined',
      system: TEST_CAMPAIGN_SYSTEM,
    });
    await expect(resolved?.scenes.list()).resolves.toMatchObject({
      ok: true,
      value: { activeSceneId: null, scenes: [] },
    });
    await expect(resolved?.scenes.create()).resolves.toMatchObject({
      changed: null,
      result: { error: { code: 'permission_denied' }, ok: false },
    });

    runtimes.unregisterJoined(campaignId);
    expect(await runtimes.resolve(campaignId)).toMatchObject({
      kind: 'local',
      system: TEST_CAMPAIGN_SYSTEM,
    });
    await runtimes.closeAll();
  });
});
