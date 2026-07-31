import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CampaignRepository } from '../campaignRepository';
import { AssetRepository } from '../assetRepository';
import { SceneRepository } from '../sceneRepository';
import {
  createEmptyDrawingLayers,
  createEmptyImageLayers,
  imageStateOf,
  type SceneDrawing,
} from '../../shared/scenes';
import { ConnectionHistoryRepository } from './connectionHistoryRepository';
import { NetworkManager } from './networkManager';
import { ServerConfigRepository } from './serverConfigRepository';

const campaignId = '11111111-1111-4111-8111-111111111111';
const userIdPattern = /^[0-9a-f-]{36}$/i;
const temporaryDirectories: string[] = [];
const managers: NetworkManager[] = [];

const secureStorage = {
  async decryptStringAsync(encrypted: Buffer) {
    return {
      result: encrypted.toString('utf8').replace(/^encrypted:/, ''),
      shouldReEncrypt: false,
    };
  },
  async encryptStringAsync(value: string) {
    return Buffer.from(`encrypted:${value}`, 'utf8');
  },
};

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('secure network integration', () => {
  it('completes TLS trust, password authentication, and UDP association', async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), 'blackbox-network-integration-'),
    );
    temporaryDirectories.push(directory);
    const campaignsRoot = path.join(directory, 'campaigns');
    const campaignRepository = new CampaignRepository({
      createId: () => campaignId,
      rootDirectory: campaignsRoot,
      trashItem: vi.fn(),
    });
    const created = await campaignRepository.create({
      name: 'Iron Meridian',
    });
    expect(created.ok).toBe(true);
    const container = await campaignRepository.getContainer(campaignId);
    expect(container).not.toBeNull();

    const config = new ServerConfigRepository(container!.directory);
    const createdUser = await config.createUser('Alice', 'password');
    expect(createdUser.ok).toBe(true);
    expect(createdUser.ok && createdUser.value.id).toMatch(userIdPattern);
    const observerUser = await config.createUser('Bob', 'password');
    expect(observerUser.ok).toBe(true);
    if (!observerUser.ok) {
      throw new Error('Expected a second user.');
    }
    const port = await getAvailablePort();
    await config.setPort(port);
    const assetSource = path.join(directory, 'Map.png');
    await writeFile(
      assetSource,
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from('network asset'),
      ]),
    );
    const assetRepository = new AssetRepository({
      campaignDirectory: container!.directory,
      trashItem: (target) => rm(target, { force: true }),
    });
    const importedAsset = await assetRepository.importFiles(
      [assetSource],
      { id: `gm:${campaignId}`, role: 'gm' },
    );
    expect(importedAsset.ok).toBe(true);
    const sceneRepository = new SceneRepository({
      campaignDirectory: container!.directory,
    });
    const initiallyPresentedScene = await sceneRepository.create();
    if (!initiallyPresentedScene.ok) {
      throw new Error('Expected an initially presented scene.');
    }
    await sceneRepository.present(initiallyPresentedScene.value.id);

    const unavailableFetch = vi.fn(async () => ({
      ok: false,
    })) as unknown as typeof fetch;
    const host = new NetworkManager({
      campaignRepository,
      fetcher: unavailableFetch,
      historyRepository: new ConnectionHistoryRepository(
        path.join(directory, 'host-connections.json'),
        secureStorage,
      ),
      warn: vi.fn(),
    });
    const player = new NetworkManager({
      assetCacheRoot: path.join(directory, 'player-cache'),
      campaignRepository,
      fetcher: unavailableFetch,
      historyRepository: new ConnectionHistoryRepository(
        path.join(directory, 'player-connections.json'),
        secureStorage,
      ),
      warn: vi.fn(),
    });
    managers.push(host, player);

    const opened = await host.openHost(campaignId);
    expect(opened).toMatchObject({
      ok: true,
      value: { effectivePort: port, state: 'online' },
    });
    expect(
      await host.setTransformPreviewRate({
        campaignId,
        transformPreviewRate: 128,
      }),
    ).toEqual({ ok: true, value: 128 });
    expect((await config.load()).transformPreviewRate).toBe(128);

    const occupiedPort = await getAvailablePort();
    const blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(occupiedPort, '0.0.0.0', () => resolve());
    });
    try {
      await expect(
        host.setPort({ campaignId, port: occupiedPort }),
      ).resolves.toEqual({ ok: true, value: port });
      expect((await config.load()).port).toBe(port);
      expect(host.getHostStatus()).toMatchObject({
        effectivePort: port,
        state: 'online',
      });
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }

    const connected = await player.connect({
      host: '127.0.0.1',
      port,
    });
    expect(connected.ok && connected.value.state).toBe('trust_required');
    if (!connected.ok || connected.value.state !== 'trust_required') {
      throw new Error('Expected a trust challenge.');
    }

    const authentication = await player.acceptTrust({
      attemptId: connected.value.challenge.attemptId,
    });
    expect(authentication.ok && authentication.value.users[0].username).toBe(
      'Alice',
    );
    if (!authentication.ok) {
      throw new Error('Expected an authentication challenge.');
    }

    const authenticated = await player.authenticate({
      attemptId: authentication.value.attemptId,
      password: 'password',
      useSavedPassword: false,
      userId: authentication.value.users[0].id,
    });
    expect(authenticated).toMatchObject({
      ok: true,
      value: {
        campaignId,
        role: 'player',
        source: 'remote',
        username: 'Alice',
      },
    });
    expect(host.getHostStatus().connectedPlayerCount).toBe(1);
    const hostMeasurements: unknown[] = [];
    host.on('measurement-update', (update) =>
      hostMeasurements.push(update),
    );
    const firstJoinMeasurement = {
      active: true,
      campaignId,
      measurementId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      points: [{ x: 10, y: 10 }],
      sceneId: initiallyPresentedScene.value.id,
      updateSequence: 1,
    };
    await player.sendMeasurementUpdate(firstJoinMeasurement);
    await vi.waitFor(() => {
      expect(hostMeasurements).toEqual([
        {
          ...firstJoinMeasurement,
          sourceId: authentication.value.users[0].id,
        },
      ]);
    });
    await player.sendMeasurementUpdate({
      ...firstJoinMeasurement,
      active: false,
      points: [],
      updateSequence: 2,
    });
    await vi.waitFor(() => {
      expect(hostMeasurements).toHaveLength(2);
    });
    await vi.waitFor(() => {
      expect(player.getRemoteActiveScene(campaignId)?.id).toBe(
        initiallyPresentedScene.value.id,
      );
    });
    await sceneRepository.present(null);
    await host.notifyScenePresented(campaignId);
    await vi.waitFor(() => {
      expect(player.getRemoteActiveScene(campaignId)).toBeNull();
    });
    hostMeasurements.length = 0;

    const synchronized = await player.prepareRemoteAssets(
      campaignId,
      vi.fn(),
    );
    expect(synchronized).toMatchObject({
      ok: true,
      value: [
        {
          available: true,
          displayName: 'Map.png',
          syncState: 'ready',
        },
      ],
    });
    if (
      !synchronized.ok ||
      !importedAsset.ok ||
      importedAsset.value.length === 0 ||
      synchronized.value.length === 0
    ) {
      throw new Error('Expected synchronized campaign assets.');
    }
    const renamedAsset = await player.renameRemoteAsset({
        assetId: synchronized.value[0].id,
        campaignId,
        displayName: 'World Map.png',
        expectedRevision: synchronized.value[0].revision,
      });
    expect(renamedAsset).toMatchObject({
      ok: true,
      value: { displayName: 'World Map.png' },
    });

    // The initial presentation was cleared before the main scene workflow.
    expect(player.getRemoteActiveScene(campaignId)).toBeNull();
    expect(player.isRemoteCampaign(campaignId)).toBe(true);

    const scene = await sceneRepository.create();
    if (!scene.ok) {
      throw new Error('Expected a created scene.');
    }
    await sceneRepository.update(
      scene.value.id,
      { grid: { size: 96, type: 'square' }, name: 'Iron Keep' },
      0,
    );
    const imageState = {
      drawings: createEmptyDrawingLayers(),
      images: {
        ...createEmptyImageLayers(),
        gm: [
          {
            assetId: importedAsset.value[0].id,
            height: 64,
            id: '55555555-5555-4555-8555-555555555555',
            rotation: 0,
            width: 64,
            x: 50,
            y: 50,
          },
        ],
        token: [
          {
            assetId: importedAsset.value[0].id,
            height: 64,
            id: '66666666-6666-4666-8666-666666666666',
            rotation: 0,
            width: 64,
            x: 100,
            y: 100,
          },
        ],
      },
      mapImage: null,
    };
    await sceneRepository.setImages(scene.value.id, imageState, 1);
    await sceneRepository.present(scene.value.id);
    await host.notifyScenePresented(campaignId);

    await vi.waitFor(() => {
      expect(player.getRemoteActiveScene(campaignId)).toMatchObject({
        grid: { size: 96, type: 'square' },
        id: scene.value.id,
        name: 'Iron Keep',
      });
      expect(
        player.getRemoteActiveScene(campaignId)?.images,
      ).toMatchObject({
        gm: [],
        token: [{ id: '66666666-6666-4666-8666-666666666666' }],
      });
    });

    const observer = new NetworkManager({
      campaignRepository,
      fetcher: unavailableFetch,
      historyRepository: new ConnectionHistoryRepository(
        path.join(directory, 'observer-connections.json'),
        secureStorage,
      ),
      warn: vi.fn(),
    });
    managers.push(observer);
    const observerConnection = await observer.connect({
      host: '127.0.0.1',
      port,
    });
    if (
      !observerConnection.ok ||
      observerConnection.value.state !== 'trust_required'
    ) {
      throw new Error('Expected an observer trust challenge.');
    }
    const observerChallenge = await observer.acceptTrust({
      attemptId: observerConnection.value.challenge.attemptId,
    });
    if (!observerChallenge.ok) {
      throw new Error('Expected an observer authentication challenge.');
    }
    await expect(
      observer.authenticate({
        attemptId: observerChallenge.value.attemptId,
        password: 'password',
        useSavedPassword: false,
        userId: observerUser.value.id,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { role: 'player', username: 'Bob' },
    });
    await vi.waitFor(() => {
      expect(observer.getRemoteActiveScene(campaignId)?.id).toBe(
        scene.value.id,
      );
    });

    const drawingId = '44444444-4444-4444-8444-444444444444';
    const liveDrawing: SceneDrawing = {
      closed: false,
      id: drawingId,
      kind: 'freeform',
      ownerId: null,
      points: [{ x: -10, y: 0 }, { x: 10, y: 0 }],
      revision: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
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
      x: 200,
      y: 200,
    };
    const hostDrawingPreviews: unknown[] = [];
    const observerDrawingPreviews: unknown[] = [];
    host.on('drawing-preview', (preview) =>
      hostDrawingPreviews.push(preview),
    );
    observer.on('drawing-preview', (preview) =>
      observerDrawingPreviews.push(preview),
    );
    await player.sendDrawingPreview({
      active: true,
      campaignId,
      closed: false,
      kind: 'freeform',
      layer: 'gm',
      operationId: drawingId,
      points: [{ x: 190, y: 200 }, { x: 210, y: 200 }],
      reliable: true,
      sceneId: scene.value.id,
      sequence: 1,
      style: liveDrawing.style,
    });
    await vi.waitFor(() => {
      expect(hostDrawingPreviews).toEqual([
        expect.objectContaining({
          layer: 'token',
          operationId: drawingId,
          reliable: true,
          sourceId: authentication.value.users[0].id,
        }),
      ]);
      expect(observerDrawingPreviews).toEqual(hostDrawingPreviews);
    });

    const playerScene = player.getRemoteActiveScene(campaignId);
    if (!playerScene) {
      throw new Error('Expected the player scene.');
    }
    const drawingState = imageStateOf(playerScene);
    drawingState.drawings.token.push(liveDrawing);
    const drawingCommit = await player.setRemoteSceneObjects({
      campaignId,
      expectedRevision: playerScene.revision,
      operationId: drawingId,
      sceneId: playerScene.id,
      state: drawingState,
    });
    expect(drawingCommit).toMatchObject({
      ok: true,
      value: {
        drawings: {
          token: [
            {
              id: drawingId,
              ownerId: authentication.value.users[0].id,
            },
          ],
        },
      },
    });
    await vi.waitFor(() => {
      expect(
        observer.getRemoteActiveScene(campaignId)?.drawings.token[0],
      ).toMatchObject({
        id: drawingId,
        ownerId: authentication.value.users[0].id,
      });
    });

    const observerScene = observer.getRemoteActiveScene(campaignId);
    if (!observerScene) {
      throw new Error('Expected the observer scene.');
    }
    const unauthorizedDelete = imageStateOf(observerScene);
    unauthorizedDelete.drawings.token = [];
    await observer.setRemoteSceneObjects({
      campaignId,
      expectedRevision: observerScene.revision,
      operationId: '45454545-4545-4545-8545-454545454545',
      sceneId: observerScene.id,
      state: unauthorizedDelete,
    });
    expect(
      observer.getRemoteActiveScene(campaignId)?.drawings.token,
    ).toEqual([
      expect.objectContaining({
        id: drawingId,
        ownerId: authentication.value.users[0].id,
      }),
    ]);

    const hostPings: unknown[] = [];
    const playerPings: unknown[] = [];
    const observerPings: unknown[] = [];
    host.on('map-ping', (ping) => hostPings.push(ping));
    player.on('map-ping', (ping) => playerPings.push(ping));
    observer.on('map-ping', (ping) => observerPings.push(ping));
    const playerPing = {
      campaignId,
      id: '77777777-7777-4777-8777-777777777777',
      pullPlayers: true,
      sceneId: scene.value.id,
      x: 400,
      y: 300,
    };
    await player.sendMapPing(playerPing);
    await vi.waitFor(() => {
      expect(hostPings).toEqual([playerPing]);
      expect(playerPings).toEqual([playerPing]);
      expect(observerPings).toEqual([playerPing]);
    });

    await player.sendMapPing({
      ...playerPing,
      id: '88888888-8888-4888-8888-888888888888',
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hostPings).toHaveLength(1);
    expect(playerPings).toHaveLength(1);
    expect(observerPings).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 500));
    await player.sendMapPing({
      ...playerPing,
      id: '99999999-9999-4999-8999-999999999999',
      x: 10_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hostPings).toHaveLength(1);
    expect(playerPings).toHaveLength(1);
    expect(observerPings).toHaveLength(1);

    const hostPing = {
      campaignId,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      pullPlayers: false,
      sceneId: scene.value.id,
      x: 600,
      y: 500,
    };
    await host.sendMapPing(hostPing);
    await vi.waitFor(() => {
      expect(hostPings).toEqual([playerPing, hostPing]);
      expect(playerPings).toEqual([playerPing, hostPing]);
      expect(observerPings).toEqual([playerPing, hostPing]);
    });

    const playerMeasurements: unknown[] = [];
    const observerMeasurements: unknown[] = [];
    player.on('measurement-update', (update) =>
      playerMeasurements.push(update),
    );
    observer.on('measurement-update', (update) =>
      observerMeasurements.push(update),
    );
    const playerMeasurement = {
      active: true,
      campaignId,
      measurementId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      points: [
        { x: 100, y: 100 },
        { x: 300, y: 400 },
      ],
      sceneId: scene.value.id,
      updateSequence: 1,
    };
    await player.sendMeasurementUpdate(playerMeasurement);
    await vi.waitFor(() => {
      expect(hostMeasurements).toEqual([
        {
          ...playerMeasurement,
          sourceId: authentication.value.users[0].id,
          updateSequence: 3,
        },
      ]);
      expect(observerMeasurements).toEqual([
        {
          ...playerMeasurement,
          sourceId: authentication.value.users[0].id,
          updateSequence: 3,
        },
      ]);
    });
    expect(playerMeasurements).toEqual([]);

    const playerMeasurementClear = {
      ...playerMeasurement,
      active: false,
      points: [],
      updateSequence: 2,
    };
    await player.sendMeasurementUpdate(playerMeasurementClear);
    await vi.waitFor(() => {
      expect(hostMeasurements).toHaveLength(2);
      expect(observerMeasurements).toHaveLength(2);
    });

    await player.sendMeasurementUpdate({
      ...playerMeasurement,
      measurementId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      points: [{ x: 50_000, y: 50_000 }],
      updateSequence: 3,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hostMeasurements).toHaveLength(2);
    expect(observerMeasurements).toHaveLength(2);

    const hostMeasurement = {
      active: true,
      campaignId,
      measurementId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      points: [{ x: 50, y: 75 }],
      sceneId: scene.value.id,
      updateSequence: 1,
    };
    await host.sendMeasurementUpdate(hostMeasurement);
    await vi.waitFor(() => {
      expect(playerMeasurements).toEqual([
        { ...hostMeasurement, sourceId: campaignId },
      ]);
      expect(observerMeasurements).toHaveLength(3);
    });
    await host.setTransformPreviewRate({
      campaignId,
      transformPreviewRate: 32,
    });
    for (let updateSequence = 2; updateSequence <= 9; updateSequence += 1) {
      await host.sendMeasurementUpdate({
        ...hostMeasurement,
        points: [{ x: 50 + updateSequence, y: 75 }],
        updateSequence,
      });
    }
    await host.sendMeasurementUpdate({
      ...hostMeasurement,
      active: false,
      points: [],
      updateSequence: 10,
    });
    await vi.waitFor(() => {
      expect(playerMeasurements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            active: false,
            updateSequence: 10,
          }),
        ]),
      );
    });
    const hostSequences = playerMeasurements
      .filter(
        (update) =>
          (update as { sourceId?: string }).sourceId === campaignId,
      )
      .map((update) => (update as { updateSequence: number }).updateSequence);
    expect(hostSequences[0]).toBe(1);
    expect(hostSequences.at(-1)).toBe(10);
    expect(hostSequences).not.toEqual(
      expect.arrayContaining([3, 4, 5, 6, 7, 8, 9]),
    );

    await player.disconnect();
    await vi.waitFor(() => {
      expect(host.getHostStatus().connectedPlayerCount).toBe(1);
    });
    const reconnected = await player.connect({
      expectedCampaignId: campaignId,
      host: '127.0.0.1',
      port,
    });
    if (
      !reconnected.ok ||
      reconnected.value.state !== 'authentication_required'
    ) {
      throw new Error('Expected remembered trust during reconnect.');
    }
    await expect(
      player.authenticate({
        attemptId: reconnected.value.challenge.attemptId,
        useSavedPassword: true,
        userId: reconnected.value.challenge.users[0].id,
      }),
    ).resolves.toMatchObject({ ok: true });
    await vi.waitFor(() => {
      expect(host.getHostStatus().connectedPlayerCount).toBe(2);
      expect(player.getRemoteActiveScene(campaignId)?.id).toBe(
        scene.value.id,
      );
    });

    const playerMeasurementCountBeforeReconnectUpdate =
      playerMeasurements.length;
    const reconnectedMeasurement = {
      active: true,
      campaignId,
      measurementId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      points: [
        { x: 250, y: 200 },
        { x: 350, y: 300 },
      ],
      sceneId: scene.value.id,
      updateSequence: 1,
    };
    await player.sendMeasurementUpdate(reconnectedMeasurement);
    await vi.waitFor(() => {
      expect(hostMeasurements).toEqual(
        expect.arrayContaining([
          {
            ...reconnectedMeasurement,
            sourceId: authentication.value.users[0].id,
            updateSequence: 5,
          },
        ]),
      );
      expect(observerMeasurements).toEqual(
        expect.arrayContaining([
          {
            ...reconnectedMeasurement,
            sourceId: authentication.value.users[0].id,
            updateSequence: 5,
          },
        ]),
      );
    });
    expect(playerMeasurements).toHaveLength(
      playerMeasurementCountBeforeReconnectUpdate,
    );
    await player.sendMeasurementUpdate({
      ...reconnectedMeasurement,
      active: false,
      points: [],
      updateSequence: 2,
    });
    await vi.waitFor(() => {
      expect(observerMeasurements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            active: false,
            measurementId: reconnectedMeasurement.measurementId,
            updateSequence: 6,
          }),
        ]),
      );
    });

    await sceneRepository.present(null);
    await host.notifyScenePresented(campaignId);

    await vi.waitFor(() => {
      expect(player.getRemoteActiveScene(campaignId)).toBeNull();
      expect(observer.getRemoteActiveScene(campaignId)).toBeNull();
    });

    await vi.waitFor(async () => {
      const history = await player.listHistory();
      expect(history.ok && history.value[0].campaignId).toBe(campaignId);
      expect(history.ok && history.value[0].profiles[0]).toMatchObject({
        hasSavedPassword: true,
        username: 'Alice',
      });
    });

    await observer.disconnect();
    await vi.waitFor(() => {
      expect(host.getHostStatus().connectedPlayerCount).toBe(1);
    });

    const secondPlayer = new NetworkManager({
      campaignRepository,
      fetcher: unavailableFetch,
      historyRepository: new ConnectionHistoryRepository(
        path.join(directory, 'second-player-connections.json'),
        secureStorage,
      ),
      warn: vi.fn(),
    });
    managers.push(secondPlayer);
    const secondConnection = await secondPlayer.connect({
      host: '127.0.0.1',
      port,
    });
    if (
      !secondConnection.ok ||
      secondConnection.value.state !== 'trust_required'
    ) {
      throw new Error('Expected a second trust challenge.');
    }
    const secondChallenge = await secondPlayer.acceptTrust({
      attemptId: secondConnection.value.challenge.attemptId,
    });
    if (!secondChallenge.ok) {
      throw new Error('Expected a second authentication challenge.');
    }
    await expect(
      secondPlayer.authenticate({
        attemptId: secondChallenge.value.attemptId,
        password: 'password',
        useSavedPassword: false,
        userId: secondChallenge.value.users[0].id,
      }),
    ).resolves.toMatchObject({
      error: { code: 'account_connected' },
      ok: false,
    });

    await player.disconnect();
    await vi.waitFor(() => {
      expect(host.getHostStatus().connectedPlayerCount).toBe(0);
    });
    const remembered = await player.connect({
      expectedCampaignId: campaignId,
      host: '127.0.0.1',
      port,
    });
    expect(remembered.ok && remembered.value.state).toBe(
      'authentication_required',
    );
    if (!remembered.ok || remembered.value.state !== 'authentication_required') {
      throw new Error('Expected remembered trust.');
    }
    expect(remembered.value.challenge.users[0].hasSavedPassword).toBe(true);
    await expect(
      player.authenticate({
        attemptId: remembered.value.challenge.attemptId,
        useSavedPassword: true,
        userId: remembered.value.challenge.users[0].id,
      }),
    ).resolves.toMatchObject({ ok: true });

    const sessionClosed = new Promise<void>((resolve) => {
      player.once('session-closed', () => resolve());
    });
    await expect(
      host.resetPassword({
        campaignId,
        password: 'new password',
        userId: remembered.value.challenge.users[0].id,
      }),
    ).resolves.toMatchObject({ ok: true });
    await sessionClosed;
    await vi.waitFor(() => {
      expect(host.getHostStatus().connectedPlayerCount).toBe(0);
    });

    const afterReset = await player.connect({
      expectedCampaignId: campaignId,
      host: '127.0.0.1',
      port,
    });
    if (!afterReset.ok || afterReset.value.state !== 'authentication_required') {
      throw new Error('Expected authentication after account revocation.');
    }
    await expect(
      player.authenticate({
        attemptId: afterReset.value.challenge.attemptId,
        useSavedPassword: true,
        userId: afterReset.value.challenge.users[0].id,
      }),
    ).resolves.toMatchObject({
      error: { code: 'authentication_failed' },
      ok: false,
    });
    await expect(
      player.authenticate({
        attemptId: afterReset.value.challenge.attemptId,
        password: 'new password',
        useSavedPassword: false,
        userId: afterReset.value.challenge.users[0].id,
      }),
    ).resolves.toMatchObject({ ok: true });

    await player.disconnect();
    await vi.waitFor(() => {
      expect(host.getHostStatus().connectedPlayerCount).toBe(0);
    });

    const failingHistoryPlayer = new NetworkManager({
      campaignRepository,
      fetcher: unavailableFetch,
      historyRepository: new ConnectionHistoryRepository(
        path.join(directory, 'failing-player-connections.json'),
        {
          ...secureStorage,
          async encryptStringAsync() {
            throw new Error('Secure storage unavailable.');
          },
        },
      ),
      warn: vi.fn(),
    });
    managers.push(failingHistoryPlayer);
    const failingConnection = await failingHistoryPlayer.connect({
      host: '127.0.0.1',
      port,
    });
    if (
      !failingConnection.ok ||
      failingConnection.value.state !== 'trust_required'
    ) {
      throw new Error('Expected trust before persistence failure.');
    }
    const failingChallenge = await failingHistoryPlayer.acceptTrust({
      attemptId: failingConnection.value.challenge.attemptId,
    });
    if (!failingChallenge.ok) {
      throw new Error('Expected authentication before persistence failure.');
    }

    await expect(
      failingHistoryPlayer.authenticate({
        attemptId: failingChallenge.value.attemptId,
        password: 'new password',
        useSavedPassword: false,
        userId: failingChallenge.value.users[0].id,
      }),
    ).resolves.toMatchObject({
      error: {
        code: 'storage_error',
        message: 'Connection history could not be saved.',
      },
      ok: false,
    });
    await vi.waitFor(() => {
      expect(host.getHostStatus().connectedPlayerCount).toBe(0);
    });
  }, 20_000);
});
