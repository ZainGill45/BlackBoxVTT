import { randomUUID } from 'node:crypto';
import type {
  ChatBootstrap,
  ChatHistoryInput,
  ChatHistoryPage,
  ChatIdentity,
  ChatMessage,
  ChatParticipantEvent,
  ChatPrincipal,
  ChatResult,
  ClearChatHistoryResult,
  SendChatMessageInput,
} from '../../shared/chat';
import type {
  ChatRepository,
  StoredChatSendResult,
} from '../chatRepository';
import type {
  ServerConfigRepository,
  StoredManagedUser,
} from '../network/serverConfigRepository';

type ChatStore = Pick<
  ChatRepository,
  'bootstrap' | 'clear' | 'currentGeneration' | 'history' | 'send'
>;
type ChatConfigurationStore = Pick<
  ServerConfigRepository,
  'load' | 'withChatConfiguration'
>;

interface CampaignChatServiceOptions {
  chat: ChatStore;
  config: ChatConfigurationStore;
  createId?: () => string;
  now?: () => Date;
}

export const GAME_MASTER_CHAT_IDENTITY = {
  displayName: 'Game Master',
  kind: 'gm',
} as const satisfies ChatIdentity;

export function playerChatIdentity(
  user: StoredManagedUser,
): Extract<ChatIdentity, { kind: 'player' }> {
  return {
    displayName: user.username,
    kind: 'player',
    userId: user.id,
  };
}

export class CampaignChatService {
  private readonly chat: ChatStore;
  private readonly config: ChatConfigurationStore;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor({
    chat,
    config,
    createId = randomUUID,
    now = () => new Date(),
  }: CampaignChatServiceOptions) {
    this.chat = chat;
    this.config = config;
    this.createId = createId;
    this.now = now;
  }

  async bootstrap(
    viewer: ChatPrincipal,
    systemEvents: ChatParticipantEvent[] = [],
  ): Promise<ChatResult<ChatBootstrap>> {
    try {
      const configuration = await this.config.load();
      return this.chat.bootstrap(
        viewer,
        this.directoryFor(configuration.users),
        configuration.maxChatMessageCharacters,
        systemEvents,
      );
    } catch {
      return this.storageFailure('Campaign chat is unavailable.');
    }
  }

  history(
    viewer: ChatPrincipal,
    input: Omit<ChatHistoryInput, 'campaignId'>,
  ): Promise<ChatResult<ChatHistoryPage>> {
    return this.chat.history(viewer, input);
  }

  clear(): Promise<ChatResult<ClearChatHistoryResult>> {
    return this.chat.clear();
  }

  async directory(): Promise<ChatResult<ChatIdentity[]>> {
    try {
      const configuration = await this.config.load();
      return { ok: true, value: this.directoryFor(configuration.users) };
    } catch {
      return this.storageFailure('Chat directory could not be loaded.');
    }
  }

  async send(
    sender: ChatIdentity,
    input: Pick<
      SendChatMessageInput,
      'clientMessageId' | 'content' | 'recipient'
    >,
  ): Promise<ChatResult<StoredChatSendResult>> {
    try {
      return this.config.withChatConfiguration(async (configuration) => {
        const recipient = this.resolveRecipient(
          input.recipient,
          configuration.users,
        );
        if (!recipient.ok) {
          return recipient;
        }
        return this.chat.send({
          clientMessageId: input.clientMessageId,
          content: input.content,
          maxMessageCharacters: configuration.maxMessageCharacters,
          recipient: recipient.value,
          sender,
        });
      });
    } catch {
      return this.storageFailure('Message could not be stored.');
    }
  }

  async createParticipantEvent(
    user: StoredManagedUser,
    type: ChatParticipantEvent['type'],
  ): Promise<ChatParticipantEvent | null> {
    const generation = await this.chat.currentGeneration();
    return generation.ok
      ? {
          eventId: this.createId(),
          generation: generation.value,
          identity: playerChatIdentity(user),
          occurredAt: this.now().toISOString(),
          type,
        }
      : null;
  }

  isVisibleTo(message: ChatMessage, userId: string): boolean {
    return (
      message.recipient === null ||
      (message.recipient.kind === 'player' &&
        message.recipient.userId === userId) ||
      (message.sender.kind === 'player' && message.sender.userId === userId)
    );
  }

  private directoryFor(users: StoredManagedUser[]): ChatIdentity[] {
    return [
      GAME_MASTER_CHAT_IDENTITY,
      ...[...users]
        .sort(
          (left, right) =>
            left.username.localeCompare(right.username, 'en-US') ||
            left.id.localeCompare(right.id),
        )
        .map(playerChatIdentity),
    ];
  }

  private resolveRecipient(
    principal: ChatPrincipal | null,
    users: StoredManagedUser[],
  ): ChatResult<ChatIdentity | null> {
    if (!principal) {
      return { ok: true, value: null };
    }
    if (principal.kind === 'gm') {
      return { ok: true, value: GAME_MASTER_CHAT_IDENTITY };
    }
    const user = users.find((candidate) => candidate.id === principal.userId);
    return user
      ? { ok: true, value: playerChatIdentity(user) }
      : {
          error: {
            code: 'recipient_not_found',
            message: 'Whisper recipient could not be found.',
          },
          ok: false,
        };
  }

  private storageFailure<T>(message: string): ChatResult<T> {
    return {
      error: { code: 'storage_error', message },
      ok: false,
    };
  }
}
