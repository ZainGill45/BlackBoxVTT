import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JournalPanel } from '../../../../features/play/JournalPanel';
import type {
  JournalApi,
  JournalChangedEvent,
  JournalEntrySummary,
  JournalPage,
  JournalResult,
  NoteEntry,
} from '../../../../shared/journal';
import {
  JOURNAL_SCHEMA_VERSION,
  defaultJournalTitleStyle,
  emptyRichTextDocument,
} from '../../../../shared/journal';
import { createFakeAssetApi, makeImageAsset } from '../../../support/scenes';

const campaignId = '11111111-1111-4111-8111-111111111111';
const page: JournalPage = {
  capabilities: { delete: false, edit: true, managePermissions: true, reorder: true, view: true },
  content: emptyRichTextDocument(),
  entryId: '22222222-2222-4222-8222-222222222222',
  id: '33333333-3333-4333-8333-333333333333',
  permissionRevision: 0,
  permissions: { allPlayers: 'inherit', overrides: [] },
  position: 0,
  revision: 0,
  title: 'Tomb of Babylon',
  titleStyle: defaultJournalTitleStyle(),
};
const note: JournalEntrySummary = {
  capabilities: { delete: true, edit: true, managePages: true, managePermissions: true, reorder: true, view: true },
  id: page.entryId,
  name: 'Gathered Magic Items',
  nameStyle: defaultJournalTitleStyle(),
  pages: [page],
  permissions: { allPlayers: 'none', overrides: [] },
  position: 0,
  revision: 0,
  typeId: 'core.note',
};

function journalApi(overrides: Partial<JournalApi> = {}): JournalApi {
  return {
    ...window.blackBox.journal,
    acquireLease: async () => ({
      ok: true,
      value: {
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        holderName: 'Game Master',
        leaseId: '44444444-4444-4444-8444-444444444444',
        page,
      },
    }),
    getNote: async () => ({ ok: true, value: note }),
    getPage: async () => ({ ok: true, value: page }),
    list: async () => ({ ok: true, value: { entries: [note], revision: 0, schemaVersion: JOURNAL_SCHEMA_VERSION } }),
    listUsers: async () => ({ ok: true, value: [] }),
    ...overrides,
  };
}

describe('JournalPanel', () => {
  it('renders the empty searchable shell with an enabled no-op add control', async () => {
    const user = userEvent.setup();
    const { container } = render(<JournalPanel />);
    const search = screen.getByRole('searchbox', { name: 'Search journal' });
    const add = screen.getByRole('button', { name: 'Add journal entry' });

    expect(add).toBeEnabled();
    expect(
      container.querySelector('[data-sidebar-icon="journal"] svg'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Characters|Monsters|Items|Spells|Notes/ }))
      .not.toBeInTheDocument();

    const beforeAdd = container.innerHTML;
    await user.click(add);
    expect(container.innerHTML).toBe(beforeAdd);

    await user.type(search, 'goblin');
    expect(search).toHaveValue('goblin');
    expect(
      screen.getByRole('button', { name: 'Clear journal search' }),
    ).toBeVisible();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
  });

  it('searches page titles and opens the matching page in the inline note editor', async () => {
    const user = userEvent.setup();
    render(<JournalPanel assetApi={createFakeAssetApi()} campaignId={campaignId} journalApi={journalApi()} role="gm" />);
    const search = await screen.findByRole('searchbox', { name: 'Search journal' });
    await user.type(search, 'Babylon');
    await user.click(screen.getByRole('button', { name: /Gathered Magic Items/ }));
    expect(await screen.findByRole('textbox', { name: 'Page title' })).toHaveValue('Tomb of Babylon');
    expect(screen.getByRole('toolbar', { name: 'Rich text formatting toolbar' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Page content' })).toHaveAttribute(
      'contenteditable',
      'true',
    );
    expect(
      screen.getByRole('button', { name: 'Add page' }).querySelector('.lucide-plus'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit page' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close note' })).not.toBeInTheDocument();
  });

  it('keeps the read-only note presentation aligned with the editable presentation', async () => {
    const user = userEvent.setup();
    const editable = render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi()}
        role="gm"
      />,
    );
    await user.click(await screen.findByRole('button', { name: /Gathered Magic Items/ }));
    const editableNoteName = await screen.findByRole('textbox', { name: 'Note name' });
    const editablePageTitle = screen.getByRole('textbox', { name: 'Page title' });
    const editableToolbar = screen.getByRole('toolbar', {
      name: 'Rich text formatting toolbar',
    });
    const editableToolbarLabels = within(editableToolbar)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    const noteNameClass = editableNoteName.className;
    const pageTitleClass = editablePageTitle.className;
    editable.unmount();

    const readOnlyPage: JournalPage = {
      ...page,
      capabilities: {
        delete: false,
        edit: false,
        managePermissions: false,
        reorder: false,
        view: true,
      },
      permissions: null,
    };
    const readOnlyNote: JournalEntrySummary = {
      ...note,
      capabilities: {
        delete: false,
        edit: false,
        managePages: false,
        managePermissions: false,
        reorder: false,
        view: true,
      },
      pages: [readOnlyPage],
      permissions: null,
    };
    const acquireLease = vi.fn();
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({
          acquireLease,
          getNote: async () => ({ ok: true, value: readOnlyNote }),
          getPage: async () => ({ ok: true, value: readOnlyPage }),
          list: async () => ({
            ok: true,
            value: {
              entries: [readOnlyNote],
              revision: 0,
              schemaVersion: JOURNAL_SCHEMA_VERSION,
            },
          }),
        })}
        role="player"
      />,
    );
    await user.click(await screen.findByRole('button', { name: /Gathered Magic Items/ }));

    const readOnlyNoteName = await screen.findByRole('textbox', { name: 'Note name' });
    const readOnlyPageTitle = screen.getByRole('textbox', { name: 'Page title' });
    const readOnlyToolbar = screen.getByRole('toolbar', {
      name: 'Rich text formatting toolbar',
    });
    expect(readOnlyNoteName).toHaveAttribute('readonly');
    expect(readOnlyPageTitle).toHaveAttribute('readonly');
    expect(readOnlyNoteName.className).toBe(noteNameClass);
    expect(readOnlyPageTitle.className).toBe(pageTitleClass);
    expect(
      within(readOnlyToolbar)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(editableToolbarLabels);
    expect(screen.getByRole('textbox', { name: 'Page content (read only)' }))
      .toHaveAttribute('contenteditable', 'false');
    expect(screen.getByRole('button', { name: 'Edit Permissions' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Note' })).toBeDisabled();
    expect(acquireLease).not.toHaveBeenCalled();
  });

  it('recovers edit access when a transient page lease clears', async () => {
    const acquireLease = vi
      .fn()
      .mockResolvedValueOnce({
        error: {
          code: 'locked',
          entryId: note.id,
          holderName: 'Game Master',
          message: 'Game Master is editing this page.',
          pageId: page.id,
        },
        ok: false,
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
          holderName: 'Game Master',
          leaseId: '44444444-4444-4444-8444-444444444444',
          page,
        },
      });
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({ acquireLease })}
        role="gm"
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: /Gathered Magic Items/ }),
    );
    expect(
      await screen.findByRole('textbox', { name: 'Page content (read only)' }),
    ).toHaveAttribute('contenteditable', 'false');

    await waitFor(() => expect(acquireLease).toHaveBeenCalledTimes(2), {
      timeout: 2_000,
    });
    expect(
      await screen.findByRole('toolbar', {
        name: 'Rich text formatting toolbar',
      }),
    ).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Page content' })).toHaveAttribute(
      'contenteditable',
      'true',
    );
  });

  it('inserts an existing Storage image through the shared scene image chooser', async () => {
    const user = userEvent.setup();
    const image = makeImageAsset();
    const assetApi = createFakeAssetApi([image]);
    const updatePage = vi.fn(async (input: Parameters<JournalApi['updatePage']>[0]) => ({
      ok: true as const,
      value: { ...page, content: input.content, revision: page.revision + 1 },
    }));
    render(
      <JournalPanel
        assetApi={assetApi}
        campaignId={campaignId}
        journalApi={journalApi({ updatePage })}
        role="gm"
      />,
    );

    await user.click(
      await screen.findByRole('button', { name: /Gathered Magic Items/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Image' }));
    const chooser = await screen.findByRole('dialog', {
      name: 'Choose a Journal image',
    });
    await user.click(
      await within(chooser).findByRole('button', { name: image.displayName }),
    );
    fireEvent.blur(screen.getByRole('textbox', { name: 'Page content' }));

    await waitFor(() => expect(updatePage).toHaveBeenCalled());
    expect(updatePage.mock.calls.at(-1)?.[0].content.doc.content).toContainEqual(
      expect.objectContaining({
        attrs: { assetId: image.id },
        type: 'assetImage',
      }),
    );
    expect(
      screen.queryByRole('dialog', { name: 'Choose a Journal image' }),
    ).not.toBeInTheDocument();
  });

  it('formats note and page titles through the shared toolbar', async () => {
    const user = userEvent.setup();
    const updateNote = vi.fn(async (input: Parameters<JournalApi['updateNote']>[0]) => ({
      ok: true as const,
      value: {
        ...note,
        name: input.name,
        nameStyle: input.nameStyle,
        revision: note.revision + 1,
      },
    }));
    const updatePage = vi.fn(async (input: Parameters<JournalApi['updatePage']>[0]) => ({
      ok: true as const,
      value: {
        ...page,
        content: input.content,
        revision: page.revision + 1,
        title: input.title,
        titleStyle: input.titleStyle,
      },
    }));
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({ updateNote, updatePage })}
        role="gm"
      />,
    );

    await user.click(await screen.findByRole('button', { name: /Gathered Magic Items/ }));
    const noteName = screen.getByRole('textbox', { name: 'Note name' });
    await user.click(noteName);
    await user.click(screen.getByRole('button', { name: 'Italic' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Font family' }), 'lora');

    expect(noteName).toHaveStyle({ fontFamily: '"Lora Variable"', fontStyle: 'italic' });
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redo' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Highlight color')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Text color')).toHaveValue('#f0f0f0');
    await waitFor(() => expect(updateNote).toHaveBeenCalled(), { timeout: 2_000 });
    expect(updateNote.mock.calls.at(-1)?.[0].nameStyle).toMatchObject({
      fontFamily: 'lora',
      italic: true,
    });

    const pageTitle = screen.getByRole('textbox', { name: 'Page title' });
    await user.click(pageTitle);
    await user.click(screen.getByRole('button', { name: 'Underline' }));
    expect(pageTitle).toHaveStyle({ textDecoration: 'underline' });
    await waitFor(() => expect(updatePage).toHaveBeenCalled(), { timeout: 2_000 });
    expect(updatePage.mock.calls.at(-1)?.[0].titleStyle.underline).toBe(true);
  });

  it('opens note and page permissions from the note context menu', async () => {
    const user = userEvent.setup();
    const updatePagePermissions = vi.fn(async (
      input: Parameters<JournalApi['updatePagePermissions']>[0],
    ) => ({
      ok: true as const,
      value: {
        ...page,
        permissionRevision: page.permissionRevision + 1,
        permissions: input.permissions,
      },
    }));
    render(<JournalPanel assetApi={createFakeAssetApi()} campaignId={campaignId} journalApi={journalApi({ updatePagePermissions })} role="gm" />);

    fireEvent.contextMenu(await screen.findByRole('button', { name: /Gathered Magic Items/ }));
    expect(screen.getByRole('menuitem', { name: 'Delete Note' })).toBeVisible();
    await user.click(screen.getByRole('menuitem', { name: 'Edit Permissions' }));

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Edit Journal permissions' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Note default/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Tomb of Babylon/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Edit permissions' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Tomb of Babylon/ }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'All players permission' }),
      'view',
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updatePagePermissions).toHaveBeenCalledWith({
      campaignId,
      entryId: note.id,
      expectedPermissionRevision: page.permissionRevision,
      pageId: page.id,
      permissions: { allPlayers: 'view', overrides: [] },
    }));
  });

  it('retries only the conflicted page after a partial permission save', async () => {
    const user = userEvent.setup();
    const secondPage: JournalPage = {
      ...page,
      id: '66666666-6666-4666-8666-666666666666',
      position: 1,
      title: 'Arcane Annex',
    };
    let currentNote: JournalEntrySummary = {
      ...note,
      pages: [page, secondPage],
    };
    let conflictSecondPage = true;
    const updatePagePermissions = vi.fn(async (
      input: Parameters<JournalApi['updatePagePermissions']>[0],
    ): ReturnType<JournalApi['updatePagePermissions']> => {
      const source = input.pageId === page.id ? page : secondPage;
      if (input.pageId === secondPage.id && conflictSecondPage) {
        conflictSecondPage = false;
        currentNote = {
          ...currentNote,
          pages: currentNote.pages.map((summary) =>
            summary.id === secondPage.id
              ? { ...summary, permissionRevision: 1 }
              : summary,
          ),
        };
        return {
          error: {
            code: 'conflict',
            entryId: note.id,
            message: 'The page permissions changed before they could be saved.',
            pageId: secondPage.id,
          },
          ok: false,
        };
      }
      const value = {
        ...source,
        permissionRevision: input.expectedPermissionRevision + 1,
        permissions: input.permissions,
      };
      currentNote = {
        ...currentNote,
        pages: currentNote.pages.map((summary) =>
          summary.id === value.id
            ? {
                ...summary,
                permissionRevision: value.permissionRevision,
                permissions: value.permissions,
              }
            : summary,
        ),
      };
      return { ok: true, value };
    });
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({
          getNote: async () => ({ ok: true, value: currentNote }),
          list: async () => ({
            ok: true,
            value: {
              entries: [currentNote],
              revision: 0,
              schemaVersion: JOURNAL_SCHEMA_VERSION,
            },
          }),
          updatePagePermissions,
        })}
        role="gm"
      />,
    );
    await user.click(await screen.findByRole('button', { name: /Gathered Magic Items/ }));
    await user.click(await screen.findByRole('button', { name: 'Edit Permissions' }));
    await user.click(screen.getByRole('button', { name: /Tomb of Babylon/ }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'All players permission' }),
      'view',
    );
    await user.click(screen.getByRole('button', { name: /Arcane Annex/ }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'All players permission' }),
      'edit',
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The page permissions changed before they could be saved.',
    );
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit Journal permissions' }))
        .not.toBeInTheDocument(),
    );

    expect(updatePagePermissions.mock.calls.filter(
      ([input]) => input.pageId === page.id,
    )).toHaveLength(1);
    expect(updatePagePermissions.mock.calls.filter(
      ([input]) => input.pageId === secondPage.id,
    ).map(([input]) => input.expectedPermissionRevision)).toEqual([0, 1]);
  });

  it('places note actions above page search and confirms top-level note deletion', async () => {
    const user = userEvent.setup();
    const prepareDelete = vi.fn(async () => ({
      ok: true as const,
      value: {
        assets: [],
        target: { entryId: note.id, kind: 'note' as const },
      },
    }));
    const deleteTarget = vi.fn(async () => ({
      ok: true as const,
      value: { cleanupFailures: [] },
    }));
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({ deleteTarget, prepareDelete })}
        role="gm"
      />,
    );
    await user.click(await screen.findByRole('button', { name: /Gathered Magic Items/ }));

    const editPermissions = await screen.findByRole('button', {
      name: 'Edit Permissions',
    });
    const deleteNote = screen.getByRole('button', { name: 'Delete Note' });
    const pageSearch = screen.getByRole('searchbox', { name: 'Search pages' });
    expect(editPermissions.compareDocumentPosition(pageSearch)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(deleteNote.compareDocumentPosition(pageSearch)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(editPermissions);
    expect(screen.getByRole('dialog', { name: 'Edit Journal permissions' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Delete Note' }));
    expect(prepareDelete).toHaveBeenCalledWith({
      campaignId,
      target: { entryId: note.id, kind: 'note' },
    });
    expect(await screen.findByRole('dialog', { name: 'Delete note' })).toBeVisible();
    expect(deleteTarget).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteTarget).toHaveBeenCalledWith({
      campaignId,
      cleanupAssetIds: [],
      expectedRevision: note.revision,
      target: { entryId: note.id, kind: 'note' },
    }));
  });

  it('arms note deletion and deletes directly when the note has no embedded images', async () => {
    const user = userEvent.setup();
    const prepareDelete = vi.fn(async () => ({
      ok: true as const,
      value: {
        assets: [],
        target: { entryId: note.id, kind: 'note' as const },
      },
    }));
    const deleteTarget = vi.fn(async () => ({
      ok: true as const,
      value: { cleanupFailures: [] },
    }));
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({ deleteTarget, prepareDelete })}
        role="gm"
      />,
    );

    fireEvent.contextMenu(
      await screen.findByRole('button', { name: /Gathered Magic Items/ }),
    );
    const deleteAction = screen.getByRole('menuitem', { name: 'Delete Note' });
    expect(deleteAction).toHaveAttribute('aria-pressed', 'false');
    await user.click(deleteAction);

    expect(deleteAction).toHaveTextContent('Confirm Delete Note');
    expect(deleteAction).toHaveAttribute('aria-pressed', 'true');
    expect(prepareDelete).not.toHaveBeenCalled();

    await user.click(deleteAction);

    await waitFor(() =>
      expect(deleteTarget).toHaveBeenCalledWith({
        campaignId,
        cleanupAssetIds: [],
        expectedRevision: note.revision,
        target: { entryId: note.id, kind: 'note' },
      }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('only opens a delete modal when embedded images need a cleanup choice', async () => {
    const user = userEvent.setup();
    const prepareDelete = vi.fn(async () => ({
      ok: true as const,
      value: {
        assets: [
          {
            cleanupAllowed: true,
            displayName: 'treasure-map.png',
            id: '55555555-5555-4555-8555-555555555555',
          },
        ],
        target: { entryId: note.id, kind: 'note' as const },
      },
    }));
    const deleteTarget = vi.fn();
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({ deleteTarget, prepareDelete })}
        role="gm"
      />,
    );

    fireEvent.contextMenu(
      await screen.findByRole('button', { name: /Gathered Magic Items/ }),
    );
    const deleteAction = screen.getByRole('menuitem', { name: 'Delete Note' });
    await user.click(deleteAction);
    await user.click(deleteAction);

    expect(
      await screen.findByRole('dialog', {
        name: 'Delete note with embedded images?',
      }),
    ).toBeVisible();
    expect(screen.getByText('treasure-map.png')).toBeVisible();
    expect(deleteTarget).not.toHaveBeenCalled();
  });

  it('keeps a name draft when an older change refresh finishes', async () => {
    const user = userEvent.setup();
    const listeners = new Set<(event: JournalChangedEvent) => void>();
    let resolveRefresh!: (result: JournalResult<NoteEntry>) => void;
    const getNote = vi.fn(
      () =>
        new Promise<JournalResult<NoteEntry>>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const api = journalApi({
      getNote,
      onChanged: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={api}
        role="gm"
      />,
    );

    await user.click(
      await screen.findByRole('button', { name: /Gathered Magic Items/ }),
    );
    const nameInput = await screen.findByRole('textbox', { name: 'Note name' });
    act(() => {
      for (const listener of listeners) {
        listener({ campaignId, entryId: note.id, type: 'structure' });
      }
    });
    await waitFor(() => expect(getNote).toHaveBeenCalledOnce());
    fireEvent.change(nameInput, { target: { value: 'Unfinished rename' } });
    await act(async () => {
      resolveRefresh({ ok: true, value: note });
    });

    expect(nameInput).toHaveValue('Unfinished rename');
    expect(screen.getByText('Unsaved changes')).toBeVisible();
  });

  it('prevents players from creating parent notes', async () => {
    render(<JournalPanel assetApi={createFakeAssetApi()} campaignId={campaignId} journalApi={journalApi()} role="player" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add journal entry' })).toBeDisabled());
  });
});
