import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CampaignRepository } from '../../../../main/campaignRepository';
import { CampaignDatabase } from '../../../../main/storage/campaignDatabase';
import { CampaignRuntimeRegistry } from '../../../../main/campaignRuntime';
import { CampaignWorkspaceRegistry } from '../../../../main/campaignWorkspace';
import { AssetRepository } from '../../../../main/assetRepository';
import { authenticatedAssetPolicy } from '../../../../main/assetPolicy';
import { SceneRepository } from '../../../../main/sceneRepository';
import type { ChatEvent } from '../../../../shared/chat';
import {
  createEmptyDrawingLayers,
  createEmptyImageLayers,
  imageStateOf,
  type SceneDrawing,
} from '../../../../shared/scenes';
import { ConnectionHistoryRepository } from '../../../../main/network/connectionHistoryRepository';
import { NetworkManager } from '../../../../main/network/networkManager';
import { ServerConfigRepository } from '../../../../main/network/serverConfigRepository';

/**
 * Real TLS, real sockets, real repositories — two NetworkManagers talking to a
 * third over the loopback interface.
 *
 * The session is expensive to build (certificate exchange, scrypt hashing, a
 * UDP association per client), so it is established once and the tests below
 * walk it forward in order. They deliberately share state: a scene presented by
 * one test is what a later one expects to receive. What they do not share is a
 * verdict — each behaviour fails under its own name, which is the difference
 * between "the network is broken" and "whispers stopped reaching the observer".
 *
 * Because the order is load-bearing, new cases belong next to the behaviour
 * they extend rather than at the end of the file.
 */

const campaignId = '11111111-1111-4111-8111-111111111111';
const userIdPattern = /^[0-9a-f-]{36}$/i;
const HANDSHAKE_TIMEOUT = 20_000;

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

const managers: NetworkManager[] = [];
const managerRuntimes = new Map<NetworkManager, CampaignRuntimeRegistry>();
let directory: string;
let campaignRepository: CampaignRepository;
let config: ServerConfigRepository;
let sceneRepository: SceneRepository;
let hostWorkspaces: CampaignWorkspaceRegistry;
let unavailableFetch: typeof fetch;
let port: number;

let host: NetworkManager;
let player: NetworkManager;
let observer: NetworkManager;

let openHostResult: Awaited<ReturnType<NetworkManager['openHost']>>;
let aliceUserId: string;
let bobUserId: string;
let importedAssetId: string;
let initialSceneId: string;
let presentedSceneId: string;

const hostChatEvents: ChatEvent[] = [];
const playerChatEvents: ChatEvent[] = [];
const observerChatEvents: ChatEvent[] = [];
const hostMeasurements: unknown[] = [];
const playerMeasurements: unknown[] = [];
const observerMeasurements: unknown[] = [];
const hostPings: unknown[] = [];
const playerPings: unknown[] = [];
const observerPings: unknown[] = [];
const hostDrawingPreviews: unknown[] = [];
const observerDrawingPreviews: unknown[] = [];

function createManager(name: string, storage = secureStorage): NetworkManager {
  const workspaces = new CampaignWorkspaceRegistry({
    campaignRepository,
    trashItem: (target) => rm(target, { force: true, recursive: true }),
    warn: vi.fn(),
  });
  if (name === 'host') {
    hostWorkspaces = workspaces;
  }
  const runtimes = new CampaignRuntimeRegistry(workspaces);
  const manager = new NetworkManager({
    assetCacheRoot: path.join(directory, `${name}-cache`),
    fetcher: unavailableFetch,
    historyRepository: new ConnectionHistoryRepository(
      path.join(directory, `${name}-application.sqlite`),
      storage,
    ),
    runtimes,
    warn: vi.fn(),
  });
  managerRuntimes.set(manager, runtimes);
  managers.push(manager);
  return manager;
}

async function joinedRuntime(manager: NetworkManager) {
  const runtime = await managerRuntimes.get(manager)?.resolve(campaignId);
  if (runtime?.kind !== 'joined') {
    throw new Error('Expected a joined campaign runtime.');
  }
  return runtime;
}

async function remoteScene(manager: NetworkManager) {
  const result = await (await joinedRuntime(manager)).scenes.list();
  if (!result.ok) {
    throw new Error('Expected the remote scene manifest.');
  }
  return (
    result.value.scenes.find(
      (scene) => scene.id === result.value.activeSceneId,
    ) ?? null
  );
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'blackbox-network-integration-'));
  campaignRepository = new CampaignRepository({
    createId: () => campaignId,
    rootDirectory: path.join(directory, 'campaigns'),
    trashItem: vi.fn(),
  });
  const created = await campaignRepository.create({ name: 'Iron Meridian' });
  expect(created.ok).toBe(true);
  const container = await campaignRepository.getContainer(campaignId);
  expect(container).not.toBeNull();

  const setupDatabase = CampaignDatabase.open(container!.directory);
  const setupConfig = new ServerConfigRepository(setupDatabase);
  const createdUser = await setupConfig.createUser('Alice', 'password');
  if (!createdUser.ok) {
    throw new Error('Expected a player account.');
  }
  expect(createdUser.value.id).toMatch(userIdPattern);
  aliceUserId = createdUser.value.id;
  const observerUser = await setupConfig.createUser('Bob', 'password');
  if (!observerUser.ok) {
    throw new Error('Expected a second user.');
  }
  bobUserId = observerUser.value.id;

  port = await getAvailablePort();
  await setupConfig.setPort(port);

  const assetSource = path.join(directory, 'Map.png');
  await writeFile(
    assetSource,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('network asset'),
    ]),
  );
  const assetRepository = new AssetRepository({
    database: setupDatabase,
    trashItem: (target) => rm(target, { force: true }),
  });
  const importedAsset = await assetRepository.importFiles([assetSource], {
    id: `gm:${campaignId}`,
    role: 'gm',
  });
  if (!importedAsset.ok || importedAsset.value.length === 0) {
    throw new Error('Expected an imported campaign asset.');
  }
  importedAssetId = importedAsset.value[0].id;

  const setupSceneRepository = new SceneRepository({
    database: setupDatabase,
  });
  const initialScene = await setupSceneRepository.create();
  if (!initialScene.ok) {
    throw new Error('Expected an initially presented scene.');
  }
  initialSceneId = initialScene.value.id;
  await setupSceneRepository.present(initialSceneId);
  setupDatabase.close();

  unavailableFetch = vi.fn(async () => ({ ok: false })) as unknown as typeof fetch;
  host = createManager('host');
  player = createManager('player');

  // Bound here rather than in the first test. A probed port is only free until
  // something else takes it, and vitest runs test files in parallel — leaving a
  // gap between the probe and the bind loses the port on a busy machine.
  openHostResult = await host.openHost(campaignId);
  const hostWorkspace = await hostWorkspaces.get(campaignId);
  if (!hostWorkspace) {
    throw new Error('Expected the host campaign workspace.');
  }
  config = hostWorkspace.configRepository;
  sceneRepository = hostWorkspace.sceneRepository;
}, HANDSHAKE_TIMEOUT);

afterAll(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
  if (directory) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe('hosting a campaign', () => {
  it('opens the host on the configured port', () => {
    expect(openHostResult).toMatchObject({
      ok: true,
      value: { effectivePort: port, state: 'online' },
    });
  });

  it('persists a changed transform preview rate', async () => {
    await expect(
      host.setTransformPreviewRate({ campaignId, transformPreviewRate: 128 }),
    ).resolves.toEqual({ ok: true, value: 128 });
    expect((await config.load()).transformPreviewRate).toBe(128);
  });

  it('keeps serving the current port when the requested one is occupied', async () => {
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
      // Falling back means tearing the listener down and binding the old port
      // again, which finishes after setPort resolves. Reading the status
      // synchronously here is a race that only shows up on a loaded machine.
      await vi.waitFor(() => {
        expect(host.getHostStatus()).toMatchObject({
          effectivePort: port,
          state: 'online',
        });
      });
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});

describe('trust and authentication', () => {
  let attemptId: string;

  it('challenges an unknown client to trust the certificate', async () => {
    const connected = await player.connect({ host: '127.0.0.1', port });
    if (!connected.ok || connected.value.state !== 'trust_required') {
      throw new Error('Expected a trust challenge.');
    }
    expect(connected.value.state).toBe('trust_required');
    attemptId = connected.value.challenge.attemptId;
  }, HANDSHAKE_TIMEOUT);

  it('offers the configured accounts once trust is accepted', async () => {
    const authentication = await player.acceptTrust({ attemptId });
    if (!authentication.ok) {
      throw new Error('Expected an authentication challenge.');
    }
    expect(authentication.value.users[0].username).toBe('Alice');
    attemptId = authentication.value.attemptId;
  });

  it('establishes a player session for a correct password', async () => {
    await expect(
      player.authenticate({
        attemptId,
        password: 'password',
        useSavedPassword: false,
        userId: aliceUserId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { campaignId, role: 'player', source: 'remote', username: 'Alice' },
    });
    expect(host.getHostStatus().connectedPlayerCount).toBe(1);
    host.on('measurement-update', (update) => hostMeasurements.push(update));
  }, HANDSHAKE_TIMEOUT);
});

describe('scene distribution', () => {
  it('relays a measurement from the joining player to the host', async () => {
    const firstJoinMeasurement = {
      active: true,
      campaignId,
      measurementId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      points: [{ x: 10, y: 10 }],
      sceneId: initialSceneId,
      updateSequence: 1,
    };
    await player.sendMeasurementUpdate(firstJoinMeasurement);
    await vi.waitFor(() => {
      expect(hostMeasurements).toEqual([
        { ...firstJoinMeasurement, sourceId: aliceUserId },
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
  });

  it('hands a joining player the scene that is already presented', async () => {
    await vi.waitFor(async () => {
      expect((await remoteScene(player))?.id).toBe(initialSceneId);
    });
  });

  it('clears the player scene when the host presents nothing', async () => {
    await sceneRepository.present(null);
    await host.notifyScenePresented(campaignId);
    await vi.waitFor(async () => {
      expect(await remoteScene(player)).toBeNull();
    });
    hostMeasurements.length = 0;
  });

  it('presents a scene with its grid and name to the player', async () => {
    const scene = await sceneRepository.create();
    if (!scene.ok) {
      throw new Error('Expected a created scene.');
    }
    presentedSceneId = scene.value.id;
    await sceneRepository.update(
      presentedSceneId,
      { grid: { size: 96, type: 'square' }, name: 'Iron Keep' },
      0,
    );
    await sceneRepository.setImages(
      presentedSceneId,
      {
        drawings: createEmptyDrawingLayers(),
        images: {
          ...createEmptyImageLayers(),
          gm: [
            {
              assetId: importedAssetId,
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
              assetId: importedAssetId,
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
      },
      1,
    );
    await sceneRepository.present(presentedSceneId);
    await host.notifyScenePresented(campaignId);

    await vi.waitFor(async () => {
      expect(await remoteScene(player)).toMatchObject({
        grid: { size: 96, type: 'square' },
        id: presentedSceneId,
        name: 'Iron Keep',
      });
    });
  });

  it('withholds the GM image layer from the player projection', async () => {
    expect((await remoteScene(player))?.images).toMatchObject({
      gm: [],
      token: [{ id: '66666666-6666-4666-8666-666666666666' }],
    });
  });
});

describe('campaign assets over the network', () => {
  it('synchronizes the imported asset to the player', async () => {
    const runtime = await joinedRuntime(player);
    const synchronized = await runtime.assets.prepare(
      authenticatedAssetPolicy,
      vi.fn(),
    );
    expect(synchronized).toMatchObject({
      ok: true,
      value: [{ available: true, displayName: 'Map.png', syncState: 'ready' }],
    });
    if (!synchronized.ok || synchronized.value.length === 0) {
      throw new Error('Expected synchronized campaign assets.');
    }

    const renamed = await runtime.assets.rename(
      {
        assetId: synchronized.value[0].id,
        campaignId,
        displayName: 'World Map.png',
        expectedRevision: synchronized.value[0].revision,
      },
      authenticatedAssetPolicy,
    );
    expect(renamed.result).toMatchObject({
      ok: true,
      value: { displayName: 'World Map.png' },
    });
  });

});

describe('a second player joining', () => {
  it('authenticates and receives the presented scene', async () => {
    observer = createManager('observer');
    const observerConnection = await observer.connect({ host: '127.0.0.1', port });
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
        userId: bobUserId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { role: 'player', username: 'Bob' },
    });
    await vi.waitFor(async () => {
      expect((await remoteScene(observer))?.id).toBe(presentedSceneId);
    });

    host.on('chat-event', (event) => hostChatEvents.push(event));
    player.on('chat-event', (event) => playerChatEvents.push(event));
    observer.on('chat-event', (event) => observerChatEvents.push(event));
  }, HANDSHAKE_TIMEOUT);
});

describe('chat delivery', () => {
  it('delivers a public message to the host and every player', async () => {
    await expect(
      player.sendChatMessage({
        campaignId,
        clientMessageId: '10101010-1010-4010-8010-101010101010',
        content: 'Public hello',
        recipient: null,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { content: 'Public hello', sequence: 1 },
    });
    await vi.waitFor(() => {
      expect(
        hostChatEvents.filter((event) => event.type === 'message'),
      ).toHaveLength(1);
      expect(
        observerChatEvents.filter((event) => event.type === 'message'),
      ).toHaveLength(1);
    });
  });

  it('delivers a player whisper to its recipient only', async () => {
    await expect(
      player.sendChatMessage({
        campaignId,
        clientMessageId: '20202020-2020-4020-8020-202020202020',
        content: 'Private for Bob',
        recipient: { kind: 'player', userId: bobUserId },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { content: 'Private for Bob', recipient: { displayName: 'Bob' } },
    });
    await vi.waitFor(() => {
      expect(
        observerChatEvents.filter((event) => event.type === 'message'),
      ).toHaveLength(2);
    });
  });

  it('does not leak a player whisper to the Game Master', () => {
    // The recipient has already received it, so the host has finished routing.
    expect(
      hostChatEvents.filter((event) => event.type === 'message'),
    ).toHaveLength(1);
  });

  it('delivers a Game Master whisper to its recipient only', async () => {
    await expect(
      host.sendChatMessage({
        campaignId,
        clientMessageId: '30303030-3030-4030-8030-303030303030',
        content: 'Private for Alice',
        recipient: { kind: 'player', userId: aliceUserId },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { content: 'Private for Alice', recipient: { displayName: 'Alice' } },
    });
    await vi.waitFor(() => {
      expect(
        playerChatEvents.filter((event) => event.type === 'message'),
      ).toHaveLength(1);
    });
    expect(
      observerChatEvents.filter((event) => event.type === 'message'),
    ).toHaveLength(2);
  });

  it('scopes replayed history to what each participant may see', async () => {
    const [hostChat, playerChat, observerChat] = await Promise.all([
      host.getChatBootstrap(campaignId),
      player.getChatBootstrap(campaignId),
      observer.getChatBootstrap(campaignId),
    ]);
    expect(
      hostChat.ok && hostChat.value.messages.map((message) => message.content),
    ).toEqual(['Public hello', 'Private for Alice']);
    expect(
      playerChat.ok && playerChat.value.messages.map((message) => message.content),
    ).toEqual(['Public hello', 'Private for Bob', 'Private for Alice']);
    expect(
      observerChat.ok &&
        observerChat.value.messages.map((message) => message.content),
    ).toEqual(['Public hello', 'Private for Bob']);
  });

  it('lets only the Game Master change the message length limit', async () => {
    await expect(
      player.setMaxChatMessageCharacters({
        campaignId,
        maxMessageCharacters: 4_000,
      }),
    ).resolves.toMatchObject({
      error: { code: 'permission_denied' },
      ok: false,
    });
    await expect(
      host.setMaxChatMessageCharacters({
        campaignId,
        maxMessageCharacters: 5_000,
      }),
    ).resolves.toEqual({ ok: true, value: 5_000 });
  });

  it('broadcasts the new limit to every connected player', async () => {
    await vi.waitFor(() => {
      expect(playerChatEvents).toContainEqual({
        campaignId,
        maxMessageCharacters: 5_000,
        type: 'limit_changed',
      });
      expect(observerChatEvents).toContainEqual({
        campaignId,
        maxMessageCharacters: 5_000,
        type: 'limit_changed',
      });
    });
  });
});

describe('drawings', () => {
  const drawingId = '44444444-4444-4444-8444-444444444444';
  const style: SceneDrawing['style'] = {
    edge: 'hard',
    fillColor: '#ffffff',
    fillEnabled: false,
    fillOpacity: 0.25,
    hardness: 1,
    strokeColor: '#ffffff',
    strokeOpacity: 1,
    strokeWidth: 12,
  };
  const liveDrawing: SceneDrawing = {
    closed: false,
    id: drawingId,
    kind: 'freeform',
    ownerId: null,
    points: [
      { x: -10, y: 0 },
      { x: 10, y: 0 },
    ],
    revision: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    style,
    x: 200,
    y: 200,
  };

  it('relays a live preview to everyone and forces it onto the token layer', async () => {
    host.on('drawing-preview', (preview) => hostDrawingPreviews.push(preview));
    observer.on('drawing-preview', (preview) =>
      observerDrawingPreviews.push(preview),
    );
    await player.sendDrawingPreview({
      active: true,
      campaignId,
      closed: false,
      kind: 'freeform',
      // A player asking for the GM layer must not get it.
      layer: 'gm',
      operationId: drawingId,
      points: [
        { x: 190, y: 200 },
        { x: 210, y: 200 },
      ],
      reliable: true,
      sceneId: presentedSceneId,
      sequence: 1,
      style,
    });
    await vi.waitFor(() => {
      expect(hostDrawingPreviews).toEqual([
        expect.objectContaining({
          layer: 'token',
          operationId: drawingId,
          reliable: true,
          sourceId: aliceUserId,
        }),
      ]);
      expect(observerDrawingPreviews).toEqual(hostDrawingPreviews);
    });
  });

  it('stamps the committing player as the owner and propagates the commit', async () => {
    const playerScene = await remoteScene(player);
    if (!playerScene) {
      throw new Error('Expected the player scene.');
    }
    const drawingState = imageStateOf(playerScene);
    drawingState.drawings.token.push(liveDrawing);

    const committed = await (await joinedRuntime(player)).scenes.setObjects({
        campaignId,
        expectedRevision: playerScene.revision,
        operationId: drawingId,
        sceneId: playerScene.id,
        state: drawingState,
      });
    expect(committed.result).toMatchObject({
      ok: true,
      value: {
        drawings: { token: [{ id: drawingId, ownerId: aliceUserId }] },
      },
    });
    await vi.waitFor(async () => {
      expect(
        (await remoteScene(observer))?.drawings.token[0],
      ).toMatchObject({ id: drawingId, ownerId: aliceUserId });
    });
  });

});

describe('map pings', () => {
  const playerPing = {
    campaignId,
    id: '77777777-7777-4777-8777-777777777777',
    pullPlayers: true,
    sceneId: '',
    x: 400,
    y: 300,
  };

  it('broadcasts a player ping to the host and every player', async () => {
    host.on('map-ping', (ping) => hostPings.push(ping));
    player.on('map-ping', (ping) => playerPings.push(ping));
    observer.on('map-ping', (ping) => observerPings.push(ping));
    playerPing.sceneId = presentedSceneId;

    await player.sendMapPing(playerPing);
    await vi.waitFor(() => {
      expect(hostPings).toEqual([playerPing]);
      expect(playerPings).toEqual([playerPing]);
      expect(observerPings).toEqual([playerPing]);
    });
  });

  it('broadcasts a Game Master ping to every participant', async () => {
    const hostPing = {
      campaignId,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      pullPlayers: false,
      sceneId: presentedSceneId,
      x: 600,
      y: 500,
    };
    await host.sendMapPing(hostPing);
    await vi.waitFor(() => {
      expect(hostPings).toEqual([playerPing, hostPing]);
      expect(playerPings).toEqual([playerPing, hostPing]);
      expect(observerPings).toEqual([playerPing, hostPing]);
    });
  });
});

describe('measurements', () => {
  let playerMeasurement: {
    active: boolean;
    campaignId: string;
    measurementId: string;
    points: { x: number; y: number }[];
    sceneId: string;
    updateSequence: number;
  };

  it('broadcasts a player measurement without echoing it to the sender', async () => {
    player.on('measurement-update', (update) => playerMeasurements.push(update));
    observer.on('measurement-update', (update) =>
      observerMeasurements.push(update),
    );
    playerMeasurement = {
      active: true,
      campaignId,
      measurementId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      points: [
        { x: 100, y: 100 },
        { x: 300, y: 400 },
      ],
      sceneId: presentedSceneId,
      updateSequence: 1,
    };

    await player.sendMeasurementUpdate(playerMeasurement);
    await vi.waitFor(() => {
      expect(hostMeasurements).toEqual([
        { ...playerMeasurement, sourceId: aliceUserId, updateSequence: 3 },
      ]);
      expect(observerMeasurements).toEqual([
        { ...playerMeasurement, sourceId: aliceUserId, updateSequence: 3 },
      ]);
    });
    expect(playerMeasurements).toEqual([]);
  });

  it('propagates the clearing update', async () => {
    await player.sendMeasurementUpdate({
      ...playerMeasurement,
      active: false,
      points: [],
      updateSequence: 2,
    });
    await vi.waitFor(() => {
      expect(hostMeasurements).toHaveLength(2);
      expect(observerMeasurements).toHaveLength(2);
    });
  });

  it('attributes a Game Master measurement to the campaign itself', async () => {
    const hostMeasurement = {
      active: true,
      campaignId,
      measurementId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      points: [{ x: 50, y: 75 }],
      sceneId: presentedSceneId,
      updateSequence: 1,
    };
    await host.sendMeasurementUpdate(hostMeasurement);
    await vi.waitFor(() => {
      expect(playerMeasurements).toEqual([
        { ...hostMeasurement, sourceId: campaignId },
      ]);
      expect(observerMeasurements).toHaveLength(3);
    });
  });

  it('coalesces intermediate updates but always delivers the first and last', async () => {
    const hostMeasurement = {
      active: true,
      campaignId,
      measurementId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      points: [{ x: 50, y: 75 }],
      sceneId: presentedSceneId,
      updateSequence: 1,
    };
    await host.setTransformPreviewRate({ campaignId, transformPreviewRate: 32 });
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
          expect.objectContaining({ active: false, updateSequence: 10 }),
        ]),
      );
    });

    const hostSequences = playerMeasurements
      .filter((update) => (update as { sourceId?: string }).sourceId === campaignId)
      .map((update) => (update as { updateSequence: number }).updateSequence);
    expect(hostSequences[0]).toBe(1);
    expect(hostSequences.at(-1)).toBe(10);
    expect(hostSequences).not.toEqual(
      expect.arrayContaining([3, 4, 5, 6, 7, 8, 9]),
    );
  });
});

describe('reconnecting', () => {
  it('drops the connected count when a player disconnects', async () => {
    await player.disconnect();
    await vi.waitFor(() => {
      expect(host.getHostStatus().connectedPlayerCount).toBe(1);
    });
  });

  it('remembers trust and the saved password on reconnect', async () => {
    const reconnected = await player.connect({
      expectedCampaignId: campaignId,
      host: '127.0.0.1',
      port,
    });
    if (!reconnected.ok || reconnected.value.state !== 'authentication_required') {
      throw new Error('Expected remembered trust during reconnect.');
    }
    await expect(
      player.authenticate({
        attemptId: reconnected.value.challenge.attemptId,
        useSavedPassword: true,
        userId: reconnected.value.challenge.users[0].id,
      }),
    ).resolves.toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      expect(host.getHostStatus().connectedPlayerCount).toBe(2);
      expect((await remoteScene(player))?.id).toBe(presentedSceneId);
    });
  }, HANDSHAKE_TIMEOUT);

  it('resumes measurement delivery after the reconnect', async () => {
    const countBeforeUpdate = playerMeasurements.length;
    const reconnectedMeasurement = {
      active: true,
      campaignId,
      measurementId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      points: [
        { x: 250, y: 200 },
        { x: 350, y: 300 },
      ],
      sceneId: presentedSceneId,
      updateSequence: 1,
    };
    await player.sendMeasurementUpdate(reconnectedMeasurement);
    await vi.waitFor(() => {
      expect(hostMeasurements).toEqual(
        expect.arrayContaining([
          { ...reconnectedMeasurement, sourceId: aliceUserId, updateSequence: 5 },
        ]),
      );
      expect(observerMeasurements).toEqual(
        expect.arrayContaining([
          { ...reconnectedMeasurement, sourceId: aliceUserId, updateSequence: 5 },
        ]),
      );
    });
    // Still no echo back to the sender.
    expect(playerMeasurements).toHaveLength(countBeforeUpdate);

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
  });

  it('clears the scene for every player when presentation stops', async () => {
    await sceneRepository.present(null);
    await host.notifyScenePresented(campaignId);
    await vi.waitFor(async () => {
      expect(await remoteScene(player)).toBeNull();
      expect(await remoteScene(observer)).toBeNull();
    });
  });

  it('records the campaign and its saved profile in connection history', async () => {
    await vi.waitFor(async () => {
      const history = await player.listHistory();
      expect(history.ok && history.value[0].campaignId).toBe(campaignId);
      expect(history.ok && history.value[0].profiles[0]).toMatchObject({
        hasSavedPassword: true,
        username: 'Alice',
      });
    });
  });
});

describe('chat for an absent player', () => {
  it('accepts a whisper addressed to someone who has left', async () => {
    await observer.disconnect();
    await vi.waitFor(() => {
      expect(host.getHostStatus().connectedPlayerCount).toBe(1);
    });
    await expect(
      player.sendChatMessage({
        campaignId,
        clientMessageId: '40404040-4040-4040-8040-404040404040',
        content: 'Waiting offline',
        recipient: { kind: 'player', userId: bobUserId },
      }),
    ).resolves.toMatchObject({ ok: true, value: { content: 'Waiting offline' } });
  });

  it('replays the missed whisper when that player returns', async () => {
    const observerReconnect = await observer.connect({
      expectedCampaignId: campaignId,
      host: '127.0.0.1',
      port,
    });
    if (
      !observerReconnect.ok ||
      observerReconnect.value.state !== 'authentication_required'
    ) {
      throw new Error('Expected remembered observer trust.');
    }
    await expect(
      observer.authenticate({
        attemptId: observerReconnect.value.challenge.attemptId,
        useSavedPassword: true,
        userId: bobUserId,
      }),
    ).resolves.toMatchObject({ ok: true });

    const offlineHistory = await observer.getChatBootstrap(campaignId);
    expect(
      offlineHistory.ok &&
        offlineHistory.value.messages.map((message) => message.content),
    ).toContain('Waiting offline');
  }, HANDSHAKE_TIMEOUT);

  it('rotates the generation and empties history for everyone on clear', async () => {
    await observer.disconnect();
    await vi.waitFor(() => {
      expect(host.getHostStatus().connectedPlayerCount).toBe(1);
    });

    const beforeClear = await player.getChatBootstrap(campaignId);
    const cleared = await host.clearChatHistory(campaignId);
    expect(cleared).toMatchObject({ ok: true });
    if (beforeClear.ok && cleared.ok) {
      expect(cleared.value.generation).not.toBe(beforeClear.value.generation);
    }
    await vi.waitFor(async () => {
      await expect(player.getChatBootstrap(campaignId)).resolves.toMatchObject({
        ok: true,
        value: { messages: [] },
      });
    });
  });
});

describe('account protection', () => {
  it('refuses a second connection using an account that is already in play', async () => {
    const secondPlayer = createManager('second-player');
    const secondConnection = await secondPlayer.connect({
      host: '127.0.0.1',
      port,
    });
    if (!secondConnection.ok || secondConnection.value.state !== 'trust_required') {
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
  }, HANDSHAKE_TIMEOUT);

  it('offers the saved password once the account is free again', async () => {
    await player.disconnect();
    await vi.waitFor(() => {
      expect(host.getHostStatus().connectedPlayerCount).toBe(0);
    });
    const remembered = await player.connect({
      expectedCampaignId: campaignId,
      host: '127.0.0.1',
      port,
    });
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
  }, HANDSHAKE_TIMEOUT);

  it('closes the live session when the Game Master resets that password', async () => {
    const sessionClosed = new Promise<void>((resolve) => {
      player.once('session-closed', () => resolve());
    });
    await expect(
      host.resetPassword({
        campaignId,
        password: 'new password',
        userId: aliceUserId,
      }),
    ).resolves.toMatchObject({ ok: true });
    await sessionClosed;
    await vi.waitFor(() => {
      expect(host.getHostStatus().connectedPlayerCount).toBe(0);
    });
  });

  it('invalidates the saved password and accepts only the new one', async () => {
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
  }, HANDSHAKE_TIMEOUT);
});

describe('connection history failures', () => {
  it('refuses the session when the saved profile cannot be written', async () => {
    await player.disconnect();
    await vi.waitFor(() => {
      expect(host.getHostStatus().connectedPlayerCount).toBe(0);
    });

    const failingHistoryPlayer = createManager('failing-player', {
      ...secureStorage,
      async encryptStringAsync() {
        throw new Error('Secure storage unavailable.');
      },
    });
    const failingConnection = await failingHistoryPlayer.connect({
      host: '127.0.0.1',
      port,
    });
    if (!failingConnection.ok || failingConnection.value.state !== 'trust_required') {
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
  }, HANDSHAKE_TIMEOUT);
});
