import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { NetworkApi } from '../../../shared/network';
import {
  applyDnd5eCharacterActionMutations,
  createDefaultDnd5eActionStep,
  createDefaultDnd5eCharacterAction,
  createDefaultDnd5eCharacterData,
  deriveDnd5eCharacterValues,
  type Dnd5eCharacterAction,
  type Dnd5eCharacterActionMutation,
} from '../../../systems/dnd5e/characterData';
import { CharacterActionPanel } from '../../../systems/dnd5e/renderer/CharacterActionPanel';
import { createMockNetworkApi } from '../../support/networkApi';

function completeAction(index = 1): Dnd5eCharacterAction {
  const action = createDefaultDnd5eCharacterAction(
    `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  );
  action.name = `Action ${index}`;
  action.description = `Description ${index}`;
  action.activation = 'Action';
  action.steps = [createDefaultDnd5eActionStep(
    'roll',
    `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  )];
  return action;
}

function Harness({
  canEdit = true,
  initialActions,
  networkApi,
}: {
  canEdit?: boolean;
  initialActions: Dnd5eCharacterAction[];
  networkApi: NetworkApi;
}) {
  const [data, setData] = useState(() => ({
    ...createDefaultDnd5eCharacterData(),
    actions: initialActions,
  }));
  const [error, setError] = useState<string | null>(null);
  const derived = useMemo(() => deriveDnd5eCharacterValues(data, '5.5e')!, [data]);
  const apply = (mutation: Dnd5eCharacterActionMutation) => {
    setData((current) => ({
      ...current,
      actions: applyDnd5eCharacterActionMutations(current.actions, [mutation]).actions,
    }));
    return true;
  };
  return (
    <>
      <CharacterActionPanel
        actions={data.actions}
        campaignId="campaign-one"
        canEdit={canEdit}
        data={data}
        derived={derived}
        networkApi={networkApi}
        onChange={apply}
        onCommit={async (mutation) => apply(mutation)}
        onError={setError}
        onSave={async () => true}
      />
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}

describe('CharacterActionPanel', () => {
  it('submits one roll from the name while Details only inspects it', async () => {
    const sendChatRoll = vi.fn(async () => ({
      error: { code: 'unavailable' as const, message: 'Host unavailable.' },
      ok: false as const,
    }));
    const networkApi = createMockNetworkApi({ sendChatRoll });
    render(<Harness initialActions={[completeAction()]} networkApi={networkApi} />);

    const actionRow = screen.getByRole('button', { name: 'Use Action 1' })
      .closest<HTMLElement>('[role="listitem"]')!;
    expect(within(actionRow).getAllByRole('button')).toHaveLength(1);
    expect(actionRow).not.toHaveTextContent('1d20');
    fireEvent.contextMenu(actionRow);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Details' }));
    const details = screen.getByRole('dialog', { name: 'Action 1 action details' });
    expect(details).toBeInTheDocument();
    expect(screen.getByText('Description 1')).toBeInTheDocument();
    expect(within(details).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    expect(sendChatRoll).not.toHaveBeenCalled();
    fireEvent.mouseDown(details);
    fireEvent.click(details);

    fireEvent.click(screen.getByRole('button', { name: 'Use Action 1' }));
    await waitFor(() => expect(sendChatRoll).toHaveBeenCalledTimes(1));
    expect(sendChatRoll).toHaveBeenCalledWith(expect.objectContaining({
      campaignId: 'campaign-one',
      definition: expect.objectContaining({
        category: 'Roll',
        title: 'Action 1',
      }),
      recipient: null,
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Host unavailable.');
  });

  it('disables incomplete drafts and hides mutation controls from viewers', () => {
    const incomplete = createDefaultDnd5eCharacterAction(
      '10000000-0000-4000-8000-000000000001',
    );
    const networkApi = createMockNetworkApi();
    const { rerender } = render(
      <Harness initialActions={[incomplete]} networkApi={networkApi} />,
    );
    expect(screen.getByRole('button', { name: 'Use New Action' })).toBeDisabled();

    rerender(
      <Harness
        canEdit={false}
        initialActions={[completeAction()]}
        key="viewer"
        networkApi={networkApi}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Add Action' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More options for Action 1' }))
      .not.toBeInTheDocument();
    const useButton = screen.getByRole('button', { name: 'Use Action 1' });
    expect(useButton).toBeEnabled();
    fireEvent.contextMenu(useButton.closest('[role="listitem"]')!);
    const menu = screen.getByRole('menu', { name: 'Action 1 actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Details' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Details' }));
    expect(screen.getByRole('dialog', { name: 'Action 1 action details' }))
      .toBeInTheDocument();
  });

  it('edits, reorders, and requires an armed Delete from the context menu', async () => {
    render(
      <Harness
        initialActions={[completeAction(1), completeAction(2)]}
        networkApi={createMockNetworkApi()}
      />,
    );
    const list = screen.getByRole('list', { name: 'Character actions' });
    const actionButtons = () => within(list).getAllByRole('button', { name: /^Use / });

    fireEvent.contextMenu(actionButtons()[1].closest('[role="listitem"]')!);
    let menu = screen.getByRole('menu', { name: 'Action 2 actions' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move Up' }));
    await waitFor(() => expect(actionButtons()[0]).toHaveAccessibleName('Use Action 2'));

    fireEvent.contextMenu(actionButtons()[0].closest('[role="listitem"]')!);
    menu = screen.getByRole('menu', { name: 'Action 2 actions' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit' }));
    const editor = screen.getByRole('dialog', { name: 'Action 2 action editor' });
    expect(editor).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Action Name' }), {
      target: { value: 'Renamed Action' },
    });
    fireEvent.mouseDown(editor);
    fireEvent.click(editor);
    expect(screen.getByRole('button', { name: 'Use Renamed Action' })).toBeInTheDocument();

    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Use Renamed Action' }).closest('[role="listitem"]')!,
    );
    menu = screen.getByRole('menu', { name: 'Renamed Action actions' });
    const deleteButton = within(menu).getByRole('menuitem', { name: 'Delete' });
    fireEvent.click(deleteButton);
    expect(screen.getByRole('button', { name: 'Use Renamed Action' })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', {
      name: 'Confirm deletion of Renamed Action',
    }));
    await waitFor(() => expect(
      screen.queryByRole('button', { name: 'Use Renamed Action' }),
    ).not.toBeInTheDocument());
  });

  it('keeps the builder compact with inline previews and no checkboxes or footer controls', () => {
    render(
      <Harness
        initialActions={[completeAction()]}
        networkApi={createMockNetworkApi()}
      />,
    );
    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Use Action 1' }).closest('[role="listitem"]')!,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));

    const editor = screen.getByRole('dialog', { name: 'Action 1 action editor' });
    expect(within(editor).queryByRole('button', { name: 'Optional details' }))
      .not.toBeInTheDocument();
    expect(within(editor).queryByRole('textbox', { name: 'Action Activation' }))
      .not.toBeInTheDocument();
    expect(within(editor).queryByRole('textbox', { name: 'Action Range' }))
      .not.toBeInTheDocument();
    expect(within(editor).queryByRole('textbox', { name: 'Action Target' }))
      .not.toBeInTheDocument();
    expect(within(editor).queryByRole('textbox', { name: 'Action Duration' }))
      .not.toBeInTheDocument();
    expect(within(editor).getByRole('textbox', { name: 'Action description' }))
      .toBeInTheDocument();
    expect(within(editor).queryByRole('complementary', { name: 'Action preview' }))
      .not.toBeInTheDocument();
    expect(within(editor).getByText('1d20')).toBeInTheDocument();
    expect(within(editor).getByRole('button', { name: 'Add roll term' }))
      .toBeInTheDocument();
    expect(within(editor).getByRole('button', { name: 'Dice 1 scaling' }))
      .toHaveTextContent('Fixed dice');
    expect(within(editor).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(editor).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    expect(within(editor).queryByText('Changes save automatically.'))
      .not.toBeInTheDocument();
    expect(within(editor).queryByText('Roll expression')).not.toBeInTheDocument();
    expect(within(editor).queryByRole('button', { name: 'Add Dice' }))
      .not.toBeInTheDocument();
    expect(within(editor).queryByRole('button', { name: 'More options for Roll' }))
      .not.toBeInTheDocument();
    fireEvent.contextMenu(editor.querySelector('[data-action-step-order-id]')!);
    expect(screen.getByRole('menu', { name: 'Roll actions' })).toBeInTheDocument();
  });
});
