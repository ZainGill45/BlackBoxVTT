import { expect, test } from '@playwright/test';
import { AppFixture, availablePort } from './support/app';
import type { LaunchedApp } from './support/app';
import {
  addPlayer,
  createAndOpenCampaign,
  joinCampaign,
  openTab,
  reconnectSavedCampaign,
  setHostPort,
} from './support/flows';
import {
  pixelColorCoverage,
  pixelDifferenceRatio,
  pixelDifferenceRatioInRegion,
} from './support/png';
import {
  MAP_FIXTURE_COLORS,
  createLargeSceneWithMap,
  dragOnStage,
  dropAssetOnStage,
  hoverStage,
  importFixture,
  measurementLabels,
  placeTextOnStage,
  readScene,
  stage,
  stageCentre,
} from './support/stage';

/**
 * Two windows, one campaign, both renderers live.
 *
 * `networkIntegration.test.ts` proves the protocol carries these payloads and
 * the SceneRenderer tests prove the stage reacts to them against a stub. This
 * is the only place both halves run together, which is where a renderer that
 * ignores an update — or a host that never sends one — actually shows.
 */

const CAMPAIGN = 'Emberfall';
const PASSWORD = 'password';
const VISIBLE_CHANGE = 0.002;

/**
 * The scene these tests share is deliberately larger than its map image.
 *
 * A first-time map sizes the scene to the image, which for the 256x256 fixture
 * leaves a scene exactly as big as anything dropped onto it — objects then have
 * nowhere valid to sit and never reach the player, which looks exactly like a
 * broken broadcast. Widening the bounds is what makes these tests about
 * synchronization rather than about scene geometry.
 */
test.describe('scene synchronization', () => {
  const apps = new AppFixture();
  let gm: LaunchedApp;
  let player: LaunchedApp;
  let port: number;
  let centre: { x: number; y: number };

  /** The player's current stage frame. */
  async function playerFrame(): Promise<Buffer> {
    return stage(player.window).screenshot();
  }

  test.beforeEach(async () => {
    port = await availablePort();

    gm = await apps.launch();
    await createAndOpenCampaign(gm.window, CAMPAIGN);
    await addPlayer(gm.window, 'Alice', PASSWORD);
    await setHostPort(gm.window, port);
    await importFixture(gm.app, gm.window);
    await createLargeSceneWithMap(gm.window, CAMPAIGN);
    centre = await stageCentre(gm.window);

    // Presenting is what pushes the scene to players; viewing it is local.
    await openTab(gm.window, 'Scenes');
    await gm.window.getByRole('button', { name: 'Present New Scene' }).click();

    player = await apps.launch();
    await joinCampaign(player.window, {
      campaign: CAMPAIGN,
      password: PASSWORD,
      port,
      username: 'Alice',
    });
    await stage(player.window).waitFor();
    await player.window.waitForTimeout(1200);
  });

  test.afterEach(() => apps.disposeAll());

  test('shows the presented map on the player stage', async () => {
    const frame = await playerFrame();

    // Match the fixture's real palette rather than a generic colour count;
    // the empty hatch backdrop also contains many antialiased colours.
    for (const color of MAP_FIXTURE_COLORS) {
      expect(pixelColorCoverage(frame, color, 40)).toBeGreaterThan(0.0005);
    }
  });

  test('streams brush fog continuously and delays box fog until commit', async () => {
    await gm.window.getByRole('button', { name: 'Fog', exact: true }).click();
    await gm.window.getByRole('button', { name: 'Fog mode: Reveal' }).click();
    const before = await playerFrame();
    const box = await stage(gm.window).boundingBox();
    if (!box) {
      throw new Error('The Game Master stage has no layout box.');
    }
    const region = {
      height: 180,
      width: 360,
      x: centre.x - 180,
      y: centre.y - 90,
    };

    await gm.window.mouse.move(box.x + centre.x - 140, box.y + centre.y);
    await gm.window.mouse.down();
    for (let step = 1; step <= 16; step += 1) {
      await gm.window.mouse.move(
        box.x + centre.x - 140 + step * 18,
        box.y + centre.y,
      );
    }
    await expect
      .poll(
        async () => pixelDifferenceRatioInRegion(
          before,
          await playerFrame(),
          region,
          4,
        ),
        { message: 'the player never rendered the live UDP fog brush' },
      )
      .toBeGreaterThan(0.01);
    expect((await readScene(gm.window, CAMPAIGN)).fog.operations).toEqual([]);

    await gm.window.mouse.up();
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).fog.operations)
      .toEqual([
        expect.objectContaining({ kind: 'brush', mode: 'hide' }),
      ]);

    await gm.window.getByRole('button', { name: 'Fog settings' }).click();
    const settings = gm.window.getByRole('dialog', { name: 'Fog settings' });
    await settings.getByRole('button', { name: 'Clear all fog' }).click();
    const confirmation = gm.window.getByRole('dialog', {
      name: 'Clear all fog?',
    });
    await confirmation.getByRole('button', { name: 'Clear all fog' }).click();
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).fog.operations)
      .toEqual([]);
    await expect
      .poll(async () => pixelDifferenceRatio(before, await playerFrame()))
      .toBeLessThan(VISIBLE_CHANGE);

    await gm.window.getByRole('button', { name: 'Fog settings' }).click();
    const colorSettings = gm.window.getByRole('dialog', { name: 'Fog settings' });
    const colorInput = colorSettings.getByRole('textbox', {
      name: 'Fog color',
      exact: true,
    });
    await colorInput.fill('#e02b2b');
    await colorInput.press('Enter');
    await gm.window.keyboard.press('Escape');
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).fog.color)
      .toBe('#e02b2b');

    await gm.window.getByRole('button', { name: 'Box fog' }).click();
    const beforeBox = await playerFrame();
    await gm.window.mouse.move(box.x + centre.x - 120, box.y + centre.y - 70);
    await gm.window.mouse.down();
    await gm.window.mouse.move(
      box.x + centre.x + 120,
      box.y + centre.y + 70,
      { steps: 12 },
    );
    await player.window.waitForTimeout(500);
    expect(pixelDifferenceRatio(beforeBox, await playerFrame()))
      .toBeLessThan(VISIBLE_CHANGE);
    expect((await readScene(gm.window, CAMPAIGN)).fog.operations).toEqual([]);

    await gm.window.mouse.up();
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).fog.operations)
      .toEqual([expect.objectContaining({ kind: 'box', mode: 'hide' })]);
    await expect
      .poll(async () => pixelDifferenceRatio(beforeBox, await playerFrame()), {
        message: 'the committed TCP box fog never reached the player',
      })
      .toBeGreaterThan(0.01);

    await gm.window.getByRole('button', { name: 'Fog mode: Hide' }).click();
    await gm.window.getByRole('button', { name: 'Brush fog' }).click();
    const beforeReveal = await playerFrame();
    await gm.window.mouse.move(box.x + centre.x - 80, box.y + centre.y);
    await gm.window.mouse.down();
    await gm.window.mouse.move(box.x + centre.x + 80, box.y + centre.y, {
      steps: 12,
    });
    await expect
      .poll(
        async () => pixelDifferenceRatioInRegion(
          beforeReveal,
          await playerFrame(),
          region,
          4,
        ),
        { message: 'the player never rendered the live UDP fog reveal' },
      )
      .toBeGreaterThan(0.005);
    await gm.window.mouse.up();
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).fog.operations)
      .toEqual([
        expect.objectContaining({ kind: 'box', mode: 'hide' }),
        expect.objectContaining({ kind: 'brush', mode: 'reveal' }),
      ]);

    const fogColor = { blue: 43, green: 43, red: 224 };
    expect(pixelColorCoverage(await playerFrame(), fogColor, 30))
      .toBeGreaterThan(0.005);
    const playerCentre = await stageCentre(player.window);
    await hoverStage(player.window, playerCentre);
    for (let index = 0; index < 12; index += 1) {
      await player.window.mouse.wheel(0, -100);
    }
    await player.window.waitForTimeout(100);
    expect(
      pixelColorCoverage(await playerFrame(), fogColor, 30),
      'fog disappeared or detached from the scene while the player zoomed',
    ).toBeGreaterThan(0.005);
  });

  test('mirrors an image the Game Master places on the token layer', async () => {
    await gm.window.getByRole('button', { name: 'Token layer' }).click();
    const before = await playerFrame();

    await dropAssetOnStage(gm.window, 'map.png', centre);
    await expect
      .poll(
        async () =>
          (await readScene(gm.window, CAMPAIGN)).images.token.length,
        { message: 'the Game Master did not persist the placed token' },
      )
      .toBe(1);

    await expect
      .poll(async () => pixelDifferenceRatio(before, await playerFrame()), {
        message: 'the placed token never reached the player',
      })
      .toBeGreaterThan(VISIBLE_CHANGE);
  });

  test('mirrors a live shape gesture before committing the same geometry', async () => {
    await gm.window.getByRole('button', { name: 'Shape', exact: true }).click();
    const before = await playerFrame();
    const box = await stage(gm.window).boundingBox();
    if (!box) {
      throw new Error('The Game Master stage has no layout box.');
    }
    await gm.window.mouse.move(box.x + centre.x, box.y + centre.y);
    await gm.window.mouse.down();
    for (let step = 1; step <= 16; step += 1) {
      await gm.window.mouse.move(
        box.x + centre.x + step * 10,
        box.y + centre.y,
      );
    }

    await expect
      .poll(async () => pixelDifferenceRatio(before, await playerFrame()), {
        message: 'the player never rendered the in-progress shape',
      })
      .toBeGreaterThan(0.0005);
    expect((await readScene(gm.window, CAMPAIGN)).shapes.token).toEqual([]);

    await gm.window.mouse.up();
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).shapes.token.length, {
        message: 'the shape preview never became a durable object',
      })
      .toBe(1);
    const shape = (await readScene(gm.window, CAMPAIGN)).shapes.token[0];
    expect(shape).toMatchObject({
      height: shape.width,
      kind: 'sphere',
      style: {
        backgroundType: 'crosshatched',
        strokeType: 'solid',
      },
    });
    await expect
      .poll(async () => pixelDifferenceRatio(before, await playerFrame()), {
        message: 'the committed shape did not remain on the player stage',
      })
      .toBeGreaterThan(0.0005);

    await gm.window.getByRole('button', { name: 'Select', exact: true }).click();
    const beforeMove = await playerFrame();
    await dragOnStage(
      gm.window,
      centre,
      { x: centre.x + 120, y: centre.y + 60 },
      { steps: 12 },
    );
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).shapes.token[0].x)
      .toBeGreaterThan(shape.x);
    await expect
      .poll(async () => pixelDifferenceRatio(beforeMove, await playerFrame()), {
        message: 'the committed shape move did not reach the player',
      })
      .toBeGreaterThan(0.0005);
  });

  test('keeps new shapes below images through synchronized layer transfers and restart', async () => {
    await gm.window.getByRole('button', { name: 'Token layer' }).click();
    await dropAssetOnStage(gm.window, 'map.png', {
      x: centre.x + 320,
      y: centre.y,
    });
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).images.token.length)
      .toBe(1);

    await gm.window.getByRole('button', { name: 'Shape', exact: true }).click();
    await dragOnStage(
      gm.window,
      centre,
      { x: centre.x + 170, y: centre.y },
      { steps: 16 },
    );
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).shapes.token.length)
      .toBe(1);
    const created = await readScene(gm.window, CAMPAIGN);
    const shapeId = created.shapes.token[0].id;
    expect(created.objectOrder.token).toEqual([
      shapeId,
      created.images.token[0].id,
    ]);

    await gm.window.getByRole('button', { name: 'Select', exact: true }).click();
    await stage(gm.window).click({ button: 'right', position: centre });
    await gm.window.getByRole('menuitem', { name: 'Move to Map layer' }).click();
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).shapes.map.length)
      .toBe(1);

    await gm.window.getByRole('button', { name: 'Map layer' }).click();
    const beforePrivateMove = await playerFrame();
    await stage(gm.window).click({ button: 'right', position: centre });
    await gm.window.getByRole('menuitem', { name: 'Move to GM layer' }).click();
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).shapes.gm.length)
      .toBe(1);
    await expect
      .poll(async () => pixelDifferenceRatio(beforePrivateMove, await playerFrame()), {
        message: 'the GM-layer transfer did not remove the shape from the player',
      })
      .toBeGreaterThan(0.0005);

    await gm.window.getByRole('button', { name: 'GM layer' }).click();
    await stage(gm.window).click({ button: 'right', position: centre });
    await gm.window.getByRole('menuitem', { name: 'Move to Token layer' }).click();
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).shapes.token.length)
      .toBe(1);
    await gm.window.getByRole('button', { name: 'Token layer' }).click();
    await stage(gm.window).click({ button: 'right', position: centre });
    await gm.window.getByRole('menuitem', { name: 'Send to back' }).click();
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).objectOrder.token[0])
      .toBe(shapeId);

    const userDataPath = gm.userDataPath;
    await gm.app.close();
    gm = await apps.launchInto(userDataPath);
    await gm.window.getByRole('tab', { name: 'Create Campaign' }).click();
    await gm.window.getByRole('button', { name: `Open ${CAMPAIGN}` }).click();
    const restored = await readScene(gm.window, CAMPAIGN);
    expect(restored.objectOrder.token[0]).toBe(shapeId);
    expect(restored.shapes.token[0].id).toBe(shapeId);
  });

  test('mirrors a move of that image', async () => {
    await gm.window.getByRole('button', { name: 'Token layer' }).click();
    const empty = await playerFrame();
    await dropAssetOnStage(gm.window, 'map.png', centre);
    await expect
      .poll(async () => pixelDifferenceRatio(empty, await playerFrame()))
      .toBeGreaterThan(VISIBLE_CHANGE);
    const beforeTransform = (
      await readScene(gm.window, CAMPAIGN)
    ).images.token[0];
    const before = await playerFrame();

    await dragOnStage(
      gm.window,
      centre,
      { x: centre.x + 240, y: centre.y + 140 },
      { steps: 15 },
    );

    await expect
      .poll(async () => {
        const moved = (await readScene(gm.window, CAMPAIGN)).images.token[0];
        return Math.hypot(
          moved.x - beforeTransform.x,
          moved.y - beforeTransform.y,
        );
      }, {
        message: 'the Game Master drag did not update the saved transform',
      })
      .toBeGreaterThan(1);
    await expect
      .poll(async () => pixelDifferenceRatio(before, await playerFrame()), {
        message: 'the move never reached the player',
      })
      .toBeGreaterThan(VISIBLE_CHANGE);
  });

  test('mirrors committed text and its live move preview', async () => {
    const empty = await playerFrame();
    await placeTextOnStage(gm.window, centre, 'Synchronized label');
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).texts.token.length)
      .toBe(1);
    await expect
      .poll(async () => pixelDifferenceRatio(empty, await playerFrame()), {
        message: 'committed host text never reached the player',
      })
      .toBeGreaterThan(0.0005);

    await gm.window.getByRole('button', { name: 'Select' }).click();
    const before = await playerFrame();
    const storedBefore = (await readScene(gm.window, CAMPAIGN)).texts.token[0];
    const box = await stage(gm.window).boundingBox();
    if (!box) {
      throw new Error('The Game Master stage has no layout box.');
    }
    await gm.window.mouse.move(box.x + centre.x, box.y + centre.y);
    await gm.window.mouse.down();
    for (let step = 1; step <= 12; step += 1) {
      await gm.window.mouse.move(
        box.x + centre.x + step * 10,
        box.y + centre.y + step * 6,
      );
    }
    await expect
      .poll(async () => pixelDifferenceRatio(before, await playerFrame()), {
        message: 'the player never rendered the in-progress text move',
      })
      .toBeGreaterThan(0.0005);
    expect((await readScene(gm.window, CAMPAIGN)).texts.token[0].x).toBe(
      storedBefore.x,
    );
    await gm.window.mouse.up();
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).texts.token[0].x)
      .toBeGreaterThan(storedBefore.x);
  });

  test('propagates player-authored text back to the host', async () => {
    const hostBefore = await stage(gm.window).screenshot();
    const playerCentre = await stageCentre(player.window);
    await placeTextOnStage(player.window, playerCentre, 'Player-authored label');

    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).texts.token.length)
      .toBe(1);
    expect((await readScene(gm.window, CAMPAIGN)).texts.token[0]).toMatchObject({
      content: 'Player-authored label',
      ownerId: expect.any(String),
    });
    await expect
      .poll(
        async () =>
          pixelDifferenceRatio(hostBefore, await stage(gm.window).screenshot()),
        { message: 'player-authored text never appeared for the host' },
      )
      .toBeGreaterThan(0.0005);
  });

  test('mirrors text scaling during preview and after commit', async () => {
    const size = await placeTextOnStage(gm.window, centre, 'Scale label');
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).texts.token.length)
      .toBe(1);
    await gm.window.getByRole('button', { name: 'Select' }).click();
    await stage(gm.window).click({ position: centre });
    const before = await playerFrame();
    const box = await stage(gm.window).boundingBox();
    if (!box) {
      throw new Error('The Game Master stage has no layout box.');
    }
    const corner = {
      x: box.x + centre.x + size.width / 2,
      y: box.y + centre.y + size.height / 2,
    };
    await gm.window.mouse.move(corner.x, corner.y);
    await gm.window.mouse.down();
    await gm.window.mouse.move(corner.x + 90, corner.y + 45, { steps: 12 });
    await expect
      .poll(async () => pixelDifferenceRatio(before, await playerFrame()), {
        message: 'the player never rendered the in-progress text scale',
      })
      .toBeGreaterThan(0.0005);
    expect((await readScene(gm.window, CAMPAIGN)).texts.token[0].scaleX).toBe(1);
    await gm.window.mouse.up();
    await expect
      .poll(
        async () =>
          (await readScene(gm.window, CAMPAIGN)).texts.token[0].scaleX,
      )
      .toBeGreaterThan(1.1);
  });

  test('mirrors text rotation during preview and after commit', async () => {
    const size = await placeTextOnStage(gm.window, centre, 'Rotate label');
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).texts.token.length)
      .toBe(1);
    await gm.window.getByRole('button', { name: 'Select' }).click();
    await stage(gm.window).click({ position: centre });
    const before = await playerFrame();
    const box = await stage(gm.window).boundingBox();
    if (!box) {
      throw new Error('The Game Master stage has no layout box.');
    }
    const rotateHandle = {
      x: box.x + centre.x,
      y: box.y + centre.y - size.height / 2 - 44,
    };
    await gm.window.mouse.move(rotateHandle.x, rotateHandle.y);
    await gm.window.mouse.down();
    await gm.window.mouse.move(
      box.x + centre.x + 70,
      box.y + centre.y,
      { steps: 12 },
    );
    await expect
      .poll(async () => pixelDifferenceRatio(before, await playerFrame()), {
        message: 'the player never rendered the in-progress text rotation',
      })
      .toBeGreaterThan(0.0005);
    expect((await readScene(gm.window, CAMPAIGN)).texts.token[0].rotation).toBe(0);
    await gm.window.mouse.up();
    await expect
      .poll(
        async () =>
          Math.abs((await readScene(gm.window, CAMPAIGN)).texts.token[0].rotation),
      )
      .toBeGreaterThan(15);
  });

  test('keeps a Game Master layer image off the player stage', async () => {
    const before = await playerFrame();

    const gmBefore = await stage(gm.window).screenshot();
    await gm.window.getByRole('button', { name: 'GM layer' }).click();
    // Well inside the scene bounds. An image dropped outside them is invisible
    // to everyone, which would make the assertion below pass for the wrong
    // reason.
    await dropAssetOnStage(gm.window, 'map.png', {
      x: centre.x - 120,
      y: centre.y - 90,
    });

    // The Game Master must actually see it before the player's stillness means
    // exclusion rather than latency — or nothing was placed at all.
    await expect
      .poll(async () =>
        pixelDifferenceRatio(gmBefore, await stage(gm.window).screenshot()),
      )
      .toBeGreaterThan(VISIBLE_CHANGE);
    await gm.window.waitForTimeout(2000);
    expect((await readScene(gm.window, CAMPAIGN)).images.gm).toHaveLength(1);

    expect(
      pixelDifferenceRatio(before, await playerFrame()),
      'a Game Master layer image was visible to the player',
    ).toBeLessThan(VISIBLE_CHANGE);

    await gm.window.getByRole('button', { name: 'Token layer' }).click();
  });

  test('keeps Game Master layer text off the player stage', async () => {
    const playerBefore = await playerFrame();
    await gm.window.getByRole('button', { name: 'GM layer' }).click();
    await placeTextOnStage(gm.window, centre, 'Secret GM label');
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).texts.gm.length)
      .toBe(1);
    await gm.window.waitForTimeout(1500);

    expect(
      pixelDifferenceRatio(playerBefore, await playerFrame()),
      'Game Master text leaked onto the player stage',
    ).toBeLessThan(0.0005);
  });

  test('shows a Game Master measurement on the player stage', async () => {
    await gm.window.getByRole('button', { name: 'Measure' }).click();
    await expect(
      gm.window.getByRole('button', { name: 'Measure' }),
    ).toHaveAttribute('aria-pressed', 'true');
    const box = await stage(gm.window).boundingBox();
    if (!box) {
      throw new Error('The stage has no layout box.');
    }
    await gm.window.mouse.move(box.x + centre.x - 120, box.y + centre.y - 90);
    await gm.window.mouse.down();

    // Distance labels are part of the real renderer's overlay and precisely
    // identify a measurement; unlike a whole-canvas pixel threshold they
    // cannot be confused with a selection outline. Keep sending snapshots
    // while waiting because remote rulers deliberately expire after 1.5s.
    const remoteLabels = measurementLabels(player.window).locator('span');
    let remoteDistance: string | null = null;
    for (let sample = 1; sample <= 16; sample += 1) {
      await gm.window.mouse.move(
        box.x + centre.x - 120 + 18 * sample,
        box.y + centre.y - 90 + 10 * sample,
      );
      await player.window.waitForTimeout(100);
      remoteDistance =
        (await remoteLabels.allTextContents()).find((text) => text !== '0 ft') ??
        null;
      if (remoteDistance) {
        break;
      }
    }

    expect(
      remoteDistance,
      'the player never rendered a non-zero remote ruler',
    ).not.toBeNull();
    await expect(remoteLabels).toHaveText(remoteDistance!);
    await gm.window.mouse.up();
    await gm.window.getByRole('button', { name: 'Select' }).click();
  });

  test('shows a Game Master ping on the player stage', async () => {
    const before = await playerFrame();

    // Select mode owns the stationary-hold ping gesture. The "Ping Map" quick
    // action only dispatches an optional application callback and does not arm
    // the renderer, so clicking it here used to test a contract that does not
    // exist.
    await expect(
      gm.window.getByRole('button', { name: 'Select' }),
    ).toHaveAttribute('aria-pressed', 'true');
    const box = await stage(gm.window).boundingBox();
    if (!box) {
      throw new Error('The stage has no layout box.');
    }
    const playerCentre = await stageCentre(player.window);
    const pingRegion = {
      height: 128,
      width: 128,
      x: playerCentre.x - 64,
      y: playerCentre.y - 64,
    };
    await gm.window.mouse.move(box.x + centre.x, box.y + centre.y);
    await gm.window.mouse.down();

    // The ring occupies only a few hundred pixels. Restricting the comparison
    // to its expected screen-space region preserves that signal instead of
    // diluting it across the entire stage.
    let peak = 0;
    for (let sample = 0; sample < 30; sample += 1) {
      await player.window.waitForTimeout(40);
      peak = Math.max(
        peak,
        pixelDifferenceRatioInRegion(
          before,
          await stage(player.window).screenshot(),
          pingRegion,
          2,
        ),
      );
      if (peak > 0.005) {
        break;
      }
    }
    await gm.window.mouse.up();

    expect(peak, 'the ping never reached the player').toBeGreaterThan(0.005);
  });

  test('restores the presented scene when the player reconnects', async () => {
    const connected = await playerFrame();

    await player.window.getByRole('button', { name: 'Logout' }).click();
    await expect(
      player.window.getByRole('tab', { name: 'Join Campaign' }),
    ).toBeVisible();
    await reconnectSavedCampaign(player.window, CAMPAIGN);
    await stage(player.window).waitFor();
    await player.window.waitForTimeout(1500);

    // Same scene, same content: the session was rebuilt, not started empty.
    expect(
      pixelDifferenceRatio(connected, await playerFrame()),
      'the scene was not restored after reconnecting',
    ).toBeLessThan(VISIBLE_CHANGE);
  });

  test('ends the player session when the Game Master resets that password', async () => {
    await openTab(gm.window, 'Settings');
    const users = gm.window.getByRole('region', { name: 'User Management' });
    await users.getByLabel('New password for Alice').fill('a different secret');
    await users.getByLabel('New password for Alice').blur();

    // The player is put back on the connection screen rather than left holding
    // a session the host has already revoked.
    await expect(
      player.window.getByRole('tab', { name: 'Join Campaign' }),
    ).toBeVisible({ timeout: 30_000 });
  });
});
