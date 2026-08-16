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
  createDefaultDnd5eSpellRollStep,
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
    expect(within(dialog).getByRole('button', { name: 'Level' })).toHaveTextContent('Cantrip');
    expect(within(dialog).getByRole('button', { name: 'School' }))
      .toHaveTextContent('Abjuration');
    expect(within(dialog).getByRole('textbox', { name: 'Casting Time' })).toHaveValue('Action');
    expect(within(dialog).queryByRole('button', { name: /close|cancel/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Autosaving')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Spell', { exact: true })).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Spell Options and Components'))
      .not.toBeInTheDocument();
    expect(within(dialog).queryByText('This Spell has no Roll Actions yet.'))
      .not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Level' }));
    await user.click(within(within(dialog).getByRole('group', { name: 'Level options' }))
      .getByRole('button', { name: '3rd Level' }));
    await waitFor(() => expect(controlled.server.data).toMatchObject({ level: 3 }));

    await user.click(within(dialog).getByRole('button', { name: 'School' }));
    await user.click(within(within(dialog).getByRole('group', { name: 'School options' }))
      .getByRole('button', { name: 'Evocation' }));
    await waitFor(() => expect(controlled.server.data).toMatchObject({ school: 'Evocation' }));

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
    await user.click(within(dialog).getByRole('button', { name: 'Wizard' }));
    await waitFor(() => expect(controlled.server.data).toMatchObject({ classes: ['Wizard'] }));
    expect(within(dialog).getByRole('group', { name: 'Spell class options' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Wizard' }))
      .toHaveAttribute('aria-pressed', 'true');

    await user.click(within(dialog).getByRole('button', { name: 'Add Roll Action' }));
    await waitFor(() => expect(
      (controlled.server.data as unknown as Dnd5eSpellData).rollSteps,
    ).toHaveLength(1));
    expect(within(dialog).getAllByText('General Roll').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('1d20')).toBeVisible();
    expect(within(dialog).getByRole('textbox', { name: 'General Roll label' })).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'General Roll purpose' }));
    expect(within(within(dialog).getByRole('group', { name: 'Roll action purposes' }))
      .queryByRole('button', { name: 'Effect' })).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Value Type')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Add term')).toBeVisible();
  });

  it('authors Flat Value tiers and preserves valid Dice and Flat tiers', async () => {
    const user = userEvent.setup();
    const data = createDefaultDnd5eSpellData();
    data.level = 3;
    const damage = createDefaultDnd5eSpellRollStep('damage');
    if (damage.purpose !== 'damage') throw new Error('fixture');
    damage.terms = [
      {
        count: 3,
        kind: 'dice',
        scaling: 'caster-level',
        sides: 4,
        tiers: [
          { count: 3, minimum: 1 },
          { count: 4, minimum: 5 },
          { count: 5, minimum: 10 },
        ],
      },
      {
        kind: 'flat',
        scaling: 'caster-level',
        tiers: [
          { minimum: 1, value: 3 },
          { minimum: 5, value: 4 },
          { minimum: 10, value: 5 },
        ],
        value: 3,
      },
    ];
    data.rollSteps = [damage];
    const entry = spellEntry(data);
    const controlled = controlledApi(entry);
    renderSpell(entry, controlled.api);
    const dialog = screen.getByRole('dialog', { name: 'New Spell spell sheet' });
    await user.click(within(dialog).getByRole('button', { name: /Damage Damage/u }));

    await user.click(within(dialog).getAllByRole('button', {
      name: 'Caster-Level Dice',
    })[0]!);
    await user.click(within(screen.getByRole('group', { name: 'Dice scaling options' }))
      .getByRole('button', { name: 'Cast-Level Dice' }));
    await user.click(within(dialog).getAllByRole('button', {
      name: 'Caster-Level Value',
    })[0]!);
    await user.click(within(screen.getByRole('group', { name: 'Flat value scaling options' }))
      .getByRole('button', { name: 'Cast-Level Value' }));
    await waitFor(() => expect(
      (controlled.server.data as Dnd5eSpellData).rollSteps[0],
    ).toMatchObject({
      terms: [
        { scaling: 'cast-level', tiers: [{ count: 4, minimum: 5 }] },
        { scaling: 'cast-level', tiers: [{ minimum: 5, value: 4 }] },
      ],
    }));

    await user.click(within(dialog).getByRole('button', { name: 'Level' }));
    await user.click(within(screen.getByRole('group', { name: 'Level options' }))
      .getByRole('button', { name: '6th Level' }));
    await waitFor(() => expect(
      (controlled.server.data as Dnd5eSpellData).rollSteps[0],
    ).toMatchObject({ terms: [{ tiers: [] }, { tiers: [] }] }));
    expect(within(dialog).getAllByText('Needs setup').length).toBeGreaterThan(0);

    await user.click(within(dialog).getAllByRole('button', {
      name: 'Cast-Level Value',
    })[0]!);
    await user.click(within(screen.getByRole('group', { name: 'Flat value scaling options' }))
      .getByRole('button', { name: 'Fixed Value' }));
    await user.click(within(dialog).getAllByRole('button', {
      name: 'Fixed Value',
    })[0]!);
    await user.click(within(screen.getByRole('group', { name: 'Flat value scaling options' }))
      .getByRole('button', { name: 'Cast-Level Value' }));
    const flatTiers = within(dialog).getByLabelText('Cast level flat value tiers');
    await user.click(within(flatTiers).getByRole('button', { name: 'Add Tier' }));
    expect(within(flatTiers).getByRole('textbox', {
      name: 'Tier 1 minimum cast-level',
    })).toHaveValue('6');
    const flatValue = within(flatTiers).getByRole('textbox', {
      name: 'Tier 1 flat value',
    });
    expect(flatValue).toHaveValue('3');
    fireEvent.change(flatValue, { target: { value: '-2' } });
    fireEvent.blur(flatValue);
    await waitFor(() => expect(
      (controlled.server.data as Dnd5eSpellData).rollSteps[0],
    ).toMatchObject({ terms: [expect.anything(), { tiers: [{ minimum: 6, value: -2 }] }] }));
    await user.click(within(flatTiers).getByRole('button', { name: 'Remove tier 1' }));

    await user.click(within(dialog).getAllByRole('button', {
      name: 'Cast-Level Dice',
    })[0]!);
    await user.click(within(screen.getByRole('group', { name: 'Dice scaling options' }))
      .getByRole('button', { name: 'Fixed Dice' }));
    await user.click(within(dialog).getAllByRole('button', {
      name: 'Fixed Dice',
    })[0]!);
    await user.click(within(screen.getByRole('group', { name: 'Dice scaling options' }))
      .getByRole('button', { name: 'Cast-Level Dice' }));
    const diceTiers = within(dialog).getByLabelText('Cast level tiers');
    await user.click(within(diceTiers).getByRole('button', { name: 'Add Tier' }));
    expect(within(diceTiers).getByRole('textbox', {
      name: 'Tier 1 dice count',
    })).toHaveValue('3');
  });

  it('makes cast-level Dice and Flat Values fixed when changing to a cantrip', async () => {
    const user = userEvent.setup();
    const data = createDefaultDnd5eSpellData();
    data.level = 1;
    const damage = createDefaultDnd5eSpellRollStep('damage');
    if (damage.purpose !== 'damage') throw new Error('fixture');
    damage.terms = [
      {
        count: 3,
        kind: 'dice',
        scaling: 'cast-level',
        sides: 4,
        tiers: [{ count: 4, minimum: 2 }],
      },
      {
        kind: 'flat',
        scaling: 'cast-level',
        tiers: [{ minimum: 2, value: 4 }],
        value: 3,
      },
      { kind: 'cast-level' },
    ];
    data.rollSteps = [damage];
    const entry = spellEntry(data);
    const controlled = controlledApi(entry);
    renderSpell(entry, controlled.api);
    const dialog = screen.getByRole('dialog', { name: 'New Spell spell sheet' });

    await user.click(within(dialog).getByRole('button', { name: 'Level' }));
    await user.click(within(screen.getByRole('group', { name: 'Level options' }))
      .getByRole('button', { name: 'Cantrip' }));
    await waitFor(() => expect(controlled.server.data).toMatchObject({
      level: 0,
      rollSteps: [{
        terms: [
          { kind: 'dice', scaling: 'fixed', tiers: [] },
          { kind: 'flat', scaling: 'fixed', tiers: [], value: 3 },
          { kind: 'flat', scaling: 'fixed', tiers: [], value: 0 },
        ],
      }],
    }));
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
    expect(screen.getByRole('button', { name: 'Level' }))
      .toHaveAttribute('aria-disabled', 'true');
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
