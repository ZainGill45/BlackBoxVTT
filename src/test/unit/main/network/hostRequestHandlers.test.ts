import { describe, expect, it, vi } from 'vitest';
import {
  type AssetRecord,
} from '../../../../shared/assets';
import type { ChatMessage } from '../../../../shared/chat';
import { NETWORK_PROTOCOL_VERSION } from '../../../../shared/network';
import {
  createDefaultGrid,
  createDefaultFog,
  createEmptyDrawingLayers,
  createEmptyImageLayers,
  createEmptyShapeLayers,
  createEmptyTextLayers,
  sceneObjectStateOf,
  type SceneRecord,
} from '../../../../shared/scenes';
import type { CampaignChatService } from '../../../../main/campaignTable/chatService';
import type { CampaignSceneService } from '../../../../main/campaignTable/sceneService';
import type { AssetRepository } from '../../../../main/assetRepository';
import type { AssetPolicy } from '../../../../main/assetPolicy';
import { HostAssetTransfer } from '../../../../main/network/hostAssetTransfer';
import { HostChatRequestHandler } from '../../../../main/network/hostChatRequestHandler';
import type { HostClient } from '../../../../main/network/hostClient';
import { HostSceneRequestHandler } from '../../../../main/network/hostSceneRequestHandler';
import {
  FrameDecoder,
  type TcpEnvelope,
} from '../../../../main/network/tcpProtocol';

const campaignId = '11111111-1111-4111-8111-111111111111';
const sceneId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const operationId = '44444444-4444-4444-8444-444444444444';

function envelope(type: string, payload: unknown): TcpEnvelope {
  return {
    payload,
    protocolVersion: NETWORK_PROTOCOL_VERSION,
    requestId: 'request',
    type,
  };
}

function createClient() {
  const writes: Buffer[] = [];
  const client = {
    socket: {
      write: vi.fn((frame: Buffer) => {
        writes.push(frame);
        return true;
      }),
    },
    user: { id: userId, username: 'Alice' },
  } as unknown as HostClient;
  return {
    client,
    writtenEnvelopes: () => {
      const decoder = new FrameDecoder();
      return writes.flatMap((frame) => decoder.push(frame));
    },
  };
}

function scene(): SceneRecord {
  return {
    createdAt: '2026-07-31T12:00:00.000Z',
    distance: 5,
    drawings: createEmptyDrawingLayers(),
    fog: createDefaultFog(),
    grid: createDefaultGrid(),
    height: 100,
    id: sceneId,
    images: createEmptyImageLayers(),
    mapImage: null,
    name: 'Arena',
    objectOrder: { gm: [], map: [], token: [] },
    pixelScale: 1,
    revision: 2,
    shapes: createEmptyShapeLayers(),
    unit: 'ft',
    updatedAt: '2026-07-31T12:00:00.000Z',
    width: 100,
    texts: createEmptyTextLayers(),
  };
}

describe('host chat request handler', () => {
  it('applies the authenticated player identity and reports a created message', async () => {
    const message: ChatMessage = {
      acceptedAt: '2026-07-31T12:00:00.000Z',
      clientMessageId: '55555555-5555-4555-8555-555555555555',
      generation: '66666666-6666-4666-8666-666666666666',
      id: '77777777-7777-4777-8777-777777777777',
      payload: { kind: 'text', text: 'Hello' },
      recipient: null,
      sender: { displayName: 'Alice', kind: 'player', userId },
      sequence: 1,
    };
    const send = vi.fn(async () => ({
      ok: true as const,
      value: { created: true, message },
    }));
    const onMessageCreated = vi.fn();
    const handler = new HostChatRequestHandler({
      chat: {
        bootstrap: vi.fn(),
        history: vi.fn(),
        send,
      } as unknown as CampaignChatService,
      onMessageCreated,
    });
    const { client, writtenEnvelopes } = createClient();

    await expect(
      handler.handleRequest(
        client,
        envelope('client.chat_send', {
          clientMessageId: message.clientMessageId,
          content: 'Hello',
          recipient: null,
        }),
      ),
    ).resolves.toBe(true);

    expect(send).toHaveBeenCalledWith(
      { displayName: 'Alice', kind: 'player', userId },
      {
        clientMessageId: message.clientMessageId,
        content: 'Hello',
        recipient: null,
      },
    );
    expect(onMessageCreated).toHaveBeenCalledWith(message, client);
    expect(writtenEnvelopes()).toEqual([
      expect.objectContaining({
        payload: message,
        requestId: 'request',
        type: 'server.chat_send_result',
      }),
    ]);
  });

  it('applies the authenticated player identity to an authoritative roll request', async () => {
    const definition = {
      category: 'Roll',
      sections: [
        { label: '1d20', modifiers: [], notation: '1d20', typeLabel: null },
      ],
      title: null,
    };
    const message: ChatMessage = {
      acceptedAt: '2026-07-31T12:00:00.000Z',
      clientMessageId: '58585858-5858-4858-8858-585858585858',
      generation: '68686868-6868-4868-8868-686868686868',
      id: '78787878-7878-4878-8878-787878787878',
      payload: {
        card: {
          ...definition,
          sections: [
            {
              ...definition.sections[0],
              baseTotal: 20,
              expression: [{ kind: 'number', value: 20 }],
              total: 20,
            },
          ],
        },
        kind: 'roll',
      },
      recipient: null,
      sender: { displayName: 'Alice', kind: 'player', userId },
      sequence: 1,
    };
    const sendRoll = vi.fn(async () => ({
      ok: true as const,
      value: { created: true, message },
    }));
    const onMessageCreated = vi.fn();
    const handler = new HostChatRequestHandler({
      chat: {
        bootstrap: vi.fn(),
        history: vi.fn(),
        send: vi.fn(),
        sendRoll,
      } as unknown as CampaignChatService,
      onMessageCreated,
    });
    const { client, writtenEnvelopes } = createClient();

    await expect(
      handler.handleRequest(
        client,
        envelope('client.chat_roll', {
          clientMessageId: message.clientMessageId,
          definition,
          recipient: null,
        }),
      ),
    ).resolves.toBe(true);
    expect(sendRoll).toHaveBeenCalledWith(
      { displayName: 'Alice', kind: 'player', userId },
      { clientMessageId: message.clientMessageId, definition, recipient: null },
    );
    expect(onMessageCreated).toHaveBeenCalledWith(message, client);
    expect(writtenEnvelopes()).toEqual([
      expect.objectContaining({ type: 'server.chat_roll_result' }),
    ]);
  });
});

describe('host scene request handler', () => {
  it('routes mutations with the authenticated actor before broadcasting', async () => {
    const activeScene = scene();
    const setPlayerObjects = vi.fn(async () => ({
      ok: true as const,
      value: activeScene,
    }));
    const onSceneMutation = vi.fn(async () => undefined);
    const handler = new HostSceneRequestHandler({
      broadcastDrawingPreview: vi.fn(),
      broadcastShapePreview: vi.fn(),
      broadcastTransformCancelled: vi.fn(),
      broadcastTransformStarted: vi.fn(),
      campaignId,
      onSceneMutation,
      scenes: {
        applyPlayerHistory: vi.fn(),
        beginPlayerTransform: vi.fn(),
        cancelTransform: vi.fn(),
        setPlayerObjects,
      } as unknown as CampaignSceneService,
    });
    const { client, writtenEnvelopes } = createClient();
    const state = sceneObjectStateOf(activeScene);

    await expect(
      handler.handleRequest(
        client,
        envelope('client.scene_objects_set', {
          expectedRevision: activeScene.revision,
          operationId,
          sceneId,
          state,
        }),
      ),
    ).resolves.toBe(true);

    expect(setPlayerObjects).toHaveBeenCalledWith(
      sceneId,
      state,
      activeScene.revision,
      operationId,
      userId,
    );
    expect(onSceneMutation).toHaveBeenCalledOnce();
    expect(writtenEnvelopes()).toEqual([
      expect.objectContaining({
        payload: { scene: activeScene },
        requestId: 'request',
        type: 'server.scene_mutation',
      }),
    ]);
  });
});

describe('host asset request handler', () => {
  it('authorizes mutations with the authenticated actor and broadcasts success', async () => {
    const asset: AssetRecord = {
      chunkHashes: [],
      createdAt: '2026-07-31T12:00:00.000Z',
      createdBy: userId,
      displayName: 'Map',
      extension: '.png',
      fileModifiedAtMs: 1,
      format: 'png',
      id: '88888888-8888-4888-8888-888888888888',
      kind: 'image',
      lastModifiedAt: '2026-07-31T12:00:00.000Z',
      lastModifiedBy: userId,
      mimeType: 'image/png',
      originalFilename: 'Map.png',
      revision: 1,
      sha256: 'a'.repeat(64),
      sizeBytes: 8,
    };
    const manifest = {
      assets: [asset],
      revision: 2,
    };
    const readManifest = vi.fn(async () => manifest);
    const renameAsset = vi.fn(async () => ({
      ok: true as const,
      value: { ...asset, displayName: 'Renamed' },
    }));
    const authorize = vi.fn(() => true);
    const broadcastAssetsChanged = vi.fn(async () => undefined);
    const handler = new HostAssetTransfer({
      assetPolicy: { authorize } as AssetPolicy,
      assetRepository: {
        readManifest,
        renameAsset,
      } as unknown as AssetRepository,
      broadcastAssetsChanged,
      onAssetSyncError: vi.fn(),
    });
    const { client, writtenEnvelopes } = createClient();

    await expect(
      handler.handleRequest(
        client,
        envelope('client.asset_rename', {
          assetId: asset.id,
          displayName: 'Renamed',
          expectedRevision: asset.revision,
        }),
      ),
    ).resolves.toBe(true);

    expect(authorize).toHaveBeenCalledWith({
      action: 'rename',
      asset,
      subject: { id: userId, role: 'player' },
    });
    expect(renameAsset).toHaveBeenCalledWith(
      asset.id,
      'Renamed',
      asset.revision,
      { id: userId, role: 'player' },
    );
    expect(broadcastAssetsChanged).toHaveBeenCalledOnce();
    expect(writtenEnvelopes()).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ revision: manifest.revision }),
        requestId: 'request',
        type: 'server.asset_mutation',
      }),
    ]);
  });
});
