import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatIdentity, ChatPrincipal } from '../../../shared/chat';
import { ChatRepository } from '../../../main/chatRepository';
import {
  CAMPAIGN_DATABASE_SCHEMA_VERSION,
  CampaignDatabase,
} from '../../../main/storage/campaignDatabase';
import { CAMPAIGN_SCHEMA_VERSION } from '../../../shared/campaigns';
import { TEST_CAMPAIGN_SYSTEM } from '../../support/gameSystems';

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
    schemaVersion: CAMPAIGN_SCHEMA_VERSION,
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
  it('transactionally migrates schema 7 text messages and whispers to v1 payloads', async () => {
    const { database, directory } = await createCampaignDatabase();
    const repository = new ChatRepository({ database });
    await repository.send({
      clientMessageId: '10101010-1010-4010-8010-101010101010',
      content: 'Public before migration',
      maxMessageCharacters: 10_000,
      recipient: null,
      sender: gm,
    });
    await repository.send({
      clientMessageId: '20202020-2020-4020-8020-202020202020',
      content: 'Private before migration',
      maxMessageCharacters: 10_000,
      recipient: bob,
      sender: alice,
    });
    await repository.close();

    database.connection.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE chat_messages RENAME TO chat_messages_v8;
      CREATE TABLE chat_messages_v7 (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        client_message_id TEXT NOT NULL,
        generation TEXT NOT NULL,
        accepted_at TEXT NOT NULL,
        sender_key TEXT NOT NULL,
        sender_kind TEXT NOT NULL,
        sender_user_id TEXT,
        sender_name TEXT NOT NULL,
        recipient_key TEXT,
        recipient_kind TEXT,
        recipient_user_id TEXT,
        recipient_name TEXT,
        content TEXT NOT NULL,
        UNIQUE (sender_key, client_message_id)
      ) STRICT;
      INSERT INTO chat_messages_v7
      SELECT
        sequence, id, client_message_id, generation, accepted_at,
        sender_key, sender_kind, sender_user_id, sender_name,
        recipient_key, recipient_kind, recipient_user_id, recipient_name,
        json_extract(payload_json, '$.text')
      FROM chat_messages_v8;
      DROP TABLE chat_messages_v8;
      ALTER TABLE chat_messages_v7 RENAME TO chat_messages;
      CREATE INDEX chat_messages_sender_sequence
        ON chat_messages (sender_key, sequence);
      CREATE INDEX chat_messages_recipient_sequence
        ON chat_messages (recipient_key, sequence);
      DROP TABLE campaign_system;
      DROP TABLE journal_page_permissions;
      DROP TABLE journal_pages;
      DROP TABLE journal_entry_permissions;
      DROP TABLE journal_entries;
      DROP TABLE journal_manifest;
      PRAGMA user_version = 7;
      COMMIT;
    `);
    database.close();
    databases.splice(databases.indexOf(database), 1);

    const migrated = CampaignDatabase.open(directory);
    databases.push(migrated);
    expect(
      (migrated.connection.prepare('PRAGMA user_version').get() as {
        user_version: number;
      }).user_version,
    ).toBe(CAMPAIGN_DATABASE_SCHEMA_VERSION);
    expect(migrated.readSystem()).toEqual(TEST_CAMPAIGN_SYSTEM);
    const migratedRepository = new ChatRepository({ database: migrated });
    const page = await migratedRepository.bootstrap(
      principal(alice),
      [gm, alice, bob],
      10_000,
    );
    expect(page).toMatchObject({
      ok: true,
      value: {
        messages: [
          {
            clientMessageId: '10101010-1010-4010-8010-101010101010',
            payload: { kind: 'text', text: 'Public before migration' },
            sequence: 1,
          },
          {
            clientMessageId: '20202020-2020-4020-8020-202020202020',
            payload: { kind: 'text', text: 'Private before migration' },
            sequence: 2,
          },
        ],
      },
    });
  });

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
    const definition = {
      category: 'Roll',
      sections: [
        { label: '1d20', modifiers: [], notation: '1d20', typeLabel: null },
      ],
      title: null,
    };
    const card = {
      ...definition,
      sections: [
        {
          ...definition.sections[0],
          baseTotal: 20,
          expression: [{ kind: 'number' as const, value: 20 }],
          total: 20,
        },
      ],
      version: 1 as const,
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
          sections: [{ ...definition.sections[0], notation: '1d12' }],
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
