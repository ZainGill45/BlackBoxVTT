import { describe, expect, it } from 'vitest';
import {
  CampaignSceneRealtimeRules,
  MAP_PING_COOLDOWN_MS,
} from '../../../../main/campaignTable/sceneRealtimeRules';
import type {
  DrawingPreviewUpdate,
  MeasurementEvent,
  ShapePreviewUpdate,
} from '../../../../shared/network';
import {
  createDefaultGrid,
  createDefaultFog,
  createEmptyDrawingLayers,
  createEmptyImageLayers,
  createEmptyShapeLayers,
  createEmptyTextLayers,
  type SceneRecord,
  type SceneTransformPreviewStart,
} from '../../../../shared/scenes';

const campaignId = '11111111-1111-4111-8111-111111111111';
const sceneId = '22222222-2222-4222-8222-222222222222';
const operationId = '33333333-3333-4333-8333-333333333333';
const assetId = '44444444-4444-4444-8444-444444444444';
const mapImageId = '55555555-5555-4555-8555-555555555555';
const tokenImageId = '66666666-6666-4666-8666-666666666666';
const gmImageId = '77777777-7777-4777-8777-777777777777';
const tokenTextId = '88888888-8888-4888-8888-888888888888';
const gmTextId = '99999999-9999-4999-8999-999999999999';

function scene(): SceneRecord {
  return {
    createdAt: '2026-07-31T12:00:00.000Z',
    distance: 5,
    drawings: createEmptyDrawingLayers(),
    fog: createDefaultFog(),
    grid: createDefaultGrid(),
    height: 100,
    id: sceneId,
    images: {
      ...createEmptyImageLayers(),
      gm: [
        {
          assetId,
          height: 10,
          id: gmImageId,
          rotation: 0,
          width: 10,
          x: 1,
          y: 2,
        },
      ],
      map: [
        {
          assetId,
          height: 20,
          id: mapImageId,
          rotation: 0.25,
          width: 30,
          x: 3,
          y: 4,
        },
      ],
      token: [
        {
          assetId,
          height: 12,
          id: tokenImageId,
          rotation: 0.5,
          width: 14,
          x: 5,
          y: 6,
        },
      ],
    },
    objectOrder: {
      gm: [gmImageId, gmTextId],
      map: [mapImageId],
      token: [tokenImageId, tokenTextId],
    },
    shapes: createEmptyShapeLayers(),
    texts: {
      ...createEmptyTextLayers(),
      gm: [
        {
          content: 'Secret',
          id: gmTextId,
          ownerId: null,
          revision: 0,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          style: {
            fontFamily: 'inter',
            fontSize: 32,
            fontWeight: 600,
            primaryColor: '#ffffff',
            strokeColor: '#000000',
            strokeWidth: 2,
          },
          x: 30,
          y: 40,
        },
      ],
      token: [
        {
          content: 'Public',
          id: tokenTextId,
          ownerId: null,
          revision: 0,
          rotation: 15,
          scaleX: 2,
          scaleY: 3,
          style: {
            fontFamily: 'inter',
            fontSize: 32,
            fontWeight: 600,
            primaryColor: '#ffffff',
            strokeColor: '#000000',
            strokeWidth: 2,
          },
          x: 10,
          y: 20,
        },
      ],
    },
    mapImage: {
      assetId,
      height: 100,
      rotation: 0,
      width: 200,
      x: 0,
      y: 0,
    },
    name: 'Arena',
    pixelScale: 1,
    revision: 4,
    unit: 'ft',
    updatedAt: '2026-07-31T12:00:00.000Z',
    width: 200,
  };
}

function drawingPreview(
  layer: DrawingPreviewUpdate['layer'] = 'map',
): DrawingPreviewUpdate {
  return {
    active: true,
    campaignId,
    closed: false,
    kind: 'freeform',
    layer,
    operationId,
    points: [{ x: 10, y: 20 }],
    sceneId,
    sequence: 1,
    style: {
      edge: 'hard',
      fillColor: '#000000',
      fillEnabled: false,
      fillOpacity: 1,
      hardness: 1,
      strokeColor: '#ffffff',
      strokeOpacity: 1,
      strokeWidth: 2,
    },
  };
}

function measurement(
  overrides: Partial<MeasurementEvent> = {},
): MeasurementEvent {
  return {
    active: true,
    campaignId,
    measurementId: operationId,
    points: [{ x: 10, y: 20 }],
    sceneId,
    sourceId: 'player',
    updateSequence: 2,
    ...overrides,
  };
}

function shapePreview(
  layer: ShapePreviewUpdate['layer'] = 'map',
): ShapePreviewUpdate {
  return {
    campaignId,
    layer,
    operationId,
    phase: 'update',
    sceneId,
    sequence: 1,
    shape: {
      height: 100,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      kind: 'sphere',
      rotation: 0,
      style: {
        backgroundColor: '#ffffff',
        backgroundOpacity: 0.25,
        backgroundType: 'crosshatched',
        fontColor: '#ffffff',
        fontFamily: 'inter',
        fontSize: 24,
        fontStrokeColor: '#000000',
        fontStrokeWidth: 2,
        fontWeight: 400,
        strokeColor: '#ffffff',
        strokeOpacity: 1,
        strokeType: 'solid',
        strokeWidth: 2,
      },
      width: 100,
      x: 50,
      y: 50,
    },
  };
}

function transformStart(): SceneTransformPreviewStart {
  return {
    campaignId,
    kind: 'move',
    operationId,
    pivotX: 1,
    pivotY: 2,
    revision: 4,
    sceneId,
    startingTransforms: [],
    targets: [mapImageId, gmImageId, 'canonical-map', mapImageId],
  };
}

describe('CampaignSceneRealtimeRules', () => {
  it('accepts only in-bounds pings after the campaign cooldown', () => {
    let now = 10_000;
    const rules = new CampaignSceneRealtimeRules(campaignId, () => now);
    const ping = {
      campaignId,
      id: operationId,
      pullPlayers: false,
      sceneId,
      x: 200,
      y: 100,
    };

    expect(rules.acceptMapPing(ping, scene(), 0)).toBe(now);
    expect(rules.acceptMapPing(ping, scene(), now)).toBeNull();
    now += MAP_PING_COOLDOWN_MS;
    expect(rules.acceptMapPing(ping, scene(), 10_000)).toBe(now);
    expect(
      rules.acceptMapPing({ ...ping, x: 201 }, scene(), 0),
    ).toBeNull();
    expect(
      rules.acceptMapPing({ ...ping, campaignId: 'other' }, scene(), 0),
    ).toBeNull();
  });

  it('forces player drawing previews onto the public token layer', () => {
    const rules = new CampaignSceneRealtimeRules(campaignId);

    expect(
      rules.createDrawingPreview(drawingPreview('gm'), scene(), 'player-id'),
    ).toMatchObject({ layer: 'token', sourceId: 'player-id' });
    expect(
      rules.createDrawingPreview(drawingPreview('gm'), scene()),
    ).toBeNull();
    expect(
      rules.createDrawingPreview(
        { ...drawingPreview(), sceneId: 'other' },
        scene(),
      ),
    ).toBeNull();
  });

  it('derives shape preview source/layer and keeps the GM layer private', () => {
    const rules = new CampaignSceneRealtimeRules(campaignId);
    const update = shapePreview('gm');
    expect(
      rules.createShapePreview(
        {
          ...update,
          phase: 'start',
          reliable: true,
          sequence: 0,
          shape: null,
        },
        scene(),
        'player-id',
      ),
    ).toMatchObject({ layer: 'token', phase: 'start', sourceId: 'player-id' });
    expect(
      rules.createShapePreview(update, scene(), 'player-id'),
    ).toMatchObject({ layer: 'token', sourceId: 'player-id' });
    expect(rules.createShapePreview(update, scene())).toBeNull();
    expect(
      rules.createShapePreview(
        { ...update, sceneId: 'other' },
        scene(),
      ),
    ).toBeNull();
    expect(
      rules.createShapePreview(
        { ...update, sequence: 2 },
        scene(),
        'player-id',
      ),
    ).toMatchObject({ sequence: 2 });
    expect(
      rules.createShapePreview(
        {
          ...update,
          phase: 'cancel',
          reliable: true,
          sequence: 3,
          shape: null,
        },
        scene(),
        'player-id',
      ),
    ).toMatchObject({ phase: 'cancel' });
    expect(
      rules.createShapePreview(
        { ...update, sequence: 2 },
        scene(),
        'player-id',
      ),
    ).toBeNull();
    expect(
      new CampaignSceneRealtimeRules(campaignId).createShapePreview(
        {
          ...update,
          phase: 'start',
          sequence: 0,
          shape: null,
        },
        scene(),
        'player-id',
      ),
    ).toBeNull();
  });

  it('rejects stale, non-finite, and out-of-bounds measurements', () => {
    const rules = new CampaignSceneRealtimeRules(campaignId);
    const activeScene = scene();

    expect(rules.acceptsMeasurement(measurement(), activeScene, 1)).toBe(true);
    expect(rules.acceptsMeasurement(measurement(), activeScene, 2)).toBe(false);
    expect(
      rules.acceptsMeasurement(
        measurement({ points: [{ x: Number.NaN, y: 1 }] }),
        activeScene,
      ),
    ).toBe(false);
    expect(
      rules.acceptsMeasurement(
        measurement({ points: [{ x: -1, y: 1 }] }),
        activeScene,
      ),
    ).toBe(false);
  });

  it('deduplicates public transform targets and captures their starting state', () => {
    const rules = new CampaignSceneRealtimeRules(campaignId);

    expect(rules.createTransformStart(transformStart(), scene())).toEqual({
      kind: 'move',
      operationId,
      pivotX: 1,
      pivotY: 2,
      revision: 4,
      sceneId,
      startingTransforms: [
        {
          id: mapImageId,
          transform: {
            height: 20,
            rotation: 0.25,
            width: 30,
            x: 3,
            y: 4,
          },
        },
        {
          id: 'canonical-map',
          transform: {
            height: 100,
            rotation: 0,
            width: 200,
            x: 0,
            y: 0,
          },
        },
      ],
      targets: [mapImageId, 'canonical-map'],
    });
    expect(
      rules.createTransformStart(
        { ...transformStart(), targets: [gmImageId] },
        scene(),
      ),
    ).toBeNull();
  });

  it('relays public text transform starts while keeping GM text private', () => {
    const rules = new CampaignSceneRealtimeRules(campaignId);
    const input = {
      ...transformStart(),
      targets: [tokenTextId, gmTextId],
    };

    expect(rules.createTransformStart(input, scene())).toMatchObject({
      startingTransforms: [
        {
          id: tokenTextId,
          transform: {
            rotation: 15,
            scaleX: 2,
            scaleY: 3,
            x: 10,
            y: 20,
          },
        },
      ],
      targets: [tokenTextId],
    });
  });
});
