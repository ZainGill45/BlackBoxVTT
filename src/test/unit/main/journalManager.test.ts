import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CampaignRepository } from '../../../main/campaignRepository';
import {
  CampaignRuntimeRegistry,
  type JoinedAssetTransport,
  type JoinedJournalTransport,
  type JoinedSceneTransport,
} from '../../../main/campaignRuntime';
import { CampaignWorkspaceRegistry } from '../../../main/campaignWorkspace';
import { JournalManager } from '../../../main/journalManager';
import {
  parsePayload,
  type ProtocolMessageType,
} from '../../../main/network/tcpProtocol';
import {
  defaultJournalTitleStyle,
  emptyRichTextDocument,
  type JournalManifest,
  type JournalPage,
  type JournalResult,
  type SystemJournalEntry,
} from '../../../shared/journal';
import { TEST_CAMPAIGN_SYSTEM } from '../../support/gameSystems';

/**
 * A joined runtime hands whatever it receives straight to the host, which
 * closes the connection on an unrecognized key rather than answering. So the
 * manager forwarding its own routing field is not a tidiness problem: it drops
 * the player out of the campaign mid-edit.
 *
 * These cases pin the forwarded request against the schema the host actually
 * parses, so a request the host would reject fails here instead of in a session.
 */

const campaignId = '11111111-1111-4111-8111-111111111111';
const entryId = '22222222-2222-4222-8222-222222222222';
const pageId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';
const assetId = '55555555-5555-4555-8555-555555555555';

let directory: string;
let registry: CampaignRuntimeRegistry;
let manager: JournalManager;
const forwarded = new Map<string, unknown>();

/**
 * Records the request that reached the transport. Every operation reports
 * failure so the manager cannot be satisfied by a fabricated entry; what is
 * under test is the request that left, not the reply that came back.
 */
function recordingJournalTransport(): JoinedJournalTransport {
  const record =
    (operation: string) =>
    (...args: unknown[]): Promise<JournalResult<never>> => {
      forwarded.set(operation, args[0]);
      return Promise.resolve({
        error: { code: 'unavailable', message: 'Recorded.' },
        ok: false,
      });
    };
  return {
    acquireLease: record('acquireLease'),
    createEntry: record('createEntry'),
    createNote: record('createNote'),
    createPage: record('createPage'),
    deleteTarget: record('deleteTarget'),
    detachAsset: record('detachAsset'),
    findAssetDependents: record('findAssetDependents'),
    getNote: record('getNote'),
    getEntry: record('getEntry'),
    getPage: record('getPage'),
    list: record('list'),
    listUsers: record('listUsers'),
    moveNote: record('moveNote'),
    moveEntry: record('moveEntry'),
    movePage: record('movePage'),
    prepareDelete: record('prepareDelete'),
    releaseLease: record('releaseLease'),
    reorderNotes: record('reorderNotes'),
    reorderEntries: record('reorderEntries'),
    reorderPages: record('reorderPages'),
    renewLease: record('renewLease'),
    updateNote: record('updateNote'),
    renameEntry: record('renameEntry'),
    updateEntryData: record('updateEntryData'),
    updateEntryPermissions: record('updateEntryPermissions'),
    updateNotePermissions: record('updateNotePermissions'),
    updatePage: record('updatePage'),
    updatePagePermissions: record('updatePagePermissions'),
  } as JoinedJournalTransport;
}

/**
 * The registry resolves a registered joined runtime before it consults a
 * workspace, so these capabilities are never reached. They throw rather than
 * return, which would make an accidental local fallback visible.
 */
function unreachableTransports(): {
  assets: JoinedAssetTransport;
  scenes: JoinedSceneTransport;
} {
  const unreachable = (): never => {
    throw new Error('The joined runtime must not be resolved locally.');
  };
  return {
    assets: new Proxy({}, { get: () => unreachable }) as JoinedAssetTransport,
    scenes: new Proxy({}, { get: () => unreachable }) as JoinedSceneTransport,
  };
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'blackbox-journal-manager-'));
  const campaignRepository = new CampaignRepository({
    rootDirectory: path.join(directory, 'campaigns'),
    trashItem: (target) => rm(target, { force: true, recursive: true }),
  });
  registry = new CampaignRuntimeRegistry(
    new CampaignWorkspaceRegistry({
      campaignRepository,
      trashItem: (target) => rm(target, { force: true, recursive: true }),
    }),
  );
  registry.registerJoined({
    ...unreachableTransports(),
    campaignId,
    journal: recordingJournalTransport(),
    kind: 'joined',
    system: TEST_CAMPAIGN_SYSTEM,
  });
  manager = new JournalManager(registry);
});

afterAll(async () => {
  await rm(directory, { force: true, recursive: true });
});

const entryPermissions = {
  allPlayers: 'view' as const,
  overrides: [{ access: 'edit' as const, userId }],
};
const pagePermissions = {
  allPlayers: 'inherit' as const,
  overrides: [{ access: 'view' as const, userId }],
};

describe('prepared Journal content', () => {
  const capabilities = {
    delete: false,
    edit: false,
    managePages: false,
    managePermissions: false,
    reorder: false,
    view: true,
  };
  const preparedEntry: SystemJournalEntry = {
    capabilities,
    data: { identity: { className: 'Ranger' } },
    detail: 'Level 4 Ranger',
    groupId: 'dnd5e.characters',
    id: entryId,
    kind: 'system',
    name: 'Arannis',
    permissionRevision: 0,
    permissions: null,
    position: 0,
    revision: 2,
    typeId: 'dnd5e.character',
  };
  const preparedPage: JournalPage = {
    capabilities: {
      delete: false,
      edit: false,
      managePermissions: false,
      reorder: false,
      view: true,
    },
    content: emptyRichTextDocument(),
    entryId: '66666666-6666-4666-8666-666666666666',
    id: pageId,
    permissionRevision: 0,
    permissions: null,
    position: 0,
    revision: 3,
    title: 'Known Paths',
    titleStyle: defaultJournalTitleStyle(),
  };
  const preparedManifest: JournalManifest = {
    entries: [
      preparedEntry,
      {
        capabilities,
        groupId: 'core.notes',
        id: preparedPage.entryId,
        kind: 'note',
        name: 'Expedition Notes',
        nameStyle: defaultJournalTitleStyle(),
        pages: [preparedPage],
        permissionRevision: 0,
        permissions: null,
        position: 1,
        revision: 1,
        typeId: 'core.note',
      },
    ],
    revision: 4,
  };

  it('snapshots actor-filtered bodies, reports items, and serves read-through consumers', async () => {
    const getEntry = vi.fn(async () => ({
      ok: true as const,
      value: preparedEntry,
    }));
    const getPage = vi.fn(async () => ({
      ok: true as const,
      value: preparedPage,
    }));
    const runtime = {
      journal: {
        getEntry,
        getPage,
        list: vi.fn(async () => ({
          ok: true as const,
          value: preparedManifest,
        })),
      },
    };
    const preparedManager = new JournalManager({
      resolve: vi.fn(async () => runtime),
    } as unknown as CampaignRuntimeRegistry);
    const progress = vi.fn();
    preparedManager.on('preparation-progress', progress);

    await expect(preparedManager.prepareContent(campaignId)).resolves.toEqual({
      ok: true,
      value: { entries: [preparedEntry], pages: [preparedPage] },
    });
    await preparedManager.getEntry({ campaignId, entryId });
    await preparedManager.getPage({ campaignId, entryId: preparedPage.entryId, pageId });

    expect(getEntry).toHaveBeenCalledOnce();
    expect(getPage).toHaveBeenCalledOnce();
    expect(progress.mock.calls.map(([event]) => event.currentName).sort()).toEqual(
      ['Arannis', 'Known Paths'],
    );
  });

  it('invalidates prepared bodies on permission change and campaign teardown', async () => {
    const getEntry = vi.fn(async () => ({
      ok: true as const,
      value: preparedEntry,
    }));
    const runtime = {
      journal: {
        getEntry,
        getPage: vi.fn(),
        list: vi.fn(async () => ({
          ok: true as const,
          value: { entries: [preparedEntry], revision: 1 },
        })),
      },
    };
    const preparedManager = new JournalManager({
      resolve: vi.fn(async () => runtime),
    } as unknown as CampaignRuntimeRegistry);
    await preparedManager.prepareContent(campaignId);

    preparedManager.notifyRemoteChanged({
      campaignId,
      entryId,
      type: 'permissions',
    });
    await preparedManager.getEntry({ campaignId, entryId });
    preparedManager.releaseCampaign(campaignId);
    await preparedManager.getEntry({ campaignId, entryId });

    expect(getEntry).toHaveBeenCalledTimes(3);
  });
});

/**
 * Each case is one manager call and the protocol message a joined runtime turns
 * it into. Operations that pass named arguments rather than the request object
 * cannot carry the routing field and are covered by the protocol suite.
 */
const forwardingOperations: readonly {
  readonly call: () => Promise<unknown>;
  readonly messageType: ProtocolMessageType;
  readonly operation: string;
}[] = [
  {
    call: () =>
      manager.updateEntryData({
        campaignId,
        data: { identity: { className: 'Ranger' } },
        entryId,
        expectedRevision: 4,
      }),
    messageType: 'client.journal_update_entry_data',
    operation: 'updateEntryData',
  },
  {
    call: () =>
      manager.updateEntryPermissions({
        campaignId,
        entryId,
        expectedPermissionRevision: 4,
        permissions: entryPermissions,
      }),
    messageType: 'client.journal_update_entry_permissions',
    operation: 'updateEntryPermissions',
  },
  {
    call: () =>
      manager.updateNotePermissions({
        campaignId,
        entryId,
        expectedPermissionRevision: 4,
        permissions: entryPermissions,
      }),
    messageType: 'client.journal_update_note_permissions',
    operation: 'updateNotePermissions',
  },
  {
    call: () =>
      manager.updatePagePermissions({
        campaignId,
        entryId,
        expectedPermissionRevision: 2,
        pageId,
        permissions: pagePermissions,
      }),
    messageType: 'client.journal_update_page_permissions',
    operation: 'updatePagePermissions',
  },
  {
    call: () =>
      manager.moveNote({
        campaignId,
        direction: 'up',
        entryId,
        expectedManifestRevision: 7,
      }),
    messageType: 'client.journal_move_note',
    operation: 'moveNote',
  },
  {
    call: () =>
      manager.moveEntry({
        campaignId,
        direction: 'down',
        entryId,
        expectedManifestRevision: 7,
      }),
    messageType: 'client.journal_move_entry',
    operation: 'moveEntry',
  },
  {
    call: () =>
      manager.reorderNotes({
        campaignId,
        expectedManifestRevision: 7,
        orderedEntryIds: [entryId],
      }),
    messageType: 'client.journal_reorder_notes',
    operation: 'reorderNotes',
  },
  {
    call: () =>
      manager.reorderEntries({
        campaignId,
        expectedManifestRevision: 7,
        groupId: 'dnd5e.characters',
        orderedEntryIds: [entryId],
      }),
    messageType: 'client.journal_reorder_entries',
    operation: 'reorderEntries',
  },
  {
    call: () =>
      manager.movePage({
        campaignId,
        direction: 'up',
        entryId,
        expectedEntryRevision: 3,
        pageId,
      }),
    messageType: 'client.journal_move_page',
    operation: 'movePage',
  },
  {
    call: () =>
      manager.reorderPages({
        campaignId,
        entryId,
        expectedEntryRevision: 3,
        orderedPageIds: [pageId],
      }),
    messageType: 'client.journal_reorder_pages',
    operation: 'reorderPages',
  },
  {
    call: () =>
      manager.deleteTarget({
        campaignId,
        cleanupAssetIds: [assetId],
        expectedRevision: 4,
        target: { entryId, kind: 'entry' },
      }),
    messageType: 'client.journal_delete_entry',
    operation: 'deleteTarget',
  },
];

describe('journal manager request forwarding', () => {
  it.each(forwardingOperations)(
    'forwards $operation as a request the host accepts',
    async ({ call, messageType, operation }) => {
      await call();
      const request = forwarded.get(operation);
      expect(request).toBeDefined();
      expect(() => parsePayload(messageType, request)).not.toThrow();
    },
  );

  it('never forwards the campaign routing field to a runtime', async () => {
    await Promise.all(forwardingOperations.map(({ call }) => call()));
    const leaked = [...forwarded.entries()]
      .filter(([, request]) =>
        Boolean(
          request &&
            typeof request === 'object' &&
            'campaignId' in request,
        ),
      )
      .map(([operation]) => operation);
    expect(leaked).toEqual([]);
  });
});
