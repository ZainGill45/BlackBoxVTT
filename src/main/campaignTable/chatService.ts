import { randomUUID } from 'node:crypto';
import {
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
  SendChatRollInput,
  chatPrincipalKey,
  countChatGraphemes,
  sameChatPrincipal,
} from '../../shared/chat';
import {
  serializeChatRollDefinition,
  type ChatRollCard,
  type ChatRollDefinition,
} from '../../shared/chatRoll';
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
  | 'bootstrap'
  | 'clear'
  | 'currentGeneration'
  | 'find'
  | 'history'
  | 'send'
  | 'sendRoll'
>;
type ChatConfigurationStore = Pick<
  ServerConfigRepository,
  'load' | 'withChatConfiguration'
>;

interface CampaignChatServiceOptions {
  chat: ChatStore;
  config: ChatConfigurationStore;
  createId?: () => string;
  diceRoller?: DiceRoller;
  now?: () => Date;
}

export interface DiceRoller {
  roll(
    actorKey: string,
    clientMessageId: string,
    definition: ChatRollDefinition,
    signature: string,
  ): Promise<ChatResult<ChatRollCard>>;
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
  private readonly diceRoller: DiceRoller;
  private readonly now: () => Date;

  constructor({
    chat,
    config,
    createId = randomUUID,
    diceRoller = {
      roll: async () => ({
        error: { code: 'unavailable', message: 'The dice roller is unavailable.' },
        ok: false,
      }),
    },
    now = () => new Date(),
  }: CampaignChatServiceOptions) {
    this.chat = chat;
    this.config = config;
    this.createId = createId;
    this.diceRoller = diceRoller;
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

  async sendRoll(
    sender: ChatIdentity,
    input: Pick<
      SendChatRollInput,
      'clientMessageId' | 'definition' | 'recipient'
    >,
  ): Promise<ChatResult<StoredChatSendResult>> {
    try {
      return this.config.withChatConfiguration(async (configuration) => {
        const recipient = this.resolveRecipient(
          input.recipient,
          configuration.users,
        );
        if (!recipient.ok) return recipient;

        const existing = await this.chat.find(sender, input.clientMessageId);
        if (!existing.ok) return existing;
        if (existing.value) {
          const message = existing.value;
          const storedRecipient = message.recipient
            ? message.recipient.kind === 'gm'
              ? { kind: 'gm' as const }
              : { kind: 'player' as const, userId: message.recipient.userId }
            : null;
          const matchesRecipient =
            (storedRecipient === null && input.recipient === null) ||
            (storedRecipient !== null &&
              input.recipient !== null &&
              sameChatPrincipal(storedRecipient, input.recipient));
          const storedDefinition =
            message.payload.kind === 'roll'
              ? {
                  category: message.payload.card.category,
                  sections: message.payload.card.sections.map((section) => {
                    if ('kind' in section) {
        if (section.kind !== 'conditional-roll') return section;
        return {
          label: section.label,
          modifiers: section.modifiers,
          notation: section.notation,
          typeLabel: section.typeLabel,
          alternateNotation: section.alternateNotation,
          condition: section.condition,
          kind: section.kind,
          sourceSection: section.sourceSection,
        };
                    }
                    return {
                      label: section.label,
                      modifiers: section.modifiers,
                      notation: section.notation,
                      typeLabel: section.typeLabel,
                    };
                  }),
                  title: message.payload.card.title,
                }
              : null;
          if (
            !matchesRecipient ||
            JSON.stringify(storedDefinition) !== JSON.stringify(input.definition)
          ) {
            return {
              error: {
                code: 'invalid_input',
                message: 'Roll retry does not match the original request.',
              },
              ok: false,
            };
          }
          return { ok: true, value: { created: false, message } };
        }

        if (
          countChatGraphemes(serializeChatRollDefinition(input.definition)) >
          configuration.maxMessageCharacters
        ) {
          return {
            error: {
              code: 'invalid_input',
              message: `Message exceeds the campaign limit of ${configuration.maxMessageCharacters} characters.`,
            },
            ok: false,
          };
        }

        const signature = JSON.stringify({
          definition: input.definition,
          recipient: input.recipient,
        });
        const rolled = await this.diceRoller.roll(
          chatPrincipalKey(
            sender.kind === 'gm'
              ? { kind: 'gm' }
              : { kind: 'player', userId: sender.userId },
          ),
          input.clientMessageId,
          input.definition,
          signature,
        );
        if (!rolled.ok) return rolled;
        return this.chat.sendRoll({
          card: rolled.value,
          clientMessageId: input.clientMessageId,
          definition: input.definition,
          maxMessageCharacters: configuration.maxMessageCharacters,
          recipient: recipient.value,
          sender,
        });
      });
    } catch {
      return this.storageFailure('Roll could not be stored.');
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
