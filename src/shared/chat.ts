import type { Result } from './result';
import type { ChatRollCardV1, ChatRollDefinition } from './chatRoll';

export const DEFAULT_MAX_CHAT_MESSAGE_CHARACTERS = 10_000;
export const MIN_MAX_CHAT_MESSAGE_CHARACTERS = 100;
export const MAX_MAX_CHAT_MESSAGE_CHARACTERS = 50_000;
export const MAX_CHAT_MESSAGE_BYTES = 512 * 1024;
export const MAX_CHAT_HISTORY_PAGE_MESSAGES = 100;
export const MAX_CHAT_HISTORY_PAGE_PAYLOAD_BYTES = 768 * 1024;
export const MAX_LOADED_CHAT_MESSAGES = 1_000;
export const CHAT_SEND_TIMEOUT_MS = 10_000;

export type ChatMessagePayload =
  | { kind: 'roll'; card: ChatRollCardV1 }
  | { kind: 'text'; text: string };

export type ChatPrincipal =
  | { kind: 'gm' }
  | { kind: 'player'; userId: string };

export type ChatIdentity =
  | { displayName: 'Game Master'; kind: 'gm' }
  | { displayName: string; kind: 'player'; userId: string };

export interface ChatMessage {
  acceptedAt: string;
  clientMessageId: string;
  generation: string;
  id: string;
  payload: ChatMessagePayload;
  recipient: ChatIdentity | null;
  sender: ChatIdentity;
  sequence: number;
}

export type ChatParticipantEvent = {
  eventId: string;
  generation: string;
  identity: ChatIdentity;
  occurredAt: string;
  type: 'participant_joined' | 'participant_left';
};

export interface ChatHistoryPage {
  generation: string;
  hasNewer: boolean;
  hasOlder: boolean;
  messages: ChatMessage[];
  newestSequence: number | null;
  oldestSequence: number | null;
}

export interface ChatBootstrap extends ChatHistoryPage {
  directory: ChatIdentity[];
  maxMessageCharacters: number;
  systemEvents: ChatParticipantEvent[];
}

export type ChatEvent =
  | {
      campaignId: string;
      message: ChatMessage;
      type: 'message';
    }
  | {
      campaignId: string;
      generation: string;
      type: 'history_cleared';
    }
  | {
      campaignId: string;
      directory: ChatIdentity[];
      type: 'directory_changed';
    }
  | {
      campaignId: string;
      maxMessageCharacters: number;
      type: 'limit_changed';
    }
  | ({
      campaignId: string;
    } & ChatParticipantEvent);

export type ChatHistoryDirection = 'newer' | 'older';

export interface ChatHistoryInput {
  campaignId: string;
  direction: ChatHistoryDirection;
  generation: string;
  sequence: number;
}

export interface SendChatMessageInput {
  campaignId: string;
  clientMessageId: string;
  content: string;
  recipient: ChatPrincipal | null;
}

export interface SendChatRollInput {
  campaignId: string;
  clientMessageId: string;
  definition: ChatRollDefinition;
  recipient: ChatPrincipal | null;
}

export interface ClearChatHistoryInput {
  campaignId: string;
}

export interface ClearChatHistoryResult {
  generation: string;
}

export interface SetMaxChatMessageCharactersInput {
  campaignId: string;
  maxMessageCharacters: number;
}

export type ChatErrorCode =
  | 'history_changed'
  | 'invalid_input'
  | 'permission_denied'
  | 'recipient_not_found'
  | 'storage_error'
  | 'timeout'
  | 'unavailable';

export interface ChatError {
  code: ChatErrorCode;
  message: string;
}

export type ChatResult<T> = Result<T, ChatError>;

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
});

export function normalizeChatContent(content: string): string {
  return content.replace(/\r\n?/g, '\n').trim();
}

export function countChatGraphemes(content: string): number {
  return [...graphemeSegmenter.segment(content)].length;
}

export function chatUtf8ByteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

export function chatPrincipalKey(principal: ChatPrincipal): string {
  return principal.kind === 'gm' ? 'gm' : `player:${principal.userId}`;
}

export function sameChatPrincipal(
  left: ChatPrincipal,
  right: ChatPrincipal,
): boolean {
  return chatPrincipalKey(left) === chatPrincipalKey(right);
}
