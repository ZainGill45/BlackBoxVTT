import type {
  IpcMain,
  IpcMainInvokeEvent,
  WebContents,
} from 'electron';
import { z } from 'zod';
import {
  MAX_CHAT_MESSAGE_BYTES,
  MAX_MAX_CHAT_MESSAGE_CHARACTERS,
  MIN_MAX_CHAT_MESSAGE_CHARACTERS,
  chatUtf8ByteLength,
} from '../shared/chat';
import { chatRollDefinitionSchema } from '../shared/chatRoll';
import {
  MAX_TRANSFORM_PREVIEW_RATE,
  MAX_DRAWING_PREVIEW_POINTS,
  MAX_MEASUREMENT_POINTS,
  MIN_TRANSFORM_PREVIEW_RATE,
  networkIpcChannels,
  type NetworkResult,
} from '../shared/network';
import {
  sceneDrawingPointSchema,
  sceneDrawingStyleSchema,
  sceneShapePreviewSchema,
} from '../shared/sceneSchema';
import { SCENE_LAYERS } from '../shared/scenes';
import type { NetworkManager } from './network/networkManager';

const campaignIdSchema = z
  .object({ campaignId: z.string().uuid() })
  .strict();
const setPortSchema = campaignIdSchema.extend({
  port: z.number().int().min(1).max(65_535),
});
const setTransformPreviewRateSchema = campaignIdSchema.extend({
  transformPreviewRate: z
    .number()
    .int()
    .min(MIN_TRANSFORM_PREVIEW_RATE)
    .max(MAX_TRANSFORM_PREVIEW_RATE),
});
const setMaxChatMessageCharactersSchema = campaignIdSchema.extend({
  maxMessageCharacters: z
    .number()
    .int()
    .min(MIN_MAX_CHAT_MESSAGE_CHARACTERS)
    .max(MAX_MAX_CHAT_MESSAGE_CHARACTERS),
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
const chatHistorySchema = campaignIdSchema.extend({
  direction: z.enum(['newer', 'older']),
  generation: z.string().uuid(),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const sendChatMessageSchema = campaignIdSchema.extend({
  clientMessageId: z.string().uuid(),
  content: z
    .string()
    .min(1)
    .max(MAX_CHAT_MESSAGE_BYTES)
    .refine(
      (content) => chatUtf8ByteLength(content) <= MAX_CHAT_MESSAGE_BYTES,
      'Chat content exceeds the encoded size limit.',
    ),
  recipient: chatPrincipalSchema.nullable(),
});
const sendChatRollSchema = campaignIdSchema.extend({
  clientMessageId: z.string().uuid(),
  definition: chatRollDefinitionSchema,
  recipient: chatPrincipalSchema.nullable(),
});
const createUserSchema = campaignIdSchema.extend({
  password: z.string().min(1),
  username: z.string().min(1).max(256),
});
const userIdSchema = campaignIdSchema.extend({
  userId: z.string().uuid(),
});
const updateUsernameSchema = userIdSchema.extend({
  username: z.string().min(1).max(256),
});
const resetPasswordSchema = userIdSchema.extend({
  password: z.string().min(1),
});
const connectSchema = z
  .object({
    expectedCampaignId: z.string().uuid().optional(),
    host: z.string().trim().min(1).max(253),
    port: z.number().int().min(1).max(65_535),
  })
  .strict();
const attemptSchema = z.object({ attemptId: z.string().uuid() }).strict();
const authenticateSchema = attemptSchema.extend({
  password: z.string().min(1).optional(),
  useSavedPassword: z.boolean(),
  userId: z.string().uuid(),
});
const mapPingSchema = campaignIdSchema.extend({
  id: z.string().uuid(),
  pullPlayers: z.boolean(),
  sceneId: z.string().uuid(),
  x: z.number().finite(),
  y: z.number().finite(),
});
const measurementPointSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();
const measurementUpdateSchema = campaignIdSchema
  .extend({
    active: z.boolean(),
    measurementId: z.string().uuid(),
    points: z.array(measurementPointSchema).max(MAX_MEASUREMENT_POINTS),
    sceneId: z.string().uuid(),
    updateSequence: z.number().int().min(0).max(0xffff_ffff),
  })
  .superRefine((input, context) => {
    if (
      (input.active && input.points.length === 0) ||
      (!input.active && input.points.length !== 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Active measurements require points and cleared measurements do not.',
        path: ['points'],
      });
    }
  });
const drawingPreviewSchema = campaignIdSchema
  .extend({
    active: z.boolean(),
    closed: z.boolean(),
    kind: z.enum(['freeform', 'polyline']),
    layer: z.enum(SCENE_LAYERS),
    operationId: z.string().uuid(),
    points: z.array(sceneDrawingPointSchema).max(MAX_DRAWING_PREVIEW_POINTS),
    reliable: z.boolean().optional(),
    sceneId: z.string().uuid(),
    sequence: z.number().int().min(0).max(0xffff_ffff),
    style: sceneDrawingStyleSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.active && input.points.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Active drawing previews require at least one point.',
        path: ['points'],
      });
    }
    if (!input.active && input.points.length !== 0) {
      context.addIssue({
        code: 'custom',
        message: 'Cleared drawing previews cannot contain points.',
        path: ['points'],
      });
    }
  });

function invalidInput<T>(): NetworkResult<T> {
  return {
    error: {
      code: 'invalid_input',
      message: 'The request contains invalid input.',
    },
    ok: false,
  };
}

export function registerNetworkIpcHandlers(
  ipc: IpcMain,
  manager: NetworkManager,
  getAllowedWebContents: () => readonly WebContents[],
) {
  const channels = Object.values(networkIpcChannels).filter(
    (channel) =>
      channel !== networkIpcChannels.hostStatusChanged &&
      channel !== networkIpcChannels.chatEvent &&
      channel !== networkIpcChannels.clientStateChanged &&
      channel !== networkIpcChannels.drawingPreview &&
      channel !== networkIpcChannels.mapPing &&
      channel !== networkIpcChannels.measurementUpdate &&
      channel !== networkIpcChannels.shapePreview &&
      channel !== networkIpcChannels.sessionClosed,
  );
  channels.forEach((channel) => ipc.removeHandler(channel));

  const isAllowed = (event: IpcMainInvokeEvent) =>
    getAllowedWebContents().includes(event.sender);

  const handle = <T>(
    channel: string,
    listener: (input: unknown) => Promise<T> | T,
  ) => {
    ipc.handle(channel, (event, input) => {
      if (!isAllowed(event)) {
        return invalidInput();
      }
      return listener(input);
    });
  };

  handle(networkIpcChannels.openHost, async (input) => {
    const parsed = campaignIdSchema.safeParse(input);
    return parsed.success
      ? manager.openHost(parsed.data.campaignId)
      : invalidInput();
  });
  handle(networkIpcChannels.stopHost, () => manager.stopHost());
  handle(networkIpcChannels.getHostStatus, () => manager.getHostStatus());
  handle(networkIpcChannels.getChatBootstrap, async (input) => {
    const parsed = campaignIdSchema.safeParse(input);
    return parsed.success
      ? manager.getChatBootstrap(parsed.data.campaignId)
      : invalidInput();
  });
const shapePreviewSchema = campaignIdSchema
  .extend({
    layer: z.enum(SCENE_LAYERS),
    operationId: z.string().uuid(),
    phase: z.enum(['cancel', 'final', 'start', 'update']),
    reliable: z.boolean().optional(),
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
    if ((input.phase === 'update') === (input.reliable === true)) {
      context.addIssue({
        code: 'custom',
        message: 'Only shape updates may use the unreliable preview path.',
        path: ['reliable'],
      });
    }
  });
  handle(networkIpcChannels.getChatHistory, async (input) => {
    const parsed = chatHistorySchema.safeParse(input);
    return parsed.success
      ? manager.getChatHistory(parsed.data)
      : invalidInput();
  });
  handle(networkIpcChannels.getServerSettings, async (input) => {
    const parsed = campaignIdSchema.safeParse(input);
    return parsed.success
      ? manager.getServerSettings(parsed.data.campaignId)
      : invalidInput();
  });
  handle(networkIpcChannels.setPort, async (input) => {
    const parsed = setPortSchema.safeParse(input);
    return parsed.success ? manager.setPort(parsed.data) : invalidInput();
  });
  handle(networkIpcChannels.setTransformPreviewRate, async (input) => {
    const parsed = setTransformPreviewRateSchema.safeParse(input);
    return parsed.success
      ? manager.setTransformPreviewRate(parsed.data)
      : invalidInput();
  });
  handle(networkIpcChannels.setMaxChatMessageCharacters, async (input) => {
    const parsed = setMaxChatMessageCharactersSchema.safeParse(input);
    return parsed.success
      ? manager.setMaxChatMessageCharacters(parsed.data)
      : invalidInput();
  });
  handle(networkIpcChannels.createUser, async (input) => {
    const parsed = createUserSchema.safeParse(input);
    return parsed.success ? manager.createUser(parsed.data) : invalidInput();
  });
  handle(networkIpcChannels.updateUsername, async (input) => {
    const parsed = updateUsernameSchema.safeParse(input);
    return parsed.success
      ? manager.updateUsername(parsed.data)
      : invalidInput();
  });
  handle(networkIpcChannels.resetPassword, async (input) => {
    const parsed = resetPasswordSchema.safeParse(input);
    return parsed.success
      ? manager.resetPassword(parsed.data)
      : invalidInput();
  });
  handle(networkIpcChannels.deleteUser, async (input) => {
    const parsed = userIdSchema.safeParse(input);
    return parsed.success ? manager.deleteUser(parsed.data) : invalidInput();
  });
  handle(networkIpcChannels.connect, async (input) => {
    const parsed = connectSchema.safeParse(input);
    return parsed.success ? manager.connect(parsed.data) : invalidInput();
  });
  handle(networkIpcChannels.acceptTrust, async (input) => {
    const parsed = attemptSchema.safeParse(input);
    return parsed.success
      ? manager.acceptTrust(parsed.data)
      : invalidInput();
  });
  handle(networkIpcChannels.authenticate, async (input) => {
    const parsed = authenticateSchema.safeParse(input);
    return parsed.success
      ? manager.authenticate(parsed.data)
      : invalidInput();
  });
  handle(networkIpcChannels.cancelConnection, async (input) => {
    const parsed = attemptSchema.safeParse(input);
    if (parsed.success) {
      await manager.cancelConnection(parsed.data.attemptId);
    }
  });
  handle(networkIpcChannels.disconnect, () => manager.disconnect());
  handle(networkIpcChannels.listHistory, () => manager.listHistory());
  handle(networkIpcChannels.deleteHistory, async (input) => {
    const parsed = campaignIdSchema.safeParse(input);
    return parsed.success
      ? manager.deleteHistory(parsed.data)
      : invalidInput();
  });
  handle(networkIpcChannels.sendMapPing, async (input) => {
    const parsed = mapPingSchema.safeParse(input);
    if (parsed.success) {
      await manager.sendMapPing(parsed.data);
    }
  });
  handle(networkIpcChannels.sendChatMessage, async (input) => {
    const parsed = sendChatMessageSchema.safeParse(input);
    return parsed.success
      ? manager.sendChatMessage(parsed.data)
      : invalidInput();
  });
  handle(networkIpcChannels.sendChatRoll, async (input) => {
    const parsed = sendChatRollSchema.safeParse(input);
    return parsed.success ? manager.sendChatRoll(parsed.data) : invalidInput();
  });
  handle(networkIpcChannels.clearChatHistory, async (input) => {
    const parsed = campaignIdSchema.safeParse(input);
    return parsed.success
      ? manager.clearChatHistory(parsed.data.campaignId)
      : invalidInput();
  });
  handle(networkIpcChannels.sendDrawingPreview, async (input) => {
    const parsed = drawingPreviewSchema.safeParse(input);
    if (parsed.success) {
      await manager.sendDrawingPreview(parsed.data);
    }
  });
  handle(networkIpcChannels.sendMeasurementUpdate, async (input) => {
    const parsed = measurementUpdateSchema.safeParse(input);
    if (parsed.success) {
      await manager.sendMeasurementUpdate(parsed.data);
    }
  });
  handle(networkIpcChannels.sendShapePreview, async (input) => {
    const parsed = shapePreviewSchema.safeParse(input);
    if (parsed.success) {
      await manager.sendShapePreview(parsed.data);
    }
  });

  const send = (channel: string, value: unknown) => {
    for (const webContents of getAllowedWebContents()) {
      if (!webContents.isDestroyed()) {
        webContents.send(channel, value);
      }
    }
  };
  const onHostStatus = (status: unknown) =>
    send(networkIpcChannels.hostStatusChanged, status);
  const onChatEvent = (event: unknown) =>
    send(networkIpcChannels.chatEvent, event);
  const onClientState = (state: unknown) =>
    send(networkIpcChannels.clientStateChanged, state);
  const onSessionClosed = (event: unknown) =>
    send(networkIpcChannels.sessionClosed, event);
  const onMapPing = (event: unknown) =>
    send(networkIpcChannels.mapPing, event);
  const onDrawingPreview = (event: unknown) =>
    send(networkIpcChannels.drawingPreview, event);
  const onMeasurementUpdate = (event: unknown) =>
    send(networkIpcChannels.measurementUpdate, event);
  const onShapePreview = (event: unknown) =>
    send(networkIpcChannels.shapePreview, event);
  const onTransformCancelled = (event: unknown) =>
    send(networkIpcChannels.transformCancelled, event);
  const onTransformPreview = (event: unknown) =>
    send(networkIpcChannels.transformPreview, event);
  const onTransformStarted = (event: unknown) =>
    send(networkIpcChannels.transformStarted, event);
  manager.on('host-status-changed', onHostStatus);
  manager.on('chat-event', onChatEvent);
  manager.on('client-state-changed', onClientState);
  manager.on('map-ping', onMapPing);
  manager.on('drawing-preview', onDrawingPreview);
  manager.on('measurement-update', onMeasurementUpdate);
  manager.on('shape-preview', onShapePreview);
  manager.on('session-closed', onSessionClosed);
  manager.on('transform-cancelled', onTransformCancelled);
  manager.on('transform-preview', onTransformPreview);
  manager.on('transform-started', onTransformStarted);

  return () => {
    channels.forEach((channel) => ipc.removeHandler(channel));
    manager.off('host-status-changed', onHostStatus);
    manager.off('chat-event', onChatEvent);
    manager.off('client-state-changed', onClientState);
    manager.off('map-ping', onMapPing);
    manager.off('drawing-preview', onDrawingPreview);
    manager.off('measurement-update', onMeasurementUpdate);
    manager.off('shape-preview', onShapePreview);
    manager.off('session-closed', onSessionClosed);
    manager.off('transform-cancelled', onTransformCancelled);
    manager.off('transform-preview', onTransformPreview);
    manager.off('transform-started', onTransformStarted);
  };
}
