import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ScenePatch, SceneRecord } from '../../../../../shared/scenes';
import { SceneSettingsModal } from '../../../../../features/play/scenes/SceneSettingsModal';
import {
  createFakeAssetApi,
  makeImageAsset,
  makeScene,
  testCampaignId,
} from '../../../../support/scenes';

function renderModal(scene: SceneRecord, assets = [makeImageAsset()]) {
  const onUpdate = vi.fn(async () => scene);
  const assetApi = createFakeAssetApi(assets);
  render(
    <SceneSettingsModal
      assetApi={assetApi}
      campaignId={testCampaignId}
      scene={scene}
      thumbnails={new Map()}
      onDismiss={vi.fn()}
      onUpdate={onUpdate}
    />,
  );
  return { assetApi, onUpdate, user: userEvent.setup() };
}

function patchOf(onUpdate: { mock: { calls: unknown[][] } }): ScenePatch {
  const call = onUpdate.mock.calls.at(-1);
  return (call?.[1] ?? {}) as ScenePatch;
}

const gridlessScene = () =>
  makeScene({ grid: { ...makeScene().grid, type: 'gridless' } });

describe('SceneSettingsModal', () => {
  it('puts a visible label on every field', () => {
    renderModal(makeScene());

    for (const text of [
      'Scene name',
      'Scene width',
      'Scene height',
      'Scene pixel scale',
      'Distance',
      'Unit',
      'Grid',
      'Grid size',
      'Line thickness',
      'Offset X',
      'Offset Y',
      'Grid color',
      'Grid opacity',
    ]) {
      // getByText only matches rendered text, so an sr-only label would fail.
      expect(screen.getByText(text)).toBeVisible();
    }
  });

  it('opens the image chooser without a heading, buttons, or a second backdrop', async () => {
    const { user } = renderModal(makeScene());

    await user.click(screen.getByRole('button', { name: 'Import/Replace' }));

    const chooser = await screen.findByRole('dialog', {
      name: 'Choose a map image',
    });
    // Modals in this app dismiss on Escape or the backdrop; a heading and a
    // Cancel button would be a shape nothing else in the app uses.
    expect(within(chooser).queryByRole('heading')).not.toBeInTheDocument();
    expect(
      within(chooser).queryByRole('button', { name: 'Cancel' }),
    ).not.toBeInTheDocument();
    // Two open dialogs stack two backdrops and black out the screen.
    expect(
      document.querySelectorAll('dialog[open]'),
    ).toHaveLength(1);
  });

  it('shows the defaults a freshly created scene carries', () => {
    renderModal(makeScene());

    expect(screen.getByLabelText('Scene name')).toHaveValue('Iron Keep');
    expect(screen.getByLabelText('Scene width')).toHaveValue(1750);
    expect(screen.getByLabelText('Scene height')).toHaveValue(1750);
    expect(screen.getByLabelText('Scene pixel scale')).toHaveValue(100);
    expect(screen.getByLabelText('Distance')).toHaveValue(5);
    expect(screen.getByLabelText('Unit')).toHaveValue('ft');
    expect(screen.getByLabelText('Grid')).toHaveValue('square');
    expect(screen.getByLabelText('Grid size')).toHaveValue(70);
    expect(screen.getByLabelText('Line thickness')).toHaveValue(1);
    expect(screen.getByLabelText('Offset X')).toHaveValue(0);
    expect(screen.getByLabelText('Offset Y')).toHaveValue(0);
    expect(screen.getByLabelText('Grid color hex code')).toHaveValue('#ffffff');
    expect(screen.getByLabelText('Grid opacity')).toHaveValue(15);
  });

  it('hides every grid field while the scene is gridless', () => {
    renderModal(gridlessScene());

    expect(screen.getByLabelText('Grid')).toHaveValue('gridless');
    expect(screen.queryByLabelText('Grid size')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Offset X')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Grid color hex code'),
    ).not.toBeInTheDocument();
    // Measurement stays available without a grid.
    expect(screen.getByLabelText('Scene pixel scale')).toBeInTheDocument();
  });

  it('switches to a square grid from the dropdown', async () => {
    const { onUpdate, user } = renderModal(gridlessScene());

    await user.selectOptions(screen.getByLabelText('Grid'), 'square');

    expect(patchOf(onUpdate)).toEqual({ grid: { type: 'square' } });
  });

  it('commits a number field on blur', async () => {
    const { onUpdate, user } = renderModal(makeScene());

    const width = screen.getByLabelText('Scene width');
    await user.clear(width);
    await user.type(width, '2560');
    await user.tab();

    expect(patchOf(onUpdate)).toEqual({ width: 2560 });
  });

  it('reverts a value outside the supported range', async () => {
    const { onUpdate, user } = renderModal(makeScene());

    const size = screen.getByLabelText('Grid size');
    await user.clear(size);
    await user.type(size, '2');
    await user.tab();

    expect(onUpdate).not.toHaveBeenCalled();
    expect(size).toHaveValue(70);
  });

  it('reverts an empty number field instead of writing NaN', async () => {
    const { onUpdate, user } = renderModal(makeScene());

    const distance = screen.getByLabelText('Distance');
    await user.clear(distance);
    await user.tab();

    expect(onUpdate).not.toHaveBeenCalled();
    expect(distance).toHaveValue(5);
  });

  it('stores grid opacity as a fraction of the percentage shown', async () => {
    const { onUpdate, user } = renderModal(makeScene());

    const opacity = screen.getByLabelText('Grid opacity');
    await user.clear(opacity);
    await user.type(opacity, '40');
    await user.tab();

    expect(patchOf(onUpdate)).toEqual({ grid: { opacity: 0.4 } });
  });

  it('accepts a typed hex colour and rejects anything else', async () => {
    const { onUpdate, user } = renderModal(makeScene());

    const color = screen.getByLabelText('Grid color hex code');
    await user.clear(color);
    await user.type(color, '#3A7BD5');
    await user.tab();
    expect(patchOf(onUpdate)).toEqual({ grid: { color: '#3a7bd5' } });

    onUpdate.mockClear();
    await user.clear(color);
    await user.type(color, 'not-a-color');
    await user.tab();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(color).toHaveValue('#ffffff');
  });

  it('applies a preset swatch', async () => {
    const { onUpdate, user } = renderModal(makeScene());

    await user.click(
      screen.getByRole('button', { name: 'Use grid color #000000' }),
    );

    expect(patchOf(onUpdate)).toEqual({ grid: { color: '#000000' } });
  });

  it('names the linked map image, or says there is none', async () => {
    const asset = makeImageAsset();
    const { user } = renderModal(makeScene());

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'No map image',
    );

    await user.click(screen.getByRole('button', { name: 'Import/Replace' }));

    expect(
      await screen.findByRole('button', { name: /Keep Ground Floor/ }),
    ).toBeInTheDocument();
    expect(asset.displayName).toBe('Keep Ground Floor');
  });

  it('sizes a first-time scene to the image it is given', async () => {
    const asset = makeImageAsset();
    const { onUpdate, user } = renderModal(makeScene());

    await user.click(screen.getByRole('button', { name: 'Import/Replace' }));
    const tile = await screen.findByRole('button', {
      name: /Keep Ground Floor/,
    });
    const image = tile.querySelector('img');
    if (!image) {
      throw new Error('The chooser tile rendered no thumbnail.');
    }
    // jsdom never loads the image, so publish the dimensions the browser would.
    Object.defineProperty(image, 'naturalWidth', { value: 2048 });
    Object.defineProperty(image, 'naturalHeight', { value: 1536 });
    image.dispatchEvent(new Event('load'));
    await user.click(tile);

    await waitFor(() => {
      expect(patchOf(onUpdate)).toEqual({
        height: 1536,
        mapImage: {
          assetId: asset.id,
          height: 1536,
          rotation: 0,
          width: 2048,
          x: 1024,
          y: 768,
        },
        width: 2048,
      });
    });
  });

  it('leaves the scene bounds alone when replacing an existing image', async () => {
    const asset = makeImageAsset();
    const { onUpdate, user } = renderModal(
      makeScene({
        height: 720,
        mapImage: {
          assetId: '99999999-9999-4999-8999-999999999999',
          height: 720,
          rotation: 0,
          width: 1280,
          x: 1024,
          y: 768,
        },
        width: 1280,
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Import/Replace' }));
    const tile = await screen.findByRole('button', {
      name: /Keep Ground Floor/,
    });
    const image = tile.querySelector('img');
    if (!image) {
      throw new Error('The chooser tile rendered no thumbnail.');
    }
    Object.defineProperty(image, 'naturalWidth', { value: 2048 });
    Object.defineProperty(image, 'naturalHeight', { value: 1536 });
    image.dispatchEvent(new Event('load'));
    await user.click(tile);

    await waitFor(() => {
      expect(patchOf(onUpdate)).toEqual({
        mapImage: {
          assetId: asset.id,
          height: 1536,
          rotation: 0,
          width: 2048,
          x: 1024,
          y: 768,
        },
      });
    });
  });
});
