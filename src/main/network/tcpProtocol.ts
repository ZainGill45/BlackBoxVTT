import type { Socket } from 'node:net';
import { z } from 'zod';
import {
  MAX_TRANSFORM_PREVIEW_RATE,
  MAX_DRAWING_PREVIEW_POINTS,
  MIN_TRANSFORM_PREVIEW_RATE,
  NETWORK_PROTOCOL_VERSION,
} from '../../shared/network';
import {
  ASSET_MANIFEST_SCHEMA_VERSION,
} from '../../shared/assets';
import {
  sceneDrawingPointSchema,
  sceneDrawingStyleSchema,
  sceneDrawingTransformSchema,
  sceneImageStateSchema,
  sceneImageTransformSchema,
  sceneRecordSchema,
} from '../sceneSchema';

export const MAX_TCP_MESSAGE_BYTES = 1024 * 1024;

const envelopeSchema = z
  .object({
    payload: z.unknown(),
    protocolVersion: z.literal(NETWORK_PROTOCOL_VERSION),
    requestId: z.string().min(1).max(128).optional(),
    type: z.string().min(1).max(96),
  })
  .strict();

const assetRecordSchema = z
  .object({
    chunkHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(2048),
    createdAt: z.string().datetime(),
    createdBy: z.string().min(1).max(256),
    displayName: z.string().min(1).max(256),
    extension: z.enum([
      'gif',
      'jpg',
      'm4a',
      'md',
      'mp3',
      'ogg',
      'pdf',
      'png',
      'txt',
      'wav',
      'webp',
    ]),
    fileModifiedAtMs: z.number().nonnegative(),
    format: z.enum([
      'gif',
      'jpeg',
      'm4a',
      'markdown',
      'mp3',
      'ogg',
      'pdf',
      'png',
      'text',
      'wav',
      'webp',
    ]),
    id: z.string().uuid(),
    kind: z.enum(['audio', 'document', 'image']),
    lastModifiedAt: z.string().datetime(),
    lastModifiedBy: z.string().min(1).max(256),
    mimeType: z.string().min(1).max(128),
    originalFilename: z.string().min(1).max(512),
    revision: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    sizeBytes: z.number().int().nonnegative().max(1024 ** 3),
  })
  .strict();

const assetCapabilitySchema = z
  .object({
    delete: z.boolean(),
    import: z.boolean(),
    list: z.boolean(),
    preview: z.boolean(),
    read: z.boolean(),
    rename: z.boolean(),
  })
  .strict();

const assetManifestSchema = z
  .object({
    assets: z.array(assetRecordSchema),
    revision: z.number().int().nonnegative(),
    schemaVersion: z.literal(ASSET_MANIFEST_SCHEMA_VERSION),
  })
  .strict();

const assetSnapshotSchema = z
  .object({
    campaignCapabilities: assetCapabilitySchema,
    manifest: assetManifestSchema,
    permissions: z.array(
      z
        .object({
          assetId: z.string().uuid(),
          capabilities: assetCapabilitySchema,
        })
        .strict(),
    ),
  })
  .strict();

const sceneObjectTransformSchema = z.union([
  sceneImageTransformSchema,
  sceneDrawingTransformSchema,
]);

const sceneTransformStartSchema = z
  .object({
    kind: z.enum(['move', 'nudge', 'resize', 'rotate']),
    operationId: z.string().uuid(),
    pivotX: z.number().finite(),
    pivotY: z.number().finite(),
    revision: z.number().int().nonnegative(),
    sceneId: z.string().uuid(),
    targets: z.array(z.string().min(1).max(128)).max(3_073),
  })
  .strict();

const drawingPreviewSchema = z
  .object({
    active: z.boolean(),
    closed: z.boolean(),
    kind: z.enum(['freeform', 'polyline']),
    layer: z.enum(['map', 'token', 'gm']),
    operationId: z.string().uuid(),
    points: z.array(sceneDrawingPointSchema).max(MAX_DRAWING_PREVIEW_POINTS),
    reliable: z.literal(true),
    sceneId: z.string().uuid(),
    sequence: z.number().int().min(0).max(0xffff_ffff),
    style: sceneDrawingStyleSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (
      (input.active && input.points.length === 0) ||
      (!input.active && input.points.length !== 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The drawing preview lifecycle is inconsistent.',
        path: ['points'],
      });
    }
  });

export class ProtocolVersionMismatchError extends Error {
  constructor() {
    super('The peer uses an incompatible protocol version.');
    this.name = 'ProtocolVersionMismatchError';
  }
}

export interface TcpEnvelope {
  payload: unknown;
  protocolVersion: typeof NETWORK_PROTOCOL_VERSION;
  requestId?: string;
  type: string;
}

export const protocolPayloadSchemas = {
  'client.asset_chunk_request': z
    .object({
      assetId: z.string().uuid(),
      index: z.number().int().nonnegative(),
    })
    .strict(),
  'client.asset_delete': z
    .object({
      assetId: z.string().uuid(),
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
  'client.asset_import_chunk': z
    .object({
      data: z.string(),
      hash: z.string().regex(/^[0-9a-f]{64}$/),
      index: z.number().int().nonnegative(),
      uploadId: z.string().uuid(),
    })
    .strict(),
  'client.asset_import_commit': z
    .object({ uploadId: z.string().uuid() })
    .strict(),
  'client.asset_import_start': z
    .object({
      displayName: z.string().min(1).max(256),
      originalFilename: z.string().min(1).max(512),
      sizeBytes: z.number().int().min(0),
    })
    .strict(),
  'client.asset_manifest': z.object({}).strict(),
  'client.asset_rename': z
    .object({
      assetId: z.string().uuid(),
      displayName: z.string().min(1).max(1024),
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
  'client.asset_sync_error': z
    .object({
      assetId: z.string().uuid().optional(),
      assetName: z.string().min(1).max(256),
      reason: z.string().min(1).max(1024),
    })
    .strict(),
  'client.authenticate': z
    .object({
      password: z.string().min(1),
      userId: z.string().uuid(),
    })
    .strict(),
  'client.map_ping': z
    .object({
      id: z.string().uuid(),
      pullPlayers: z.boolean(),
      sceneId: z.string().uuid(),
      x: z.number().finite(),
      y: z.number().finite(),
    })
    .strict(),
  'client.scene_drawing_preview': drawingPreviewSchema,
  'client.scene_objects_set': z
    .object({
      expectedRevision: z.number().int().nonnegative(),
      operationId: z.string().uuid(),
      sceneId: z.string().uuid(),
      state: sceneImageStateSchema,
    })
    .strict(),
  'client.scene_redo': z
    .object({ sceneId: z.string().uuid() })
    .strict(),
  'client.scene_transform_cancel': z
    .object({
      operationId: z.string().uuid(),
      sceneId: z.string().uuid(),
    })
    .strict(),
  'client.scene_transform_start': sceneTransformStartSchema,
  'client.scene_undo': z
    .object({ sceneId: z.string().uuid() })
    .strict(),
  'client.pong': z.object({ nonce: z.string().min(1).max(128) }).strict(),
  'client.trust_accepted': z.object({}).strict(),
  'client.udp_rekey': z.object({}).strict(),
  'server.auth_error': z
    .object({
      code: z.enum([
        'account_connected',
        'authentication_failed',
        'cooldown',
        'protocol_mismatch',
      ]),
      message: z.string().min(1).max(512),
    })
    .strict(),
  'server.asset_chunk': z
    .object({
      assetId: z.string().uuid(),
      data: z.string(),
      hash: z.string().regex(/^[0-9a-f]{64}$/),
      index: z.number().int().nonnegative(),
    })
    .strict(),
  'server.asset_error': z
    .object({
      assetId: z.string().uuid().optional(),
      code: z.enum([
        'conflict',
        'invalid_input',
        'not_found',
        'permission_denied',
        'storage_error',
        'sync_error',
        'unavailable',
      ]),
      message: z.string().min(1).max(1024),
    })
    .strict(),
  'server.asset_import_ready': z
    .object({
      uploadId: z.string().uuid(),
    })
    .strict(),
  'server.asset_manifest': assetSnapshotSchema,
  'server.asset_mutation': z
    .object({
      asset: assetRecordSchema.optional(),
      imported: z.array(assetRecordSchema).optional(),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  'server.assets_changed': assetSnapshotSchema,
  'server.hello': z
    .object({
      campaignId: z.string().uuid(),
      campaignName: z.string().min(1).max(64),
      protocolVersion: z.number().int(),
    })
    .strict(),
  'server.ping': z.object({ nonce: z.string().min(1).max(128) }).strict(),
  'server.map_ping': z
    .object({
      id: z.string().uuid(),
      pullPlayers: z.boolean(),
      sceneId: z.string().uuid(),
      x: z.number().finite(),
      y: z.number().finite(),
    })
    .strict(),
  'server.scene_error': z
    .object({
      code: z.enum([
        'conflict',
        'invalid_input',
        'not_found',
        'permission_denied',
        'storage_error',
        'unavailable',
      ]),
      message: z.string().min(1).max(1024),
      sceneId: z.string().uuid().optional(),
    })
    .strict(),
  'server.scene_drawing_preview': drawingPreviewSchema.extend({
    sourceId: z.string().min(1).max(128),
  }),
  'server.scene_mutation': z
    .object({ scene: sceneRecordSchema })
    .strict(),
  'server.scene_presented': z
    .object({ scene: sceneRecordSchema.nullable() })
    .strict(),
  'server.scene_transform_started': sceneTransformStartSchema.extend({
      startingTransforms: z
        .array(
          z
            .object({
              id: z.string().min(1).max(128),
              transform: sceneObjectTransformSchema,
            })
            .strict(),
        )
        .max(3_073),
    }).strict(),
  'server.scene_transform_cancelled': z
    .object({
      operationId: z.string().uuid(),
      sceneId: z.string().uuid(),
    })
    .strict(),
  'server.scene_transform_granted': z
    .object({ operationId: z.string().uuid() })
    .strict(),
  'server.update_rate_changed': z
    .object({
      updateRate: z
        .number()
        .int()
        .min(MIN_TRANSFORM_PREVIEW_RATE)
        .max(MAX_TRANSFORM_PREVIEW_RATE),
    })
    .strict(),
  'server.ready': z
    .object({
      campaignId: z.string().uuid(),
      campaignName: z.string().min(1).max(64),
      updateRate: z
        .number()
        .int()
        .min(MIN_TRANSFORM_PREVIEW_RATE)
        .max(MAX_TRANSFORM_PREVIEW_RATE),
      userId: z.string().uuid(),
      username: z.string().min(1).max(64),
    })
    .strict(),
  'server.udp_recovery_required': z.object({}).strict(),
  'server.udp_credentials': z
    .object({
      clientToServerKey: z.string().min(1),
      clientToServerNoncePrefix: z.string().min(1),
      epoch: z.number().int().nonnegative(),
      serverToClientKey: z.string().min(1),
      serverToClientNoncePrefix: z.string().min(1),
      sessionId: z.string().min(1),
    })
    .strict(),
  'server.users': z
    .object({
      users: z.array(
        z
          .object({
            id: z.string().uuid(),
            username: z.string().min(1).max(64),
          })
          .strict(),
      ),
    })
    .strict(),
} as const;

export type ProtocolMessageType = keyof typeof protocolPayloadSchemas;

export function parseEnvelope(input: unknown): TcpEnvelope {
  if (
    input &&
    typeof input === 'object' &&
    'protocolVersion' in input &&
    input.protocolVersion !== NETWORK_PROTOCOL_VERSION
  ) {
    throw new ProtocolVersionMismatchError();
  }
  return envelopeSchema.parse(input);
}

export function parsePayload<T extends ProtocolMessageType>(
  type: T,
  payload: unknown,
): z.infer<(typeof protocolPayloadSchemas)[T]> {
  return protocolPayloadSchemas[type].parse(payload) as z.infer<
    (typeof protocolPayloadSchemas)[T]
  >;
}

export function encodeFrame(envelope: TcpEnvelope): Buffer {
  const parsed = envelopeSchema.parse(envelope);
  const payload = Buffer.from(JSON.stringify(parsed), 'utf8');

  if (payload.length > MAX_TCP_MESSAGE_BYTES) {
    throw new Error('TCP message exceeds the maximum frame size.');
  }

  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

export function writeEnvelope(
  socket: Socket,
  type: ProtocolMessageType,
  payload: unknown,
  requestId?: string,
): boolean {
  return socket.write(
    encodeFrame({
      payload,
      protocolVersion: NETWORK_PROTOCOL_VERSION,
      requestId,
      type,
    }),
  );
}

export class FrameDecoder {
  private buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private expectedLength: number | null = null;

  push(chunk: Buffer): TcpEnvelope[] {
    this.buffered =
      this.buffered.length === 0
        ? chunk
        : Buffer.concat([this.buffered, chunk]);
    const envelopes: TcpEnvelope[] = [];

    while (this.buffered.length > 0 || this.expectedLength !== null) {
      if (this.expectedLength === null) {
        if (this.buffered.length < 4) {
          break;
        }

        this.expectedLength = this.buffered.readUInt32BE(0);
        this.buffered = this.buffered.subarray(4);

        if (
          this.expectedLength < 1 ||
          this.expectedLength > MAX_TCP_MESSAGE_BYTES
        ) {
          throw new Error('Invalid TCP frame length.');
        }
      }

      if (this.buffered.length < this.expectedLength) {
        break;
      }

      const source = this.buffered
        .subarray(0, this.expectedLength)
        .toString('utf8');
      this.buffered = this.buffered.subarray(this.expectedLength);
      this.expectedLength = null;

      let value: unknown;
      try {
        value = JSON.parse(source);
      } catch {
        throw new Error('TCP frame contains invalid JSON.');
      }
      envelopes.push(parseEnvelope(value));
    }

    return envelopes;
  }
}
