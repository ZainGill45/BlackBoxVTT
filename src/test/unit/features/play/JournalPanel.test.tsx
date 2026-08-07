import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JournalPanel } from '../../../../features/play/JournalPanel';
import type {
  JournalApi,
  JournalChangedEvent,
  JournalPage,
  JournalResult,
  NoteEntry,
} from '../../../../shared/journal';
import {
  DND5E_CHARACTER_ENTRY_TYPE_ID,
} from '../../../../systems/dnd5e/definition';
import {
  createDefaultDnd5eCharacterData,
  DND5E_5_5E_CLASSES,
  DND5E_CHARACTER_LEVELS,
  type Dnd5eCharacterData,
} from '../../../../systems/dnd5e/characterData';
import {
  JOURNAL_ENTRY_TYPE_NOTE,
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
const note: NoteEntry = {
  capabilities: { delete: true, edit: true, managePages: true, managePermissions: true, reorder: true, view: true },
  groupId: 'core.notes',
  id: page.entryId,
  kind: 'note',
  name: 'Gathered Magic Items',
  nameStyle: defaultJournalTitleStyle(),
  pages: [page],
  permissions: { allPlayers: 'none', overrides: [] },
  position: 0,
  revision: 0,
  typeId: 'core.note',
};

const character = {
  capabilities: { delete: true, edit: true, managePages: false, managePermissions: true, reorder: true, view: true },
  data: createDefaultDnd5eCharacterData(),
  groupId: 'dnd5e.characters',
  id: '77777777-7777-4777-8777-777777777777',
  kind: 'system' as const,
  name: 'New Character',
  permissions: { allPlayers: 'none' as const, overrides: [] },
  position: 0,
  revision: 0,
  typeId: DND5E_CHARACTER_ENTRY_TYPE_ID,
};

async function expandNotes(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole('button', { name: 'Notes' });
  if (button.getAttribute('aria-expanded') !== 'true') await user.click(button);
}

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
    list: async () => ({ ok: true, value: { entries: [note], revision: 0 } }),
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

  it('creates the selected catalog entry and opens its bound editor', async () => {
    const user = userEvent.setup();
    const createEntry = vi.fn(async ({ typeId }: { typeId: string }) => ({
      ok: true as const,
      value: typeId === JOURNAL_ENTRY_TYPE_NOTE ? note : character,
    }));
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({
          createEntry,
          list: async () => ({
            ok: true,
            value: {
              entries: [],
              revision: 0,
            },
          }),
        })}
        role="gm"
      />,
    );

    const add = await screen.findByRole('button', {
      name: 'Add journal entry',
    });
    expect(add).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(add);

    const actorMenu = screen.getByRole('menu', {
      name: 'Choose journal entry type',
    });
    expect(within(actorMenu).getByRole('menuitem', { name: 'Note' })).toBeVisible();
    await user.click(
      within(actorMenu).getByRole('menuitem', { name: 'Character' }),
    );

    const characterSheet = screen.getByRole('dialog', {
      name: 'New Character character sheet',
    });
    expect(characterSheet).toBeVisible();
    expect(characterSheet).toHaveFocus();
    expect(within(characterSheet).getByRole('textbox', { name: 'Name' }))
      .toHaveValue('New Character');
    const classDropdown = within(characterSheet).getByRole('button', { name: 'Class' });
    const levelDropdown = within(characterSheet).getByRole('button', { name: 'Level' });
    expect(classDropdown).toBeVisible();
    expect(levelDropdown).toBeVisible();
    expect(classDropdown.querySelector('svg')).not.toBeInTheDocument();
    expect(levelDropdown.querySelector('svg')).not.toBeInTheDocument();
    expect(classDropdown).toHaveAttribute(
      'title',
      "The character's primary adventuring class.",
    );
    expect(levelDropdown).toHaveAttribute(
      'title',
      "The character's current class level, from 1 to 20.",
    );
    const identityInputTooltips = [
      ['Name', 'The name used to identify this character.'],
      ['Subclass', "The specialization chosen within the character's class."],
      ['Experience', "The character's accumulated experience points."],
      ['Species', "The character's species."],
      ['Lineage', "The character's lineage, if applicable."],
      ['Creature Type', "The character's creature type, such as Humanoid."],
      ['Age', "The character's age."],
      ['Height', "The character's height."],
      ['Weight', "The character's weight."],
      ['Eyes', "The character's eye color or appearance."],
      ['Skin', "The character's skin color or appearance."],
      ['Hair', "The character's hair color or appearance."],
      ['Size', "The character's size category, such as Medium or Small."],
    ] as const;
    for (const [label, tooltip] of identityInputTooltips) {
      expect(within(characterSheet).getByRole('textbox', { name: label }))
        .toHaveAttribute('title', tooltip);
    }
    expect(within(characterSheet).getByRole('textbox', { name: 'Species' })).toBeVisible();
    expect(within(characterSheet).getByRole('textbox', { name: 'Strength score' })).toBeVisible();
    const importantStats = within(characterSheet).getByRole('heading', { name: 'Important Statistics' })
      .parentElement!;
    const importantStatDefaults = [
      ['Initiative', '0'],
      ['Armor Class', '10'],
      ['Current Speed', '30'],
      ['Concentration Save', '0'],
      ['Proficiency Bonus', '+2'],
      ['Inspiration Count', '0'],
    ] as const;
    for (const [label, defaultValue] of importantStatDefaults) {
      const input = within(importantStats).getByRole('textbox', { name: label });
      expect(input.parentElement?.tagName).toBe('LABEL');
      expect(input).not.toHaveAttribute('placeholder');
      expect(input).toHaveValue(defaultValue);
    }
    expect(within(characterSheet).getByRole('heading', { name: 'Skills' }))
      .toBeVisible();
    const health = within(characterSheet).getByRole('heading', { name: /^Health$/u })
      .parentElement!;
    for (const [label, defaultValue] of [
      ['Current hit points', '1'],
      ['Maximum hit points', '1'],
      ['Temporary hit points', '0'],
      ['Current hit dice', '1'],
      ['Maximum hit dice', '1'],
      ['Hit die', 'd8'],
    ] as const) {
      expect(within(health).getByRole('textbox', { name: label })).toHaveValue(defaultValue);
    }
    expect(within(health).getByRole('group', { name: 'Death save successes' })
      .querySelectorAll('button')).toHaveLength(3);
    expect(within(health).getByRole('group', { name: 'Death save failures' })
      .querySelectorAll('button')).toHaveLength(3);
    expect(within(characterSheet).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Spells',
      'Home',
      'Settings',
    ]);
    await user.click(within(characterSheet).getByRole('tab', { name: 'Spells' }));
    expect(within(characterSheet).getByRole('tabpanel')).toBeEmptyDOMElement();
    await user.click(within(characterSheet).getByRole('tab', { name: 'Settings' }));
    expect(within(characterSheet).getByRole('tabpanel')).toBeEmptyDOMElement();
    expect(createEntry).toHaveBeenCalledWith({ campaignId, typeId: DND5E_CHARACTER_ENTRY_TYPE_ID });

    fireEvent(
      characterSheet,
      new Event('cancel', { bubbles: false, cancelable: true }),
    );
    expect(
      screen.queryByRole('dialog', { name: 'New Character character sheet' }),
    ).not.toBeInTheDocument();

    await user.click(add);
    await user.click(
      screen.getByRole('menuitem', { name: 'Note' }),
    );
    await waitFor(() =>
      expect(createEntry).toHaveBeenCalledWith({ campaignId, typeId: JOURNAL_ENTRY_TYPE_NOTE }),
    );
    expect(
      await screen.findByRole('textbox', { name: 'Note name' }),
    ).toBeVisible();
  });

  it('autosaves Character fields and its Journal name from the sheet', async () => {
    const user = userEvent.setup();
    let server = structuredClone(character);
    const renameEntry = vi.fn(async (
      input: Parameters<JournalApi['renameEntry']>[0],
    ): Promise<JournalResult<typeof server>> => {
      server = {
        ...server,
        name: input.name.trim(),
        revision: server.revision + 1,
      };
      return { ok: true, value: server };
    });
    const updateEntryData = vi.fn(async (
      input: Parameters<JournalApi['updateEntryData']>[0],
    ): Promise<JournalResult<typeof server>> => {
      server = {
        ...server,
        data: input.data as typeof server.data,
        revision: server.revision + 1,
      };
      return { ok: true, value: server };
    });
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({
          getEntry: async () => ({ ok: true, value: server }),
          list: async () => ({
            ok: true,
            value: { entries: [server], revision: 0 },
          }),
          renameEntry,
          updateEntryData,
        })}
        role="gm"
        system={{
          id: 'dnd5e',
          settings: { defaultRulesVersion: '5e' },
        }}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Characters' }));
    await user.click(await screen.findByRole('button', { name: 'Open New Character' }));
    let sheet = screen.getByRole('dialog', { name: 'New Character character sheet' });
    expect(within(sheet).getByRole('textbox', { name: 'Race' }))
      .toHaveAttribute('title', "The character's race.");
    expect(within(sheet).getByRole('textbox', { name: 'Subrace' }))
      .toHaveAttribute('title', "The character's subrace, if applicable.");
    expect(within(sheet).getByRole('textbox', { name: 'Creature' })).toBeVisible();

    await user.click(within(sheet).getByRole('button', { name: 'Class' }));
    const classOptions = within(sheet).getByRole('group', { name: 'Class options' });
    const classOptionButtons = within(classOptions).getAllByRole('button');
    expect(classOptionButtons.map(({ textContent }) => textContent))
      .toEqual([...DND5E_5_5E_CLASSES]);
    const classIconNames = classOptionButtons.map((option) =>
      option.querySelector('svg')?.getAttribute('class'));
    expect(classIconNames.every(Boolean)).toBe(true);
    expect(new Set(classIconNames).size).toBe(DND5E_5_5E_CLASSES.length);
    await user.click(within(classOptions).getByRole('button', { name: 'Fighter' }));
    await waitFor(() => expect(updateEntryData).toHaveBeenCalledWith(expect.objectContaining({
      campaignId,
      entryId: character.id,
      expectedRevision: 0,
      data: expect.objectContaining({ identity: expect.objectContaining({ className: 'Fighter' }) }),
    })));

    await user.click(within(sheet).getByRole('button', { name: 'Level' }));
    const levelOptions = within(sheet).getByRole('group', { name: 'Level options' });
    const levelOptionButtons = within(levelOptions).getAllByRole('button');
    expect(levelOptionButtons.map(({ textContent }) => textContent))
      .toEqual(DND5E_CHARACTER_LEVELS);
    const levelIconNames = levelOptionButtons.map((option) =>
      option.querySelector('svg')?.getAttribute('class'));
    expect(levelIconNames.every(Boolean)).toBe(true);
    expect(new Set(levelIconNames).size).toBe(4);
    await user.click(within(levelOptions).getByRole('button', { name: '7' }));
    await waitFor(() => expect(updateEntryData).toHaveBeenCalledWith(expect.objectContaining({
      campaignId,
      entryId: character.id,
      expectedRevision: 1,
      data: expect.objectContaining({
        identity: expect.objectContaining({ className: 'Fighter', level: 7 }),
      }),
    })));

    const name = within(sheet).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Aria Stone');
    await user.tab();
    await waitFor(() => expect(renameEntry).toHaveBeenCalledWith({
      campaignId,
      entryId: character.id,
      expectedRevision: 2,
      name: 'Aria Stone',
    }));

    fireEvent(sheet, new Event('cancel', { bubbles: false, cancelable: true }));
    await user.click(await screen.findByRole('button', { name: 'Open Aria Stone' }));
    sheet = screen.getByRole('dialog', { name: 'Aria Stone character sheet' });
    expect(within(sheet).getByRole('textbox', { name: 'Name' })).toHaveValue('Aria Stone');
    expect(within(sheet).getByRole('button', { name: 'Class' })).toHaveTextContent('Fighter');
    expect(within(sheet).getByRole('button', { name: 'Level' })).toHaveTextContent('7');
  });

  it('edits calculated totals as durable offsets and propagates their effective values', async () => {
    const user = userEvent.setup();
    let server = structuredClone(character);
    const updateEntryData = vi.fn(async (
      input: Parameters<JournalApi['updateEntryData']>[0],
    ): Promise<JournalResult<typeof server>> => {
      server = {
        ...server,
        data: input.data as Dnd5eCharacterData,
        revision: server.revision + 1,
      };
      return { ok: true, value: server };
    });
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({
          getEntry: async () => ({ ok: true, value: server }),
          list: async () => ({
            ok: true,
            value: { entries: [server], revision: 0 },
          }),
          updateEntryData,
        })}
        role="gm"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Characters' }));
    await user.click(await screen.findByRole('button', { name: 'Open New Character' }));
    const sheet = screen.getByRole('dialog', { name: 'New Character character sheet' });
    await user.click(within(sheet).getByRole('button', { name: 'Class' }));
    await user.click(within(sheet).getByRole('button', { name: 'Fighter' }));
    await user.click(within(sheet).getByRole('button', { name: 'Level' }));
    await user.click(within(sheet).getByRole('button', { name: '5' }));

    const strengthScore = within(sheet).getByRole('textbox', { name: 'Strength score' });
    const strengthModifier = within(sheet).getByRole('textbox', { name: 'Strength modifier' });
    const strengthSave = within(sheet).getByRole('textbox', { name: 'Strength saving throw' });
    const athletics = within(sheet).getByLabelText('Athletics bonus and passive score');
    await user.clear(strengthScore);
    await user.type(strengthScore, '12');
    await user.tab();
    await waitFor(() => {
      expect(strengthModifier).toHaveValue('+1');
      expect(strengthSave).toHaveValue('+4');
      expect(athletics).toHaveTextContent('+1 / 11');
    });

    await user.clear(strengthModifier);
    await user.type(strengthModifier, '+3');
    await user.tab();
    await waitFor(() => {
      expect(server.data.abilities.strength.modifierOffset).toBe(2);
      expect(strengthSave).toHaveValue('+6');
      expect(athletics).toHaveTextContent('+3 / 13');
    });
    await user.click(within(sheet).getByRole('button', {
      name: 'Athletics training: Untrained',
    }));
    await waitFor(() => expect(athletics).toHaveTextContent('+6 / 16'));

    await user.clear(strengthScore);
    await user.type(strengthScore, '14');
    await user.tab();
    await waitFor(() => {
      expect(strengthModifier).toHaveValue('+4');
      expect(strengthSave).toHaveValue('+7');
      expect(athletics).toHaveTextContent('+7 / 17');
    });
    await user.clear(strengthModifier);
    await user.tab();
    await waitFor(() => {
      expect(server.data.abilities.strength.modifierOffset).toBe(0);
      expect(strengthModifier).toHaveValue('+2');
      expect(strengthSave).toHaveValue('+5');
      expect(athletics).toHaveTextContent('+5 / 15');
    });

    await user.clear(strengthModifier);
    await user.type(strengthModifier, 'invalid');
    await user.tab();
    expect(strengthModifier).toHaveValue('+2');

    const proficiency = within(sheet).getByRole('textbox', { name: 'Proficiency Bonus' });
    await user.clear(proficiency);
    await user.type(proficiency, '+4');
    await user.tab();
    await waitFor(() => {
      expect(server.data.importantStats.proficiencyBonusOffset).toBe(1);
      expect(strengthSave).toHaveValue('+6');
      expect(athletics).toHaveTextContent('+6 / 16');
    });
    await user.click(within(sheet).getByRole('button', { name: 'Level' }));
    await user.click(within(sheet).getByRole('button', { name: '9' }));
    await waitFor(() => {
      expect(proficiency).toHaveValue('+5');
      expect(strengthSave).toHaveValue('+7');
      expect(athletics).toHaveTextContent('+7 / 17');
    });

    const constitutionSave = within(sheet).getByRole('textbox', {
      name: 'Constitution saving throw',
    });
    const concentration = within(sheet).getByRole('textbox', { name: 'Concentration Save' });
    expect(constitutionSave).toHaveValue('+5');
    expect(concentration).toHaveValue('+5');
    await user.clear(constitutionSave);
    await user.type(constitutionSave, '+6');
    await user.tab();
    await waitFor(() => expect(concentration).toHaveValue('+6'));
    await user.clear(concentration);
    await user.type(concentration, '+8');
    await user.tab();
    await waitFor(() => {
      expect(server.data.importantStats.concentrationSaveOffset).toBe(2);
      expect(concentration).toHaveValue('+8');
    });
  });

  it('adds, edits, reorders, and deletes signed Character Resources', async () => {
    const user = userEvent.setup();
    let server = structuredClone(character);
    const updateEntryData = vi.fn(async (
      input: Parameters<JournalApi['updateEntryData']>[0],
    ): Promise<JournalResult<typeof server>> => {
      server = {
        ...server,
        data: input.data as Dnd5eCharacterData,
        revision: server.revision + 1,
      };
      return { ok: true, value: server };
    });
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({
          getEntry: async () => ({ ok: true, value: server }),
          list: async () => ({
            ok: true,
            value: { entries: [server], revision: 0 },
          }),
          updateEntryData,
        })}
        role="gm"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Characters' }));
    await user.click(await screen.findByRole('button', { name: 'Open New Character' }));
    const sheet = screen.getByRole('dialog', { name: 'New Character character sheet' });
    await user.click(within(sheet).getByRole('button', { name: 'Add Resource' }));
    const firstName = within(sheet).getByRole('textbox', { name: 'New Resource name' });
    expect(firstName).toHaveFocus();
    expect(firstName).toHaveValue('New Resource');
    expect((firstName as HTMLInputElement).selectionStart).toBe(0);
    expect((firstName as HTMLInputElement).selectionEnd).toBe('New Resource'.length);
    await waitFor(() => expect(server.data.resources).toHaveLength(1));

    await user.clear(firstName);
    await user.type(firstName, 'Rage');
    await user.tab();
    const current = within(sheet).getByRole('textbox', { name: 'Rage current' });
    const maximum = within(sheet).getByRole('textbox', { name: 'Rage maximum' });
    expect(current).toHaveAttribute('size', '1');
    await user.clear(current);
    await user.type(current, '-2');
    expect(current).toHaveAttribute('size', '2');
    await user.tab();
    await user.clear(maximum);
    await user.type(maximum, '9007199254740992');
    await user.tab();
    expect(maximum).toHaveValue('0');
    await waitFor(() => expect(server.data.resources[0]).toMatchObject({
      current: -2,
      maximum: 0,
      name: 'Rage',
    }));
    await user.clear(current);
    await user.tab();
    await waitFor(() => expect(server.data.resources[0]?.current).toBe(0));
    await user.clear(current);
    await user.type(current, '-2');
    await user.tab();
    await waitFor(() => expect(server.data.resources[0]?.current).toBe(-2));

    await user.click(within(sheet).getByRole('button', { name: 'Add Resource' }));
    const secondName = within(sheet).getByRole('textbox', { name: 'New Resource name' });
    await user.clear(secondName);
    await user.type(secondName, 'Ki');
    await user.tab();
    await waitFor(() => expect(server.data.resources.map(({ name }) => name))
      .toEqual(['Rage', 'Ki']));

    fireEvent.contextMenu(secondName);
    const moveUp = screen.getByRole('menuitem', { name: 'Move Resource Up' });
    expect(moveUp).toBeEnabled();
    await user.click(moveUp);
    await waitFor(() => expect(server.data.resources.map(({ name }) => name))
      .toEqual(['Ki', 'Rage']));

    fireEvent.contextMenu(within(sheet).getByRole('textbox', { name: 'Ki name' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reorder Resource Freely' }));
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(server.data.resources.map(({ name }) => name))
      .toEqual(['Rage', 'Ki']));

    const rageName = within(sheet).getByRole('textbox', { name: 'Rage name' });
    fireEvent.contextMenu(rageName);
    await user.click(screen.getByRole('menuitem', { name: 'Reorder Resource Freely' }));
    const kiName = within(sheet).getByRole('textbox', { name: 'Ki name' });
    const resourceList = within(sheet).getByRole('list', { name: 'Character resources' });
    Object.defineProperty(resourceList, 'scrollBy', {
      configurable: true,
      value: vi.fn(),
    });
    fireEvent(kiName, new MouseEvent('pointermove', {
      bubbles: true,
      clientX: 1,
      clientY: 1,
    }));
    fireEvent(kiName, new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    await waitFor(() => expect(server.data.resources.map(({ name }) => name))
      .toEqual(['Ki', 'Rage']));

    fireEvent.contextMenu(kiName);
    await user.click(screen.getByRole('menuitem', { name: 'Reorder Resource Freely' }));
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(server.data.resources.map(({ name }) => name)).toEqual(['Ki', 'Rage']);

    fireEvent.contextMenu(kiName);
    await user.click(screen.getByRole('menuitem', { name: 'Move Resource Down' }));
    await waitFor(() => expect(server.data.resources.map(({ name }) => name))
      .toEqual(['Rage', 'Ki']));

    fireEvent.contextMenu(kiName);
    await user.click(screen.getByRole('menuitem', { name: 'Delete Resource' }));
    await user.click(screen.getByRole('menuitem', { name: 'Confirm deletion of Ki' }));
    await waitFor(() => expect(server.data.resources.map(({ name }) => name))
      .toEqual(['Rage']));
  });

  it('adds, expands, edits, reorders, collapses, and deletes Character Features', async () => {
    const user = userEvent.setup();
    let server = structuredClone(character);
    const updateEntryData = vi.fn(async (
      input: Parameters<JournalApi['updateEntryData']>[0],
    ): Promise<JournalResult<typeof server>> => {
      server = {
        ...server,
        data: input.data as Dnd5eCharacterData,
        revision: server.revision + 1,
      };
      return { ok: true, value: server };
    });
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({
          getEntry: async () => ({ ok: true, value: server }),
          list: async () => ({
            ok: true,
            value: { entries: [server], revision: 0 },
          }),
          updateEntryData,
        })}
        role="gm"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Characters' }));
    await user.click(await screen.findByRole('button', { name: 'Open New Character' }));
    const sheet = screen.getByRole('dialog', { name: 'New Character character sheet' });
    await user.click(within(sheet).getByRole('button', { name: 'Add Feature' }));
    const firstName = within(sheet).getByRole('textbox', { name: 'New Feature name' });
    expect(firstName).toHaveFocus();
    expect((firstName as HTMLInputElement).selectionStart).toBe(0);
    expect((firstName as HTMLInputElement).selectionEnd).toBe('New Feature'.length);
    expect(within(sheet).getByRole('button', { name: 'New Feature' }))
      .toHaveAttribute('aria-expanded', 'true');
    expect(within(sheet).getByRole('button', { name: 'New Feature type' }))
      .toHaveTextContent('Unknown');

    await user.clear(firstName);
    await user.type(firstName, 'Second Wind');
    await user.tab();
    await user.click(within(sheet).getByRole('button', { name: 'Second Wind type' }));
    await user.click(within(sheet).getByRole('button', { name: 'Trait' }));
    const source = within(sheet).getByRole('textbox', { name: 'Second Wind source' });
    await user.type(source, 'Class');
    await user.tab();
    const sourceType = within(sheet).getByRole('textbox', {
      name: 'Second Wind source type',
    });
    await user.type(sourceType, 'Fighter');
    await user.tab();
    const description = within(sheet).getByRole('textbox', {
      name: 'Second Wind description',
    });
    expect(description).toHaveAttribute('maxlength', '16384');
    expect(description).toHaveAttribute('rows', '4');
    await user.type(description, 'Regain hit points.{Enter}Once per rest.');
    await user.tab();
    await waitFor(() => expect(server.data.features[0]).toMatchObject({
      description: 'Regain hit points.\nOnce per rest.',
      name: 'Second Wind',
      source: 'Class',
      sourceType: 'Fighter',
      type: 'trait',
    }));

    await user.click(within(sheet).getByRole('button', { name: 'Second Wind type' }));
    await user.click(within(sheet).getByRole('button', { name: 'Unknown' }));
    await waitFor(() => expect(server.data.features[0]?.type).toBe('unknown'));

    await user.click(within(sheet).getByRole('button', { name: 'Add Feature' }));
    const secondName = within(sheet).getByRole('textbox', { name: 'New Feature name' });
    await user.clear(secondName);
    await user.type(secondName, 'Darkvision');
    await user.tab();
    await waitFor(() => expect(server.data.features.map(({ name }) => name))
      .toEqual(['Second Wind', 'Darkvision']));
    expect(within(sheet).getByRole('button', { name: 'Second Wind' }))
      .toHaveAttribute('aria-expanded', 'true');
    expect(within(sheet).getByRole('button', { name: 'Darkvision' }))
      .toHaveAttribute('aria-expanded', 'true');

    const darkvisionTrigger = within(sheet).getByRole('button', { name: 'Darkvision' });
    fireEvent.contextMenu(darkvisionTrigger);
    await user.click(screen.getByRole('menuitem', { name: 'Move Feature Up' }));
    await waitFor(() => expect(server.data.features.map(({ name }) => name))
      .toEqual(['Darkvision', 'Second Wind']));

    fireEvent.contextMenu(within(sheet).getByRole('button', { name: 'Darkvision' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reorder Feature Freely' }));
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(server.data.features.map(({ name }) => name))
      .toEqual(['Second Wind', 'Darkvision']));

    const viewport = sheet.querySelector<HTMLElement>('[data-character-sheet-viewport]')!;
    Object.defineProperty(viewport, 'scrollBy', {
      configurable: true,
      value: vi.fn(),
    });
    fireEvent.contextMenu(within(sheet).getByRole('button', { name: 'Second Wind' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reorder Feature Freely' }));
    const darkvisionAfterKeyboard = within(sheet).getByRole('button', {
      name: 'Darkvision',
    });
    fireEvent(darkvisionAfterKeyboard, new MouseEvent('pointermove', {
      bubbles: true,
      clientX: 1,
      clientY: 1,
    }));
    fireEvent(darkvisionAfterKeyboard, new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
    }));
    await waitFor(() => expect(server.data.features.map(({ name }) => name))
      .toEqual(['Darkvision', 'Second Wind']));
    fireEvent.contextMenu(within(sheet).getByRole('button', { name: 'Darkvision' }));
    await user.click(screen.getByRole('menuitem', { name: 'Move Feature Down' }));
    await waitFor(() => expect(server.data.features.map(({ name }) => name))
      .toEqual(['Second Wind', 'Darkvision']));

    fireEvent.contextMenu(within(sheet).getByRole('button', { name: 'Second Wind' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reorder Feature Freely' }));
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(server.data.features.map(({ name }) => name))
      .toEqual(['Second Wind', 'Darkvision']);

    await user.click(within(sheet).getByRole('button', { name: 'Second Wind' }));
    expect(within(sheet).getByRole('button', { name: 'Second Wind' }))
      .toHaveAttribute('aria-expanded', 'false');
    expect(within(sheet).getByRole('button', { name: 'Darkvision' }))
      .toHaveAttribute('aria-expanded', 'true');

    fireEvent.contextMenu(within(sheet).getByRole('button', { name: 'Darkvision' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete Feature' }));
    await user.click(screen.getByRole('menuitem', {
      name: 'Confirm deletion of Darkvision',
    }));
    await waitFor(() => expect(server.data.features.map(({ name }) => name))
      .toEqual(['Second Wind']));
    await user.click(within(sheet).getByRole('button', { name: 'Second Wind' }));
    const remainingName = within(sheet).getByRole('textbox', { name: 'Second Wind name' });
    await user.clear(remainingName);
    await user.tab();
    expect(within(sheet).getByRole('button', { name: 'Unnamed Feature' }))
      .toHaveAttribute('aria-expanded', 'true');
    await user.click(within(sheet).getByRole('button', { name: 'Unnamed Feature' }));
    expect(within(sheet).getByRole('button', { name: 'Unnamed Feature' }))
      .toHaveAttribute('aria-expanded', 'false');
  }, 15_000);

  it('merges dirty Character fields over a newer server revision and retries safely', async () => {
    const user = userEvent.setup();
    let server = structuredClone(character);
    const updateEntryData = vi.fn(async (
      input: Parameters<JournalApi['updateEntryData']>[0],
    ): Promise<JournalResult<typeof server>> => {
      if (updateEntryData.mock.calls.length === 1) {
        const remoteData = structuredClone(server.data);
        remoteData.identity.ancestry = 'Dwarf';
        server = { ...server, data: remoteData, revision: 1 };
        return {
          error: { code: 'conflict', entryId: server.id, message: 'Changed remotely.' },
          ok: false,
        };
      }
      server = {
        ...server,
        data: input.data as typeof server.data,
        revision: server.revision + 1,
      };
      return { ok: true, value: server };
    });
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({
          getEntry: async () => ({ ok: true, value: server }),
          list: async () => ({
            ok: true,
            value: { entries: [server], revision: 0 },
          }),
          updateEntryData,
        })}
        role="gm"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Characters' }));
    await user.click(await screen.findByRole('button', { name: 'Open New Character' }));
    const sheet = screen.getByRole('dialog', { name: 'New Character character sheet' });
    await user.click(within(sheet).getByRole('button', { name: 'Class' }));
    await user.click(within(sheet).getByRole('button', { name: 'Fighter' }));

    await waitFor(() => expect(updateEntryData).toHaveBeenCalledTimes(2));
    expect(updateEntryData).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        identity: expect.objectContaining({ ancestry: 'Dwarf', className: 'Fighter' }),
      }),
      expectedRevision: 1,
    }));
    expect(within(sheet).getByRole('textbox', { name: 'Species' })).toHaveValue('Dwarf');
    expect(within(sheet).getByRole('button', { name: 'Class' })).toHaveTextContent('Fighter');
  });

  it('rebases Resource edits by id without replacing remotely added Resources', async () => {
    const user = userEvent.setup();
    let server = structuredClone(character);
    server.data.resources = [{
      current: 1,
      id: '11111111-1111-4111-8111-111111111111',
      maximum: 2,
      name: 'Local',
    }];
    const updateEntryData = vi.fn(async (
      input: Parameters<JournalApi['updateEntryData']>[0],
    ): Promise<JournalResult<typeof server>> => {
      if (updateEntryData.mock.calls.length === 1) {
        server = {
          ...server,
          data: {
            ...server.data,
            resources: [
              {
                current: 3,
                id: '22222222-2222-4222-8222-222222222222',
                maximum: 4,
                name: 'Remote',
              },
              { ...server.data.resources[0], current: 9 },
            ],
          },
          revision: 1,
        };
        return {
          error: { code: 'conflict', entryId: server.id, message: 'Changed remotely.' },
          ok: false,
        };
      }
      server = {
        ...server,
        data: input.data as Dnd5eCharacterData,
        revision: server.revision + 1,
      };
      return { ok: true, value: server };
    });
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({
          getEntry: async () => ({ ok: true, value: server }),
          list: async () => ({
            ok: true,
            value: { entries: [server], revision: 0 },
          }),
          updateEntryData,
        })}
        role="gm"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Characters' }));
    await user.click(await screen.findByRole('button', { name: 'Open New Character' }));
    const sheet = screen.getByRole('dialog', { name: 'New Character character sheet' });
    const name = within(sheet).getByRole('textbox', { name: 'Local name' });
    await user.clear(name);
    await user.type(name, 'Rebased');
    await user.tab();

    await waitFor(() => expect(updateEntryData).toHaveBeenCalledTimes(2));
    expect(server.data.resources).toEqual([
      {
        current: 3,
        id: '22222222-2222-4222-8222-222222222222',
        maximum: 4,
        name: 'Remote',
      },
      {
        current: 9,
        id: '11111111-1111-4111-8111-111111111111',
        maximum: 2,
        name: 'Rebased',
      },
    ]);
  });

  it('lets remote Resource deletion win over a pending local edit', async () => {
    const user = userEvent.setup();
    let server = structuredClone(character);
    server.data.resources = [{
      current: 1,
      id: '11111111-1111-4111-8111-111111111111',
      maximum: 2,
      name: 'Vanishing',
    }];
    const updateEntryData = vi.fn(async (): Promise<JournalResult<typeof server>> => {
      server = {
        ...server,
        data: { ...server.data, resources: [] },
        revision: 1,
      };
      return {
        error: { code: 'conflict', entryId: server.id, message: 'Deleted remotely.' },
        ok: false,
      };
    });
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({
          getEntry: async () => ({ ok: true, value: server }),
          list: async () => ({
            ok: true,
            value: { entries: [server], revision: 0 },
          }),
          updateEntryData,
        })}
        role="gm"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Characters' }));
    await user.click(await screen.findByRole('button', { name: 'Open New Character' }));
    const sheet = screen.getByRole('dialog', { name: 'New Character character sheet' });
    const current = within(sheet).getByRole('textbox', { name: 'Vanishing current' });
    await user.clear(current);
    await user.type(current, '8');
    await user.tab();

    const error = await screen.findByRole('dialog', { name: 'Character sheet error' });
    expect(within(error).getByRole('alert')).toHaveTextContent(
      'A Resource was deleted remotely, so its pending local edit was discarded.',
    );
    expect(within(sheet).queryByRole('textbox', { name: 'Vanishing current' }))
      .not.toBeInTheDocument();
    expect(updateEntryData).toHaveBeenCalledTimes(1);
  });

  it('rebases Feature edits by id without replacing remotely added Features', async () => {
    const user = userEvent.setup();
    let server = structuredClone(character);
    server.data.features = [{
      description: '',
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Local',
      source: '',
      sourceType: '',
      type: 'unknown',
    }];
    const updateEntryData = vi.fn(async (
      input: Parameters<JournalApi['updateEntryData']>[0],
    ): Promise<JournalResult<typeof server>> => {
      if (updateEntryData.mock.calls.length === 1) {
        server = {
          ...server,
          data: {
            ...server.data,
            features: [
              {
                description: 'Remote addition',
                id: '22222222-2222-4222-8222-222222222222',
                name: 'Remote',
                source: '',
                sourceType: '',
                type: 'feature',
              },
              { ...server.data.features[0], source: 'Remote source' },
            ],
          },
          revision: 1,
        };
        return {
          error: { code: 'conflict', entryId: server.id, message: 'Changed remotely.' },
          ok: false,
        };
      }
      server = {
        ...server,
        data: input.data as Dnd5eCharacterData,
        revision: server.revision + 1,
      };
      return { ok: true, value: server };
    });
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({
          getEntry: async () => ({ ok: true, value: server }),
          list: async () => ({
            ok: true,
            value: { entries: [server], revision: 0 },
          }),
          updateEntryData,
        })}
        role="gm"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Characters' }));
    await user.click(await screen.findByRole('button', { name: 'Open New Character' }));
    const sheet = screen.getByRole('dialog', { name: 'New Character character sheet' });
    await user.click(within(sheet).getByRole('button', { name: 'Local' }));
    const name = within(sheet).getByRole('textbox', { name: 'Local name' });
    await user.clear(name);
    await user.type(name, 'Rebased');
    await user.tab();

    await waitFor(() => expect(updateEntryData).toHaveBeenCalledTimes(2));
    expect(server.data.features).toEqual([
      {
        description: 'Remote addition',
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Remote',
        source: '',
        sourceType: '',
        type: 'feature',
      },
      {
        description: '',
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Rebased',
        source: 'Remote source',
        sourceType: '',
        type: 'unknown',
      },
    ]);
  });

  it('lets remote Feature deletion win over a pending local edit', async () => {
    const user = userEvent.setup();
    let server = structuredClone(character);
    server.data.features = [{
      description: '',
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Vanishing Feature',
      source: '',
      sourceType: '',
      type: 'unknown',
    }];
    const updateEntryData = vi.fn(async (): Promise<JournalResult<typeof server>> => {
      server = {
        ...server,
        data: { ...server.data, features: [] },
        revision: 1,
      };
      return {
        error: { code: 'conflict', entryId: server.id, message: 'Deleted remotely.' },
        ok: false,
      };
    });
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({
          getEntry: async () => ({ ok: true, value: server }),
          list: async () => ({
            ok: true,
            value: { entries: [server], revision: 0 },
          }),
          updateEntryData,
        })}
        role="gm"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Characters' }));
    await user.click(await screen.findByRole('button', { name: 'Open New Character' }));
    const sheet = screen.getByRole('dialog', { name: 'New Character character sheet' });
    await user.click(within(sheet).getByRole('button', { name: 'Vanishing Feature' }));
    const source = within(sheet).getByRole('textbox', { name: 'Vanishing Feature source' });
    await user.type(source, 'Local change');
    await user.tab();

    const error = await screen.findByRole('dialog', { name: 'Character sheet error' });
    expect(within(error).getByRole('alert')).toHaveTextContent(
      'A Feature was deleted remotely, so its pending local edit was discarded.',
    );
    expect(within(sheet).queryByRole('button', { name: 'Vanishing Feature' }))
      .not.toBeInTheDocument();
    expect(updateEntryData).toHaveBeenCalledTimes(1);
  });

  it('keeps a dirty Character sheet open when close-time saving fails and retries', async () => {
    const user = userEvent.setup();
    let server = structuredClone(character);
    const updateEntryData = vi.fn(async (
      input: Parameters<JournalApi['updateEntryData']>[0],
    ): Promise<JournalResult<typeof server>> => {
      if (updateEntryData.mock.calls.length === 1) {
        return { error: { code: 'storage_error', message: 'Save failed.' }, ok: false };
      }
      server = {
        ...server,
        data: input.data as typeof server.data,
        revision: server.revision + 1,
      };
      return { ok: true, value: server };
    });
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({
          getEntry: async () => ({ ok: true, value: server }),
          list: async () => ({
            ok: true,
            value: { entries: [server], revision: 0 },
          }),
          updateEntryData,
        })}
        role="gm"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Characters' }));
    await user.click(await screen.findByRole('button', { name: 'Open New Character' }));
    const sheet = screen.getByRole('dialog', { name: 'New Character character sheet' });
    await user.type(within(sheet).getByRole('textbox', { name: 'Subclass' }), 'Champion');
    fireEvent(sheet, new Event('cancel', { bubbles: false, cancelable: true }));

    const error = await screen.findByRole('dialog', { name: 'Character sheet error' });
    expect(sheet).toBeInTheDocument();
    expect(within(error).getByRole('button', { name: 'Discard changes' })).toBeVisible();
    await user.click(within(error).getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(sheet).not.toBeInTheDocument());
    expect(updateEntryData).toHaveBeenCalledTimes(2);
  });

  it('presents a view-only Character sheet without editable fields', async () => {
    const user = userEvent.setup();
    const readOnlyCharacter = {
      ...structuredClone(character),
      capabilities: {
        delete: false,
        edit: false,
        managePages: false,
        managePermissions: false,
        reorder: false,
        view: true,
      },
      data: {
        ...structuredClone(character.data),
        features: [{
          description: 'See in darkness.',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Darkvision',
          source: 'Species',
          sourceType: 'Dwarf',
          type: 'trait' as const,
        }],
        resources: [{
          current: -1,
          id: '99999999-9999-4999-8999-999999999999',
          maximum: 3,
          name: 'Luck',
        }],
      },
      permissions: null,
    };
    const renameEntry = vi.fn();
    const updateEntryData = vi.fn();
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({
          getEntry: async () => ({ ok: true, value: readOnlyCharacter }),
          list: async () => ({
            ok: true,
            value: {
              entries: [readOnlyCharacter],
              revision: 0,
            },
          }),
          renameEntry,
          updateEntryData,
        })}
        role="player"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Characters' }));
    await user.click(await screen.findByRole('button', { name: 'Open New Character' }));
    const sheet = screen.getByRole('dialog', { name: 'New Character character sheet' });
    expect(within(sheet).getByRole('textbox', { name: 'Name' })).toHaveAttribute('readonly');
    expect(within(sheet).getByRole('button', { name: 'Class' }))
      .toHaveAttribute('aria-disabled', 'true');
    expect(within(sheet).getByRole('button', { name: 'Level' }))
      .toHaveAttribute('aria-disabled', 'true');
    expect(within(sheet).getByRole('textbox', { name: 'Strength score' })).toHaveAttribute('readonly');
    expect(within(sheet).getByRole('textbox', { name: 'Initiative' })).toHaveAttribute('readonly');
    for (const label of [
      'Current hit points',
      'Maximum hit points',
      'Temporary hit points',
      'Current hit dice',
      'Maximum hit dice',
      'Hit die',
    ]) {
      expect(within(sheet).getByRole('textbox', { name: label })).toHaveAttribute('readonly');
    }
    for (const control of within(sheet).getAllByRole('button', { name: /^(Success|Failure) \d$/u })) {
      expect(control).toBeDisabled();
    }
    const skillTrainingControls = within(sheet).getAllByRole('button', { name: /training:/u });
    expect(skillTrainingControls).toHaveLength(18);
    for (const control of skillTrainingControls) expect(control).toBeDisabled();
    for (const name of [
      'Add Custom Skill',
      'Add Action',
      'Add Inventory Item',
      'Add Resource',
      'Add Feature',
    ]) {
      expect(within(sheet).getByRole('button', { name })).toBeDisabled();
    }
    const resourceName = within(sheet).getByRole('textbox', { name: 'Luck name' });
    expect(resourceName).toHaveAttribute('readonly');
    expect(within(sheet).getByRole('textbox', { name: 'Luck current' }))
      .toHaveAttribute('readonly');
    expect(within(sheet).getByRole('textbox', { name: 'Luck maximum' }))
      .toHaveAttribute('readonly');
    fireEvent.contextMenu(resourceName);
    expect(screen.queryByRole('menu', { name: 'Luck actions' })).not.toBeInTheDocument();
    const featureTrigger = within(sheet).getByRole('button', { name: 'Darkvision' });
    expect(featureTrigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(featureTrigger);
    expect(within(sheet).getByRole('textbox', { name: 'Darkvision name' }))
      .toHaveAttribute('readonly');
    expect(within(sheet).getByRole('textbox', { name: 'Darkvision source' }))
      .toHaveAttribute('readonly');
    expect(within(sheet).getByRole('textbox', { name: 'Darkvision source type' }))
      .toHaveAttribute('readonly');
    expect(within(sheet).getByRole('textbox', { name: 'Darkvision description' }))
      .toHaveAttribute('readonly');
    expect(within(sheet).getByRole('button', { name: 'Darkvision type' }))
      .toHaveAttribute('aria-disabled', 'true');
    fireEvent.contextMenu(featureTrigger);
    expect(screen.queryByRole('menu', { name: 'Darkvision actions' }))
      .not.toBeInTheDocument();
    expect(within(sheet).getByLabelText('Acrobatics bonus and passive score'))
      .toHaveTextContent('0 / 10');
    expect(renameEntry).not.toHaveBeenCalled();
    expect(updateEntryData).not.toHaveBeenCalled();
  });

  it('opens a character from its icon, renames it inline, and edits permissions', async () => {
    const user = userEvent.setup();
    const playerId = '88888888-8888-4888-8888-888888888888';
    const renameEntry = vi.fn(async (
      input: Parameters<JournalApi['renameEntry']>[0],
    ) => ({
      ok: true as const,
      value: {
        ...character,
        name: input.name.trim(),
        revision: character.revision + 1,
      },
    }));
    const updateEntryPermissions = vi.fn(async (
      input: Parameters<JournalApi['updateEntryPermissions']>[0],
    ) => ({
      ok: true as const,
      value: {
        ...character,
        name: 'Aria Stone',
        permissions: input.permissions,
        revision: input.expectedRevision + 1,
      },
    }));
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({
          getEntry: async () => ({ ok: true, value: character }),
          list: async () => ({
            ok: true,
            value: {
              entries: [character],
              revision: 0,
            },
          }),
          listUsers: async () => ({
            ok: true,
            value: [{ id: playerId, username: 'Chris' }],
          }),
          renameEntry,
          updateEntryPermissions,
        })}
        role="gm"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Characters' }));
    const characterRow = await screen.findByRole('button', { name: 'Open New Character' });
    expect(screen.getByRole('button', { name: 'Delete New Character' })).toBeVisible();
    expect(screen.getByText('Character Sheet')).toBeVisible();
    expect(screen.queryByText(/pages?/)).not.toBeInTheDocument();

    await user.click(characterRow);
    const sheet = screen.getByRole('dialog', { name: 'New Character character sheet' });
    fireEvent(sheet, new Event('cancel', { bubbles: false, cancelable: true }));

    const name = screen.getByRole('textbox', { name: 'Name for New Character' });
    await user.clear(name);
    await user.type(name, 'Aria Stone{Enter}');
    await waitFor(() => expect(renameEntry).toHaveBeenCalledWith({
      campaignId,
      entryId: character.id,
      expectedRevision: character.revision,
      name: 'Aria Stone',
    }));
    const renamedCharacter = await screen.findByRole('button', { name: 'Open Aria Stone' });

    fireEvent.contextMenu(renamedCharacter);
    expect(screen.queryByRole('menuitem', { name: 'Rename Character' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete Character' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Edit Permissions' }));

    const permissions = screen.getByRole('dialog', {
      name: 'Edit permissions for Aria Stone',
    });
    expect(within(permissions).getByRole('columnheader', { name: 'Effective' })).toBeVisible();
    await user.selectOptions(
      within(permissions).getByRole('combobox', { name: 'Chris permission' }),
      'edit',
    );
    expect(within(permissions).getByRole('cell', { name: 'Edit' })).toBeVisible();
    await user.click(within(permissions).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateEntryPermissions).toHaveBeenCalledWith({
      campaignId,
      entryId: character.id,
      expectedRevision: character.revision + 1,
      permissions: {
        allPlayers: 'none',
        overrides: [{ access: 'edit', userId: playerId }],
      },
    }));
  });

  it('renames a Note inline with its page count in the metadata line', async () => {
    const user = userEvent.setup();
    const renameEntry = vi.fn(async (
      input: Parameters<JournalApi['renameEntry']>[0],
    ) => ({
      ok: true as const,
      value: {
        ...note,
        name: input.name.trim(),
        revision: note.revision + 1,
      },
    }));
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({ renameEntry })}
        role="gm"
      />,
    );

    await expandNotes(user);
    const name = await screen.findByRole('textbox', {
      name: 'Name for Gathered Magic Items',
    });
    expect(screen.getByText('1 page')).toBeVisible();

    await user.clear(name);
    await user.type(name, 'Unsaved name{Escape}');
    expect(name).toHaveValue('Gathered Magic Items');
    expect(renameEntry).not.toHaveBeenCalled();

    await user.clear(name);
    await user.type(name, 'Field Notes{Enter}');
    await waitFor(() => expect(renameEntry).toHaveBeenCalledWith({
      campaignId,
      entryId: note.id,
      expectedRevision: note.revision,
      name: 'Field Notes',
    }));
    expect(await screen.findByRole('textbox', {
      name: 'Name for Field Notes',
    })).toHaveValue('Field Notes');
  });

  it('searches page titles and opens the matching page in the inline note editor', async () => {
    const user = userEvent.setup();
    render(<JournalPanel assetApi={createFakeAssetApi()} campaignId={campaignId} journalApi={journalApi()} role="gm" />);
    const search = await screen.findByRole('searchbox', { name: 'Search journal' });
    await user.type(search, 'Babylon');
    await user.click(screen.getByRole('button', { name: 'Open Gathered Magic Items' }));
    expect(await screen.findByRole('button', {
      name: 'Open Tomb of Babylon',
    })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Page title' })).not.toBeInTheDocument();
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

  it('renames a page inline and opens it from its document icon', async () => {
    const user = userEvent.setup();
    const secondPage: JournalPage = {
      ...page,
      id: '66666666-6666-4666-8666-666666666666',
      position: 1,
      title: 'Arcane Annex',
    };
    let currentNote: NoteEntry = {
      ...note,
      pages: [page, secondPage],
    };
    const pages = new Map([
      [page.id, page],
      [secondPage.id, secondPage],
    ]);
    let leaseSequence = 0;
    const acquireLease = vi.fn(async (
      input: Parameters<JournalApi['acquireLease']>[0],
    ) => ({
      ok: true as const,
      value: {
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        holderName: 'Game Master',
        leaseId: `44444444-4444-4444-8444-${String(++leaseSequence).padStart(12, '0')}`,
        page: pages.get(input.pageId)!,
      },
    }));
    const releaseLease = vi.fn(async () => ({ ok: true as const, value: null }));
    const updatePage = vi.fn(async (
      input: Parameters<JournalApi['updatePage']>[0],
    ) => {
      const updatedPage = {
        ...pages.get(input.pageId)!,
        content: input.content,
        revision: pages.get(input.pageId)!.revision + 1,
        title: input.title,
        titleStyle: input.titleStyle,
      };
      pages.set(updatedPage.id, updatedPage);
      currentNote = {
        ...currentNote,
        pages: currentNote.pages.map((summary) =>
          summary.id === updatedPage.id ? updatedPage : summary,
        ),
        revision: currentNote.revision + 1,
      };
      return { ok: true as const, value: updatedPage };
    });
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({
          acquireLease,
          getNote: async () => ({ ok: true, value: currentNote }),
          list: async () => ({
            ok: true,
            value: { entries: [currentNote], revision: 0 },
          }),
          releaseLease,
          updatePage,
        })}
        role="gm"
      />,
    );

    await expandNotes(user);
    await user.click(
      await screen.findByRole('button', { name: 'Open Gathered Magic Items' }),
    );
    const firstTitle = await screen.findByRole('textbox', {
      name: 'Name for Tomb of Babylon',
    });
    const firstRow = firstTitle.closest('li')!;
    const firstIcon = within(firstRow).getByRole('button', {
      name: 'Open Tomb of Babylon',
    });
    expect(firstIcon.querySelector('.lucide-file-text')).toBeInTheDocument();
    expect(within(firstTitle.parentElement!).getByText('Inherits')).toBeVisible();

    const secondTitle = screen.getByRole('textbox', {
      name: 'Name for Arcane Annex',
    });
    await user.clear(secondTitle);
    await user.type(secondTitle, 'Vault Index{Enter}');

    await waitFor(() => expect(updatePage).toHaveBeenCalledWith(expect.objectContaining({
      content: secondPage.content,
      entryId: note.id,
      expectedRevision: secondPage.revision,
      pageId: secondPage.id,
      title: 'Vault Index',
      titleStyle: secondPage.titleStyle,
    })));
    expect(releaseLease).toHaveBeenCalledWith(expect.objectContaining({
      entryId: note.id,
      pageId: secondPage.id,
    }));

    const renamedTitle = await screen.findByRole('textbox', {
      name: 'Name for Vault Index',
    });
    const renamedIcon = within(renamedTitle.closest('li')!).getByRole('button', {
      name: 'Open Vault Index',
    });
    await user.click(renamedIcon);

    await waitFor(() => expect(renamedIcon).toHaveAttribute('aria-current', 'page'));
    await waitFor(() => expect(renamedTitle).toBeEnabled());
    expect(acquireLease).toHaveBeenCalledWith({
      campaignId,
      entryId: note.id,
      pageId: secondPage.id,
    });

    await user.clear(renamedTitle);
    await user.type(renamedTitle, 'Vault Ledger{Enter}');

    await waitFor(() => expect(updatePage).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('textbox', { name: 'Name for Vault Ledger' }))
      .toHaveValue('Vault Ledger');
  });

  it('deletes a page from its row and disables deletion for the last page', async () => {
    const user = userEvent.setup();
    const firstPage: JournalPage = {
      ...page,
      capabilities: { ...page.capabilities, delete: true },
    };
    const secondPage: JournalPage = {
      ...firstPage,
      id: '66666666-6666-4666-8666-666666666666',
      position: 1,
      title: 'Arcane Annex',
    };
    let currentNote: NoteEntry = {
      ...note,
      pages: [firstPage, secondPage],
    };
    const prepareDelete = vi.fn(async (
      input: Parameters<JournalApi['prepareDelete']>[0],
    ): ReturnType<JournalApi['prepareDelete']> => ({
      ok: true,
      value: { assets: [], target: input.target },
    }));
    const deleteTarget = vi.fn(async (
      input: Parameters<JournalApi['deleteTarget']>[0],
    ) => {
      if (input.target.kind === 'page') {
        const deletedPageId = input.target.pageId;
        currentNote = {
          ...currentNote,
          pages: currentNote.pages.filter(({ id }) => id !== deletedPageId),
          revision: currentNote.revision + 1,
        };
      }
      return { ok: true as const, value: { cleanupFailures: [] } };
    });
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({
          acquireLease: async () => ({
            ok: true,
            value: {
              expiresAt: new Date(Date.now() + 30_000).toISOString(),
              holderName: 'Game Master',
              leaseId: '44444444-4444-4444-8444-444444444444',
              page: firstPage,
            },
          }),
          deleteTarget,
          getNote: async () => ({ ok: true, value: currentNote }),
          list: async () => ({
            ok: true,
            value: { entries: [currentNote], revision: 0 },
          }),
          prepareDelete,
        })}
        role="gm"
      />,
    );

    await expandNotes(user);
    await user.click(
      await screen.findByRole('button', { name: 'Open Gathered Magic Items' }),
    );
    expect(screen.getByRole('button', { name: 'Delete Tomb of Babylon' }))
      .toBeEnabled();
    const deleteSecondPage = screen.getByRole('button', {
      name: 'Delete Arcane Annex',
    });
    expect(deleteSecondPage).toBeEnabled();

    await user.click(deleteSecondPage);

    const confirmDelete = screen.getByRole('button', {
      name: 'Confirm deletion of Arcane Annex',
    });
    expect(confirmDelete).toHaveAttribute('aria-pressed', 'true');
    expect(prepareDelete).not.toHaveBeenCalled();
    await user.click(confirmDelete);

    await waitFor(() => expect(deleteTarget).toHaveBeenCalledWith({
      campaignId,
      cleanupAssetIds: [],
      expectedRevision: secondPage.revision,
      target: {
        entryId: note.id,
        kind: 'page',
        pageId: secondPage.id,
      },
    }));
    expect(screen.queryByRole('textbox', { name: 'Name for Arcane Annex' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Tomb of Babylon' }))
      .toBeDisabled();
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
    await expandNotes(user);
    await user.click(await screen.findByRole('button', { name: 'Open Gathered Magic Items' }));
    const editableNoteName = await screen.findByRole('textbox', { name: 'Note name' });
    const editableToolbar = screen.getByRole('toolbar', {
      name: 'Rich text formatting toolbar',
    });
    const editableToolbarLabels = within(editableToolbar)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    const noteNameClass = editableNoteName.className;
    expect(screen.queryByRole('textbox', { name: 'Page title' })).not.toBeInTheDocument();
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
    const readOnlyNote: NoteEntry = {
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
            },
          }),
        })}
        role="player"
      />,
    );
    await expandNotes(user);
    await user.click(await screen.findByRole('button', { name: 'Open Gathered Magic Items' }));

    const readOnlyNoteName = await screen.findByRole('textbox', { name: 'Note name' });
    const readOnlyToolbar = screen.getByRole('toolbar', {
      name: 'Rich text formatting toolbar',
    });
    expect(readOnlyNoteName).toHaveAttribute('readonly');
    expect(readOnlyNoteName.className).toBe(noteNameClass);
    expect(screen.queryByRole('textbox', { name: 'Page title' })).not.toBeInTheDocument();
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

    await expandNotes(userEvent.setup());
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Gathered Magic Items' }),
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

    await expandNotes(user);
    await user.click(
      await screen.findByRole('button', { name: 'Open Gathered Magic Items' }),
    );
    await user.click(screen.getByRole('button', { name: 'Insert' }));
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

  it('formats the note title through the shared toolbar', async () => {
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
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({ updateNote })}
        role="gm"
      />,
    );

    await expandNotes(user);
    await user.click(await screen.findByRole('button', { name: 'Open Gathered Magic Items' }));
    const noteName = screen.getByRole('textbox', { name: 'Note name' });
    await user.click(noteName);
    await user.click(screen.getByRole('button', { name: 'Style: Title' }));
    await user.click(screen.getByRole('button', { name: 'Italic' }));
    await user.click(screen.getByRole('button', { name: 'Font Family: Default' }));
    await user.click(screen.getByRole('button', { name: 'Lora' }));

    expect(noteName).toHaveStyle({ fontFamily: '"Lora Variable"', fontStyle: 'italic' });
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redo' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Highlight color')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Text Color: Default' })).toBeVisible();
    await waitFor(() => expect(updateNote).toHaveBeenCalled(), { timeout: 2_000 });
    expect(updateNote.mock.calls.at(-1)?.[0].nameStyle).toMatchObject({
      fontFamily: 'lora',
      italic: true,
    });
    expect(screen.queryByRole('textbox', { name: 'Page title' })).not.toBeInTheDocument();
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

    await expandNotes(user);
    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Open Gathered Magic Items' }));
    expect(screen.getByRole('button', { name: 'Delete Gathered Magic Items' })).toBeVisible();
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
    let currentNote: NoteEntry = {
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
            },
          }),
          updatePagePermissions,
        })}
        role="gm"
      />,
    );
    await expandNotes(user);
    await user.click(await screen.findByRole('button', { name: 'Open Gathered Magic Items' }));
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

  it('places note actions above page search and directly deletes an unreferenced note after priming', async () => {
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
    await expandNotes(user);
    await user.click(await screen.findByRole('button', { name: 'Open Gathered Magic Items' }));

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

    expect(deleteNote).toHaveAttribute('aria-pressed', 'false');
    await user.click(deleteNote);
    expect(deleteNote).toHaveAttribute('aria-pressed', 'true');
    expect(deleteNote).toHaveTextContent('Confirm Delete');
    expect(prepareDelete).not.toHaveBeenCalled();

    await user.click(deleteNote);
    expect(prepareDelete).toHaveBeenCalledWith({
      campaignId,
      target: { entryId: note.id, kind: 'note' },
    });
    await waitFor(() => expect(deleteTarget).toHaveBeenCalledWith({
      campaignId,
      cleanupAssetIds: [],
      expectedRevision: note.revision,
      target: { entryId: note.id, kind: 'note' },
    }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

    await expandNotes(user);
    const deleteAction = await screen.findByRole('button', {
      name: 'Delete Gathered Magic Items',
    });
    expect(deleteAction).toHaveAttribute('aria-pressed', 'false');
    await user.click(deleteAction);

    expect(deleteAction).toHaveAccessibleName('Confirm deletion of Gathered Magic Items');
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

  it('opens the top note cleanup modal only when embedded images need a choice', async () => {
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

    await expandNotes(user);
    await user.click(
      await screen.findByRole('button', { name: 'Open Gathered Magic Items' }),
    );
    const deleteAction = await screen.findByRole('button', { name: 'Delete Note' });
    await user.click(deleteAction);
    await user.click(deleteAction);

    expect(
      await screen.findByRole('dialog', {
        name: 'Delete note with embedded images?',
      }),
    ).toBeVisible();
    expect(screen.getByText('treasure-map.png')).toBeVisible();
    expect(deleteTarget).not.toHaveBeenCalled();

    const cleanupCheckbox = screen.getByRole('checkbox', {
      name: 'treasure-map.png',
    });
    await user.click(cleanupCheckbox);

    expect(cleanupCheckbox).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Delete and clean up' }));

    await waitFor(() =>
      expect(deleteTarget).toHaveBeenCalledWith({
        campaignId,
        cleanupAssetIds: ['55555555-5555-4555-8555-555555555555'],
        expectedRevision: note.revision,
        target: { entryId: note.id, kind: 'note' },
      }),
    );
  });

  it('keeps close-time save recovery in the Journal error dialog', async () => {
    const user = userEvent.setup();
    let currentNote = structuredClone(note);
    const updateNote = vi.fn(async (
      input: Parameters<JournalApi['updateNote']>[0],
    ): Promise<JournalResult<NoteEntry>> => {
      if (updateNote.mock.calls.length === 1) {
        return {
          error: { code: 'storage_error', message: 'Save failed.' },
          ok: false,
        };
      }
      currentNote = {
        ...currentNote,
        name: input.name,
        nameStyle: input.nameStyle,
        revision: currentNote.revision + 1,
      };
      return { ok: true, value: currentNote };
    });
    render(
      <JournalPanel
        assetApi={createFakeAssetApi()}
        campaignId={campaignId}
        journalApi={journalApi({ updateNote })}
        role="gm"
      />,
    );

    await expandNotes(user);
    await user.click(
      await screen.findByRole('button', { name: 'Open Gathered Magic Items' }),
    );
    const noteDialog = screen.getByRole('dialog', { name: 'Gathered Magic Items' });
    fireEvent.change(within(noteDialog).getByRole('textbox', { name: 'Note name' }), {
      target: { value: 'Retitled Note' },
    });
    fireEvent(
      noteDialog,
      new Event('cancel', { bubbles: false, cancelable: true }),
    );

    const errorDialog = await screen.findByRole('dialog', { name: 'Journal error' });
    expect(noteDialog).toBeInTheDocument();
    expect(within(errorDialog).getByRole('alert')).toHaveTextContent('Save failed.');
    const retrySave = await within(errorDialog).findByRole('button', {
      name: 'Retry save',
    });
    expect(within(errorDialog).getByRole('button', { name: 'Discard changes' }))
      .toBeVisible();

    await user.click(retrySave);

    await waitFor(() => expect(noteDialog).not.toBeInTheDocument());
    expect(updateNote).toHaveBeenCalledTimes(2);
  });

  it('keeps a name draft when an older change refresh finishes without a save-status bar', async () => {
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

    await expandNotes(user);
    await user.click(
      await screen.findByRole('button', { name: 'Open Gathered Magic Items' }),
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
    const noteDialog = screen.getByRole('dialog', { name: 'Gathered Magic Items' });
    expect(within(noteDialog).queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(within(noteDialog).queryByText('Saved', { exact: true })).not.toBeInTheDocument();
  });

  it('prevents players from creating parent notes', async () => {
    render(<JournalPanel assetApi={createFakeAssetApi()} campaignId={campaignId} journalApi={journalApi()} role="player" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add journal entry' })).toBeDisabled());
  });
});
