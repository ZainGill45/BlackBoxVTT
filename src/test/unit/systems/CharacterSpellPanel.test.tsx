import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useMemo, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SystemJournalEntry } from '../../../shared/journal';
import type { CharacterSheetJournalApi } from '../../../shared/journalWindows';
import type { ChatRollDefinition } from '../../../shared/chatRoll';
import {
  applyDnd5eCharacterSpellMutations,
  createDefaultDnd5eCharacterData,
  deriveDnd5eCharacterValues,
  type Dnd5eCharacterData,
  type Dnd5eCharacterSpellMutation,
  type Dnd5eCharacterSpellReference,
  type Dnd5eDerivedCharacterValues,
  type Dnd5eSpellSlotLevel,
} from '../../../systems/dnd5e/characterData';
import { DND5E_SPELL_ENTRY_TYPE_ID } from '../../../systems/dnd5e/definition';
import { CharacterSpellPanel } from '../../../systems/dnd5e/renderer/CharacterSpellPanel';
import {
  createDefaultDnd5eSpellData,
  type Dnd5eSpellData,
  type Dnd5eSpellLevel,
} from '../../../systems/dnd5e/spellData';
import { createMockNetworkApi } from '../../support/networkApi';

const campaignId = '11111111-1111-4111-8111-111111111111';
const characterEntryId = '22222222-2222-4222-8222-222222222222';

function spellEntry(
  id: string,
  name: string,
  level: Dnd5eSpellLevel,
  overrides: Partial<Dnd5eSpellData> = {},
): SystemJournalEntry {
  const data = { ...createDefaultDnd5eSpellData(), level, ...overrides };
  return {
    capabilities: {
      delete: true,
      edit: true,
      managePages: false,
      managePermissions: true,
      reorder: true,
      view: true,
    },
    data,
    detail: level === 0 ? `Cantrip ${data.school}` : `${level} Level ${data.school}`,
    groupId: 'dnd5e.spells',
    id,
    kind: 'system',
    name,
    permissionRevision: 0,
    permissions: { allPlayers: 'none', overrides: [] },
    position: 0,
    revision: 0,
    typeId: DND5E_SPELL_ENTRY_TYPE_ID,
  };
}

interface RenderPanelOptions {
  canEdit?: boolean;
  entries: SystemJournalEntry[];
  onSendRoll?: ReturnType<typeof vi.fn>;
  preparedMaximumOffset?: number;
  references: Dnd5eCharacterSpellReference[];
  slots?: Partial<Record<Dnd5eSpellSlotLevel, number>>;
}

function renderPanel({
  canEdit = true,
  entries: initialEntries,
  onSendRoll = vi.fn(async () => true),
  preparedMaximumOffset = 0,
  references,
  slots = {},
}: RenderPanelOptions) {
  let visibleEntries = initialEntries;
  let changeListener: Parameters<CharacterSheetJournalApi['onChanged']>[0] | null = null;
  const journalApi: CharacterSheetJournalApi = {
    getEntry: vi.fn(async ({ entryId }) => {
      const entry = visibleEntries.find(({ id }) => id === entryId);
      return entry
        ? { ok: true as const, value: entry }
        : {
            error: { code: 'not_found' as const, message: 'Not found.' },
            ok: false as const,
          };
    }),
    list: vi.fn(async () => ({
      ok: true as const,
      value: { entries: visibleEntries, revision: 1 },
    })),
    onChanged: vi.fn((listener) => {
      changeListener = listener;
      return () => undefined;
    }),
    renameEntry: vi.fn(),
    updateEntryData: vi.fn(),
  };
  const onCommitSpells = vi.fn();
  const onAdjustSpellSlot = vi.fn();
  const onError = vi.fn();
  const onPreparedSummaryChange = vi.fn();
  const networkApi = createMockNetworkApi();

  function Harness() {
    const [data, setData] = useState<Dnd5eCharacterData>(() => {
      const value = createDefaultDnd5eCharacterData();
      value.identity.className = 'Wizard';
      value.identity.level = 5;
      value.abilities.intelligence.score = 18;
      value.spellcasting.ability = 'intelligence';
      value.spellcasting.preparedMaximumOffset = preparedMaximumOffset;
      value.spellcasting.spells = references;
      for (const [level, current] of Object.entries(slots)) {
        value.spellcasting.slots[level as Dnd5eSpellSlotLevel].current = current;
      }
      return value;
    });
    const derived = useMemo(
      () => deriveDnd5eCharacterValues(data, '5.5e'),
      [data],
    );
    if (!derived) throw new Error('Character fixture must derive.');
    const commit = useCallback(async (
      mutations: readonly Dnd5eCharacterSpellMutation[],
    ) => {
      onCommitSpells(mutations);
      setData((current) => ({
        ...current,
        spellcasting: {
          ...current.spellcasting,
          spells: applyDnd5eCharacterSpellMutations(
            current.spellcasting.spells,
            mutations,
          ).spells,
        },
      }));
      return true;
    }, []);
    const refundSlot = useCallback(async (
      level: Dnd5eSpellSlotLevel,
    ) => {
      onAdjustSpellSlot(level, 1);
      setData((current) => ({
        ...current,
        spellcasting: {
          ...current.spellcasting,
          slots: {
            ...current.spellcasting.slots,
            [level]: {
              ...current.spellcasting.slots[level],
              current: current.spellcasting.slots[level].current + 1,
            },
          },
        },
      }));
      return true;
    }, []);
    const consumeSlot = useCallback(async (
      level: Dnd5eSpellSlotLevel,
      compile: (
        character: Dnd5eCharacterData,
        latestDerived: Dnd5eDerivedCharacterValues,
      ) => ChatRollDefinition | null,
    ) => {
      if (data.spellcasting.slots[level].current < 1) return null;
      const definition = compile(data, derived);
      if (!definition) return null;
      onAdjustSpellSlot(level, -1);
      setData((current) => ({
        ...current,
        spellcasting: {
          ...current.spellcasting,
          slots: {
            ...current.spellcasting.slots,
            [level]: {
              ...current.spellcasting.slots[level],
              current: current.spellcasting.slots[level].current - 1,
            },
          },
        },
      }));
      return definition;
    }, [data, derived]);
    return (
      <CharacterSpellPanel
        campaignId={campaignId}
        canEdit={canEdit}
        characterEntryId={characterEntryId}
        data={data}
        derived={derived}
        journalApi={journalApi}
        networkApi={networkApi}
        onCommitSpells={commit}
        onConsumeSpellSlot={consumeSlot}
        onError={onError}
        onPreparedSummaryChange={onPreparedSummaryChange}
        onRefundSpellSlot={refundSlot}
        onSendRoll={onSendRoll}
      />
    );
  }

  render(<Harness />);
  return {
    emitChange: async () => {
      if (!changeListener) throw new Error('Change listener was not installed.');
      await act(async () => changeListener?.({
        campaignId,
        entryId: visibleEntries[0]?.id,
        type: 'content',
      }));
    },
    journalApi,
    onAdjustSpellSlot,
    onCommitSpells,
    onError,
    onPreparedSummaryChange,
    onSendRoll,
    setVisibleEntries: (entries: SystemJournalEntry[]) => {
      visibleEntries = entries;
    },
  };
}

describe('Character spell browser', () => {
  it('groups, alphabetizes, searches metadata, and shows complete details', async () => {
    const cantrip = spellEntry(
      '30000000-0000-4000-8000-000000000001',
      'Zephyr Spark',
      0,
      { classes: ['Wizard'], school: 'Evocation' },
    );
    const alpha = spellEntry(
      '30000000-0000-4000-8000-000000000002',
      'Arcane Lock',
      2,
      {
        castingTime: '1 Action',
        classes: ['Wizard'],
        components: {
          material: true,
          materialDescription: 'gold dust',
          somatic: true,
          verbal: true,
        },
        concentration: true,
        description: 'Locks a door.',
        duration: 'Until dispelled',
        higherLevelDescription: 'No additional effect.',
        range: 'Touch',
        ritual: true,
        target: 'One door',
      },
    );
    const beta = spellEntry(
      '30000000-0000-4000-8000-000000000003',
      'Beacon',
      2,
      { classes: ['Cleric'], school: 'Divination' },
    );
    renderPanel({
      entries: [beta, alpha, cantrip],
      references: [
        { entryId: beta.id, preparation: 'unprepared' },
        { entryId: alpha.id, preparation: 'prepared' },
        { entryId: cantrip.id, preparation: 'unprepared' },
      ],
    });

    await screen.findByRole('button', { name: 'View Zephyr Spark' });
    const levelTwo = screen.getByRole('heading', { name: '2nd Level' }).closest('section')!;
    expect(within(levelTwo).getAllByRole('button').map((button) =>
      button.getAttribute('aria-label'))).toEqual([
      'View Arcane Lock',
      'View Beacon',
    ]);
    expect(await screen.findByRole('heading', { name: 'Zephyr Spark' }))
      .toBeInTheDocument();

    await userEvent.setup().type(
      screen.getByRole('searchbox', { name: 'Search character spells' }),
      'cleric',
    );
    expect(screen.getByRole('button', { name: 'View Beacon' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Arcane Lock' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '2nd Level' })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'View Beacon' }));
    expect(screen.getByRole('heading', { name: 'Beacon' })).toBeInTheDocument();
  });

  it('reuses revision-matched spell details and refreshes edited metadata', async () => {
    const spell = spellEntry(
      '30000000-0000-4000-8000-000000000001', 'Original Name', 1,
    );
    const panel = renderPanel({
      entries: [spell],
      references: [{ entryId: spell.id, preparation: 'unprepared' }],
    });
    await screen.findByRole('heading', { name: 'Original Name' });
    expect(panel.journalApi.getEntry).toHaveBeenCalledOnce();

    await panel.emitChange();
    await waitFor(() => expect(panel.journalApi.list).toHaveBeenCalledTimes(2));
    expect(panel.journalApi.getEntry).toHaveBeenCalledOnce();

    panel.setVisibleEntries([{
      ...spell,
      name: 'Revised Name',
      revision: 1,
    }]);
    await panel.emitChange();
    expect(await screen.findByRole('heading', { name: 'Revised Name' }))
      .toBeInTheDocument();
    expect(panel.journalApi.getEntry).toHaveBeenCalledTimes(2);
  });

  it('stages multiple picker additions and prevents duplicate membership', async () => {
    const attached = spellEntry(
      '30000000-0000-4000-8000-000000000001', 'Attached', 1,
    );
    const cantrip = spellEntry(
      '30000000-0000-4000-8000-000000000002', 'Cantrip Choice', 0,
    );
    const ritual = spellEntry(
      '30000000-0000-4000-8000-000000000003',
      'Ritual Choice',
      2,
      { ritual: true },
    );
    const { onCommitSpells } = renderPanel({
      entries: [ritual, attached, cantrip],
      references: [{ entryId: attached.id, preparation: 'unprepared' }],
    });
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'View Attached' });
    await user.click(screen.getByRole('button', { name: 'Add spells to character' }));
    const picker = screen.getByRole('dialog', { name: 'Add spells to character' });
    expect(within(picker).getByRole('checkbox', { name: /Attached/ })).toBeDisabled();
    await user.click(within(picker).getByRole('checkbox', { name: /Cantrip Choice/ }));
    await user.click(within(picker).getByRole('checkbox', { name: /Ritual Choice/ }));
    expect(onCommitSpells).not.toHaveBeenCalled();
    await user.click(within(picker).getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(onCommitSpells).toHaveBeenCalledWith([
      {
        kind: 'add',
        spell: { entryId: cantrip.id, preparation: 'unprepared' },
      },
      {
        kind: 'add',
        spell: { entryId: ritual.id, preparation: 'unprepared' },
      },
    ]));
    expect(await screen.findByRole('button', { name: 'View Ritual Choice' }))
      .toBeInTheDocument();
  });

  it('cycles preparation, excludes cantrips and unavailable spells, and warns', async () => {
    const cantrip = spellEntry(
      '30000000-0000-4000-8000-000000000001', 'Spark', 0,
    );
    const leveled = spellEntry(
      '30000000-0000-4000-8000-000000000002', 'Shield', 1,
    );
    const unavailableId = '30000000-0000-4000-8000-000000000003';
    const { onPreparedSummaryChange } = renderPanel({
      entries: [cantrip, leveled],
      preparedMaximumOffset: -100,
      references: [
        { entryId: cantrip.id, preparation: 'prepared' },
        { entryId: leveled.id, preparation: 'prepared' },
        { entryId: unavailableId, preparation: 'prepared' },
      ],
    });
    const user = userEvent.setup();
    const prepared = await screen.findByRole('checkbox', {
      name: 'Shield: Prepared',
    });
    await waitFor(() => expect(onPreparedSummaryChange).toHaveBeenLastCalledWith({
      current: 1,
      incomplete: true,
      overMaximum: true,
    }));
    expect(screen.getByText('Prepared spells exceed the current maximum.'))
      .toBeInTheDocument();
    expect(screen.getByText('The count excludes unavailable Prepared spells.'))
      .toBeInTheDocument();

    await user.click(prepared);
    const always = await screen.findByRole('checkbox', {
      name: 'Shield: Always Prepared',
    });
    expect(always).toHaveAttribute('aria-checked', 'mixed');
    await user.click(always);
    expect(await screen.findByRole('checkbox', { name: 'Shield: Unprepared' }))
      .not.toBeChecked();
    await waitFor(() => expect(onPreparedSummaryChange).toHaveBeenLastCalledWith({
      current: 0,
      incomplete: true,
      overMaximum: false,
    }));
  });

  it('replaces revoked spell contents with a generic unavailable placeholder', async () => {
    const spell = spellEntry(
      '30000000-0000-4000-8000-000000000001',
      'Secret Name',
      1,
      { description: 'Secret description.' },
    );
    const panel = renderPanel({
      entries: [spell],
      references: [{ entryId: spell.id, preparation: 'prepared' }],
    });
    expect(await screen.findByText('Secret description.')).toBeInTheDocument();

    panel.setVisibleEntries([]);
    await panel.emitChange();
    await screen.findByRole('heading', { name: 'Unavailable' });
    expect(screen.queryByText('Secret Name')).not.toBeInTheDocument();
    expect(screen.queryByText('Secret description.')).not.toBeInTheDocument();
    expect(screen.getByText('This spell is unavailable.')).toBeInTheDocument();
  });

  it('requires the standard double confirmation before removing a reference', async () => {
    const spell = spellEntry(
      '30000000-0000-4000-8000-000000000001', 'Removable', 1,
    );
    const { onCommitSpells } = renderPanel({
      entries: [spell],
      references: [{ entryId: spell.id, preparation: 'unprepared' }],
    });
    const user = userEvent.setup();
    const rowButton = await screen.findByRole('button', { name: 'View Removable' });
    fireEvent.contextMenu(rowButton, { clientX: 20, clientY: 20 });
    await user.click(screen.getByRole('menuitem', { name: 'Remove from Character' }));
    expect(onCommitSpells).not.toHaveBeenCalled();
    await user.click(screen.getByRole('menuitem', {
      name: 'Confirm removal from character',
    }));
    await waitFor(() => expect(onCommitSpells).toHaveBeenCalledWith([
      { entryId: spell.id, kind: 'remove' },
    ]));
  });

  it('consumes a slot before sending and refunds it when chat fails', async () => {
    const spell = spellEntry(
      '30000000-0000-4000-8000-000000000001', 'Failed Cast', 1,
    );
    const onSendRoll = vi.fn(async () => false);
    const panel = renderPanel({
      entries: [spell],
      onSendRoll,
      references: [{ entryId: spell.id, preparation: 'unprepared' }],
      slots: { '1': 1 },
    });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Failed Cast' });
    await waitFor(() => expect(screen.getByRole('combobox', {
      name: 'Spell cast mode',
    })).toHaveValue('slot:1'));
    await user.click(screen.getByRole('button', { name: 'Cast' }));

    await waitFor(() => expect(panel.onAdjustSpellSlot.mock.calls).toEqual([
      ['1', -1],
      ['1', 1],
    ]));
    expect(onSendRoll).toHaveBeenCalledWith(
      `spell:${spell.id}`,
      expect.objectContaining({ category: 'Spell', title: 'Failed Cast' }),
    );
    expect(panel.onError).toHaveBeenCalledWith(
      'The cast was not sent. The spell slot was refunded.',
    );
  });

  it('defaults view-only casting to no-slot and never consumes a slot', async () => {
    const spell = spellEntry(
      '30000000-0000-4000-8000-000000000001', 'Viewed Cast', 1,
    );
    const panel = renderPanel({
      canEdit: false,
      entries: [spell],
      references: [{ entryId: spell.id, preparation: 'unprepared' }],
      slots: { '1': 2 },
    });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Viewed Cast' });
    expect(screen.getByRole('combobox', { name: 'Spell cast mode' }))
      .toHaveValue('without-slot');
    expect(screen.getByRole('option', { name: /Cast at 1st Level/ }))
      .toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cast' }));
    await waitFor(() => expect(panel.onSendRoll).toHaveBeenCalledOnce());
    expect(panel.onAdjustSpellSlot).not.toHaveBeenCalled();
  });
});
