import { describe, expect, it, vi } from 'vitest';
import type {
  ChatIdentity,
  ChatMessage,
  ChatParticipantEvent,
} from '../../../../shared/chat';
import type {
  ChatRepository,
  StoredChatSendResult,
} from '../../../../main/chatRepository';
import {
  CampaignChatService,
  GAME_MASTER_CHAT_IDENTITY,
  playerChatIdentity,
  type DiceRoller,
} from '../../../../main/campaignTable/chatService';
import type { ChatRollCardV1 } from '../../../../shared/chatRoll';
import type {
  ChatConfigurationSnapshot,
  ServerConfigRepository,
  StoredManagedUser,
} from '../../../../main/network/serverConfigRepository';

const alphaId = '11111111-1111-4111-8111-111111111111';
const betaId = '22222222-2222-4222-8222-222222222222';

function user(id: string, username: string): StoredManagedUser {
  return {
    id,
    password: {
      algorithm: 'scrypt',
      blockSize: 8,
      cost: 32_768,
      hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      keyLength: 32,
      parallelization: 1,
      salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    },
    username,
  };
}

function message(
  sender: ChatIdentity,
  recipient: ChatIdentity | null,
): ChatMessage {
  return {
    acceptedAt: '2026-07-31T12:00:00.000Z',
    clientMessageId: 'client-message',
    generation: 'generation',
    id: 'message',
    payload: { kind: 'text', text: 'Hello' },
    recipient,
    sender,
    sequence: 1,
  };
}

function createHarness(options?: {
  diceRoller?: DiceRoller;
  loadError?: Error;
  sendResult?: StoredChatSendResult;
}) {
  const users = [user(betaId, 'Beta'), user(alphaId, 'Alpha')];
  const defaultMessage = message(GAME_MASTER_CHAT_IDENTITY, null);
  const bootstrap = vi.fn(async () => ({
    ok: true as const,
    value: {
      directory: [],
      generation: 'generation',
      hasNewer: false,
      hasOlder: false,
      maxMessageCharacters: 500,
      messages: [],
      newestSequence: null,
      oldestSequence: null,
      systemEvents: [],
    },
  }));
  const clear = vi.fn(async () => ({
    ok: true as const,
    value: { generation: 'next-generation' },
  }));
  const currentGeneration = vi.fn(async () => ({
    ok: true as const,
    value: 'generation',
  }));
  const history = vi.fn(async () => ({
    ok: true as const,
    value: {
      generation: 'generation',
      hasNewer: false,
      hasOlder: false,
      messages: [],
      newestSequence: null,
      oldestSequence: null,
    },
  }));
  const send = vi.fn(async () => ({
    ok: true as const,
    value: options?.sendResult ?? {
      created: true,
      message: defaultMessage,
    },
  }));
  const find = vi.fn(
    async (): Promise<{ ok: true; value: ChatMessage | null }> => ({
      ok: true,
      value: null,
    }),
  );
  const sendRoll = vi.fn();
  const chat = {
    bootstrap,
    clear,
    currentGeneration,
    find,
    history,
    send,
    sendRoll,
  } as unknown as ChatRepository;
  const load = vi.fn(async () => {
    if (options?.loadError) {
      throw options.loadError;
    }
    return {
      maxChatMessageCharacters: 500,
      port: 31_337,
      schemaVersion: 3 as const,
      transformPreviewRate: 60,
      users,
    };
  });
  const withChatConfiguration = vi.fn(
    async <T>(
      useConfiguration: (
        snapshot: ChatConfigurationSnapshot,
      ) => Promise<T>,
    ) =>
      useConfiguration({
        maxMessageCharacters: 500,
        users,
      }),
  );
  const config = {
    load,
    withChatConfiguration,
  } as unknown as ServerConfigRepository;
  const service = new CampaignChatService({
    chat,
    config,
    createId: () => 'event-id',
    diceRoller: options?.diceRoller,
    now: () => new Date('2026-07-31T12:00:00.000Z'),
  });

  return {
    bootstrap,
    clear,
    currentGeneration,
    find,
    history,
    load,
    send,
    sendRoll,
    service,
    users,
    withChatConfiguration,
  };
}

describe('CampaignChatService', () => {
  it('builds a stable, sorted chat directory for bootstrap', async () => {
    const { bootstrap, service, users } = createHarness();
    const systemEvents: ChatParticipantEvent[] = [
      {
        eventId: 'event',
        generation: 'generation',
        identity: playerChatIdentity(users[0]),
        occurredAt: '2026-07-31T12:00:00.000Z',
        type: 'participant_joined',
      },
    ];

    await expect(
      service.bootstrap({ kind: 'gm' }, systemEvents),
    ).resolves.toMatchObject({ ok: true });
    expect(bootstrap).toHaveBeenCalledWith(
      { kind: 'gm' },
      [
        GAME_MASTER_CHAT_IDENTITY,
        playerChatIdentity(users[1]),
        playerChatIdentity(users[0]),
      ],
      500,
      systemEvents,
    );
  });

  it('resolves a whisper recipient and preserves the stored created flag', async () => {
    const stored = {
      created: false,
      message: message(GAME_MASTER_CHAT_IDENTITY, {
        displayName: 'Alpha',
        kind: 'player' as const,
        userId: alphaId,
      }),
    };
    const { send, service } = createHarness({ sendResult: stored });

    const result = await service.send(GAME_MASTER_CHAT_IDENTITY, {
      clientMessageId: 'retry-id',
      content: 'Private',
      recipient: { kind: 'player', userId: alphaId },
    });

    expect(result).toEqual({ ok: true, value: stored });
    expect(send).toHaveBeenCalledWith({
      clientMessageId: 'retry-id',
      content: 'Private',
      maxMessageCharacters: 500,
      recipient: {
        displayName: 'Alpha',
        kind: 'player',
        userId: alphaId,
      },
      sender: GAME_MASTER_CHAT_IDENTITY,
    });
  });

  it('rejects a missing whisper recipient without touching chat storage', async () => {
    const { send, service } = createHarness();

    await expect(
      service.send(GAME_MASTER_CHAT_IDENTITY, {
        clientMessageId: 'message-id',
        content: 'Private',
        recipient: {
          kind: 'player',
          userId: '33333333-3333-4333-8333-333333333333',
        },
      }),
    ).resolves.toEqual({
      error: {
        code: 'recipient_not_found',
        message: 'Whisper recipient could not be found.',
      },
      ok: false,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('limits whisper delivery to its sender and recipient', () => {
    const { service, users } = createHarness();
    const sender = playerChatIdentity(users[0]);
    const recipient = playerChatIdentity(users[1]);
    const whisper = message(sender, recipient);

    expect(service.isVisibleTo(whisper, sender.userId)).toBe(true);
    expect(service.isVisibleTo(whisper, recipient.userId)).toBe(true);
    expect(
      service.isVisibleTo(
        whisper,
        '33333333-3333-4333-8333-333333333333',
      ),
    ).toBe(false);
    expect(
      service.isVisibleTo(message(sender, null), 'unrelated-player'),
    ).toBe(true);
  });

  it('creates deterministic participant events for the current generation', async () => {
    const { service, users } = createHarness();

    await expect(
      service.createParticipantEvent(users[1], 'participant_left'),
    ).resolves.toEqual({
      eventId: 'event-id',
      generation: 'generation',
      identity: playerChatIdentity(users[1]),
      occurredAt: '2026-07-31T12:00:00.000Z',
      type: 'participant_left',
    });
  });

  it('maps configuration failures to operation-specific storage errors', async () => {
    const { service } = createHarness({ loadError: new Error('disk') });

    await expect(service.bootstrap({ kind: 'gm' })).resolves.toEqual({
      error: {
        code: 'storage_error',
        message: 'Campaign chat is unavailable.',
      },
      ok: false,
    });
    await expect(service.directory()).resolves.toEqual({
      error: {
        code: 'storage_error',
        message: 'Chat directory could not be loaded.',
      },
      ok: false,
    });
  });

  it('returns an accepted durable roll retry without invoking the worker twice', async () => {
    const definition = {
      category: 'Roll',
      sections: [
        { label: '1d20', modifiers: [], notation: '1d20', typeLabel: null },
      ],
      title: null,
    };
    const card: ChatRollCardV1 = {
      ...definition,
      sections: [
        {
          ...definition.sections[0],
          baseTotal: 20,
          expression: [{ kind: 'number', value: 20 }],
          total: 20,
        },
      ],
      version: 1,
    };
    const diceRoller = { roll: vi.fn(async () => ({ ok: true as const, value: card })) };
    const { find, sendRoll, service } = createHarness({ diceRoller });
    const storedMessage: ChatMessage = {
      ...message(GAME_MASTER_CHAT_IDENTITY, null),
      clientMessageId: 'roll-id',
      payload: { card, kind: 'roll' },
    };
    find
      .mockResolvedValueOnce({ ok: true, value: null })
      .mockResolvedValueOnce({ ok: true, value: storedMessage });
    sendRoll.mockResolvedValue({
      ok: true,
      value: { created: true, message: storedMessage },
    });
    const input = { clientMessageId: 'roll-id', definition, recipient: null };

    await expect(service.sendRoll(GAME_MASTER_CHAT_IDENTITY, input)).resolves.toMatchObject({
      ok: true,
    });
    await expect(service.sendRoll(GAME_MASTER_CHAT_IDENTITY, input)).resolves.toEqual({
      ok: true,
      value: { created: false, message: storedMessage },
    });
    expect(diceRoller.roll).toHaveBeenCalledTimes(1);
    expect(sendRoll).toHaveBeenCalledTimes(1);
  });
});
