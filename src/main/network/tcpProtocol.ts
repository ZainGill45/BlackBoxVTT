import type { Socket } from 'node:net';
import { z } from 'zod';
import {
  MAX_SCENE_OBJECTS,
  SCENE_LAYERS,
} from '../../shared/scenes';
import {
  MAX_CHAT_HISTORY_PAGE_MESSAGES,
  MAX_CHAT_MESSAGE_BYTES,
  MAX_MAX_CHAT_MESSAGE_CHARACTERS,
  MIN_MAX_CHAT_MESSAGE_CHARACTERS,
  chatUtf8ByteLength,
} from '../../shared/chat';
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
  sceneObjectStateSchema,
  sceneObjectTransformSchema,
  sceneRecordSchema,
  sceneShapePreviewSchema,
} from '../../shared/sceneSchema';
import { sceneArrangementSchema } from '../../shared/sceneContracts';
import {
  chatRollCardSchema,
  chatRollDefinitionSchema,
} from '../../shared/chatRoll';
import {
  JOURNAL_ENTRY_TYPE_NOTE,
  JOURNAL_SCHEMA_VERSION,
  MAX_JOURNAL_CLEANUP_ASSETS,
  MAX_JOURNAL_ENTRIES,
  MAX_JOURNAL_PERMISSION_OVERRIDES,
  MAX_JOURNAL_TITLE_INPUT_CODE_UNITS,
  MAX_NOTE_PAGES,
  isJournalTitleStyle,
  isRichTextDocument,
  type JournalTitleStyle,
  type RichTextDocumentV1,
} from '../../shared/journal';

export const MAX_TCP_MESSAGE_BYTES = 3 * 1024 * 1024;

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

const sceneTransformStartSchema = z
  .object({
    kind: z.enum(['move', 'nudge', 'resize', 'rotate']),
    operationId: z.string().uuid(),
    pivotX: z.number().finite(),
    pivotY: z.number().finite(),
    revision: z.number().int().nonnegative(),
    sceneId: z.string().uuid(),
    targets: z.array(z.string().min(1).max(128)).max(MAX_SCENE_OBJECTS),
  })
  .strict();

const drawingPreviewSchema = z
  .object({
    active: z.boolean(),
    closed: z.boolean(),
    kind: z.enum(['freeform', 'polyline']),
    layer: z.enum(SCENE_LAYERS),
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

const shapePreviewSchema = z
  .object({
    layer: z.enum(SCENE_LAYERS),
    operationId: z.string().uuid(),
    phase: z.enum(['cancel', 'final', 'start', 'update']),
    reliable: z.literal(true),
    sceneId: z.string().uuid(),
    sequence: z.number().int().min(0).max(0xffff_ffff),
    shape: sceneShapePreviewSchema.nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    const needsShape = input.phase === 'final' || input.phase === 'update';
    if (needsShape !== Boolean(input.shape)) {
      context.addIssue({
        code: 'custom',
        message: 'The shape preview lifecycle is inconsistent.',
        path: ['shape'],
      });
    }
    if (input.phase === 'update') {
      context.addIssue({
        code: 'custom',
        message: 'Shape updates must use the throttled snapshot channel.',
        path: ['phase'],
      });
    }
  });

const chatPrincipalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('gm') }).strict(),
  z
    .object({
      kind: z.literal('player'),
      userId: z.string().uuid(),
    })
    .strict(),
]);

const chatIdentitySchema = z.discriminatedUnion('kind', [
  z
    .object({
      displayName: z.literal('Game Master'),
      kind: z.literal('gm'),
    })
    .strict(),
  z
    .object({
      displayName: z.string().min(1).max(64),
      kind: z.literal('player'),
      userId: z.string().uuid(),
    })
    .strict(),
]);

const chatContentSchema = z
  .string()
  .min(1)
  .max(MAX_CHAT_MESSAGE_BYTES)
  .refine(
    (content) => chatUtf8ByteLength(content) <= MAX_CHAT_MESSAGE_BYTES,
    'Chat content exceeds the encoded size limit.',
  );

const chatMessageSchema = z
  .object({
    acceptedAt: z.string().datetime(),
    clientMessageId: z.string().uuid(),
    generation: z.string().uuid(),
    id: z.string().uuid(),
    payload: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('text'), text: chatContentSchema }).strict(),
      z.object({ card: chatRollCardSchema, kind: z.literal('roll') }).strict(),
    ]),
    recipient: chatIdentitySchema.nullable(),
    sender: chatIdentitySchema,
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

const campaignSystemStateSchema = z
  .object({
    id: z.string().min(1).max(128),
    schemaVersion: z.number().int().positive(),
    settings: z.json(),
  })
  .strict();

const journalEntryAccessSchema = z.enum(['none', 'view', 'edit']);
const journalPageAccessSchema = z.enum(['inherit', 'none', 'view', 'edit']);
const journalPermissionsSchema = <T extends z.ZodTypeAny>(access: T) => z
  .object({
    allPlayers: access,
    overrides: z.array(z.object({ access, userId: z.string().uuid() }).strict())
      .max(MAX_JOURNAL_PERMISSION_OVERRIDES),
  })
  .strict();
const journalEntryCapabilitiesSchema = z.object({
  delete: z.boolean(),
  edit: z.boolean(),
  managePages: z.boolean(),
  managePermissions: z.boolean(),
  reorder: z.boolean(),
  view: z.boolean(),
}).strict();
const journalPageCapabilitiesSchema = z.object({
  delete: z.boolean(),
  edit: z.boolean(),
  managePermissions: z.boolean(),
  reorder: z.boolean(),
  view: z.boolean(),
}).strict();
const journalTitleStyleSchema = z.custom<JournalTitleStyle>(isJournalTitleStyle);
const journalPageSummarySchema = z.object({
  capabilities: journalPageCapabilitiesSchema,
  id: z.string().uuid(),
  permissionRevision: z.number().int().nonnegative(),
  permissions: journalPermissionsSchema(journalPageAccessSchema).nullable(),
  position: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  title: z.string().min(1).max(MAX_JOURNAL_TITLE_INPUT_CODE_UNITS),
  titleStyle: journalTitleStyleSchema,
}).strict();
const journalNoteSchema = z.object({
  capabilities: journalEntryCapabilitiesSchema,
  id: z.string().uuid(),
  name: z.string().min(1).max(MAX_JOURNAL_TITLE_INPUT_CODE_UNITS),
  nameStyle: journalTitleStyleSchema,
  pages: z.array(journalPageSummarySchema).max(MAX_NOTE_PAGES),
  permissions: journalPermissionsSchema(journalEntryAccessSchema).nullable(),
  position: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  typeId: z.literal(JOURNAL_ENTRY_TYPE_NOTE),
}).strict();
const richTextDocumentSchema = z.custom<RichTextDocumentV1>(isRichTextDocument);
const journalPageSchema = journalPageSummarySchema.extend({
  content: richTextDocumentSchema,
  entryId: z.string().uuid(),
}).strict();
const journalManifestSchema = z.object({
  entries: z.array(journalNoteSchema).max(MAX_JOURNAL_ENTRIES),
  revision: z.number().int().nonnegative(),
  schemaVersion: z.literal(JOURNAL_SCHEMA_VERSION),
}).strict();
const journalLeaseSchema = z.object({
  expiresAt: z.string().datetime(),
  holderName: z.string().min(1).max(64),
  leaseId: z.string().uuid(),
  page: journalPageSchema,
}).strict();
const journalErrorSchema = z.object({
  code: z.enum(['conflict', 'invalid_input', 'locked', 'not_found', 'permission_denied', 'storage_error', 'unavailable']),
  entryId: z.string().uuid().optional(),
  holderName: z.string().min(1).max(64).optional(),
  message: z.string().min(1).max(1024),
  pageId: z.string().uuid().optional(),
}).strict();
const journalDeleteTargetSchema = z.discriminatedUnion('kind', [
  z.object({ entryId: z.string().uuid(), kind: z.literal('note') }).strict(),
  z.object({ entryId: z.string().uuid(), kind: z.literal('page'), pageId: z.string().uuid() }).strict(),
]);

const chatParticipantEventSchema = z
  .object({
    eventId: z.string().uuid(),
    generation: z.string().uuid(),
    identity: chatIdentitySchema,
    occurredAt: z.string().datetime(),
    type: z.enum(['participant_joined', 'participant_left']),
  })
  .strict();

const chatHistoryPageSchema = z
  .object({
    generation: z.string().uuid(),
    hasNewer: z.boolean(),
    hasOlder: z.boolean(),
    messages: z
      .array(chatMessageSchema)
      .max(MAX_CHAT_HISTORY_PAGE_MESSAGES),
    newestSequence: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    oldestSequence: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
  })
  .strict();

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
  'client.journal_acquire_lease': z.object({ entryId: z.string().uuid(), pageId: z.string().uuid() }).strict(),
  'client.journal_create_note': z.object({}).strict(),
  'client.journal_create_page': z.object({
    entryId: z.string().uuid(),
    expectedEntryRevision: z.number().int().nonnegative(),
  }).strict(),
  'client.journal_delete_note': z.object({
    cleanupAssetIds: z.array(z.string().uuid()).max(MAX_JOURNAL_CLEANUP_ASSETS),
    expectedRevision: z.number().int().nonnegative(),
    target: z.object({ entryId: z.string().uuid(), kind: z.literal('note') }).strict(),
  }).strict(),
  'client.journal_delete_page': z.object({
    cleanupAssetIds: z.array(z.string().uuid()).max(MAX_JOURNAL_CLEANUP_ASSETS),
    expectedRevision: z.number().int().nonnegative(),
    target: z.object({ entryId: z.string().uuid(), kind: z.literal('page'), pageId: z.string().uuid() }).strict(),
  }).strict(),
  'client.journal_detach_asset': z.object({ assetId: z.string().uuid() }).strict(),
  'client.journal_find_asset_dependents': z.object({ assetId: z.string().uuid() }).strict(),
  'client.journal_get_note': z.object({ entryId: z.string().uuid() }).strict(),
  'client.journal_get_page': z.object({ entryId: z.string().uuid(), pageId: z.string().uuid() }).strict(),
  'client.journal_list': z.object({}).strict(),
  'client.journal_list_users': z.object({}).strict(),
  'client.journal_move_note': z.object({
    direction: z.enum(['up', 'down']),
    entryId: z.string().uuid(),
    expectedManifestRevision: z.number().int().nonnegative(),
  }).strict(),
  'client.journal_move_page': z.object({
    direction: z.enum(['up', 'down']),
    entryId: z.string().uuid(),
    expectedEntryRevision: z.number().int().nonnegative(),
    pageId: z.string().uuid(),
  }).strict(),
  'client.journal_prepare_delete': z.object({ target: journalDeleteTargetSchema }).strict(),
  'client.journal_release_lease': z.object({
    entryId: z.string().uuid(),
    leaseId: z.string().uuid(),
    pageId: z.string().uuid(),
  }).strict(),
  'client.journal_reorder_notes': z.object({
    expectedManifestRevision: z.number().int().nonnegative(),
    orderedEntryIds: z.array(z.string().uuid()).max(MAX_JOURNAL_ENTRIES),
  }).strict(),
  'client.journal_reorder_pages': z.object({
    entryId: z.string().uuid(),
    expectedEntryRevision: z.number().int().nonnegative(),
    orderedPageIds: z.array(z.string().uuid()).max(MAX_NOTE_PAGES),
  }).strict(),
  'client.journal_renew_lease': z.object({
    entryId: z.string().uuid(),
    leaseId: z.string().uuid(),
    pageId: z.string().uuid(),
  }).strict(),
  'client.journal_update_note': z.object({
    entryId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    name: z.string().max(MAX_JOURNAL_TITLE_INPUT_CODE_UNITS),
    nameStyle: journalTitleStyleSchema,
  }).strict(),
  'client.journal_update_note_permissions': z.object({
    entryId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    permissions: journalPermissionsSchema(journalEntryAccessSchema),
  }).strict(),
  'client.journal_update_page': z.object({
    content: richTextDocumentSchema,
    entryId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    leaseId: z.string().uuid(),
    pageId: z.string().uuid(),
    title: z.string().max(MAX_JOURNAL_TITLE_INPUT_CODE_UNITS),
    titleStyle: journalTitleStyleSchema,
  }).strict(),
  'client.journal_update_page_permissions': z.object({
    entryId: z.string().uuid(),
    expectedPermissionRevision: z.number().int().nonnegative(),
    pageId: z.string().uuid(),
    permissions: journalPermissionsSchema(journalPageAccessSchema),
  }).strict(),
  'client.chat_bootstrap': z.object({}).strict(),
  'client.chat_history': z
    .object({
      direction: z.enum(['newer', 'older']),
      generation: z.string().uuid(),
      sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  'client.chat_send': z
    .object({
      clientMessageId: z.string().uuid(),
      content: chatContentSchema,
      recipient: chatPrincipalSchema.nullable(),
    })
    .strict(),
  'client.chat_roll': z
    .object({
      clientMessageId: z.string().uuid(),
      definition: chatRollDefinitionSchema,
      recipient: chatPrincipalSchema.nullable(),
    })
    .strict(),
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
  'client.scene_shape_preview': shapePreviewSchema,
  'client.scene_objects_set': z
    .object({
      arrangement: sceneArrangementSchema.optional(),
      expectedRevision: z.number().int().nonnegative(),
      operationId: z.string().uuid(),
      sceneId: z.string().uuid(),
      state: sceneObjectStateSchema,
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
  'server.chat_bootstrap': chatHistoryPageSchema.extend({
    directory: z.array(chatIdentitySchema).max(21),
    maxMessageCharacters: z
      .number()
      .int()
      .min(MIN_MAX_CHAT_MESSAGE_CHARACTERS)
      .max(MAX_MAX_CHAT_MESSAGE_CHARACTERS),
    systemEvents: z.array(chatParticipantEventSchema),
  }),
  'server.chat_directory_changed': z
    .object({
      directory: z.array(chatIdentitySchema).max(21),
    })
    .strict(),
  'server.chat_error': z
    .object({
      code: z.enum([
        'history_changed',
        'invalid_input',
        'permission_denied',
        'recipient_not_found',
        'storage_error',
        'timeout',
        'unavailable',
      ]),
      message: z.string().min(1).max(512),
    })
    .strict(),
  'server.chat_history': chatHistoryPageSchema,
  'server.chat_history_cleared': z
    .object({ generation: z.string().uuid() })
    .strict(),
  'server.chat_limit_changed': z
    .object({
      maxMessageCharacters: z
        .number()
        .int()
        .min(MIN_MAX_CHAT_MESSAGE_CHARACTERS)
        .max(MAX_MAX_CHAT_MESSAGE_CHARACTERS),
    })
    .strict(),
  'server.chat_message': chatMessageSchema,
  'server.chat_participant_event': chatParticipantEventSchema,
  'server.chat_send_result': chatMessageSchema,
  'server.chat_roll_result': chatMessageSchema,
  'server.journal_changed': z.object({
    entryId: z.string().uuid().optional(),
    pageId: z.string().uuid().optional(),
    type: z.enum(['content', 'deleted', 'permissions', 'structure']),
  }).strict(),
  'server.journal_delete_preview': z.object({
    assets: z.array(z.object({
      cleanupAllowed: z.boolean(),
      displayName: z.string().min(1).max(256),
      id: z.string().uuid(),
      reason: z.string().min(1).max(1024).optional(),
    }).strict()).max(2048),
    target: journalDeleteTargetSchema,
  }).strict(),
  'server.journal_delete_result': z.object({ cleanupFailures: z.array(z.string().uuid()).max(2048) }).strict(),
  'server.journal_asset_dependents': z.object({
    dependents: z.array(z.object({ entryId: z.string().uuid(), pageId: z.string().uuid(), title: z.string().min(1).max(1024) }).strict()).max(2048),
  }).strict(),
  'server.journal_error': journalErrorSchema,
  'server.journal_lease': journalLeaseSchema,
  'server.journal_manifest': journalManifestSchema,
  'server.journal_note': journalNoteSchema,
  'server.journal_page': journalPageSchema,
  'server.journal_release_result': z.object({}).strict(),
  'server.journal_users': z.object({
    users: z.array(z.object({ id: z.string().uuid(), username: z.string().min(1).max(64) }).strict())
      .max(MAX_JOURNAL_PERMISSION_OVERRIDES),
  }).strict(),
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
      system: campaignSystemStateSchema,
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
  'server.scene_shape_preview': shapePreviewSchema.extend({
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
      system: campaignSystemStateSchema,
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
