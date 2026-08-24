import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TokenInspector } from '../../../../features/play/TokenInspector';
import type { TokenInspectorPresentation } from '../../../../shared/tokenInspector';
import { createFakeSceneApi, makeScene, testCampaignId } from '../../../support/scenes';
import { createMockNetworkApi } from '../../../support/networkApi';

const sceneId = '11111111-1111-4111-8111-111111111111';
const tokenId = '22222222-2222-4222-8222-222222222222';

function presentation(editable = true): TokenInspectorPresentation {
  return {
    editable,
    fields: [
      {
        current: '7',
        editor: editable ? 'command' : null,
        id: 'health',
        kind: 'resource',
        label: 'Health',
        maximum: '10',
      },
      {
        editor: editable ? 'text' : null,
        id: 'armor-class',
        kind: 'scalar',
        label: 'Armor Class',
        value: '12',
      },
      {
        editor: null,
        id: 'initiative',
        kind: 'scalar',
        label: 'Initiative',
        ...(editable ? { roll: { label: 'Roll Initiative' } } : {}),
        value: '+2',
      },
    ],
    selectedFieldIds: ['health', 'armor-class'],
    tokenId,
  };
}

describe('TokenInspector', () => {
  it('shows selected fields, filters them, and disables editing for view access', async () => {
    const sceneApi = createFakeSceneApi();
    const readOnly = presentation(false);
    readOnly.selectedFieldIds.push('initiative');
    sceneApi.getTokenInspector = vi.fn(async () => ({
      ok: true as const,
      value: readOnly,
    }));
    render(
      <TokenInspector
        campaignId={testCampaignId}
        networkApi={createMockNetworkApi()}
        sceneApi={sceneApi}
        sceneId={sceneId}
        sceneRevision={1}
        tokenId={tokenId}
      />,
    );

    expect(await screen.findByRole('complementary', { name: 'Token Inspector' }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add inspector field' }))
      .toBeDisabled();
    expect(screen.getByText('Health')).toBeInTheDocument();
    expect(screen.getByText('Armor Class')).toBeInTheDocument();
    expect(screen.getByText('Initiative')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Roll Initiative' }))
      .not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search inspector fields' }), 'armor');
    expect(screen.queryByText('Health')).not.toBeInTheDocument();
    expect(screen.getByText('Armor Class')).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByText('Armor Class'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('adds fields and commits field edits through explicit mutations', async () => {
    const sceneApi = createFakeSceneApi();
    const current = presentation();
    sceneApi.getTokenInspector = vi.fn(async () => ({
      ok: true as const,
      value: structuredClone(current),
    }));
    sceneApi.mutateTokenInspector = vi.fn(async ({ mutation }) => {
      if (mutation.kind === 'add-field') {
        current.selectedFieldIds.push(mutation.fieldId);
      } else if (mutation.kind === 'set-value' && mutation.fieldId === 'armor-class') {
        const field = current.fields.find(({ id }) => id === mutation.fieldId);
        if (field?.kind === 'scalar') field.value = mutation.command;
      }
      return {
        ok: true as const,
        value: makeScene(),
      };
    });
    render(
      <TokenInspector
        campaignId={testCampaignId}
        networkApi={createMockNetworkApi()}
        sceneApi={sceneApi}
        sceneId={sceneId}
        sceneRevision={1}
        tokenId={tokenId}
      />,
    );
    await screen.findByText('Armor Class');
    await userEvent.click(screen.getByRole('button', { name: 'Add inspector field' }));
    const menu = screen.getByRole('menu', { name: 'Choose inspector field' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Initiative' }));
    await waitFor(() => expect(sceneApi.mutateTokenInspector).toHaveBeenCalledWith(
      expect.objectContaining({ mutation: { fieldId: 'initiative', kind: 'add-field' } }),
    ));

    const armor = screen.getByRole('textbox', { name: 'Armor Class value' });
    await userEvent.clear(armor);
    await userEvent.type(armor, '18{Enter}');
    await waitFor(() => expect(sceneApi.mutateTokenInspector).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: {
          command: '18',
          fieldId: 'armor-class',
          kind: 'set-value',
          target: 'value',
        },
      }),
    ));
  });

  it('evaluates arithmetic entered by editing the displayed value', async () => {
    const sceneApi = createFakeSceneApi();
    const current = presentation();
    const health = current.fields.find(({ id }) => id === 'health');
    if (health?.kind !== 'resource') throw new Error('Expected the health resource field.');
    health.current = '24';
    health.maximum = '24';
    sceneApi.getTokenInspector = vi.fn(async () => ({
      ok: true as const,
      value: structuredClone(current),
    }));
    sceneApi.mutateTokenInspector = vi.fn(async ({ mutation }) => {
      if (
        mutation.kind === 'set-value'
        && mutation.fieldId === 'health'
        && mutation.target === 'current'
        && mutation.command === '24-5'
      ) {
        health.current = '19';
      }
      return {
        ok: true as const,
        value: makeScene(),
      };
    });
    render(
      <TokenInspector
        campaignId={testCampaignId}
        networkApi={createMockNetworkApi()}
        sceneApi={sceneApi}
        sceneId={sceneId}
        sceneRevision={1}
        tokenId={tokenId}
      />,
    );

    const healthCurrent = await screen.findByRole('textbox', { name: 'Health current' });
    healthCurrent.focus();
    await act(async () => {
      fireEvent.change(healthCurrent, { target: { value: '24-5' } });
      fireEvent.keyDown(healthCurrent, { key: 'Enter' });
    });

    await waitFor(() => expect(sceneApi.mutateTokenInspector).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: {
          command: '24-5',
          fieldId: 'health',
          kind: 'set-value',
          target: 'current',
        },
      }),
    ));
    await waitFor(() => expect(
      screen.getByRole('textbox', { name: 'Health current' }),
    ).toHaveValue('19'));
  });

  it('uses the canonical ghost state while freely reordering fields', async () => {
    const sceneApi = createFakeSceneApi();
    sceneApi.getTokenInspector = vi.fn(async () => ({
      ok: true as const,
      value: presentation(),
    }));
    sceneApi.mutateTokenInspector = vi.fn(async () => ({
      ok: true as const,
      value: makeScene(),
    }));
    render(
      <TokenInspector
        campaignId={testCampaignId}
        networkApi={createMockNetworkApi()}
        sceneApi={sceneApi}
        sceneId={sceneId}
        sceneRevision={1}
        tokenId={tokenId}
      />,
    );

    const healthField = (await screen.findByText('Health')).closest('[role="listitem"]');
    expect(healthField).not.toBeNull();
    fireEvent.contextMenu(healthField!);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reorder Field Freely' }));

    expect(healthField).toHaveAttribute('data-reordering', 'true');
    expect(healthField).not.toHaveAttribute('data-active');

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(sceneApi.mutateTokenInspector).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: {
          beforeFieldId: null,
          fieldId: 'health',
          kind: 'place-field',
        },
      }),
    ));
    expect(healthField).not.toHaveAttribute('data-reordering');
  });

  it('resolves a roll from the inspected token and submits it to public chat', async () => {
    const sceneApi = createFakeSceneApi();
    const current = presentation();
    current.selectedFieldIds.push('initiative');
    const definition = {
      category: 'Initiative',
      sections: [{
        label: 'Initiative',
        modifiers: [{ label: 'Initiative', value: 2 }],
        notation: '1d20',
        typeLabel: null,
      }],
      title: null,
    };
    sceneApi.getTokenInspector = vi.fn(async () => ({
      ok: true as const,
      value: current,
    }));
    sceneApi.resolveTokenInspectorRoll = vi.fn(async () => ({
      ok: true as const,
      value: definition,
    }));
    const networkApi = createMockNetworkApi({
      sendChatRoll: vi.fn(async () => ({ ok: true as const, value: {} as never })),
    });
    render(
      <TokenInspector
        campaignId={testCampaignId}
        networkApi={networkApi}
        sceneApi={sceneApi}
        sceneId={sceneId}
        sceneRevision={1}
        tokenId={tokenId}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Roll Initiative' }));

    expect(sceneApi.resolveTokenInspectorRoll).toHaveBeenCalledWith({
      campaignId: testCampaignId,
      fieldId: 'initiative',
      sceneId,
      tokenId,
    });
    await waitFor(() => expect(networkApi.sendChatRoll).toHaveBeenCalledWith({
      campaignId: testCampaignId,
      clientMessageId: expect.any(String),
      definition,
      recipient: null,
    }));
  });
});
