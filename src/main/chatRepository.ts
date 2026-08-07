import { randomUUID } from 'node:crypto';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import {
  MAX_CHAT_HISTORY_PAGE_MESSAGES,
  MAX_CHAT_HISTORY_PAGE_PAYLOAD_BYTES,
  MAX_CHAT_MESSAGE_BYTES,
  chatPrincipalKey,
  chatUtf8ByteLength,
  countChatGraphemes,
  normalizeChatContent,
  sameChatPrincipal,
  type ChatBootstrap,
  type ChatErrorCode,
  type ChatHistoryInput,
  type ChatHistoryPage,
  type ChatIdentity,
  type ChatMessage,
  type ChatMessagePayload,
  type ChatParticipantEvent,
  type ChatPrincipal,
  type ChatResult,
  type ClearChatHistoryResult,
} from '../shared/chat';
import {
  chatRollCardSchema,
  chatRollDefinitionSchema,
  serializeChatRollDefinition,
  type ChatRollCard,
  type ChatRollDefinition,
} from '../shared/chatRoll';
import { fail } from '../shared/result';
import { CampaignDatabase } from './storage/campaignDatabase';
import { MutationQueue } from './storage/mutationQueue';

const CAMPAIGN_TOUCH_INTERVAL_MS = 30_000;

interface ChatRepositoryOptions {
  createId?: () => string;
  database: CampaignDatabase;
  now?: () => Date;
  touchCampaign?: () => Promise<void>;
  warn?: (message: string, error?: unknown) => void;
}

interface StoredChatRow {
  accepted_at: string;
  client_message_id: string;
  message_kind: string;
  payload_json: string;
  generation: string;
  id: string;
  recipient_kind: string | null;
  recipient_name: string | null;
  recipient_user_id: string | null;
  sender_kind: string;
  sender_name: string;
  sender_user_id: string | null;
  sequence: number;
}

interface SendStoredChatInput {
  clientMessageId: string;
  content: string;
  maxMessageCharacters: number;
  recipient: ChatIdentity | null;
  sender: ChatIdentity;
}

interface SendStoredRollInput {
  card: ChatRollCard;
  clientMessageId: string;
  definition: ChatRollDefinition;
  maxMessageCharacters: number;
  recipient: ChatIdentity | null;
  sender: ChatIdentity;
}

export interface StoredChatSendResult {
  created: boolean;
  message: ChatMessage;
}

function chatFailure<T>(
  code: ChatErrorCode,
  message: string,
): ChatResult<T> {
  return fail({ code, message });
}

function identityPrincipal(identity: ChatIdentity): ChatPrincipal {
  return identity.kind === 'gm'
    ? { kind: 'gm' }
    : { kind: 'player', userId: identity.userId };
}

function sameRecipient(
  left: ChatIdentity | null,
  right: ChatIdentity | null,
): boolean {
  return (
    (left === null && right === null) ||
    (left !== null &&
      right !== null &&
      sameChatPrincipal(identityPrincipal(left), identityPrincipal(right)))
  );
}

function definitionFromCard(card: ChatRollCard): ChatRollDefinition {
  return {
    category: card.category,
    sections: card.sections.map(({ label, modifiers, notation, typeLabel }) => ({
      label,
      modifiers,
      notation,
      typeLabel,
    })),
    title: card.title,
  };
}

function rowIdentity(
  kind: string | null,
  userId: string | null,
  displayName: string | null,
): ChatIdentity | null {
  if (kind === null) {
    return null;
  }
  if (kind === 'gm' && displayName === 'Game Master' && userId === null) {
    return { displayName: 'Game Master', kind: 'gm' };
  }
  if (
    kind === 'player' &&
    typeof userId === 'string' &&
    typeof displayName === 'string'
  ) {
    return { displayName, kind: 'player', userId };
  }
  throw new Error('Chat database contains an invalid identity.');
}

function rowToMessage(row: StoredChatRow): ChatMessage {
  const sender = rowIdentity(
    row.sender_kind,
    row.sender_user_id,
    row.sender_name,
  );
  if (!sender) {
    throw new Error('Chat database contains a message without a sender.');
  }
  if (
    !Number.isSafeInteger(row.sequence) ||
    row.sequence < 1 ||
    !Number.isFinite(Date.parse(row.accepted_at))
  ) {
    throw new Error('Chat database contains invalid message metadata.');
  }
  let payload: ChatMessagePayload;
  try {
    if (chatUtf8ByteLength(row.payload_json) > MAX_CHAT_MESSAGE_BYTES) {
      throw new Error('Stored chat payload exceeds its size limit.');
    }
    const parsed: unknown = JSON.parse(row.payload_json);
    if (
      row.message_kind === 'text' &&
      parsed !== null &&
      typeof parsed === 'object' &&
      Object.keys(parsed).length === 2 &&
      (parsed as Record<string, unknown>).kind === 'text' &&
      typeof (parsed as Record<string, unknown>).text === 'string'
    ) {
      const text = (parsed as { text: string }).text;
      if (
        text.length === 0 ||
        normalizeChatContent(text) !== text ||
        chatUtf8ByteLength(text) > MAX_CHAT_MESSAGE_BYTES
      ) {
        throw new Error('Stored text chat payload is invalid.');
      }
      payload = { kind: 'text', text };
    } else if (
      row.message_kind === 'roll' &&
      parsed !== null &&
      typeof parsed === 'object' &&
      Object.keys(parsed).length === 2 &&
      (parsed as Record<string, unknown>).kind === 'roll'
    ) {
      payload = {
        card: chatRollCardSchema.parse(
          (parsed as Record<string, unknown>).card,
        ),
        kind: 'roll',
      };
    } else {
      throw new Error('Unknown chat message kind.');
    }
  } catch (error) {
    throw new Error('Chat database contains an invalid message payload.', {
      cause: error,
    });
  }
  return {
    acceptedAt: row.accepted_at,
    clientMessageId: row.client_message_id,
    generation: row.generation,
    id: row.id,
    payload,
    recipient: rowIdentity(
      row.recipient_kind,
      row.recipient_user_id,
      row.recipient_name,
    ),
    sender,
    sequence: row.sequence,
  };
}

function statementRows(statement: StatementSync, ...values: unknown[]) {
  return statement.all(
    ...(values as Parameters<StatementSync['all']>),
  ) as unknown as StoredChatRow[];
}

export class ChatRepository {
  private readonly createId: () => string;
  private readonly database: CampaignDatabase;
  private readonly mutations = new MutationQueue();
  private readonly now: () => Date;
  private lastTouchAt = 0;
  private readonly touchCampaign?: () => Promise<void>;
  private touchPromise: Promise<void> = Promise.resolve();
  private touchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly warn: (message: string, error?: unknown) => void;

  constructor({
    createId = randomUUID,
    database,
    now = () => new Date(),
    touchCampaign,
    warn = console.warn,
  }: ChatRepositoryOptions) {
    this.createId = createId;
    this.database = database;
    this.now = now;
    this.touchCampaign = touchCampaign;
    this.warn = warn;
  }

  bootstrap(
    viewer: ChatPrincipal,
    directory: ChatIdentity[],
    maxMessageCharacters: number,
    systemEvents: ChatParticipantEvent[] = [],
  ): Promise<ChatResult<ChatBootstrap>> {
    return this.mutations.run(async () => {
      try {
        const database = this.database.connection;
        const page = this.readPage(database, viewer);
        return {
          ok: true,
          value: {
            ...page,
            directory: structuredClone(directory),
            maxMessageCharacters,
            systemEvents: structuredClone(systemEvents).filter(
              (event) => event.generation === page.generation,
            ),
          },
        };
      } catch (error) {
        this.warn('Chat bootstrap failed.', error);
        return chatFailure(
          'storage_error',
          'Campaign chat history is unavailable.',
        );
      }
    });
  }

  history(
    viewer: ChatPrincipal,
    input: Omit<ChatHistoryInput, 'campaignId'>,
  ): Promise<ChatResult<ChatHistoryPage>> {
    return this.mutations.run(async () => {
      try {
        const database = this.database.connection;
        const generation = this.getGeneration(database);
        if (generation !== input.generation) {
          return chatFailure(
            'history_changed',
            'Chat history changed and must be reloaded.',
          );
        }
        return {
          ok: true,
          value: this.readPage(
            database,
            viewer,
            input.direction,
            input.sequence,
          ),
        };
      } catch (error) {
        this.warn('Chat history page failed.', error);
        return chatFailure(
          'storage_error',
          'Campaign chat history is unavailable.',
        );
      }
    });
  }

  currentGeneration(): Promise<ChatResult<string>> {
    return this.mutations.run(async () => {
      try {
        return {
          ok: true,
          value: this.getGeneration(this.database.connection),
        };
      } catch (error) {
        this.warn('Chat generation could not be read.', error);
        return chatFailure(
          'storage_error',
          'Campaign chat history is unavailable.',
        );
      }
    });
  }

  send(input: SendStoredChatInput): Promise<ChatResult<StoredChatSendResult>> {
    return this.mutations.run(async () => {
      const content = normalizeChatContent(input.content);
      if (content.length === 0) {
        return chatFailure('invalid_input', 'Message must not be empty.');
      }
      const characterCount = countChatGraphemes(content);
      if (characterCount > input.maxMessageCharacters) {
        return chatFailure(
          'invalid_input',
          `Message exceeds the campaign limit of ${input.maxMessageCharacters} characters.`,
        );
      }
      if (chatUtf8ByteLength(content) > MAX_CHAT_MESSAGE_BYTES) {
        return chatFailure(
          'invalid_input',
          'Message exceeds the encoded size limit.',
        );
      }
      if (
        input.recipient &&
        sameChatPrincipal(
          identityPrincipal(input.sender),
          identityPrincipal(input.recipient),
        )
      ) {
        return chatFailure(
          'recipient_not_found',
          'You cannot whisper to yourself.',
        );
      }

      const database = this.database.connection;

      const senderPrincipal = identityPrincipal(input.sender);
      const senderKey = chatPrincipalKey(senderPrincipal);
      const recipientPrincipal = input.recipient
        ? identityPrincipal(input.recipient)
        : null;
      const recipientKey = recipientPrincipal
        ? chatPrincipalKey(recipientPrincipal)
        : null;

      try {
        database.exec('BEGIN IMMEDIATE');
        const existing = database
          .prepare(
            `SELECT
               sequence, id, client_message_id, generation, accepted_at,
               sender_kind, sender_user_id, sender_name,
               recipient_kind, recipient_user_id, recipient_name,
               message_kind, payload_json
             FROM chat_messages
             WHERE sender_key = ? AND client_message_id = ?`,
          )
          .get(senderKey, input.clientMessageId) as
          | StoredChatRow
          | undefined;
        if (existing) {
          const message = rowToMessage(existing);
          const sameRecipient =
            (message.recipient === null && input.recipient === null) ||
            (message.recipient !== null &&
              input.recipient !== null &&
              sameChatPrincipal(
                identityPrincipal(message.recipient),
                identityPrincipal(input.recipient),
              ));
          if (
            message.payload.kind !== 'text' ||
            message.payload.text !== content ||
            !sameRecipient
          ) {
            database.exec('ROLLBACK');
            return chatFailure(
              'invalid_input',
              'Message retry does not match the original send.',
            );
          }
          database.exec('COMMIT');
          return {
            ok: true,
            value: { created: false, message },
          };
        }

        const generation = this.getGeneration(database);
        const id = this.createId();
        const acceptedAt = this.now().toISOString();
        const insert = database
          .prepare(
            `INSERT INTO chat_messages (
               id, client_message_id, generation, accepted_at,
               sender_key, sender_kind, sender_user_id, sender_name,
               recipient_key, recipient_kind, recipient_user_id,
               recipient_name, message_kind, payload_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            input.clientMessageId,
            generation,
            acceptedAt,
            senderKey,
            input.sender.kind,
            input.sender.kind === 'player' ? input.sender.userId : null,
            input.sender.displayName,
            recipientKey,
            input.recipient?.kind ?? null,
            input.recipient?.kind === 'player'
              ? input.recipient.userId
              : null,
            input.recipient?.displayName ?? null,
            'text',
            JSON.stringify({ kind: 'text', text: content }),
          );
        const sequence = Number(insert.lastInsertRowid);
        database.exec('COMMIT');
        this.scheduleCampaignTouch();
        return {
          ok: true,
          value: {
            created: true,
            message: {
              acceptedAt,
              clientMessageId: input.clientMessageId,
              generation,
              id,
              payload: { kind: 'text', text: content },
              recipient: input.recipient
                ? structuredClone(input.recipient)
                : null,
              sender: structuredClone(input.sender),
              sequence,
            },
          },
        };
      } catch (error) {
        try {
          database.exec('ROLLBACK');
        } catch {
          // The transaction did not begin or already rolled back.
        }
        this.warn('Chat message could not be committed.', error);
        return chatFailure('storage_error', 'Message could not be stored.');
      }
    });
  }

  find(
    sender: ChatIdentity,
    clientMessageId: string,
  ): Promise<ChatResult<ChatMessage | null>> {
    return this.mutations.run(async () => {
      try {
        const row = this.database.connection
          .prepare(
            `SELECT
               sequence, id, client_message_id, generation, accepted_at,
               sender_kind, sender_user_id, sender_name,
               recipient_kind, recipient_user_id, recipient_name,
               message_kind, payload_json
             FROM chat_messages
             WHERE sender_key = ? AND client_message_id = ?`,
          )
          .get(
            chatPrincipalKey(identityPrincipal(sender)),
            clientMessageId,
          ) as StoredChatRow | undefined;
        return { ok: true, value: row ? rowToMessage(row) : null };
      } catch (error) {
        this.warn('Chat idempotency lookup failed.', error);
        return chatFailure('storage_error', 'Message could not be checked.');
      }
    });
  }

  sendRoll(input: SendStoredRollInput): Promise<ChatResult<StoredChatSendResult>> {
    return this.mutations.run(async () => {
      const definitionResult = chatRollDefinitionSchema.safeParse(input.definition);
      const cardResult = chatRollCardSchema.safeParse(input.card);
      if (!definitionResult.success || !cardResult.success) {
        return chatFailure('invalid_input', 'Roll data is invalid.');
      }
      const definition = definitionResult.data;
      const card = cardResult.data;
      if (
        JSON.stringify(definitionFromCard(card)) !== JSON.stringify(definition)
      ) {
        return chatFailure('invalid_input', 'Roll result does not match its definition.');
      }
      if (
        countChatGraphemes(serializeChatRollDefinition(definition)) >
        input.maxMessageCharacters
      ) {
        return chatFailure(
          'invalid_input',
          `Message exceeds the campaign limit of ${input.maxMessageCharacters} characters.`,
        );
      }
      const payload: ChatMessagePayload = { card, kind: 'roll' };
      const payloadJson = JSON.stringify(payload);
      if (chatUtf8ByteLength(payloadJson) > MAX_CHAT_MESSAGE_BYTES) {
        return chatFailure('invalid_input', 'Roll result exceeds the encoded size limit.');
      }
      if (
        input.recipient &&
        sameChatPrincipal(
          identityPrincipal(input.sender),
          identityPrincipal(input.recipient),
        )
      ) {
        return chatFailure('recipient_not_found', 'You cannot whisper to yourself.');
      }

      const database = this.database.connection;
      const senderKey = chatPrincipalKey(identityPrincipal(input.sender));
      const recipientKey = input.recipient
        ? chatPrincipalKey(identityPrincipal(input.recipient))
        : null;
      try {
        database.exec('BEGIN IMMEDIATE');
        const existing = database
          .prepare(
            `SELECT
               sequence, id, client_message_id, generation, accepted_at,
               sender_kind, sender_user_id, sender_name,
               recipient_kind, recipient_user_id, recipient_name,
               message_kind, payload_json
             FROM chat_messages
             WHERE sender_key = ? AND client_message_id = ?`,
          )
          .get(senderKey, input.clientMessageId) as StoredChatRow | undefined;
        if (existing) {
          const message = rowToMessage(existing);
          if (
            message.payload.kind !== 'roll' ||
            JSON.stringify(definitionFromCard(message.payload.card)) !==
              JSON.stringify(definition) ||
            !sameRecipient(message.recipient, input.recipient)
          ) {
            database.exec('ROLLBACK');
            return chatFailure(
              'invalid_input',
              'Message retry does not match the original send.',
            );
          }
          database.exec('COMMIT');
          return { ok: true, value: { created: false, message } };
        }

        const generation = this.getGeneration(database);
        const id = this.createId();
        const acceptedAt = this.now().toISOString();
        const insert = database
          .prepare(
            `INSERT INTO chat_messages (
               id, client_message_id, generation, accepted_at,
               sender_key, sender_kind, sender_user_id, sender_name,
               recipient_key, recipient_kind, recipient_user_id,
               recipient_name, message_kind, payload_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'roll', ?)`,
          )
          .run(
            id,
            input.clientMessageId,
            generation,
            acceptedAt,
            senderKey,
            input.sender.kind,
            input.sender.kind === 'player' ? input.sender.userId : null,
            input.sender.displayName,
            recipientKey,
            input.recipient?.kind ?? null,
            input.recipient?.kind === 'player' ? input.recipient.userId : null,
            input.recipient?.displayName ?? null,
            payloadJson,
          );
        const message: ChatMessage = {
          acceptedAt,
          clientMessageId: input.clientMessageId,
          generation,
          id,
          payload: structuredClone(payload),
          recipient: input.recipient ? structuredClone(input.recipient) : null,
          sender: structuredClone(input.sender),
          sequence: Number(insert.lastInsertRowid),
        };
        database.exec('COMMIT');
        this.scheduleCampaignTouch();
        return { ok: true, value: { created: true, message } };
      } catch (error) {
        try {
          database.exec('ROLLBACK');
        } catch {
          // The transaction did not begin or already rolled back.
        }
        this.warn('Chat roll could not be committed.', error);
        return chatFailure('storage_error', 'Message could not be stored.');
      }
    });
  }

  clear(): Promise<ChatResult<ClearChatHistoryResult>> {
    return this.mutations.run(async () => {
      const database = this.database.connection;
      const generation = this.createId();
      try {
        database.exec('BEGIN IMMEDIATE');
        database.exec('DELETE FROM chat_messages');
        database
          .prepare(
            `UPDATE chat_metadata
             SET value = ?
             WHERE key = 'history_generation'`,
          )
          .run(generation);
        database.exec('COMMIT');
      } catch (error) {
        try {
          database.exec('ROLLBACK');
        } catch {
          // The transaction did not begin or already rolled back.
        }
        this.warn('Chat history clear failed.', error);
        return chatFailure(
          'storage_error',
          'Chat history could not be cleared.',
        );
      }

      try {
        database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch (error) {
        this.warn('Chat WAL could not be truncated after clear.', error);
      }
      this.scheduleCampaignTouch();
      return { ok: true, value: { generation } };
    });
  }

  retry(): Promise<void> {
    return this.mutations.run(async () => undefined);
  }

  close(): Promise<void> {
    return this.mutations.run(async () => {
      const flushTouch = this.touchTimer !== null;
      if (this.touchTimer) {
        clearTimeout(this.touchTimer);
        this.touchTimer = null;
      }
      if (flushTouch) {
        this.lastTouchAt = Date.now();
        this.enqueueCampaignTouch();
      }
      await this.touchPromise;
    });
  }

  private getGeneration(database: DatabaseSync): string {
    const row = database
      .prepare(
        `SELECT value
         FROM chat_metadata
         WHERE key = 'history_generation'`,
      )
      .get() as { value?: unknown } | undefined;
    if (
      typeof row?.value !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        row.value,
      )
    ) {
      throw new Error('Chat database generation is invalid.');
    }
    return row.value;
  }

  private readPage(
    database: DatabaseSync,
    viewer: ChatPrincipal,
    direction?: 'newer' | 'older',
    sequence?: number,
  ): ChatHistoryPage {
    const generation = this.getGeneration(database);
    const viewerKey = chatPrincipalKey(viewer);
    const visibility =
      '(recipient_key IS NULL OR sender_key = ? OR recipient_key = ?)';
    let query: string;
    let values: Array<string | number>;
    let ascending = false;
    if (direction === 'older' && sequence !== undefined) {
      query = `SELECT
          sequence, id, client_message_id, generation, accepted_at,
          sender_kind, sender_user_id, sender_name,
          recipient_kind, recipient_user_id, recipient_name,
          message_kind, payload_json
        FROM chat_messages
        WHERE ${visibility} AND sequence < ?
        ORDER BY sequence DESC
        LIMIT ${MAX_CHAT_HISTORY_PAGE_MESSAGES + 1}`;
      values = [viewerKey, viewerKey, sequence];
    } else if (direction === 'newer' && sequence !== undefined) {
      query = `SELECT
          sequence, id, client_message_id, generation, accepted_at,
          sender_kind, sender_user_id, sender_name,
          recipient_kind, recipient_user_id, recipient_name,
          message_kind, payload_json
        FROM chat_messages
        WHERE ${visibility} AND sequence > ?
        ORDER BY sequence ASC
        LIMIT ${MAX_CHAT_HISTORY_PAGE_MESSAGES + 1}`;
      values = [viewerKey, viewerKey, sequence];
      ascending = true;
    } else {
      query = `SELECT
          sequence, id, client_message_id, generation, accepted_at,
          sender_kind, sender_user_id, sender_name,
          recipient_kind, recipient_user_id, recipient_name,
          message_kind, payload_json
        FROM chat_messages
        WHERE ${visibility}
        ORDER BY sequence DESC
        LIMIT ${MAX_CHAT_HISTORY_PAGE_MESSAGES + 1}`;
      values = [viewerKey, viewerKey];
    }

    const rows = statementRows(database.prepare(query), ...values);
    const messages: ChatMessage[] = [];
    let truncated = false;
    for (const row of rows) {
      if (messages.length >= MAX_CHAT_HISTORY_PAGE_MESSAGES) {
        truncated = true;
        break;
      }
      const message = rowToMessage(row);
      const candidate = [...messages, message];
      if (
        messages.length > 0 &&
        chatUtf8ByteLength(
          JSON.stringify({
            generation,
            hasNewer: true,
            hasOlder: true,
            messages: candidate,
            newestSequence: candidate.at(-1)?.sequence ?? null,
            oldestSequence: candidate[0]?.sequence ?? null,
          }),
        ) >
          MAX_CHAT_HISTORY_PAGE_PAYLOAD_BYTES
      ) {
        truncated = true;
        break;
      }
      messages.push(message);
    }

    if (!ascending) {
      messages.reverse();
    }
    const first = messages[0]?.sequence;
    const last = messages[messages.length - 1]?.sequence;
    const hasBefore =
      first !== undefined &&
      this.hasVisible(database, viewerKey, '<', first);
    const hasAfter =
      last !== undefined &&
      this.hasVisible(database, viewerKey, '>', last);

    return {
      generation,
      hasNewer:
        direction === 'newer' ? truncated || hasAfter : hasAfter,
      hasOlder:
        direction === 'older' || direction === undefined
          ? truncated || hasBefore
          : hasBefore,
      messages,
      newestSequence: last ?? null,
      oldestSequence: first ?? null,
    };
  }

  private hasVisible(
    database: DatabaseSync,
    viewerKey: string,
    operator: '<' | '>',
    sequence: number,
  ): boolean {
    const row = database
      .prepare(
        `SELECT 1 AS found
         FROM chat_messages
         WHERE
           (recipient_key IS NULL OR sender_key = ? OR recipient_key = ?)
           AND sequence ${operator} ?
         LIMIT 1`,
      )
      .get(viewerKey, viewerKey, sequence) as
      | { found?: unknown }
      | undefined;
    return row?.found === 1;
  }

  private scheduleCampaignTouch(): void {
    if (!this.touchCampaign) {
      return;
    }
    const now = Date.now();
    const elapsed = now - this.lastTouchAt;
    if (elapsed >= CAMPAIGN_TOUCH_INTERVAL_MS) {
      this.lastTouchAt = now;
      this.enqueueCampaignTouch();
      return;
    }
    if (!this.touchTimer) {
      this.touchTimer = setTimeout(() => {
        this.touchTimer = null;
        this.lastTouchAt = Date.now();
        this.enqueueCampaignTouch();
      }, CAMPAIGN_TOUCH_INTERVAL_MS - elapsed);
    }
  }

  private enqueueCampaignTouch(): void {
    if (!this.touchCampaign) {
      return;
    }
    this.touchPromise = this.touchPromise
      .then(() => this.touchCampaign?.())
      .then(() => undefined)
      .catch((error) => {
        this.warn(
          'Campaign chat activity timestamp could not be updated.',
          error,
        );
      });
  }

}
