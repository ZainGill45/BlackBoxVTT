import type { Socket } from 'node:net';
import type {
  DrawingPreviewUpdate,
  ShapePreviewUpdate,
} from '../../shared/network';
import type {
  SceneRecord,
  SceneResult,
  SceneTransformPreviewCancel,
  SceneTransformPreviewStart,
} from '../../shared/scenes';
import type { CampaignSceneService } from '../campaignTable/sceneService';
import type { HostClient } from './hostClient';
import {
  parsePayload,
  writeEnvelope,
  type TcpEnvelope,
} from './tcpProtocol';

type PlayerSceneService = Pick<
  CampaignSceneService,
  | 'applyPlayerHistory'
  | 'beginPlayerTransform'
  | 'cancelTransform'
  | 'listForPlayer'
  | 'setPlayerObjects'
  | 'trashForPlayer'
  | 'updateForPlayer'
>;

interface HostSceneRequestHandlerOptions {
  broadcastDrawingPreview: (
    input: DrawingPreviewUpdate,
    source: HostClient,
  ) => Promise<void>;
  broadcastShapePreview: (
    input: ShapePreviewUpdate,
    source: HostClient,
  ) => Promise<void>;
  broadcastTransformCancelled: (
    input: SceneTransformPreviewCancel,
    source: HostClient,
  ) => void;
  broadcastTransformStarted: (
    input: SceneTransformPreviewStart,
    source: HostClient,
  ) => Promise<void>;
  campaignId: string;
  onSceneMutation: () => Promise<void>;
  scenes: PlayerSceneService;
}

/** Translates authenticated player scene requests into table operations. */
export class HostSceneRequestHandler {
  constructor(
    private readonly options: HostSceneRequestHandlerOptions,
  ) {}

  async handleRequest(
    client: HostClient,
    envelope: TcpEnvelope,
  ): Promise<boolean> {
    if (!client.user) {
      return false;
    }
    if (envelope.type === 'client.scene_list') {
      parsePayload('client.scene_list', envelope.payload);
      writeEnvelope(
        client.socket as unknown as Socket,
        'server.scene_manifest',
        await this.options.scenes.listForPlayer(client.user.id),
        envelope.requestId,
      );
      return true;
    }
    if (envelope.type === 'client.scene_update') {
      const input = parsePayload('client.scene_update', envelope.payload);
      const result = await this.options.scenes.updateForPlayer(
        client.user.id,
        input,
      );
      this.sendResult(client, result, envelope.requestId);
      if (result.ok) await this.options.onSceneMutation();
      return true;
    }
    if (envelope.type === 'client.scene_trash') {
      const input = parsePayload('client.scene_trash', envelope.payload);
      const result = await this.options.scenes.trashForPlayer(
        client.user.id,
        input,
      );
      /* Deleting answers with the caller's remaining library rather than a
         scene, because the scene it names is gone. */
      if (!result.ok) {
        this.sendResult(client, result, envelope.requestId);
        return true;
      }
      writeEnvelope(
        client.socket as unknown as Socket,
        'server.scene_manifest',
        await this.options.scenes.listForPlayer(client.user.id),
        envelope.requestId,
      );
      await this.options.onSceneMutation();
      return true;
    }
    if (envelope.type === 'client.scene_drawing_preview') {
      const input = parsePayload(
        'client.scene_drawing_preview',
        envelope.payload,
      );
      await this.options.broadcastDrawingPreview(
        {
          ...input,
          campaignId: this.options.campaignId,
          layer: 'token',
        },
        client,
      );
      return true;
    }
    if (envelope.type === 'client.scene_shape_preview') {
      const input = parsePayload(
        'client.scene_shape_preview',
        envelope.payload,
      );
      await this.options.broadcastShapePreview(
        {
          ...input,
          campaignId: this.options.campaignId,
          layer: 'token',
        },
        client,
      );
      return true;
    }
    if (envelope.type === 'client.scene_objects_set') {
      const input = parsePayload(
        'client.scene_objects_set',
        envelope.payload,
      );
      const result = input.arrangement
        ? await this.options.scenes.setPlayerObjects(
            input.sceneId,
            input.state,
            input.expectedRevision,
            input.operationId,
            client.user.id,
            input.arrangement,
          )
        : await this.options.scenes.setPlayerObjects(
            input.sceneId,
            input.state,
            input.expectedRevision,
            input.operationId,
            client.user.id,
          );
      this.sendResult(client, result, envelope.requestId);
      if (result.ok) {
        await this.options.onSceneMutation();
      }
      return true;
    }
    if (
      envelope.type === 'client.scene_undo' ||
      envelope.type === 'client.scene_redo'
    ) {
      const input =
        envelope.type === 'client.scene_undo'
          ? parsePayload('client.scene_undo', envelope.payload)
          : parsePayload('client.scene_redo', envelope.payload);
      const result = await this.options.scenes.applyPlayerHistory(
        envelope.type === 'client.scene_undo' ? 'undo' : 'redo',
        input.sceneId,
        client.user.id,
      );
      this.sendResult(client, result, envelope.requestId);
      if (result.ok) {
        await this.options.onSceneMutation();
      }
      return true;
    }
    if (envelope.type === 'client.scene_transform_start') {
      const input = parsePayload(
        'client.scene_transform_start',
        envelope.payload,
      );
      const result = await this.options.scenes.beginPlayerTransform(
        input.sceneId,
        input.operationId,
        input.targets,
        client.user.id,
      );
      if (!result.ok) {
        this.sendResult(client, result, envelope.requestId);
        return true;
      }
      await this.options.broadcastTransformStarted(
        {
          ...input,
          campaignId: this.options.campaignId,
          startingTransforms: [],
        },
        client,
      );
      writeEnvelope(
        client.socket as unknown as Socket,
        'server.scene_transform_granted',
        { operationId: input.operationId },
        envelope.requestId,
      );
      return true;
    }
    if (envelope.type === 'client.scene_transform_cancel') {
      const input = parsePayload(
        'client.scene_transform_cancel',
        envelope.payload,
      );
      this.options.scenes.cancelTransform(
        input.operationId,
        client.user.id,
      );
      this.options.broadcastTransformCancelled(
        { ...input, campaignId: this.options.campaignId },
        client,
      );
      return true;
    }
    return false;
  }

  private sendResult(
    client: HostClient,
    result: SceneResult<SceneRecord> | SceneResult<null>,
    requestId?: string,
  ): void {
    if (!result.ok) {
      writeEnvelope(
        client.socket as unknown as Socket,
        'server.scene_error',
        result.error,
        requestId,
      );
      return;
    }
    if (result.value && 'id' in result.value) {
      writeEnvelope(
        client.socket as unknown as Socket,
        'server.scene_mutation',
        { scene: result.value },
        requestId,
      );
    }
  }
}
