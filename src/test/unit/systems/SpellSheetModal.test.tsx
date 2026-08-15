import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  JournalApi,
  JournalChangedEvent,
  JournalResult,
  SystemJournalEntry,
} from '../../../shared/journal';
import { createDefaultCampaignSystemState } from '../../../systems/catalog';
import { DND5E_SPELL_ENTRY_TYPE_ID } from '../../../systems/dnd5e/definition';
import { SpellSheetModal } from '../../../systems/dnd5e/renderer/SpellSheetModal';
import {
  createDefaultDnd5eSpellData,
  describeDnd5eSpellData,
  type Dnd5eSpellData,
} from '../../../systems/dnd5e/spellData';

const campaignId = '11111111-1111-4111-8111-111111111111';

function spellEntry(
  data: Dnd5eSpellData = createDefaultDnd5eSpellData(),
  edit = true,
): SystemJournalEntry {
  return {
    capabilities: {
      delete: edit,
      edit,
      managePages: false,
      managePermissions: edit,
      reorder: edit,
      view: true,
    },
    data,
    detail: describeDnd5eSpellData(data),
    groupId: 'dnd5e.spells',
    id: '22222222-2222-4222-8222-222222222222',
    kind: 'system',
    name: 'New Spell',
    permissionRevision: 0,
    permissions: edit ? { allPlayers: 'view', overrides: [] } : null,
    position: 0,
    revision: 0,
    typeId: DND5E_SPELL_ENTRY_TYPE_ID,
  };
}

function controlledApi(initial: SystemJournalEntry) {
  let server = structuredClone(initial);
  let listener: ((event: JournalChangedEvent) => void) | null = null;
  const updateEntryData = vi.fn(async (input: {
    data: Dnd5eSpellData;
    expectedRevision: number;
  }): Promise<JournalResult<SystemJournalEntry>> => {
    server = {
      ...server,
      data: structuredClone(input.data),
      detail: describeDnd5eSpellData(input.data),
      revision: server.revision + 1,
    };
    return { ok: true, value: structuredClone(server) };
  });
  const renameEntry = vi.fn(async (input: {
    name: string;
  }): Promise<JournalResult<SystemJournalEntry>> => {
    server = { ...server, name: input.name, revision: server.revision + 1 };
    return { ok: true, value: structuredClone(server) };
  });
  const api: JournalApi = {
    ...window.blackBox.journal,
    getEntry: async () => ({ ok: true, value: structuredClone(server) }),
    onChanged: (next) => {
      listener = next;
      return () => { listener = null; };
    },
    renameEntry: renameEntry as JournalApi['renameEntry'],
    updateEntryData: updateEntryData as unknown as JournalApi['updateEntryData'],
  };
  return {
    api,
    emit(event: JournalChangedEvent) {
      listener?.(event);
    },
    get server() {
      return server;
    },
    renameEntry,
    setServer(next: SystemJournalEntry) {
      server = structuredClone(next);
    },
    updateEntryData,
  };
}

function renderSpell(
  entry: SystemJournalEntry,
  api: JournalApi,
  onDismiss = vi.fn(),
) {
  render(
    <SpellSheetModal
      campaignId={campaignId}
      entry={entry}
      journalApi={api}
      onDismiss={onDismiss}
      onUpdated={vi.fn()}
      system={createDefaultCampaignSystemState()!}
    />,
  );
  return { onDismiss };
}

describe('SpellSheetModal', () => {
  it('renders the agreed defaults and immediately persists structured controls and Roll Actions', async () => {
    const user = userEvent.setup();
    const entry = spellEntry();
    const controlled = controlledApi(entry);
    renderSpell(entry, controlled.api);
    const dialog = screen.getByRole('dialog', { name: 'New Spell spell sheet' });

    expect(within(dialog).getByRole('textbox', { name: 'Spell Name' })).toHaveValue('New Spell');
    expect(within(dialog).getByRole('combobox', { name: 'Level' })).toHaveValue('0');
    expect(within(dialog).getByRole('combobox', { name: 'School' })).toHaveValue('Abjuration');
    expect(within(dialog).getByRole('textbox', { name: 'Casting Time' })).toHaveValue('Action');
    expect(within(dialog).queryByRole('button', { name: /close|cancel/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Autosaving')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Spell', { exact: true })).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Spell Options and Components'))
      .not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('checkbox', { name: 'Material' }));
    await waitFor(() => expect(controlled.updateEntryData).toHaveBeenCalled());
    expect(controlled.server.data).toMatchObject({ components: { material: true } });
    expect(within(dialog).getByRole('textbox', { name: 'Material Description' })).toBeVisible();
    expect(within(dialog).queryByText('Material Cost')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox', { name: 'Material is consumed' }))
      .not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Spell classes' }));
    expect(within(dialog).queryByRole('button', { name: 'Clear All' }))
      .not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Wizard' }));
    await waitFor(() => expect(controlled.server.data).toMatchObject({ classes: ['Wizard'] }));

    await user.click(within(dialog).getByRole('button', { name: 'Add Roll Action' }));
    await waitFor(() => expect(
      (controlled.server.data as unknown as Dnd5eSpellData).rollSteps,
    ).toHaveLength(1));
    expect(within(dialog).getAllByText('General Roll').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('1d20')).toBeVisible();
    expect(within(dialog).getByRole('textbox', { name: 'General Roll label' })).toBeVisible();
    expect(within(dialog).queryByText('Value Type')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Add term')).toBeVisible();
  });

  it('flushes text on blur and rebases it over a conflicting remote field update', async () => {
    const entry = spellEntry();
    const controlled = controlledApi(entry);
    controlled.updateEntryData
      .mockResolvedValueOnce({
        error: { code: 'conflict', message: 'Conflict' },
        ok: false,
      });
    const remoteData = createDefaultDnd5eSpellData();
    remoteData.duration = 'Up to 1 minute';
    controlled.setServer({ ...entry, data: remoteData, revision: 1 });
    renderSpell(entry, controlled.api);

    const castingTime = screen.getByRole('textbox', { name: 'Casting Time' });
    fireEvent.change(castingTime, { target: { value: '1 Bonus Action' } });
    fireEvent.blur(castingTime);

    await waitFor(() => expect(controlled.updateEntryData).toHaveBeenCalledTimes(2));
    const retry = controlled.updateEntryData.mock.calls[1]![0];
    expect(retry.data).toMatchObject({
      castingTime: '1 Bonus Action',
      duration: 'Up to 1 minute',
    });
    expect(screen.getByRole('textbox', { name: 'Duration' })).toHaveValue('Up to 1 minute');
  });

  it('keeps the modal open when its final name save fails', async () => {
    const entry = spellEntry();
    const controlled = controlledApi(entry);
    controlled.renameEntry.mockResolvedValueOnce({
      error: { code: 'storage_error', message: 'Could not save the Spell.' },
      ok: false,
    });
    const { onDismiss } = renderSpell(entry, controlled.api);
    const dialog = screen.getByRole('dialog', { name: 'New Spell spell sheet' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Spell Name' }), {
      target: { value: 'Arc Flash' },
    });
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save'));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(dialog).toBeVisible();
  });

  it('discards unauthorized dirty changes and becomes read-only when Edit is revoked', async () => {
    const entry = spellEntry();
    const controlled = controlledApi(entry);
    renderSpell(entry, controlled.api);
    const description = screen.getByRole('textbox', { name: 'Spell Description' });
    fireEvent.change(description, { target: { value: 'Unsaved local text' } });
    const authoritativeData = createDefaultDnd5eSpellData();
    authoritativeData.description = 'Authoritative text';
    controlled.setServer({
      ...spellEntry(authoritativeData, false),
      permissionRevision: 1,
      revision: 1,
    });
    await act(async () => controlled.emit({
      campaignId,
      entryId: entry.id,
      type: 'permissions',
    }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Edit access was removed'));
    expect(screen.getByRole('textbox', { name: 'Spell Description' }))
      .toHaveValue('Authoritative text');
    expect(screen.getByRole('combobox', { name: 'Level' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add Roll Action' })).not.toBeInTheDocument();
  });

  it('closes immediately when the Spell is deleted or View is revoked', async () => {
    const entry = spellEntry();
    const controlled = controlledApi(entry);
    controlled.api.getEntry = async () => ({
      error: { code: 'not_found', message: 'Gone' },
      ok: false,
    });
    const { onDismiss } = renderSpell(entry, controlled.api);
    await act(async () => controlled.emit({
      campaignId,
      entryId: entry.id,
      type: 'deleted',
    }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
  });
});
