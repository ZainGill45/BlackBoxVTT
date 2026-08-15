import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../shared/chat';
import type { SystemJournalEntry } from '../../../shared/journal';
import type { CharacterSheetJournalApi } from '../../../shared/journalWindows';
import { createDefaultCampaignSystemState } from '../../../systems/catalog';
import {
  createDefaultDnd5eCharacterData,
  type Dnd5eCharacterData,
} from '../../../systems/dnd5e/characterData';
import {
  DND5E_CHARACTER_ENTRY_TYPE_ID,
  DND5E_SPELL_ENTRY_TYPE_ID,
} from '../../../systems/dnd5e/definition';
import { CharacterSheetDetached } from '../../../systems/dnd5e/renderer/CharacterSheetModal';
import { createDefaultDnd5eSpellData } from '../../../systems/dnd5e/spellData';
import { createMockNetworkApi } from '../../support/networkApi';

const campaignId = '11111111-1111-4111-8111-111111111111';

function characterEntry(): SystemJournalEntry {
  const data = createDefaultDnd5eCharacterData();
  data.abilities.strength.score = 16;
  data.customSkills = [{
    ability: 'none',
    bonusOffset: 4,
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Recall',
    passiveOffset: 0,
    training: 'untrained',
  }];
  data.health = {
    currentHitDice: '1',
    currentHitPoints: '7',
    hitDie: 'd10',
    maximumHitDice: '5',
    maximumHitPoints: '12',
    temporaryHitPoints: '3',
  };
  data.features = [{
    description: 'Gain advantage on Strength checks.\nUsable while raging.',
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    name: 'Rage',
    source: 'Barbarian 1',
    sourceType: 'Class Feature',
    type: 'feature',
  }];
  data.identity.className = 'Fighter';
  data.identity.level = 5;
  data.inventory.entries = [
    {
      equipped: false,
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      kind: 'item',
      name: 'Longsword',
      quantity: 2,
      weight: 3,
    },
    {
      capacity: 30,
      collapsed: false,
      contents: [{
        equipped: true,
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        kind: 'item',
        name: 'Rations',
        quantity: 3,
        weight: 2,
      }],
      contentsWeight: 'normal',
      equipped: true,
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      kind: 'container',
      name: 'Backpack',
      weight: 5,
    },
  ];
  data.resources = [{
    current: 2,
    id: '66666666-6666-4666-8666-666666666666',
    maximum: 5,
    name: 'Ki Points',
  }];
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
    groupId: 'dnd5e.characters',
    id: '77777777-7777-4777-8777-777777777777',
    detail: null,
    kind: 'system',
    name: 'Aria Stone',
    permissionRevision: 0,
    permissions: { allPlayers: 'none', overrides: [] },
    position: 0,
    revision: 0,
    typeId: DND5E_CHARACTER_ENTRY_TYPE_ID,
  };
}

function successfulMessage(): ChatMessage {
  return {
    acceptedAt: new Date(0).toISOString(),
    clientMessageId: '88888888-8888-4888-8888-888888888888',
    generation: '99999999-9999-4999-8999-999999999999',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    payload: { kind: 'text', text: 'Rolled.' },
    recipient: null,
    sender: { displayName: 'Game Master', kind: 'gm' },
    sequence: 1,
  };
}

function renderCharacterSheet() {
  let server = characterEntry();
  const journalApi: CharacterSheetJournalApi = {
    getEntry: vi.fn(async () => ({ ok: true as const, value: server })),
    list: vi.fn(async () => ({
      ok: true as const,
      value: { entries: [server], revision: server.revision },
    })),
    onChanged: vi.fn(() => () => undefined),
    renameEntry: vi.fn(async (input) => {
      server = { ...server, name: input.name, revision: server.revision + 1 };
      return { ok: true as const, value: server };
    }),
    updateEntryData: vi.fn(async (input) => {
      server = {
        ...server,
        data: input.data as Dnd5eCharacterData,
        revision: server.revision + 1,
      };
      return { ok: true as const, value: server };
    }),
  };
  const sendChatRoll = vi.fn(async () => ({
    ok: true as const,
    value: successfulMessage(),
  }));
  const sendChatMessage = vi.fn(async () => ({
    ok: true as const,
    value: successfulMessage(),
  }));
  const system = createDefaultCampaignSystemState();
  if (!system) throw new Error('The default game system must exist.');
  render(
    <CharacterSheetDetached
      campaignId={campaignId}
      closeRequestId={0}
      entry={server}
      journalApi={journalApi}
      networkApi={createMockNetworkApi({ sendChatMessage, sendChatRoll })}
      onDismiss={() => undefined}
      onUpdated={() => undefined}
      system={system}
    />,
  );
  return {
    sendChatMessage,
    sendChatRoll,
    sheet: screen.getByRole('document', { name: 'Aria Stone character sheet' }),
  };
}

describe('CharacterSheetModal layout', () => {
  it('contains the Spells tab in the sheet viewport with an internal spell-list region', async () => {
    const user = userEvent.setup();
    const { sheet } = renderCharacterSheet();
    const viewport = sheet.querySelector<HTMLElement>('[data-character-sheet-viewport]');
    const main = within(sheet).getByRole('main');

    expect(viewport).toHaveAttribute('data-active-tab', 'home');
    expect(main).toHaveAttribute('data-active-tab', 'home');

    await user.click(within(sheet).getByRole('tab', { name: 'Spells' }));

    expect(viewport).toHaveAttribute('data-active-tab', 'spells');
    expect(main).toHaveAttribute('data-active-tab', 'spells');
    expect(within(sheet).getByRole('region', { name: 'Character spell list' }))
      .toBeInTheDocument();
  });
});

describe('CharacterSheetModal chat actions', () => {
  it('rolls current ability and important-stat totals', async () => {
    const user = userEvent.setup();
    const { sendChatRoll, sheet } = renderCharacterSheet();
    const strengthScore = within(sheet).getByRole('textbox', { name: 'Strength score' });

    await user.clear(strengthScore);
    await user.type(strengthScore, '18');
    await user.click(within(sheet).getByRole('button', { name: 'Roll Strength check' }));
    await waitFor(() => expect(sendChatRoll).toHaveBeenCalledTimes(1));
    expect(sendChatRoll).toHaveBeenLastCalledWith(expect.objectContaining({
      campaignId,
      definition: {
        category: 'Ability Check',
        sections: [{
          label: 'Strength',
          modifiers: [{ label: 'Ability Check', value: 4 }],
          notation: '1d20',
          typeLabel: 'Ability Check',
        }],
        title: null,
      },
      recipient: null,
    }));

    const strengthSave = within(sheet).getByRole('textbox', {
      name: 'Strength saving throw',
    });
    await user.clear(strengthSave);
    await user.type(strengthSave, '+8');
    await user.click(within(sheet).getByRole('button', {
      name: 'Roll Strength saving throw',
    }));
    await waitFor(() => expect(sendChatRoll).toHaveBeenCalledTimes(2));
    expect(sendChatRoll).toHaveBeenLastCalledWith(expect.objectContaining({
      definition: expect.objectContaining({
        category: 'Saving Throw',
        sections: [expect.objectContaining({
          modifiers: [{ label: 'Saving Throw', value: 8 }],
          typeLabel: 'Saving Throw',
        })],
      }),
    }));

    await user.click(within(sheet).getByRole('button', {
      name: 'Roll Strength check from ability heading',
    }));
    await waitFor(() => expect(sendChatRoll).toHaveBeenCalledTimes(3));
    expect(sendChatRoll).toHaveBeenLastCalledWith(expect.objectContaining({
      definition: expect.objectContaining({
        category: 'Ability Check',
        sections: [expect.objectContaining({
          label: 'Strength',
          modifiers: [{ label: 'Ability Check', value: 4 }],
        })],
      }),
    }));

    const initiative = within(sheet).getByRole('textbox', { name: 'Initiative' });
    await user.clear(initiative);
    await user.type(initiative, '+2');
    await user.click(within(sheet).getByRole('button', { name: 'Roll Initiative' }));
    await waitFor(() => expect(sendChatRoll).toHaveBeenCalledTimes(4));
    expect(sendChatRoll).toHaveBeenLastCalledWith(expect.objectContaining({
      definition: {
        category: 'Initiative',
        sections: [{
          label: 'Initiative',
          modifiers: [{ label: 'Initiative', value: 2 }],
          notation: '1d20',
          typeLabel: null,
        }],
        title: null,
      },
    }));

    await user.click(within(sheet).getByRole('button', {
      name: 'Roll Concentration saving throw',
    }));
    await waitFor(() => expect(sendChatRoll).toHaveBeenCalledTimes(5));
    expect(sendChatRoll).toHaveBeenLastCalledWith(expect.objectContaining({
      definition: expect.objectContaining({
        category: 'Saving Throw',
        sections: [expect.objectContaining({
          label: 'Concentration',
          modifiers: [{ label: 'Saving Throw', value: 3 }],
          typeLabel: 'Saving Throw',
        })],
      }),
    }));
  });

  it('shares Character values and stops consuming Hit Dice at zero', async () => {
    const user = userEvent.setup();
    const { sendChatMessage, sendChatRoll, sheet } = renderCharacterSheet();
    for (const [accessibleLabel, content] of [
      ['Armor Class', 'Armor Class: 10'],
      ['Current Speed', 'Speed: 30'],
      ['Proficiency Bonus', 'Proficiency: +3'],
      ['Inspiration Count', 'Inspiration: 0'],
      ['Current hit points', 'HP: 7/12'],
      ['Temporary hit points', 'Temp HP: 3'],
      ['Current hit dice', 'Hit Dice: 1/5 d10'],
      ['Ki Points name', 'Ki Points: 2/5'],
    ] as const) {
      fireEvent.contextMenu(
        within(sheet).getByRole('textbox', { name: accessibleLabel }),
        { clientX: 100, clientY: 100 },
      );
      await user.click(screen.getByRole('menuitem', { name: 'Send To Chat' }));
      await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({ campaignId, content, recipient: null }),
      ));
    }
    expect(sendChatMessage).toHaveBeenCalledTimes(8);

    await user.click(within(sheet).getByRole('button', { name: 'Roll Hit Die' }));
    await waitFor(() => expect(sendChatRoll).toHaveBeenCalledTimes(1));
    expect(sendChatRoll).toHaveBeenLastCalledWith(expect.objectContaining({
      campaignId,
      definition: {
        category: 'Hit Dice',
        sections: [{
          label: 'Hit Die',
          modifiers: [],
          notation: '1d10',
          typeLabel: 'Healing',
        }],
        title: null,
      },
      recipient: null,
    }));
    await waitFor(() => expect(
      within(sheet).getByRole('textbox', { name: 'Current hit dice' }),
    ).toHaveValue('0'));
    await user.click(within(sheet).getByRole('button', { name: 'Roll Hit Die' }));
    await waitFor(() => expect(sendChatRoll).toHaveBeenCalledTimes(2));
    expect(within(sheet).getByRole('textbox', { name: 'Current hit dice' }))
      .toHaveValue('0');
  });

  it('rolls built-in skills by name and custom skills from their context menu', async () => {
    const user = userEvent.setup();
    const { sendChatRoll, sheet } = renderCharacterSheet();

    await user.click(within(sheet).getByRole('button', { name: 'Roll Athletics' }));
    await waitFor(() => expect(sendChatRoll).toHaveBeenCalledTimes(1));
    expect(sendChatRoll).toHaveBeenLastCalledWith(expect.objectContaining({
      campaignId,
      definition: {
        category: 'Skill Check',
        sections: [{
          label: 'Athletics',
          modifiers: [{ label: 'Skill Check', value: 3 }],
          notation: '1d20',
          typeLabel: 'Skill Check',
        }],
        title: null,
      },
      recipient: null,
    }));

    fireEvent.contextMenu(
      within(sheet).getByRole('textbox', { name: 'Recall name' }),
      { clientX: 100, clientY: 100 },
    );
    await user.click(screen.getByRole('menuitem', { name: 'Send To Chat' }));
    await waitFor(() => expect(sendChatRoll).toHaveBeenCalledTimes(2));
    expect(sendChatRoll).toHaveBeenLastCalledWith(expect.objectContaining({
      campaignId,
      definition: expect.objectContaining({
        category: 'Skill Check',
        sections: [expect.objectContaining({
          label: 'Recall',
          modifiers: [{ label: 'Skill Check', value: 4 }],
        })],
      }),
      recipient: null,
    }));
  });

  it('shares readable item and recursive container details from inventory menus', async () => {
    const user = userEvent.setup();
    const { sendChatMessage, sheet } = renderCharacterSheet();

    fireEvent.contextMenu(
      within(sheet).getByRole('textbox', { name: 'Longsword name' }),
      { clientX: 100, clientY: 100 },
    );
    await user.click(screen.getByRole('menuitem', { name: 'Send To Chat' }));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId,
        content: [
          'Item: Longsword',
          'Equipped: No',
          'Count: 2',
          'Weight: 3 lb each',
          'Total Weight: 6 lb',
        ].join('\n'),
        recipient: null,
      }),
    ));

    fireEvent.contextMenu(
      within(sheet).getByRole('textbox', { name: 'Backpack name' }),
      { clientX: 100, clientY: 100 },
    );
    await user.click(screen.getByRole('menuitem', { name: 'Send To Chat' }));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId,
        content: [
          'Container: Backpack',
          'Equipped: Yes',
          'Weight (empty): 5 lb',
          'Contents Weight: Normal',
          'Capacity: 30 lb',
          'Used Capacity: 6 lb',
          'Status: Within capacity',
          'Contents:',
          '  - Item: Rations',
          '    Equipped: Yes',
          '    Count: 3',
          '    Weight: 2 lb each',
          '    Total Weight: 6 lb',
        ].join('\n'),
        recipient: null,
      }),
    ));
    expect(sendChatMessage).toHaveBeenCalledTimes(2);
  });

  it('shares every field from a Feature entry', async () => {
    const user = userEvent.setup();
    const { sendChatMessage, sheet } = renderCharacterSheet();

    fireEvent.contextMenu(
      within(sheet).getByRole('button', { name: 'Rage' }),
      { clientX: 100, clientY: 100 },
    );
    await user.click(screen.getByRole('menuitem', { name: 'Send To Chat' }));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId,
        content: [
          'Feature: Rage',
          'Type: Feature',
          'Source: Barbarian 1',
          'Source Type: Class Feature',
          '',
          'Gain advantage on Strength checks.',
          'Usable while raging.',
        ].join('\n'),
        recipient: null,
      }),
    ));
  });

  it('recompiles after a slot conflict and durably refunds a failed cast', async () => {
    const user = userEvent.setup();
    const spellId = '30000000-0000-4000-8000-000000000001';
    let server = characterEntry();
    const characterData = server.data as Dnd5eCharacterData;
    characterData.identity.className = 'Wizard';
    characterData.identity.level = 5;
    characterData.abilities.intelligence.score = 18;
    characterData.spellcasting.ability = 'intelligence';
    characterData.spellcasting.slots['1'].current = 1;
    characterData.spellcasting.spells = [{
      entryId: spellId,
      preparation: 'unprepared',
    }];
    const spellData = createDefaultDnd5eSpellData();
    spellData.level = 1;
    spellData.rollSteps = [{
      id: '30000000-0000-4000-8000-000000000002',
      label: 'Power',
      purpose: 'roll',
      terms: [{ kind: 'spellcasting-modifier' }],
    }];
    const spell: SystemJournalEntry = {
      capabilities: server.capabilities,
      data: spellData,
      detail: '1st Level Abjuration',
      groupId: 'dnd5e.spells',
      id: spellId,
      kind: 'system',
      name: 'Conflict Ward',
      permissionRevision: 0,
      permissions: server.permissions,
      position: 1,
      revision: 0,
      typeId: DND5E_SPELL_ENTRY_TYPE_ID,
    };
    let conflicted = false;
    const updateEntryData = vi.fn(async (
      input: Parameters<CharacterSheetJournalApi['updateEntryData']>[0],
    ) => {
      if (!conflicted) {
        conflicted = true;
        const remoteData = structuredClone(server.data as Dnd5eCharacterData);
        remoteData.abilities.intelligence.score = 20;
        server = { ...server, data: remoteData, revision: 1 };
        return {
          error: { code: 'conflict' as const, message: 'Changed remotely.' },
          ok: false as const,
        };
      }
      server = {
        ...server,
        data: input.data as Dnd5eCharacterData,
        revision: server.revision + 1,
      };
      return { ok: true as const, value: server };
    });
    const journalApi: CharacterSheetJournalApi = {
      getEntry: vi.fn(async ({ entryId }) => ({
        ok: true as const,
        value: entryId === spellId ? spell : server,
      })),
      list: vi.fn(async () => ({
        ok: true as const,
        value: { entries: [server, spell], revision: 1 },
      })),
      onChanged: vi.fn(() => () => undefined),
      renameEntry: vi.fn(),
      updateEntryData,
    };
    const sendChatRoll = vi.fn(async () => ({
      error: { code: 'timeout' as const, message: 'Chat timed out.' },
      ok: false as const,
    }));
    const system = createDefaultCampaignSystemState();
    if (!system) throw new Error('The default game system must exist.');
    render(
      <CharacterSheetDetached
        campaignId={campaignId}
        closeRequestId={0}
        entry={server}
        journalApi={journalApi}
        networkApi={createMockNetworkApi({ sendChatRoll })}
        onDismiss={() => undefined}
        onUpdated={() => undefined}
        system={system}
      />,
    );
    const sheet = screen.getByRole('document', {
      name: 'Aria Stone character sheet',
    });
    await user.click(within(sheet).getByRole('tab', { name: 'Spells' }));
    await within(sheet).findByRole('heading', { name: 'Conflict Ward' });
    await waitFor(() => expect(within(sheet).getByRole('button', {
      name: 'Spell cast mode',
    })).toHaveTextContent('Cast at 1st Level'));
    await user.click(within(sheet).getByRole('button', { name: 'Cast' }));

    await waitFor(() => expect(updateEntryData).toHaveBeenCalledTimes(3));
    expect(updateEntryData.mock.calls.map(([input]) => ({
      current: (input.data as Dnd5eCharacterData)
        .spellcasting.slots['1'].current,
      expectedRevision: input.expectedRevision,
    }))).toEqual([
      { current: 0, expectedRevision: 0 },
      { current: 0, expectedRevision: 1 },
      { current: 1, expectedRevision: 2 },
    ]);
    expect(sendChatRoll).toHaveBeenCalledWith(expect.objectContaining({
      definition: expect.objectContaining({
        category: 'Spell',
        sections: [
          expect.anything(),
          expect.objectContaining({
            modifiers: [{ label: 'Spellcasting Modifier', value: 5 }],
          }),
        ],
        title: 'Conflict Ward',
      }),
    }));
    expect(server.data).toMatchObject({
      spellcasting: { slots: { '1': { current: 1 } } },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The cast was not sent. The spell slot was refunded.',
    );
  });
});
