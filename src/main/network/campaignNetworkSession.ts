import type {
  ChatBootstrap,
  ChatHistoryInput,
  ChatHistoryPage,
  ChatMessage,
  ChatResult,
  ClearChatHistoryResult,
  SendChatMessageInput,
  SendChatRollInput,
} from '../../shared/chat';
import type {
  DrawingPreviewUpdate,
  MapPing,
  MeasurementUpdate,
  ShapePreviewUpdate,
} from '../../shared/network';
import type { CampaignSystemState } from '../../shared/gameSystems';

export type SessionChatHistoryInput = Omit<ChatHistoryInput, 'campaignId'>;
export type SessionChatMessageInput = Omit<
  SendChatMessageInput,
  'campaignId'
>;
export type SessionChatRollInput = Omit<SendChatRollInput, 'campaignId'>;
export type SessionDrawingPreview = Omit<
  DrawingPreviewUpdate,
  'campaignId'
>;
export type SessionMapPing = Omit<MapPing, 'campaignId'>;
export type SessionMeasurementUpdate = Omit<
  MeasurementUpdate,
  'campaignId'
>;
export type SessionShapePreview = Omit<ShapePreviewUpdate, 'campaignId'>;

/**
 * The network behavior of one active campaign. The hosted/joined decision is
 * made when this adapter is created, so callers never rediscover the role.
 */
export interface CampaignNetworkSession {
  readonly campaignId: string;
  readonly kind: 'hosted' | 'joined';
  readonly system: CampaignSystemState;
  clearChatHistory(): Promise<ChatResult<ClearChatHistoryResult>>;
  getChatBootstrap(): Promise<ChatResult<ChatBootstrap>>;
  getChatHistory(
    input: SessionChatHistoryInput,
  ): Promise<ChatResult<ChatHistoryPage>>;
  sendChatMessage(
    input: SessionChatMessageInput,
  ): Promise<ChatResult<ChatMessage>>;
  sendChatRoll(input: SessionChatRollInput): Promise<ChatResult<ChatMessage>>;
  sendDrawingPreview(input: SessionDrawingPreview): Promise<void>;
  sendMapPing(input: SessionMapPing): Promise<void>;
  sendMeasurementUpdate(input: SessionMeasurementUpdate): Promise<void>;
  sendShapePreview(input: SessionShapePreview): Promise<void>;
}
