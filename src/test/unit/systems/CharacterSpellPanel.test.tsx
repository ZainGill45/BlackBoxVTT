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
  let changeLevel: ((level: number) => void) | null = null;
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
    changeLevel = (level) => setData((current) => ({
      ...current,
      identity: { ...current.identity, level },
    }));
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
    setLevel: (level: number) => {
      if (!changeLevel) throw new Error('Character harness was not rendered.');
      act(() => changeLevel?.(level));
    },
    setVisibleEntries: (entries: SystemJournalEntry[]) => {
      visibleEntries = entries;
    },
  };
}

describe('Character spell browser', () => {
  it('groups in manual order, searches metadata, and shows complete details', async () => {
    const cantrip = spellEntry(
      '30000000-0000-4000-8000-000000000001',
      'Zephyr Spark',
      0,
      {
        castingTime: '1 Bonus Action',
        classes: ['Wizard'],
        duration: '',
        range: ' ',
        school: 'Evocation',
        target: '',
      },
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
        rollSteps: [
          {
            attackBonus: { kind: 'spell-attack-bonus' },
            id: '40000000-0000-4000-8000-000000000001',
            label: 'Spell Attack',
            purpose: 'attack',
          },
          {
            criticalSourceStepId: null,
            damageType: 'radiant',
            id: '40000000-0000-4000-8000-000000000002',
            label: 'Damage',
            purpose: 'damage',
            terms: [{
              count: 4,
              kind: 'dice',
              scaling: 'fixed',
              sides: 6,
              tiers: [],
            }],
          },
        ],
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

    const cantripRow = await screen.findByRole('button', { name: 'View Zephyr Spark' });
    expect(within(cantripRow).getByText('Cantrip Bonus Action')).toBeInTheDocument();
    expect(within(cantripRow).queryByText(/Evocation|·/)).not.toBeInTheDocument();
    const levelTwo = screen.getByRole('heading', { name: '2nd Level' }).closest('section')!;
    expect(within(levelTwo).getAllByRole('button').map((button) =>
      button.getAttribute('aria-label'))).toEqual([
      'View Beacon',
      'View Arcane Lock',
    ]);
    const arcaneLockRow = screen.getByRole('button', { name: 'View Arcane Lock' });
    expect(within(arcaneLockRow).getByText('2nd Level Action')).toBeInTheDocument();
    expect(within(arcaneLockRow).queryByText(/Abjuration|·/)).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Zephyr Spark' }))
      .toBeInTheDocument();
    expect(within(screen.getByLabelText('Spell metadata')).getAllByText('N/A'))
      .toHaveLength(4);

    await userEvent.setup().click(screen.getByRole('button', { name: 'View Arcane Lock' }));
    expect(screen.getByText('2nd-level Abjuration')).toBeInTheDocument();
    expect(Array.from(screen.getByLabelText('Spell tags').children).map(
      (tag) => tag.textContent,
    )).toEqual([
      'Attack',
      'Radiant',
      'Wizard',
      'Concentration',
      'Ritual',
      'V, S, M',
    ]);
    const metadata = screen.getByLabelText('Spell metadata');
    expect(within(metadata).getByText('Roll')).toBeInTheDocument();
    expect(within(metadata).getByText('One door')).toBeInTheDocument();
    expect(within(metadata).getByText('+7 · 4d6')).toBeInTheDocument();
    expect(within(metadata).queryByText('Preparation'))
      .not.toBeInTheDocument();

    await userEvent.setup().type(
      screen.getByRole('searchbox', { name: 'Search character spells' }),
      'cleric',
    );
    expect(screen.getByRole('button', { name: 'View Beacon' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Arcane Lock' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '2nd Level' })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', {
      name: 'Clear character spell search',
    }));
    expect(screen.getByRole('button', { name: 'View Arcane Lock' }))
      .toBeInTheDocument();

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
    expect(within(picker).getByText('Choose spells from the campaign Journal.'))
      .toBeInTheDocument();
    expect(within(picker).getByText('0 selected')).toBeInTheDocument();
    expect(within(picker).getByText('3 spells')).toBeInTheDocument();
    expect(within(picker).getByRole('checkbox', { name: /Attached/ })).toBeDisabled();
    const cantripOption = within(picker).getByRole('checkbox', { name: /Cantrip Choice/ });
    const cantripOptionLabel = cantripOption.closest('label')!;
    expect(within(cantripOptionLabel).getByText('Cantrip Action')).toBeInTheDocument();
    expect(within(cantripOptionLabel).queryByText(/Abjuration|·/)).not.toBeInTheDocument();
    await user.click(cantripOption);
    await user.click(within(picker).getByRole('checkbox', { name: /Ritual Choice/ }));
    expect(within(picker).getByText('2 selected')).toBeInTheDocument();
    expect(onCommitSpells).not.toHaveBeenCalled();
    await user.click(within(picker).getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(onCommitSpells).toHaveBeenCalledWith([
      {
        kind: 'add',
        spell: { entryId: cantrip.id, preparation: 'always-prepared' },
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
    const panel = renderPanel({
      entries: [cantrip, leveled],
      preparedMaximumOffset: -100,
      references: [
        { entryId: cantrip.id, preparation: 'prepared' },
        { entryId: leveled.id, preparation: 'prepared' },
        { entryId: unavailableId, preparation: 'prepared' },
      ],
    });
    const user = userEvent.setup();
    const cantripPreparation = await screen.findByRole('checkbox', {
      name: 'Spark: Always Prepared',
    });
    expect(cantripPreparation).toHaveAttribute('aria-checked', 'mixed');
    expect(cantripPreparation).toBeDisabled();
    await user.click(cantripPreparation);
    expect(panel.onCommitSpells).not.toHaveBeenCalled();
    const prepared = await screen.findByRole('checkbox', {
      name: 'Shield: Prepared',
    });
    await waitFor(() => expect(panel.onPreparedSummaryChange).toHaveBeenLastCalledWith({
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
    await waitFor(() => expect(panel.onPreparedSummaryChange).toHaveBeenLastCalledWith({
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

  it('moves within level groups and requires the standard armed Delete', async () => {
    const first = spellEntry(
      '30000000-0000-4000-8000-000000000001', 'First', 1,
    );
    const cantrip = spellEntry(
      '30000000-0000-4000-8000-000000000002', 'Cantrip', 0,
    );
    const second = spellEntry(
      '30000000-0000-4000-8000-000000000003', 'Second', 1,
    );
    const unavailableId = '30000000-0000-4000-8000-000000000004';
    const panel = renderPanel({
      entries: [second, cantrip, first],
      references: [
        { entryId: first.id, preparation: 'unprepared' },
        { entryId: cantrip.id, preparation: 'unprepared' },
        { entryId: second.id, preparation: 'prepared' },
        { entryId: unavailableId, preparation: 'always-prepared' },
      ],
    });
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'View Second' });
    const levelOne = screen.getByRole('heading', { name: '1st Level' }).closest('section')!;
    const levelOrder = () => within(levelOne).getAllByRole('button', { name: /^View / })
      .map((button) => button.getAttribute('aria-label'));
    expect(levelOrder()).toEqual(['View First', 'View Second']);

    fireEvent.contextMenu(screen.getByRole('button', { name: 'View Second' }), {
      clientX: 20,
      clientY: 20,
    });
    let menu = screen.getByRole('menu', { name: 'Second actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Move Down' })).toBeDisabled();
    await user.click(within(menu).getByRole('menuitem', { name: 'Move Up' }));
    await waitFor(() => expect(levelOrder()).toEqual(['View Second', 'View First']));
    expect(panel.onCommitSpells).toHaveBeenLastCalledWith([{
      kind: 'reorder',
      orderedEntryIds: [second.id, first.id],
    }]);

    const unavailable = screen.getByRole('button', { name: 'View unavailable spell' });
    fireEvent.contextMenu(unavailable, { clientX: 20, clientY: 20 });
    menu = screen.getByRole('menu', { name: 'Unavailable spell actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Move Up' })).toBeDisabled();
    expect(within(menu).getByRole('menuitem', { name: 'Reorder Freely' })).toBeDisabled();
    fireEvent.keyDown(menu, { key: 'Escape' });

    const firstButton = screen.getByRole('button', { name: 'View First' });
    fireEvent.contextMenu(firstButton, { clientX: 20, clientY: 20 });
    menu = screen.getByRole('menu', { name: 'First actions' });
    const callsBeforeDelete = panel.onCommitSpells.mock.calls.length;
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    expect(panel.onCommitSpells).toHaveBeenCalledTimes(callsBeforeDelete);
    await user.click(screen.getByRole('menuitem', {
      name: 'Confirm deletion of First from character',
    }));
    await waitFor(() => expect(panel.onCommitSpells).toHaveBeenLastCalledWith([
      { entryId: first.id, kind: 'remove' },
    ]));
    expect(screen.queryByRole('button', { name: 'View First' })).not.toBeInTheDocument();
    expect(panel.journalApi.updateEntryData).not.toHaveBeenCalled();
  });

  it('supports keyboard free reorder and disables ordering during search', async () => {
    const first = spellEntry(
      '30000000-0000-4000-8000-000000000001', 'First', 1,
    );
    const second = spellEntry(
      '30000000-0000-4000-8000-000000000002', 'Second', 1,
    );
    const third = spellEntry(
      '30000000-0000-4000-8000-000000000003', 'Third', 1,
    );
    const panel = renderPanel({
      entries: [third, first, second],
      references: [first, second, third].map((spell) => ({
        entryId: spell.id,
        preparation: 'unprepared' as const,
      })),
    });
    const user = userEvent.setup();
    const levelOne = await screen.findByRole('heading', { name: '1st Level' });
    const group = levelOne.closest('section')!;
    const order = () => within(group).getAllByRole('button', { name: /^View / })
      .map((button) => button.getAttribute('aria-label'));
    const secondButton = screen.getByRole('button', { name: 'View Second' });

    secondButton.focus();
    fireEvent.keyDown(secondButton, { key: 'F10', shiftKey: true });
    let menu = screen.getByRole('menu', { name: 'Second actions' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Reorder Freely' }));
    expect(screen.getByText('Place Second')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(order()).toEqual(['View First', 'View Third', 'View Second']);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(order()).toEqual(['View First', 'View Second', 'View Third']);
    expect(panel.onCommitSpells).not.toHaveBeenCalled();

    fireEvent.keyDown(secondButton, { key: 'ContextMenu' });
    menu = screen.getByRole('menu', { name: 'Second actions' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Reorder Freely' }));
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(order()).toEqual([
      'View First',
      'View Third',
      'View Second',
    ]));
    expect(panel.onCommitSpells).toHaveBeenLastCalledWith([{
      kind: 'reorder',
      orderedEntryIds: [first.id, third.id, second.id],
    }]);

    fireEvent.keyDown(screen.getByRole('button', { name: 'View Second' }), {
      key: 'ContextMenu',
    });
    menu = screen.getByRole('menu', { name: 'Second actions' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Reorder Freely' }));
    const firstRow = screen.getByRole('button', { name: 'View First' })
      .closest<HTMLElement>('[data-spell-order-id]')!;
    fireEvent.pointerMove(firstRow, { clientY: 0 });
    expect(order()).toEqual(['View Second', 'View First', 'View Third']);
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(panel.onCommitSpells).toHaveBeenLastCalledWith([{
      kind: 'reorder',
      orderedEntryIds: [second.id, first.id, third.id],
    }]));
    await panel.emitChange();
    expect(order()).toEqual(['View Second', 'View First', 'View Third']);

    await user.type(
      screen.getByRole('searchbox', { name: 'Search character spells' }),
      'Second',
    );
    const filteredSecond = screen.getByRole('button', { name: 'View Second' });
    fireEvent.keyDown(filteredSecond, { key: 'ContextMenu' });
    menu = screen.getByRole('menu', { name: 'Second actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Move Up' })).toBeDisabled();
    expect(within(menu).getByRole('menuitem', { name: 'Move Down' })).toBeDisabled();
    expect(within(menu).getByRole('menuitem', { name: 'Reorder Freely' })).toBeDisabled();
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeEnabled();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(filteredSecond).toHaveFocus();
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
    await waitFor(() => expect(screen.getByRole('button', {
      name: 'Spell cast mode',
    })).toHaveTextContent('Cast at 1st Level'));
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

  it('removes a cast level when leveling down locks its stale current slots', async () => {
    const spell = spellEntry(
      '30000000-0000-4000-8000-000000000001', 'Level Gate', 3,
    );
    const panel = renderPanel({
      entries: [spell],
      references: [{ entryId: spell.id, preparation: 'unprepared' }],
      slots: { '3': 1 },
    });

    await screen.findByRole('heading', { name: 'Level Gate' });
    expect(screen.getByRole('button', { name: 'Spell cast mode' }))
      .toHaveTextContent('Cast at 3rd Level');

    panel.setLevel(4);

    await waitFor(() => expect(screen.getByRole('button', {
      name: 'Spell cast mode',
    })).toHaveTextContent('Cast without slot'));
    await userEvent.setup().click(screen.getByRole('button', {
      name: 'Spell cast mode',
    }));
    expect(within(screen.getByRole('group', {
      name: 'Spell cast mode options',
    })).queryByRole('button', { name: 'Cast at 3rd Level' }))
      .not.toBeInTheDocument();
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
    const viewButton = screen.getByRole('button', { name: 'View Viewed Cast' });
    fireEvent.contextMenu(viewButton);
    fireEvent.keyDown(viewButton, { key: 'ContextMenu' });
    expect(screen.queryByRole('menu', { name: 'Viewed Cast actions' }))
      .not.toBeInTheDocument();
    const castMode = screen.getByRole('button', { name: 'Spell cast mode' });
    expect(castMode).toHaveTextContent('Cast without slot');
    await user.click(castMode);
    expect(within(screen.getByRole('group', {
      name: 'Spell cast mode options',
    })).getByRole('button', { name: 'Cast at 1st Level' }))
      .toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cast' }));
    await waitFor(() => expect(panel.onSendRoll).toHaveBeenCalledOnce());
    expect(panel.onAdjustSpellSlot).not.toHaveBeenCalled();
  });
});
