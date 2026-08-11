import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatIdentity, ChatPrincipal } from '../../../shared/chat';
import { ChatRepository } from '../../../main/chatRepository';
import {
  CampaignDatabase,
} from '../../../main/storage/campaignDatabase';
import { TEST_CAMPAIGN_SYSTEM } from '../../support/gameSystems';
import type {
  ChatRollCard,
  ChatRollConditionalSectionDefinition,
  ChatRollDefinition,
  ChatRollEffectSectionDefinition,
  ChatRollPromptSectionDefinition,
} from '../../../shared/chatRoll';

const gm = { displayName: 'Game Master', kind: 'gm' } as const;
const alice = {
  displayName: 'Alice',
  kind: 'player',
  userId: '11111111-1111-4111-8111-111111111111',
} as const;
const bob = {
  displayName: 'Bob',
  kind: 'player',
  userId: '22222222-2222-4222-8222-222222222222',
} as const;
const charlie = {
  displayName: 'Charlie',
  kind: 'player',
  userId: '33333333-3333-4333-8333-333333333333',
} as const;
const temporaryDirectories: string[] = [];
const databases: CampaignDatabase[] = [];

async function createCampaignDatabase() {
  const directory = await mkdtemp(path.join(tmpdir(), 'blackbox-chat-'));
  temporaryDirectories.push(directory);
  const timestamp = '2026-07-31T12:00:00.000Z';
  const database = CampaignDatabase.create(directory, {
    createdAt: timestamp,
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Iron Meridian',
    system: TEST_CAMPAIGN_SYSTEM,
    updatedAt: timestamp,
  });
  databases.push(database);
  return { database, directory };
}

function principal(identity: ChatIdentity): ChatPrincipal {
  return identity.kind === 'gm'
    ? { kind: 'gm' }
    : { kind: 'player', userId: identity.userId };
}

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('ChatRepository', () => {
  it('persists public and participant-only whispers with immutable snapshots', async () => {
    const { database, directory } = await createCampaignDatabase();
    const repository = new ChatRepository({ database });
    const publicSend = await repository.send({
      clientMessageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      content: '  Public\r\nmessage  ',
      maxMessageCharacters: 10_000,
      recipient: null,
      sender: gm,
    });
    await repository.send({
      clientMessageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      content: 'Alice to Bob',
      maxMessageCharacters: 10_000,
      recipient: bob,
      sender: alice,
    });
    await repository.send({
      clientMessageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      content: 'Alice to GM',
      maxMessageCharacters: 10_000,
      recipient: gm,
      sender: alice,
    });

    expect(publicSend).toMatchObject({
      ok: true,
      value: {
        created: true,
        message: {
          payload: { kind: 'text', text: 'Public\nmessage' },
          sequence: 1,
        },
      },
    });
    const retry = await repository.send({
      clientMessageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      content: 'Public\nmessage',
      maxMessageCharacters: 10_000,
      recipient: null,
      sender: gm,
    });
    expect(retry).toMatchObject({
      ok: true,
      value: { created: false, message: { sequence: 1 } },
    });
    expect(
      await repository.send({
        clientMessageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        content: 'Different',
        maxMessageCharacters: 10_000,
        recipient: null,
        sender: gm,
      }),
    ).toMatchObject({
      error: { code: 'invalid_input' },
      ok: false,
    });

    await repository.close();
    database.close();
    databases.splice(databases.indexOf(database), 1);
    const reopenedDatabase = CampaignDatabase.open(directory);
    databases.push(reopenedDatabase);
    const reopened = new ChatRepository({ database: reopenedDatabase });
    const directorySnapshot = [gm, alice, bob, charlie];
    const read = async (viewer: ChatIdentity) => {
      const result = await reopened.bootstrap(
        principal(viewer),
        directorySnapshot,
        10_000,
      );
      return result.ok ? result.value.messages : [];
    };
    expect((await read(gm)).map((message) => message.payload.kind === 'text' ? message.payload.text : '')).toEqual([
      'Public\nmessage',
      'Alice to GM',
    ]);
    expect((await read(alice)).map((message) => message.payload.kind === 'text' ? message.payload.text : '')).toEqual([
      'Public\nmessage',
      'Alice to Bob',
      'Alice to GM',
    ]);
    expect((await read(bob)).map((message) => message.payload.kind === 'text' ? message.payload.text : '')).toEqual([
      'Public\nmessage',
      'Alice to Bob',
    ]);
    expect((await read(charlie)).map((message) => message.payload.kind === 'text' ? message.payload.text : '')).toEqual([
      'Public\nmessage',
    ]);
    await reopened.close();
  });

  it('counts graphemes, bounds bytes, rejects self-whispers, and pages by bytes', async () => {
    const { database } = await createCampaignDatabase();
    const repository = new ChatRepository({ database });
    expect(
      await repository.send({
        clientMessageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        content: '👨‍👩‍👧‍👦a',
        maxMessageCharacters: 1,
        recipient: null,
        sender: alice,
      }),
    ).toMatchObject({ error: { code: 'invalid_input' }, ok: false });
    expect(
      await repository.send({
        clientMessageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        content: 'hello',
        maxMessageCharacters: 10,
        recipient: alice,
        sender: alice,
      }),
    ).toMatchObject({ error: { code: 'recipient_not_found' }, ok: false });

    const largeMessage = '😀'.repeat(49_999);
    for (let index = 0; index < 4; index += 1) {
      const result = await repository.send({
        clientMessageId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        content: `${index}${largeMessage}`,
        maxMessageCharacters: 50_000,
        recipient: null,
        sender: alice,
      });
      expect(result.ok).toBe(true);
    }
    const bootstrap = await repository.bootstrap(
      principal(alice),
      [gm, alice],
      50_000,
    );
    expect(bootstrap.ok).toBe(true);
    if (bootstrap.ok) {
      expect(bootstrap.value.messages.length).toBe(3);
      expect(bootstrap.value.hasOlder).toBe(true);
      expect(
        Buffer.byteLength(
          JSON.stringify({
            generation: bootstrap.value.generation,
            hasNewer: bootstrap.value.hasNewer,
            hasOlder: bootstrap.value.hasOlder,
            messages: bootstrap.value.messages,
            newestSequence: bootstrap.value.newestSequence,
            oldestSequence: bootstrap.value.oldestSequence,
          }),
          'utf8',
        ),
      ).toBeLessThanOrEqual(768 * 1024);
    }
    await repository.close();
  });

  it('stores immutable roll payloads, deduplicates retries, and fails closed on malformed trees', async () => {
    const { database } = await createCampaignDatabase();
    const repository = new ChatRepository({ database, warn: vi.fn() });
    const definition: ChatRollDefinition = {
      category: 'Roll',
      sections: [
        { label: 'Attack', modifiers: [], notation: '1d20', typeLabel: 'Attack' },
        { kind: 'effect', label: 'Details', text: 'Range: 5 feet' },
        { detail: 'Failure: knocked prone', kind: 'prompt', label: 'Save', value: 'DC 14 DEXTERITY save' },
        {
          alternateNotation: '2d6',
          condition: 'first-d20-natural-maximum',
          kind: 'conditional-roll',
          label: 'Damage',
          modifiers: [{ label: 'Strength', value: 3 }],
          notation: '1d6',
          sourceSection: 0,
          typeLabel: 'Slashing',
        },
      ],
      title: 'Longsword',
    };
    const card: ChatRollCard = {
      ...definition,
      sections: [
        {
          ...definition.sections[0],
          baseTotal: 20,
          expression: [{ kind: 'number' as const, value: 20 }],
          total: 20,
        },
        definition.sections[1] as ChatRollEffectSectionDefinition,
        definition.sections[2] as ChatRollPromptSectionDefinition,
        {
          ...(definition.sections[3] as ChatRollConditionalSectionDefinition),
          baseTotal: 12,
          expression: [{ kind: 'number', value: 12 }],
          rolledNotation: '2d6',
          total: 15,
          usedAlternate: true,
        },
      ],
    };
    const input = {
      card,
      clientMessageId: '30303030-3030-4030-8030-303030303030',
      definition,
      maxMessageCharacters: 10_000,
      recipient: null,
      sender: gm,
    };
    const first = await repository.sendRoll(input);
    const retry = await repository.sendRoll(input);
    if (!first.ok) throw new Error(first.error.message);
    expect(first).toMatchObject({ ok: true, value: { created: true } });
    expect(retry).toMatchObject({
      ok: true,
      value: { created: false, message: { payload: { kind: 'roll' }, sequence: 1 } },
    });
    expect(
      await repository.sendRoll({
        ...input,
        definition: {
          ...definition,
          sections: [
            { ...definition.sections[0], notation: '1d12' },
            ...definition.sections.slice(1),
          ],
        },
      }),
    ).toMatchObject({ error: { code: 'invalid_input' }, ok: false });

    database.connection
      .prepare(
        `UPDATE chat_messages
         SET payload_json = ?
         WHERE client_message_id = ?`,
      )
      .run(
        JSON.stringify({
          card: { ...card, sections: [{ ...card.sections[0], expression: [{}] }] },
          kind: 'roll',
        }),
        input.clientMessageId,
      );
    expect(
      await repository.bootstrap({ kind: 'gm' }, [gm], 10_000),
    ).toMatchObject({ error: { code: 'storage_error' }, ok: false });
  });

  it('returns 100-message pages and rotates the generation atomically on clear', async () => {
    const { database } = await createCampaignDatabase();
    const repository = new ChatRepository({ database });
    for (let index = 0; index < 105; index += 1) {
      await repository.send({
        clientMessageId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        content: `Message ${index}`,
        maxMessageCharacters: 10_000,
        recipient: null,
        sender: gm,
      });
    }
    const bootstrap = await repository.bootstrap(
      { kind: 'gm' },
      [gm],
      10_000,
    );
    expect(bootstrap.ok).toBe(true);
    if (!bootstrap.ok) {
      return;
    }
    expect(bootstrap.value.messages).toHaveLength(100);
    expect(bootstrap.value.messages[0].sequence).toBe(6);
    expect(bootstrap.value.oldestSequence).toBe(6);
    expect(bootstrap.value.newestSequence).toBe(105);
    expect(bootstrap.value.hasOlder).toBe(true);
    const older = await repository.history(
      { kind: 'gm' },
      {
        direction: 'older',
        generation: bootstrap.value.generation,
        sequence: bootstrap.value.messages[0].sequence,
      },
    );
    expect(older.ok).toBe(true);
    if (older.ok) {
      expect(older.value.hasOlder).toBe(false);
      expect(older.value.messages.map((message) => message.sequence)).toEqual([
        1, 2, 3, 4, 5,
      ]);
    }

    const cleared = await repository.clear();
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.value.generation).not.toBe(
        bootstrap.value.generation,
      );
    }
    expect(
      await repository.history(
        { kind: 'gm' },
        {
          direction: 'older',
          generation: bootstrap.value.generation,
          sequence: 106,
        },
      ),
    ).toMatchObject({ error: { code: 'history_changed' }, ok: false });
    const afterClear = await repository.bootstrap(
      { kind: 'gm' },
      [gm],
      10_000,
    );
    expect(afterClear).toMatchObject({
      ok: true,
      value: { messages: [] },
    });
    await repository.close();
  });

  it('fails closed when the shared chat schema becomes unavailable', async () => {
    const { database } = await createCampaignDatabase();
    const warn = vi.fn();
    const repository = new ChatRepository({
      database,
      warn,
    });
    database.connection.exec('DROP TABLE chat_messages');

    expect(
      await repository.bootstrap({ kind: 'gm' }, [gm], 10_000),
    ).toMatchObject({ error: { code: 'storage_error' }, ok: false });
    await repository.retry();
    expect(
      await repository.bootstrap({ kind: 'gm' }, [gm], 10_000),
    ).toMatchObject({ error: { code: 'storage_error' }, ok: false });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
