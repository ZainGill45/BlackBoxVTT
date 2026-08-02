import {
  Application,
  Container,
  Graphics,
  Sprite,
  Texture,
  TilingSprite,
} from 'pixi.js';
import type { GifSource } from 'pixi.js/gif';
import {
  DEFAULT_TRANSFORM_PREVIEW_RATE,
  MAX_TRANSFORM_PREVIEW_RATE,
  MAX_DRAWING_PREVIEW_POINTS,
  MAX_MEASUREMENT_POINTS,
  type DrawingPreviewEvent,
  type DrawingPreviewUpdate,
  type MapPing,
  type MeasurementEvent,
  type MeasurementPoint,
  type MeasurementUpdate,
  type ShapePreviewEvent,
  type ShapePreviewUpdate,
} from '../../../shared/network';
import { LatestSnapshotRateLimiter } from '../../../shared/latestSnapshotRateLimiter';
import { compactFogBrushPoints } from '../../../shared/sceneFogGeometry';
import {
  applySceneTransformPreview,
  CANONICAL_MAP_ID,
  createEmptyImageLayers,
  sceneObjectStateOf,
  MAX_SCENE_IMAGES,
  MAX_SCENE_SHAPES,
  type SceneDrawing,
  type SceneDrawingPoint,
  type SceneDrawingStyle,
  type SceneImage,
  type SceneFogMutation,
  type SceneFogOperation,
  type SceneImageLayer,
  type SceneObjectState,
  type SceneArrangement,
  type SceneMapImage,
  type SceneRecord,
  type SceneShape,
  type SceneShapeKind,
  type SceneShapeStyle,
  type SceneText,
  type SceneTextStyle,
  type SceneTransformPreviewCancel,
  type SceneTransformPreviewDelta,
  type SceneTransformPreviewStart,
} from '../../../shared/scenes';
import {
  sceneTextLayersSchema,
  sceneTextSchema,
} from '../../../shared/sceneSchema';
import {
  createCamera,
  fitToScene,
  pan,
  sceneToScreen,
  screenToScene,
  visibleBounds,
  zoomAt,
  type Camera,
  type Viewport,
} from './camera';
import { computeGridLines } from './grid';
import {
  cumulativeMeasurementDistances,
  formatMeasurementDistance,
} from './measurement';
import {
  containsPoint,
  rectangleCoverage,
  snapValue,
} from './imageGeometry';
import {
  ContextMenuController,
  type ContextMenuEntry,
} from './contextMenu';
import { SceneImageClipboard } from './sceneImageClipboard';
import {
  loadImageResource,
  SceneImageResourceCache,
} from './imageResourceLoader';
import {
  gestureOfKind,
  planKeyDown,
  planPointerDown,
  planPointerMove,
  planPointerUp,
  SceneInteractionEngine,
  type ActiveSceneGesture,
  type SceneGesture,
} from './sceneInteractionEngine';
import {
  activeSceneTargets,
  canCreateSceneImages,
  canEditDrawing,
  canEditShape,
  canEditText,
  deleteSelectedObjects,
  drawingAsImage,
  drawingTransformOf,
  imageTransformOf,
  duplicateSceneImages,
  moveSelectedObjectsToLayer,
  reorderSelectedObjects,
  selectedPlacedImages,
  selectedSceneTargets,
  selectionFrame,
  textAsImage,
  textTransformOf,
  type EditTarget,
} from './sceneSelection';
import {
  containsShapePoint,
  createShapeFromDrag,
  editShapeWithSemanticHandle,
  shapeAsImage,
  shapeIncrementPixels,
  type ShapeSemanticHandle,
} from './shapeGeometry';
import {
  createNudgePreview,
  nudgeSceneState,
  snapshotEditTargets,
  updateSceneEdit,
} from './sceneEditInteraction';
import {
  advancePolyline,
  appendFreeformPoint,
  compactPreviewPoints,
  createSceneDrawing,
} from './scenePaintInteraction';
import {
  activeMeasurementUpdate,
  addMeasurementPivot,
  beginMeasurement,
  inactiveMeasurementUpdate,
  measurementGesturePoints,
  moveMeasurement,
} from './sceneMeasurementInteraction';
import {
  canBeginPendingPing,
  canSendPing,
  pinchFrame,
  updatePinchCamera,
} from './sceneNavigationInteraction';
import { SceneSelectionOverlay } from './sceneSelectionOverlay';
import {
  ensureSceneTextFontsLoaded,
  sceneTextFontStack,
  SceneTextRenderer,
} from './sceneTextRenderer';
import {
  SceneTextEditorController,
  type SceneTextEditorDraft,
} from './sceneTextEditor';
import {
  SceneDrawingRenderer,
  strokeDrawingPath,
} from './sceneDrawingRenderer';
import {
  AdditionalImageRenderer,
  drawImagePlaceholder,
} from './additionalImageRenderer';
import { SceneShapeRenderer } from './sceneShapeRenderer';
import { fogCoversPoint, SceneFogRenderer } from './sceneFogRenderer';
import styles from './SceneRenderer.module.css';

/**
 * Tile size for the ±45° hatch, in scene units — parallel lines land every
 * HATCH_TILE / √2 scene pixels apart. Pixi v8 is WebGL2-only, so this does not
 * need to be a power of two to wrap and mip cleanly.
 */
const HATCH_TILE = 18;
const HATCH_LINE_WIDTH = 1;
const FALLBACK_HATCH_COLOR = '#3b3b3b';
/** The scene surface sits above the play screen's own near-black backdrop. */
const FALLBACK_SURFACE_COLOR = '#1d1d1d';
const FALLBACK_OUTLINE_COLOR = '#767676';
const SCENE_OUTLINE_WIDTH = 1;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const MAP_IMAGE_Z_INDEX = 2;
const GRIDLESS_COPY_OFFSET = 20;
const MAP_PING_HOLD_MS = 500;
const MAP_PING_COOLDOWN_MS = 500;
const MAP_PING_DURATION_MS = 1_200;
const CAMERA_PULL_DURATION_MS = 300;
const ANIMATION_FRAME_MS = 16;
const MEASUREMENT_UPDATE_INTERVAL_MS = 1_000 / MAX_TRANSFORM_PREVIEW_RATE;
const MEASUREMENT_KEEPALIVE_MS = 500;
const MEASUREMENT_EXPIRY_MS = 1_500;
const SHAPE_PREVIEW_EXPIRY_MS = 30_000;
const FOG_POINT_SPACING_PX = 2;
const LOCAL_TEXT_PREVIEW_ID = '00000000-0000-4000-8000-000000000000';

type RendererMapPing = Omit<MapPing, 'campaignId'>;
type RendererMeasurementUpdate = Omit<MeasurementUpdate, 'campaignId'>;
type RendererDrawingPreview = Omit<DrawingPreviewUpdate, 'campaignId'>;

export interface SceneRendererHandle {
  destroy(): void;
  fitToScene(): void;
  clientToScene(clientX: number, clientY: number): { x: number; y: number };
  mount(element: HTMLElement): Promise<void>;
  resize(width: number, height: number): void;
  selectImages(ids: string[]): void;
  showMeasurement(update: MeasurementEvent): void;
  showDrawingPreview(preview: DrawingPreviewEvent): void;
  showShapePreview(preview: ShapePreviewEvent): void;
  showPing(ping: RendererMapPing, centerCamera?: boolean): void;
  showTransformCancelled(input: SceneTransformPreviewCancel): void;
  showTransformPreview(input: SceneTransformPreviewDelta): void;
  showTransformStarted(input: SceneTransformPreviewStart): void;
  setInteraction(options: SceneRendererInteraction): void;
  setScene(
    scene: SceneRecord | null,
    imageUrls: Record<string, string> | string | null,
  ): void;
}

export interface SceneRendererInteraction {
  activeLayer: SceneImageLayer;
  actorId?: string | null;
  canEditImages?: boolean;
  editable: boolean;
  measureEnabled?: boolean;
  paintEnabled?: boolean;
  paintKind?: 'freeform' | 'polyline';
  paintStyle?: SceneDrawingStyle;
  fogEnabled?: boolean;
  fogMode?: 'hide' | 'reveal';
  fogSubtool?: 'box' | 'brush';
  fogBrushHardness?: number;
  fogBrushWidth?: number;
  fogGmOpacity?: number;
  networkUpdateRate?: number;
  shapeEnabled?: boolean;
  shapeKind?: SceneShapeKind;
  shapeStyle?: SceneShapeStyle;
  textEnabled?: boolean;
  textStyle?: SceneTextStyle;
  pingEnabled?: boolean;
  onActiveLayerChange?: (layer: SceneImageLayer) => void;
  onCommit?: (
    state: SceneObjectState,
    operationId: string,
    arrangement?: SceneArrangement,
  ) => Promise<SceneRecord | null>;
  onMeasurementUpdate?: (update: RendererMeasurementUpdate) => void;
  onDrawingPreview?: (preview: RendererDrawingPreview) => void;
  onFogCommit?: (
    mutation: SceneFogMutation,
    operationId: string,
  ) => Promise<SceneRecord | null>;
  onShapePreview?: (
    preview: Omit<ShapePreviewUpdate, 'campaignId'>,
  ) => void;
  onPreviewCancel?: (operationId: string, sceneId: string) => void;
  onPreviewStart?: (
    input: Omit<SceneTransformPreviewStart, 'campaignId'>,
  ) => void;
  onPreviewUpdate?: (
    input: Omit<SceneTransformPreviewDelta, 'campaignId'>,
  ) => void;
  onPing?: (ping: RendererMapPing) => void;
  onRedo?: () => Promise<SceneRecord | null>;
  onUndo?: () => Promise<SceneRecord | null>;
}

function readCssColor(name: string, fallback: string): number {
  let value = fallback;
  if (typeof window !== 'undefined' && document.documentElement) {
    const computed = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    if (/^#[0-9a-f]{6}$/i.test(computed)) {
      value = computed;
    }
  }
  return Number.parseInt(value.slice(1), 16);
}

function sceneDrawingPoint(
  drawing: SceneDrawing,
  point: SceneDrawingPoint,
): SceneDrawingPoint {
  const radians = (drawing.rotation * Math.PI) / 180;
  const x = point.x * drawing.scaleX;
  const y = point.y * drawing.scaleY;
  return {
    x: drawing.x + Math.cos(radians) * x - Math.sin(radians) * y,
    y: drawing.y + Math.sin(radians) * x + Math.cos(radians) * y,
  };
}

function pointSegmentDistance(
  point: SceneDrawingPoint,
  start: SceneDrawingPoint,
  end: SceneDrawingPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const amount = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(
    point.x - (start.x + amount * dx),
    point.y - (start.y + amount * dy),
  );
}

function pointInPolygon(
  point: SceneDrawingPoint,
  polygon: SceneDrawingPoint[],
): boolean {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) *
          (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y || 1) +
          currentPoint.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function containsDrawingPoint(
  drawing: SceneDrawing,
  point: SceneDrawingPoint,
  tolerance: number,
): boolean {
  const points = drawing.points.map((candidate) =>
    sceneDrawingPoint(drawing, candidate),
  );
  if (
    drawing.closed &&
    drawing.style.fillEnabled &&
    pointInPolygon(point, points)
  ) {
    return true;
  }
  const width =
    (drawing.style.strokeWidth *
      Math.max(drawing.scaleX, drawing.scaleY)) /
      2 +
    tolerance;
  if (points.length === 1) {
    return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= width;
  }
  const segments = drawing.closed
    ? [...points, points[0]]
    : points;
  for (let index = 1; index < segments.length; index += 1) {
    if (pointSegmentDistance(point, segments[index - 1], segments[index]) <= width) {
      return true;
    }
  }
  return false;
}

function createHatchTexture(color: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = HATCH_TILE;
  canvas.height = HATCH_TILE;
  const context = canvas.getContext('2d');
  if (context) {
    context.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.lineWidth = HATCH_LINE_WIDTH;
    const size = HATCH_TILE;
    const half = size / 2;
    const segments: Array<[number, number, number, number]> = [
      // Descending diagonals, with the corner wraps that make the tile seamless.
      [0, 0, size, size],
      [-half, half, half, size + half],
      [half, -half, size + half, half],
      // Ascending diagonals.
      [0, size, size, 0],
      [-half, half, half, -half],
      [half, size + half, size + half, half],
    ];
    context.beginPath();
    for (const [x1, y1, x2, y2] of segments) {
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
    }
    context.stroke();
  }
  return Texture.from(canvas);
}

/**
 * Owns the Pixi application for the play area. The scene's surface — its fill,
 * its crosshatch, and the map image — lives in `world` and carries the camera
 * transform, so the hatch behaves like a texture painted on the scene: the same
 * number of hatch lines spans the map at every zoom. Only the grid is drawn in
 * screen space, where it can be pixel-aligned. The canvas stays transparent
 * outside the scene rectangle so the play screen's own grid shows through.
 */
export class SceneRenderer implements SceneRendererHandle {
  private readonly app = new Application();
  private readonly base = new Graphics();
  private camera: Camera = createCamera();
  private container: HTMLElement | null = null;
  private destroyed = false;
  private readonly interactionEngine = new SceneInteractionEngine();
  private readonly grid = new Graphics();
  private readonly measurementGraphics = new Graphics();
  private measurementLabels: HTMLDivElement | null = null;
  private readonly pingGraphics = new Graphics();
  private activePings = new Map<
    string,
    RendererMapPing & { startedAt: number }
  >();
  private animationTimer: ReturnType<typeof setInterval> | null = null;
  private cameraAnimation: {
    fromX: number;
    fromY: number;
    startedAt: number;
    targetX: number;
    targetY: number;
  } | null = null;
  private hatch: TilingSprite | null = null;
  private hatchTexture: Texture | null = null;
  private imageToken = 0;
  private imageUrl: string | null = null;
  private imageUrls: Record<string, string> = {};
  private readonly drawingRenderer: SceneDrawingRenderer;
  private readonly shapeRenderer: SceneShapeRenderer;
  private readonly textRenderer = new SceneTextRenderer();
  private activeTextEditor: SceneTextEditorController | null = null;
  private textDraftFontTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly imageResources = new SceneImageResourceCache();
  private readonly additionalImages = new AdditionalImageRenderer(
    this.imageResources,
    () => this.placeholderColor,
    () => this.rebuildScene(),
    (assetId) => {
      if (this.scene?.mapImage?.assetId === assetId) {
        this.mapSprite?.destroy();
        this.mapSprite = null;
        this.mapSpriteKind = null;
      }
    },
  );
  private interaction: SceneRendererInteraction = {
    activeLayer: 'token',
    editable: false,
    measureEnabled: false,
    pingEnabled: false,
  };
  private measurementUpdateSequence = 0;
  private readonly remoteMeasurements = new Map<
    string,
    { lastAt: number; update: MeasurementEvent }
  >();
  private readonly remoteMeasurementVersions = new Map<string, number>();
  private readonly drawingPreviewRateLimiter =
    new LatestSnapshotRateLimiter<RendererDrawingPreview>(
      () => this.interaction.networkUpdateRate ?? DEFAULT_TRANSFORM_PREVIEW_RATE,
      (preview) => this.interaction.onDrawingPreview?.(preview),
    );
  private readonly paintPreviewGraphics = new Graphics();
  private readonly fogRenderer = new SceneFogRenderer();
  private fogFrameId: number | null = null;
  private localFogOperation: SceneFogOperation | null = null;
  private readonly remotePaintGraphics = new Graphics();
  private readonly remotePaintPreviews = new Map<
    string,
    { lastAt: number; preview: DrawingPreviewEvent }
  >();
  private readonly remoteShapePreviews = new Map<
    string,
    { lastAt: number; preview: ShapePreviewEvent }
  >();
  private readonly remoteShapeSequences = new Map<string, number>();
  private readonly remoteTransformStarts = new Map<
    string,
    { base: SceneRecord; input: SceneTransformPreviewStart }
  >();
  private readonly selectionOverlay = new SceneSelectionOverlay(readCssColor);
  private readonly contextMenu = new ContextMenuController({
    deleteItem: styles.contextMenuDelete,
    divider: styles.contextMenuDivider,
    item: styles.contextMenuItem,
    menu: styles.contextMenu,
  });
  private readonly imageClipboard = new SceneImageClipboard();
  private lastSentPingAt: number | null = null;
  private mapSprite: Sprite | null = null;
  private mapPlaceholder: Graphics | null = null;
  private mapGifSource: GifSource | null = null;
  private mapResourceAssetId: string | null = null;
  private mapTexture: Texture | null = null;
  private mapSpriteKind: 'gif' | 'texture' | null = null;
  private mounted = false;
  private readonly outline = new Graphics();
  private placeholderColor = Number.parseInt(
    FALLBACK_OUTLINE_COLOR.slice(1),
    16,
  );
  private scene: SceneRecord | null = null;
  private draftShape: SceneShape | null = null;
  private viewport: Viewport = { height: 0, width: 0 };
  private readonly world = new Container();
  private readonly tokenWorld = new Container();
  private readonly gmWorld = new Container();

  constructor() {
    this.drawingRenderer = new SceneDrawingRenderer(
      this.world,
      this.tokenWorld,
      this.gmWorld,
    );
    this.shapeRenderer = new SceneShapeRenderer(
      this.world,
      this.tokenWorld,
      this.gmWorld,
    );
  }

  private beginGesture(gesture: ActiveSceneGesture): boolean {
    return this.interactionEngine.begin(gesture);
  }

  private finishGesture(kind: ActiveSceneGesture['kind']): void {
    this.interactionEngine.finish(kind);
  }

  private get gesture(): SceneGesture {
    return this.interactionEngine.gesture;
  }

  private get selected(): Set<string> {
    return this.interactionEngine.selected;
  }

  private set selected(value: Set<string>) {
    this.interactionEngine.selected = value;
  }

  private get groupSelectionRotation(): number {
    return this.interactionEngine.groupSelectionRotation;
  }

  private set groupSelectionRotation(value: number) {
    this.interactionEngine.groupSelectionRotation = value;
  }

  private get leftAlt(): boolean {
    return this.interactionEngine.leftAlt;
  }

  private set leftAlt(value: boolean) {
    this.interactionEngine.leftAlt = value;
  }

  private get pendingPing() {
    return this.interactionEngine.pendingPing;
  }

  private set pendingPing(value) {
    this.interactionEngine.pendingPing = value;
  }

  private get pingConsumedPointers(): Set<number> {
    return this.interactionEngine.pingConsumedPointers;
  }

  private get touchLongPressOpened(): Set<number> {
    return this.interactionEngine.touchLongPressOpened;
  }

  private get touchLongPressTimer(): ReturnType<typeof setTimeout> | null {
    return this.interactionEngine.touchLongPressTimer;
  }

  private set touchLongPressTimer(
    value: ReturnType<typeof setTimeout> | null,
  ) {
    this.interactionEngine.touchLongPressTimer = value;
  }

  private get touchPointers() {
    return this.interactionEngine.touchPointers;
  }

  private get committing(): boolean {
    return this.interactionEngine.committing;
  }

  private set committing(value: boolean) {
    this.interactionEngine.committing = value;
  }

  private get activeFreeform() {
    return gestureOfKind(this.gesture, 'freeform');
  }

  private set activeFreeform(
    value: Omit<
      Extract<SceneGesture, { kind: 'freeform' }>,
      'kind'
    > | null,
  ) {
    if (value) {
      this.beginGesture({ ...value, kind: 'freeform' });
    } else {
      this.finishGesture('freeform');
    }
  }

  private get activePolyline() {
    return gestureOfKind(this.gesture, 'polyline');
  }

  private get activeShape() {
    return gestureOfKind(this.gesture, 'shape');
  }

  private get activeFogBrush() {
    return gestureOfKind(this.gesture, 'fog-brush');
  }

  private get activeFogBox() {
    return gestureOfKind(this.gesture, 'fog-box');
  }

  private set activePolyline(
    value: Omit<
      Extract<SceneGesture, { kind: 'polyline' }>,
      'kind'
    > | null,
  ) {
    if (value) {
      this.beginGesture({ ...value, kind: 'polyline' });
    } else {
      this.finishGesture('polyline');
    }
  }

  private get activeMeasurement() {
    return gestureOfKind(this.gesture, 'measurement');
  }

  private set activeMeasurement(
    value: Omit<
      Extract<SceneGesture, { kind: 'measurement' }>,
      'kind'
    > | null,
  ) {
    if (value) {
      this.beginGesture({ ...value, kind: 'measurement' });
    } else {
      this.finishGesture('measurement');
    }
  }

  private get editGesture() {
    return gestureOfKind(this.gesture, 'edit');
  }

  private get editPointerId(): number | null {
    return this.editGesture?.pointerId ?? null;
  }

  private get editStart() {
    return this.editGesture?.start ?? null;
  }

  private get editBefore() {
    return this.editGesture?.before ?? null;
  }

  private get editGroupRotationBefore(): number {
    return this.editGesture?.groupRotationBefore ?? 0;
  }

  private get editMode() {
    return this.editGesture?.mode ?? null;
  }

  private get previewOperationId(): string | null {
    return this.editGesture?.previewOperationId ?? null;
  }

  private get previewPivot() {
    return this.editGesture?.previewPivot ?? { x: 0, y: 0 };
  }

  private get resizeCorner(): number {
    return this.editGesture?.resizeCorner ?? 0;
  }

  private get nudgeGesture() {
    return gestureOfKind(this.gesture, 'nudge');
  }

  private get nudgeBefore() {
    return this.nudgeGesture?.before ?? null;
  }

  private get nudgeKeys(): Set<string> {
    return this.nudgeGesture?.keys ?? new Set<string>();
  }

  private get nudgeOperationId(): string | null {
    return this.nudgeGesture?.operationId ?? null;
  }

  private get nudgeStartTargets(): EditTarget[] {
    return this.nudgeGesture?.startTargets ?? [];
  }

  private get dragPointerId(): number | null {
    return gestureOfKind(this.gesture, 'pan')?.pointerId ?? null;
  }

  private get pinching(): boolean {
    return this.gesture.kind === 'pinch';
  }

  async mount(element: HTMLElement): Promise<void> {
    const width = Math.max(1, element.clientWidth);
    const height = Math.max(1, element.clientHeight);
    await ensureSceneTextFontsLoaded();
    await this.app.init({
      antialias: true,
      autoDensity: true,
      backgroundAlpha: 0,
      height,
      resolution: window.devicePixelRatio || 1,
      width,
    });
    if (this.destroyed) {
      this.app.destroy(true, { children: true, texture: true });
      return;
    }
    this.container = element;
    this.viewport = { height, width };
    this.mounted = true;
    this.fogRenderer.attach(this.app.renderer);

    // `autoDensity` owns the canvas's CSS size; only the box model is ours.
    const canvas = this.app.canvas;
    canvas.style.display = 'block';
    element.appendChild(canvas);
    element.tabIndex = 0;

    this.hatchTexture = createHatchTexture(
      readCssColor('--color-border', FALLBACK_HATCH_COLOR),
    );
    this.placeholderColor = readCssColor(
      '--color-border',
      FALLBACK_OUTLINE_COLOR,
    );
    // Back to front: scene fill, crosshatch, map image — all inside the camera
    // transform — then the grid and the scene's edge, drawn in screen space on
    // top so both stay a constant width.
    this.world.sortableChildren = true;
    this.tokenWorld.sortableChildren = true;
    this.gmWorld.sortableChildren = true;
    this.base.zIndex = 0;
    this.world.addChild(this.base);
    this.app.stage.addChild(this.world);
    this.app.stage.addChild(this.grid);
    this.app.stage.addChild(this.tokenWorld);
    this.app.stage.addChild(this.remotePaintGraphics);
    this.app.stage.addChild(this.paintPreviewGraphics);
    this.app.stage.addChild(this.selectionOverlay.selection);
    this.app.stage.addChild(this.selectionOverlay.marquee);
    this.app.stage.addChild(this.fogRenderer.sprite);
    this.gmWorld.alpha = 0.5;
    this.app.stage.addChild(this.gmWorld);
    this.app.stage.addChild(this.outline);
    this.app.stage.addChild(this.pingGraphics);
    this.app.stage.addChild(this.measurementGraphics);

    const measurementLabels = document.createElement('div');
    measurementLabels.className = styles.measurementLabels;
    measurementLabels.setAttribute('aria-hidden', 'true');
    element.appendChild(measurementLabels);
    this.measurementLabels = measurementLabels;

    element.addEventListener('wheel', this.handleWheel, { passive: false });
    element.addEventListener('pointerdown', this.handlePointerDown);
    element.addEventListener('pointermove', this.handlePointerMove);
    element.addEventListener('pointerup', this.handlePointerUp);
    element.addEventListener('pointercancel', this.handlePointerUp);
    element.addEventListener('dblclick', this.handleDoubleClick);
    element.addEventListener('contextmenu', this.handleContextMenu);
    element.addEventListener('blur', this.handleBlur);
    element.addEventListener('keydown', this.handleKeyDown);
    element.addEventListener('keyup', this.handleKeyUp);

    this.syncPaintCursor();

    this.rebuildScene();
  }

  setInteraction(options: SceneRendererInteraction): void {
    const layerChanged = options.activeLayer !== this.interaction.activeLayer;
    const networkUpdateRateChanged =
      options.networkUpdateRate !== this.interaction.networkUpdateRate;
    const editingDisabled =
      this.interaction.editable && !options.editable;
    const paintChanged =
      this.interaction.paintEnabled !== options.paintEnabled ||
      this.interaction.paintKind !== options.paintKind;
    const shapeChanged =
      this.interaction.shapeEnabled !== options.shapeEnabled ||
      this.interaction.shapeKind !== options.shapeKind;
    const fogChanged =
      this.interaction.fogEnabled !== options.fogEnabled ||
      this.interaction.fogMode !== options.fogMode ||
      this.interaction.fogSubtool !== options.fogSubtool;
    const measurementDisabled =
      this.interaction.measureEnabled && !options.measureEnabled;
    const textEditingDisabled =
      Boolean(this.activeTextEditor) &&
      (layerChanged || !options.editable ||
        (!options.textEnabled && !this.activeTextEditor?.draft.originalId));
    if (measurementDisabled) {
      this.cancelMeasurement();
    }
    if (paintChanged || layerChanged) {
      this.cancelPaintGesture();
    }
    if (editingDisabled || layerChanged) {
      this.cancelEditGesture();
      void this.finishNudge(true);
    }
    if (shapeChanged || layerChanged) {
      this.cancelShapeGesture();
    }
    if (fogChanged || layerChanged) {
      this.cancelFogGesture();
    }
    if (textEditingDisabled) {
      void this.finishTextEditor(true);
    }
    this.interaction = options;
    if (networkUpdateRateChanged) {
      this.drawingPreviewRateLimiter.rateChanged();
    }
    this.gmWorld.alpha = options.activeLayer === 'gm' ? 1 : 0.5;
    if (layerChanged) {
      this.selected.clear();
      this.groupSelectionRotation = 0;
    }
    this.syncPaintCursor();
    if (!options.pingEnabled) {
      this.cancelPendingPing();
      this.pingConsumedPointers.clear();
    }
    this.drawSelection();
    this.drawMeasurements();
    this.renderFog();
  }

  selectImages(ids: string[]): void {
    this.selected = new Set(ids);
    this.groupSelectionRotation = 0;
    this.drawSelection();
  }

  setScene(
    scene: SceneRecord | null,
    imageUrls: Record<string, string> | string | null,
  ): void {
    const sceneChanged = scene?.id !== this.scene?.id;
    const revisionChanged =
      scene?.id === this.scene?.id &&
      scene?.revision !== this.scene?.revision;
    if (sceneChanged || revisionChanged) {
      this.remotePaintPreviews.clear();
      this.remotePaintGraphics.clear();
      this.remoteShapePreviews.clear();
      this.remoteTransformStarts.clear();
    }
    if (sceneChanged) {
      this.remoteShapeSequences.clear();
    }
    if (sceneChanged) {
      void this.finishTextEditor(false);
      this.cancelPaintGesture();
      this.cancelShapeGesture();
      this.cancelFogGesture();
      this.cancelMeasurement();
      this.clearRemoteMeasurements();
      this.clearPings();
      this.cancelCameraAnimation();
      this.cancelPendingPing();
      this.pingConsumedPointers.clear();
      this.cancelEditGesture();
      void this.finishNudge(true);
    }
    if (
      !sceneChanged &&
      scene &&
      this.scene &&
      scene.revision !== this.scene.revision &&
      !this.committing
    ) {
      this.cancelEditGesture();
      void this.finishNudge(true);
    }
    this.scene = scene;
    const textFontContent = scene
      ? Object.values(scene.texts)
          .flat()
          .map((text) => text.content)
          .join('\n')
      : '';
    const hasShapeLabels = Boolean(
      scene && Object.values(scene.shapes).some((layer) => layer.length > 0),
    );
    if (scene && (textFontContent || hasShapeLabels)) {
      const expectedSceneId = scene.id;
      const expectedRevision = scene.revision;
      void ensureSceneTextFontsLoaded(textFontContent || undefined).then(() => {
        if (
          this.scene?.id === expectedSceneId &&
          this.scene.revision === expectedRevision
        ) {
          this.rebuildScene();
          this.drawSelection();
        }
      });
    }
    this.selected = new Set(
      [...this.selected].filter((id) => this.target(id) !== null),
    );
    this.imageUrls =
      typeof imageUrls === 'object' && imageUrls !== null ? imageUrls : {};
    this.additionalImages.setSceneState(scene, this.imageUrls);
    const mapAssetId = scene?.mapImage?.assetId ?? null;
    const imageUrl =
      typeof imageUrls === 'string'
        ? imageUrls
        : scene?.mapImage
          ? this.imageUrls[scene.mapImage.assetId] ?? null
          : null;
    const sharedMapResourceReady = Boolean(
      mapAssetId &&
        this.imageResources.has(mapAssetId),
    );
    if (
      imageUrl &&
      !sharedMapResourceReady &&
      (imageUrl !== this.imageUrl ||
        mapAssetId !== this.mapResourceAssetId)
    ) {
      this.imageUrl = imageUrl;
      void this.loadMapTexture(imageUrl, mapAssetId);
    } else if (mapAssetId && sharedMapResourceReady) {
      if (
        imageUrl &&
        !this.imageResources.matchesOrLoads(mapAssetId, imageUrl)
      ) {
        void this.additionalImages.loadAsset(mapAssetId, imageUrl);
      }
      if (mapAssetId !== this.mapResourceAssetId && this.mapResourceAssetId) {
        this.replaceMapResource(null, null, null);
      }
    } else if (!mapAssetId) {
      this.imageUrl = null;
      this.replaceMapResource(null, null, null);
    } else if (
      mapAssetId !== this.mapResourceAssetId &&
      !sharedMapResourceReady &&
      !imageUrl
    ) {
      // The URL hook retains known resources while it acquires new ones. A
      // genuinely different map with no available resource must not render the
      // previous map's texture in the meantime.
      this.imageUrl = null;
      this.replaceMapResource(null, null, null);
    }
    if (!this.mounted) {
      return;
    }
    this.rebuildScene();
    if (sceneChanged) {
      this.selected.clear();
      this.groupSelectionRotation = 0;
      this.fitToScene();
    }
  }

  resize(width: number, height: number): void {
    this.viewport = {
      height: Math.max(1, height),
      width: Math.max(1, width),
    };
    if (!this.mounted) {
      return;
    }
    this.app.renderer.resize(this.viewport.width, this.viewport.height);
    this.applyCamera();
  }

  fitToScene(): void {
    this.cancelCameraAnimation();
    this.camera = this.scene
      ? fitToScene(this.scene, this.viewport)
      : createCamera();
    this.applyCamera();
  }

  destroy(): void {
    this.cancelMeasurement();
    this.cancelPaintGesture();
    this.cancelShapeGesture();
    this.cancelFogGesture();
    this.drawingPreviewRateLimiter.clear();
    this.remotePaintPreviews.clear();
    this.remotePaintGraphics.clear();
    this.remoteTransformStarts.clear();
    this.clearRemoteMeasurements();
    this.destroyed = true;
    this.clearPings();
    this.cancelCameraAnimation();
    this.cancelPendingPing();
    this.pingConsumedPointers.clear();
    const element = this.container;
    if (element) {
      element.removeEventListener('wheel', this.handleWheel);
      element.removeEventListener('pointerdown', this.handlePointerDown);
      element.removeEventListener('pointermove', this.handlePointerMove);
      element.removeEventListener('pointerup', this.handlePointerUp);
      element.removeEventListener('pointercancel', this.handlePointerUp);
      element.removeEventListener('dblclick', this.handleDoubleClick);
      element.removeEventListener('contextmenu', this.handleContextMenu);
      element.removeEventListener('blur', this.handleBlur);
      element.removeEventListener('keydown', this.handleKeyDown);
      element.removeEventListener('keyup', this.handleKeyUp);
    }
    this.container = null;
    this.finishTextEditor(false);
    this.measurementLabels?.remove();
    this.measurementLabels = null;
    this.mapTexture?.destroy(true);
    this.mapTexture = null;
    this.mapResourceAssetId = null;
    this.hatchTexture?.destroy(true);
    this.hatchTexture = null;
    this.drawingRenderer.clear();
    this.shapeRenderer.clear();
    this.textRenderer.clear();
    this.additionalImages.destroy();
    this.fogRenderer.destroy();
    this.mapPlaceholder?.destroy();
    this.mapPlaceholder = null;
    this.mapGifSource?.destroy();
    this.mapGifSource = null;
    this.mapSpriteKind = null;
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
    if (this.touchLongPressTimer) {
      clearTimeout(this.touchLongPressTimer);
      this.touchLongPressTimer = null;
    }
    this.closeContextMenu();
    if (this.mounted) {
      this.mounted = false;
      this.app.destroy(true, { children: true, texture: true });
    }
  }

  private async loadMapTexture(
    url: string | null,
    assetId: string | null,
  ): Promise<void> {
    const token = (this.imageToken += 1);
    if (!url) {
      this.replaceMapResource(null, null, null);
      return;
    }
    let resource: Awaited<ReturnType<typeof loadImageResource>> = {
      gif: null,
      gifSpriteClass: null,
      texture: null,
    };
    try {
      resource = await loadImageResource(url);
    } catch {
      // A missing or undecodable image is rendered as a transformed placeholder.
    }
    if (this.destroyed || token !== this.imageToken) {
      resource.texture?.destroy(true);
      resource.gif?.destroy();
      return;
    }
    this.imageResources.rememberSpriteClass(resource.gifSpriteClass);
    this.replaceMapResource(resource.texture, resource.gif, assetId);
  }

  private replaceMapResource(
    texture: Texture | null,
    gif: GifSource | null,
    assetId: string | null,
  ): void {
    const previousTexture = this.mapTexture;
    const previousGif = this.mapGifSource;
    const previousAssetId = this.mapResourceAssetId;
    const previousStillPlaced = Boolean(
      previousAssetId &&
        (Object.values(
          this.scene?.images ?? createEmptyImageLayers(),
        ) as SceneImage[][]).some((layer) =>
          layer.some((image) => image.assetId === previousAssetId),
        ),
    );
    let transferredTexture = false;
    let transferredGif = false;
    if (
      previousAssetId &&
      previousStillPlaced &&
      previousTexture &&
      !this.imageResources.texture(previousAssetId)
    ) {
      transferredTexture = this.imageResources.adopt(
        previousAssetId,
        this.imageUrl,
        { gif: null, texture: previousTexture },
      ).texture;
    }
    if (
      previousAssetId &&
      previousStillPlaced &&
      previousGif &&
      !this.imageResources.gif(previousAssetId)
    ) {
      transferredGif = this.imageResources.adopt(
        previousAssetId,
        this.imageUrl,
        { gif: previousGif, texture: null },
      ).gif;
    }

    const nextKind = gif ? 'gif' : texture ? 'texture' : null;
    if (this.mapSprite && this.mapSpriteKind !== nextKind) {
      this.mapSprite.destroy();
      this.mapSprite = null;
    }
    this.mapSpriteKind = nextKind;
    this.mapTexture = texture;
    this.mapGifSource = gif;
    this.mapResourceAssetId = assetId;
    this.rebuildScene();
    if (
      previousTexture &&
      previousTexture !== texture &&
      !transferredTexture
    ) {
      previousTexture.destroy(true);
    }
    if (previousGif && previousGif !== gif && !transferredGif) {
      previousGif.destroy();
    }
  }

  private rebuildScene(): void {
    if (!this.mounted) {
      return;
    }
    this.drawSceneSurface();
    this.drawMap();
    this.additionalImages.render(
      this.scene,
      this.imageUrls,
      { gm: this.gmWorld, map: this.world, token: this.tokenWorld },
      {
        assetId: this.mapResourceAssetId,
        gif: this.mapGifSource,
        texture: this.mapTexture,
        url: this.imageUrl,
      },
    );
    this.drawingRenderer.render(
      this.scene?.drawings ?? null,
      this.scene?.objectOrder,
    );
    this.textRenderer.render(this.scene?.texts ?? null, {
      gm: this.gmWorld,
      map: this.world,
      token: this.tokenWorld,
    }, this.scene?.objectOrder);
    this.applyCamera();
  }

  private renderShapes(): void {
    if (!this.scene) {
      this.shapeRenderer.render(null, null, this.camera.zoom);
      return;
    }
    const hasPreviews = this.draftShape || this.remoteShapePreviews.size > 0;
    const layers = hasPreviews
      ? {
          gm: [...this.scene.shapes.gm],
          map: [...this.scene.shapes.map],
          token: [...this.scene.shapes.token],
        }
      : this.scene.shapes;
    if (this.draftShape) {
      const layer = this.interaction.actorId == null
        ? this.interaction.activeLayer
        : 'token';
      layers[layer].push(this.draftShape);
    }
    for (const { preview } of this.remoteShapePreviews.values()) {
      if (!preview.shape || preview.phase === 'cancel') {
        continue;
      }
      layers[preview.layer].push({
        ...structuredClone(preview.shape),
        ownerId: null,
        revision: 0,
      });
    }
    const halfWidth = this.viewport.width / (2 * this.camera.zoom);
    const halfHeight = this.viewport.height / (2 * this.camera.zoom);
    this.shapeRenderer.render(layers, this.scene, this.camera.zoom, {
      maxX: this.camera.x + halfWidth,
      maxY: this.camera.y + halfHeight,
      minX: this.camera.x - halfWidth,
      minY: this.camera.y - halfHeight,
    });
  }

  /**
   * The scene's fill and crosshatch, in scene coordinates. The tile is never
   * rescaled, so the hatch spans the scene with the same number of lines at
   * every zoom — it reads as a texture on the surface rather than a pattern
   * laid over the viewport, whose spacing across the map would shift as you
   * zoom in and out.
   */
  private drawSceneSurface(): void {
    if (!this.scene || !this.hatchTexture) {
      this.hatch?.destroy();
      this.hatch = null;
      this.base.clear();
      return;
    }

    // Deliberately lighter than the play screen's backdrop: an empty scene has
    // to read as a distinct surface, not as more of the same void.
    this.base
      .clear()
      .rect(0, 0, this.scene.width, this.scene.height)
      .fill({
        color: readCssColor('--color-surface-raised', FALLBACK_SURFACE_COLOR),
      });

    if (!this.hatch) {
      this.hatch = new TilingSprite({
        height: this.scene.height,
        texture: this.hatchTexture,
        width: this.scene.width,
      });
      this.hatch.zIndex = 1;
      this.world.addChild(this.hatch);
    }
    this.hatch.width = this.scene.width;
    this.hatch.height = this.scene.height;
  }

  private drawMap(): void {
    const placement = this.scene?.mapImage ?? null;
    if (!placement) {
      this.mapSprite?.destroy();
      this.mapSprite = null;
      this.mapSpriteKind = null;
      this.mapPlaceholder?.destroy();
      this.mapPlaceholder = null;
      return;
    }
    const ownsResource = this.mapResourceAssetId === placement.assetId;
    const texture =
      this.imageResources.texture(placement.assetId) ??
      (ownsResource ? this.mapTexture : null);
    const gif =
      this.imageResources.gif(placement.assetId) ??
      (ownsResource ? this.mapGifSource : null);
    const gifSpriteClass = this.imageResources.spriteClass;
    const nextKind = gif ? 'gif' : texture ? 'texture' : null;
    if (!texture && (!gif || !gifSpriteClass)) {
      this.mapSprite?.destroy();
      this.mapSprite = null;
      this.mapSpriteKind = null;
      if (!this.mapPlaceholder) {
        this.mapPlaceholder = new Graphics();
        this.mapPlaceholder.zIndex = MAP_IMAGE_Z_INDEX;
        this.world.addChild(this.mapPlaceholder);
      }
      drawImagePlaceholder(
        this.mapPlaceholder,
        placement,
        true,
        this.placeholderColor,
      );
      return;
    }
    this.mapPlaceholder?.destroy();
    this.mapPlaceholder = null;
    if (this.mapSprite && this.mapSpriteKind !== nextKind) {
      this.mapSprite.destroy();
      this.mapSprite = null;
    }
    if (!this.mapSprite) {
      this.mapSprite =
        gif && gifSpriteClass
          ? new gifSpriteClass(gif)
          : new Sprite();
      this.mapSpriteKind = nextKind;
      this.mapSprite.zIndex = MAP_IMAGE_Z_INDEX;
      this.world.addChild(this.mapSprite);
    }
    if (texture) {
      this.mapSprite.texture = texture;
    }
    this.mapSprite.anchor.set(0.5);
    // A placement recorded before the image reported its size falls back to the
    // texture's own dimensions rather than collapsing to nothing.
    this.mapSprite.width =
      placement.width > 0
        ? placement.width
        : (texture?.width ?? gif?.width ?? 1);
    this.mapSprite.height =
      placement.height > 0
        ? placement.height
        : (texture?.height ?? gif?.height ?? 1);
    this.mapSprite.position.set(placement.x, placement.y);
    this.mapSprite.angle = placement.rotation;
  }

  clientToScene(clientX: number, clientY: number): { x: number; y: number } {
    return screenToScene(
      this.camera,
      this.viewport,
      this.localPoint({ clientX, clientY } as MouseEvent),
    );
  }

  showPing(ping: RendererMapPing, centerCamera = false): void {
    if (!this.scene || ping.sceneId !== this.scene.id) {
      return;
    }
    if (this.activePings.has(ping.id)) {
      return;
    }
    this.activePings.set(ping.id, {
      ...ping,
      startedAt: Date.now(),
    });
    if (centerCamera) {
      this.cameraAnimation = {
        fromX: this.camera.x,
        fromY: this.camera.y,
        startedAt: Date.now(),
        targetX: ping.x,
        targetY: ping.y,
      };
    }
    this.drawPings();
    this.startAnimationLoop();
  }

  showMeasurement(update: MeasurementEvent): void {
    if (
      !this.scene ||
      update.campaignId.length === 0 ||
      update.sceneId !== this.scene.id
    ) {
      return;
    }
    const previousSequence =
      this.remoteMeasurementVersions.get(update.sourceId) ?? -1;
    if (update.updateSequence <= previousSequence) {
      return;
    }
    this.remoteMeasurementVersions.set(
      update.sourceId,
      update.updateSequence,
    );
    if (!update.active) {
      this.remoteMeasurements.delete(update.sourceId);
    } else {
      this.remoteMeasurements.set(update.sourceId, {
        lastAt: Date.now(),
        update: {
          ...update,
          points: update.points.map((point) => ({ ...point })),
        },
      });
    }
    this.drawMeasurements();
    if (this.remoteMeasurements.size > 0) {
      this.startAnimationLoop();
    } else {
      this.stopAnimationLoopIfIdle();
    }
  }

  showDrawingPreview(preview: DrawingPreviewEvent): void {
    if (!this.scene || preview.sceneId !== this.scene.id) {
      return;
    }
    const key = `${preview.sourceId}:${preview.operationId}`;
    const previous = this.remotePaintPreviews.get(key)?.preview;
    if (previous && preview.sequence <= previous.sequence) {
      return;
    }
    if (!preview.active) {
      this.remotePaintPreviews.delete(key);
    } else {
      this.remotePaintPreviews.set(key, {
        lastAt: Date.now(),
        preview: structuredClone(preview),
      });
      const sequence = preview.sequence;
      setTimeout(() => {
        const current = this.remotePaintPreviews.get(key);
        if (
          current?.preview.sequence === sequence &&
          Date.now() - current.lastAt >= MEASUREMENT_EXPIRY_MS
        ) {
          this.remotePaintPreviews.delete(key);
          this.drawRemotePaintPreviews();
        }
      }, MEASUREMENT_EXPIRY_MS + 20);
    }
    this.drawRemotePaintPreviews();
  }

  showShapePreview(preview: ShapePreviewEvent): void {
    if (!this.scene || preview.sceneId !== this.scene.id) {
      return;
    }
    const key = `${preview.sourceId}:${preview.operationId}`;
    if (preview.sequence <= (this.remoteShapeSequences.get(key) ?? -1)) {
      return;
    }
    this.remoteShapeSequences.delete(key);
    this.remoteShapeSequences.set(key, preview.sequence);
    if (this.remoteShapeSequences.size > 512) {
      const oldest = this.remoteShapeSequences.keys().next().value;
      if (oldest) {
        this.remoteShapeSequences.delete(oldest);
      }
    }
    if (preview.phase === 'cancel') {
      this.remoteShapePreviews.delete(key);
    } else {
      this.remoteShapePreviews.set(key, {
        lastAt: Date.now(),
        preview: structuredClone(preview),
      });
      const sequence = preview.sequence;
      setTimeout(() => {
        const current = this.remoteShapePreviews.get(key);
        if (
          current?.preview.sequence === sequence &&
          Date.now() - current.lastAt >= SHAPE_PREVIEW_EXPIRY_MS
        ) {
          this.remoteShapePreviews.delete(key);
          this.renderShapes();
        }
      }, SHAPE_PREVIEW_EXPIRY_MS + 20);
    }
    this.renderShapes();
  }

  showTransformStarted(input: SceneTransformPreviewStart): void {
    if (
      !this.scene ||
      input.sceneId !== this.scene.id ||
      input.revision !== this.scene.revision
    ) {
      return;
    }
    this.remoteTransformStarts.set(input.operationId, {
      base: structuredClone(this.scene),
      input: structuredClone(input),
    });
  }

  showTransformPreview(input: SceneTransformPreviewDelta): void {
    const active = this.remoteTransformStarts.get(input.operationId);
    if (!active) {
      return;
    }
    this.scene = applySceneTransformPreview(
      active.base,
      active.input,
      input,
    );
    this.rebuildScene();
  }

  showTransformCancelled(input: SceneTransformPreviewCancel): void {
    const active = this.remoteTransformStarts.get(input.operationId);
    if (!active || active.base.id !== input.sceneId) {
      return;
    }
    this.remoteTransformStarts.delete(input.operationId);
    this.scene = active.base;
    this.rebuildScene();
  }

  private nextMeasurementSequence(): number {
    this.measurementUpdateSequence =
      (this.measurementUpdateSequence + 1) >>> 0;
    return this.measurementUpdateSequence;
  }

  private currentMeasurementPoints(): MeasurementPoint[] {
    return measurementGesturePoints(this.activeMeasurement);
  }

  private addMeasurementPivot(clientX: number, clientY: number): void {
    const measurement = this.activeMeasurement;
    if (!measurement || !this.scene) {
      return;
    }
    const point = screenToScene(
      this.camera,
      this.viewport,
      this.localPoint({ clientX, clientY } as MouseEvent),
    );
    addMeasurementPivot(
      measurement,
      this.scene,
      point,
      MAX_MEASUREMENT_POINTS,
    );
    this.emitMeasurementSnapshot(true);
    this.drawMeasurements();
  }

  private emitMeasurementSnapshot(force = false, now = Date.now()): void {
    const measurement = this.activeMeasurement;
    if (!measurement) {
      return;
    }
    const update = activeMeasurementUpdate(
      measurement,
      (this.measurementUpdateSequence + 1) >>> 0,
      now,
      MEASUREMENT_UPDATE_INTERVAL_MS,
      force,
    );
    if (update) {
      this.measurementUpdateSequence = update.updateSequence;
      this.interaction.onMeasurementUpdate?.(update);
    }
  }

  private cancelMeasurement(): void {
    const measurement = this.activeMeasurement;
    if (!measurement) {
      return;
    }
    this.activeMeasurement = null;
    this.interaction.onMeasurementUpdate?.(
      inactiveMeasurementUpdate(
        measurement,
        this.nextMeasurementSequence(),
      ),
    );
    if (
      this.container?.hasPointerCapture(measurement.pointerId)
    ) {
      this.container.releasePointerCapture(measurement.pointerId);
    }
    if (this.container) {
      this.container.style.cursor = '';
    }
    this.drawMeasurements();
    this.stopAnimationLoopIfIdle();
  }

  private clearRemoteMeasurements(): void {
    this.remoteMeasurements.clear();
    this.remoteMeasurementVersions.clear();
    this.drawMeasurements();
    this.stopAnimationLoopIfIdle();
  }

  private measurementPaths(): MeasurementPoint[][] {
    const paths = [...this.remoteMeasurements.values()].map(
      ({ update }) => update.points,
    );
    if (this.activeMeasurement) {
      paths.push(this.currentMeasurementPoints());
    }
    return paths;
  }

  private drawMeasurements(now = Date.now()): void {
    this.measurementGraphics.clear();
    this.measurementLabels?.replaceChildren();
    if (!this.scene) {
      return;
    }
    for (const [sourceId, measurement] of this.remoteMeasurements) {
      if (now - measurement.lastAt >= MEASUREMENT_EXPIRY_MS) {
        this.remoteMeasurements.delete(sourceId);
      }
    }
    const lineColor = readCssColor('--color-focus', '#eeeeee');
    const markerFill = readCssColor('--color-play-canvas', '#161616');
    for (const points of this.measurementPaths()) {
      if (points.length === 0) {
        continue;
      }
      const screenPoints = points.map((point) =>
        sceneToScreen(this.camera, this.viewport, point),
      );
      this.measurementGraphics.moveTo(
        screenPoints[0].x,
        screenPoints[0].y,
      );
      for (const point of screenPoints.slice(1)) {
        this.measurementGraphics.lineTo(point.x, point.y);
      }
      this.measurementGraphics.stroke({
        color: lineColor,
        width: 2,
      });
      for (const point of screenPoints) {
        this.measurementGraphics
          .circle(point.x, point.y, 4)
          .fill({ color: markerFill })
          .stroke({ color: lineColor, width: 2 });
      }
      const distances = cumulativeMeasurementDistances(this.scene, points);
      const firstLabelIndex = points.length === 1 ? 0 : 1;
      for (
        let index = firstLabelIndex;
        index < screenPoints.length;
        index += 1
      ) {
        if (!this.measurementLabels) {
          break;
        }
        const label = document.createElement('span');
        label.className = styles.measurementLabel;
        label.textContent = formatMeasurementDistance(
          distances[index],
          this.scene.unit,
        );
        label.style.left = `${screenPoints[index].x}px`;
        label.style.top = `${screenPoints[index].y}px`;
        this.measurementLabels.appendChild(label);
      }
    }
  }

  private requestPing(
    point: { x: number; y: number },
    pullPlayers: boolean,
  ): void {
    if (
      !this.scene ||
      !this.interaction.pingEnabled ||
      !this.interaction.onPing
    ) {
      return;
    }
    const now = Date.now();
    if (!canSendPing(this.lastSentPingAt, now, MAP_PING_COOLDOWN_MS)) {
      return;
    }
    this.lastSentPingAt = now;
    this.interaction.onPing({
      id: crypto.randomUUID(),
      pullPlayers,
      sceneId: this.scene.id,
      x: point.x,
      y: point.y,
    });
  }

  private drawPings(now = Date.now()): void {
    this.pingGraphics.clear();
    const color = readCssColor('--color-focus', '#eeeeee');
    for (const [id, ping] of this.activePings) {
      const progress = Math.max(
        0,
        Math.min(1, (now - ping.startedAt) / MAP_PING_DURATION_MS),
      );
      if (progress >= 1) {
        this.activePings.delete(id);
        continue;
      }
      const point = sceneToScreen(this.camera, this.viewport, ping);
      const eased = 1 - (1 - progress) ** 3;
      const alpha = 1 - progress;
      const radius = 8 + eased * 30;
      this.pingGraphics
        .circle(point.x, point.y, 2.5)
        .fill({ alpha, color })
        .circle(point.x, point.y, radius)
        .stroke({ alpha, color, width: 2 });
      if (ping.pullPlayers) {
        const secondProgress = Math.max(0, Math.min(1, progress * 1.25));
        this.pingGraphics
          .circle(
            point.x,
            point.y,
            14 + (1 - (1 - secondProgress) ** 3) * 34,
          )
          .stroke({
            alpha: Math.max(0, 0.9 - secondProgress),
            color,
            width: 2,
          });
      }
    }
  }

  private clearPings(): void {
    this.activePings.clear();
    this.pingGraphics.clear();
    this.stopAnimationLoopIfIdle();
  }

  private startAnimationLoop(): void {
    if (this.animationTimer) {
      return;
    }
    this.animationTimer = setInterval(
      this.tickAnimations,
      ANIMATION_FRAME_MS,
    );
  }

  private readonly tickAnimations = () => {
    const now = Date.now();
    if (
      this.activeMeasurement &&
      now - this.activeMeasurement.lastSentAt >= MEASUREMENT_KEEPALIVE_MS
    ) {
      this.emitMeasurementSnapshot(true, now);
    }
    if (this.cameraAnimation) {
      const progress = Math.max(
        0,
        Math.min(
          1,
          (now - this.cameraAnimation.startedAt) /
            CAMERA_PULL_DURATION_MS,
        ),
      );
      const eased = 1 - (1 - progress) ** 3;
      this.camera = {
        ...this.camera,
        x:
          this.cameraAnimation.fromX +
          (this.cameraAnimation.targetX - this.cameraAnimation.fromX) *
            eased,
        y:
          this.cameraAnimation.fromY +
          (this.cameraAnimation.targetY - this.cameraAnimation.fromY) *
            eased,
      };
      if (progress >= 1) {
        this.cameraAnimation = null;
      }
      this.applyCamera();
    } else {
      this.drawPings(now);
      this.drawMeasurements(now);
    }
    this.stopAnimationLoopIfIdle();
  };

  private stopAnimationLoopIfIdle(): void {
    if (
      this.animationTimer &&
      this.activePings.size === 0 &&
      !this.cameraAnimation &&
      !this.activeMeasurement &&
      this.remoteMeasurements.size === 0
    ) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
  }

  private cancelCameraAnimation(): void {
    this.cameraAnimation = null;
    this.stopAnimationLoopIfIdle();
  }

  private startEditPreview(): void {
    const edit = this.editGesture;
    if (
      !this.scene ||
      !edit ||
      edit.mode === 'marquee' ||
      this.interaction.activeLayer === 'gm' ||
      edit.previewOperationId ||
      this.pendingPing?.pointerId === edit.pointerId
    ) {
      return;
    }
    const selected = this.selectedTargets();
    if (selected.length === 0) {
      return;
    }
    const frame = this.selectionFrame(selected);
    edit.previewPivot = frame?.center ?? selected[0].image;
    edit.previewOperationId = crypto.randomUUID();
    this.interaction.onPreviewStart?.({
      kind: edit.mode === 'semantic' ? 'resize' : edit.mode,
      operationId: edit.previewOperationId,
      pivotX: edit.previewPivot.x,
      pivotY: edit.previewPivot.y,
      revision: this.scene.revision,
      sceneId: this.scene.id,
      startingTransforms: selected.map((target) => ({
        id: target.id,
        transform: target.drawing
          ? drawingTransformOf(target.drawing)
          : target.text
            ? textTransformOf(target.text)
          : imageTransformOf(target.image),
      })),
      targets: selected.map((target) => target.id),
    });
  }

  private target(id: string): SceneMapImage | null {
    if (!this.scene) {
      return null;
    }
    if (id === CANONICAL_MAP_ID) {
      return this.scene.mapImage;
    }
    for (const layer of Object.values(
      this.scene.images,
    ) as SceneImage[][]) {
      const image = layer.find((candidate) => candidate.id === id);
      if (image) {
        return image;
      }
    }
    for (const layer of Object.values(
      this.scene.drawings,
    ) as SceneDrawing[][]) {
      const drawing = layer.find((candidate) => candidate.id === id);
      if (drawing && canEditDrawing(drawing, this.interaction.actorId)) {
        return drawingAsImage(drawing);
      }
    }
    for (const layer of Object.values(this.scene.shapes)) {
      const shape = layer.find((candidate) => candidate.id === id);
      if (shape && canEditShape(shape, this.interaction.actorId)) {
        return shapeAsImage(shape);
      }
    }
    for (const layer of Object.values(this.scene.texts)) {
      const text = layer.find((candidate) => candidate.id === id);
      const bounds = this.textRenderer.bounds(id);
      if (text && bounds && canEditText(text, this.interaction.actorId)) {
        return textAsImage(text, bounds);
      }
    }
    return null;
  }

  private activeTargets(): EditTarget[] {
    return this.scene
      ? activeSceneTargets(
          this.scene,
          this.interaction,
          (id) => this.textRenderer.bounds(id),
        )
      : [];
  }

  private selectedTargets(): EditTarget[] {
    return this.scene
      ? selectedSceneTargets(
          this.scene,
          this.selected,
          this.interaction,
          (id) => this.textRenderer.bounds(id),
        )
      : [];
  }

  private selectionFrame(
    targets = this.selectedTargets(),
    groupAngle = this.groupSelectionRotation,
  ): {
    angle: number;
    center: { x: number; y: number };
    corners: Array<{ x: number; y: number }>;
    height: number;
    width: number;
  } | null {
    return selectionFrame(targets, groupAngle);
  }

  private applyState(state: SceneObjectState): void {
    if (!this.scene) {
      return;
    }
    this.scene = { ...this.scene, ...state };
    this.rebuildScene();
  }

  private async commitState(
    before: SceneObjectState,
    after: SceneObjectState,
    beforeRotation = this.groupSelectionRotation,
    operationId: string = crypto.randomUUID(),
    arrangement?: SceneArrangement,
  ): Promise<boolean> {
    if (!this.scene || JSON.stringify(before) === JSON.stringify(after)) {
      return false;
    }
    const sceneId = this.scene.id;
    this.applyState(after);
    this.committing = true;
    let result: SceneRecord | null | undefined;
    try {
      result = await this.interaction.onCommit?.(
        after,
        operationId,
        arrangement,
      );
    } catch {
      result = null;
    } finally {
      this.committing = false;
    }
    if (!result) {
      this.applyState(before);
      this.groupSelectionRotation = beforeRotation;
      this.interaction.onPreviewCancel?.(operationId, sceneId);
      return false;
    }
    this.scene = result;
    this.rebuildScene();
    return true;
  }

  private localPoint(event: PointerEvent | MouseEvent) {
    const rect = this.container?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  }

  private scenePointInside(
    screenPoint: { x: number; y: number },
  ): { x: number; y: number } | null {
    if (!this.scene) {
      return null;
    }
    const point = screenToScene(this.camera, this.viewport, screenPoint);
    return point.x >= 0 &&
      point.x <= this.scene.width &&
      point.y >= 0 &&
      point.y <= this.scene.height
      ? point
      : null;
  }

  private editableTextAt(
    screenPoint: { x: number; y: number },
  ): SceneText | null {
    const point = screenToScene(this.camera, this.viewport, screenPoint);
    if (this.playerFogCovers(point)) {
      return null;
    }
    const targets = this.activeTargets();
    for (let index = targets.length - 1; index >= 0; index -= 1) {
      const target = targets[index];
      if (target.text && containsPoint(target.image, point)) {
        return target.text;
      }
    }
    return null;
  }

  private beginTextEditor(
    point: { x: number; y: number },
    existing: SceneText | null = null,
  ): void {
    if (
      !this.container ||
      !this.scene ||
      (!this.interaction.editable && !this.interaction.textEnabled)
    ) {
      return;
    }
    if (this.activeTextEditor) {
      void this.finishTextEditor(true);
      return;
    }
    const style = structuredClone(existing?.style ?? this.interaction.textStyle);
    if (!style) {
      return;
    }
    const draft: SceneTextEditorDraft = {
      layer: this.interaction.activeLayer,
      originalId: existing?.id ?? null,
      point: existing ? { x: existing.x, y: existing.y } : point,
      rotation: existing?.rotation ?? 0,
      scaleX: existing?.scaleX ?? 1,
      scaleY: existing?.scaleY ?? 1,
      style,
    };
    const editor: SceneTextEditorController = new SceneTextEditorController({
      container: this.container,
      draft,
      editorClassName: styles.textEditor,
      errorClassName: styles.textEditorError,
      initialContent: existing?.content ?? '',
      label: existing ? 'Edit map text' : 'New map text',
      onChange: () => this.syncTextEditor(),
      onClose: () => this.closeTextEditor(editor),
      onCommit: (): Promise<string | null> => this.commitTextEditor(editor),
    });
    this.activeTextEditor = editor;
    this.syncTextEditor();
  }

  private syncTextEditor(loadFonts = true): void {
    const editor = this.activeTextEditor;
    if (!editor) {
      return;
    }
    const { draft } = editor;
    const content = editor.content;
    const screen = sceneToScreen(this.camera, this.viewport, draft.point);
    const fontSize = draft.style.fontSize * this.camera.zoom;
    const strokeWidth = draft.style.strokeWidth * this.camera.zoom;
    const previewCandidate: SceneText = {
      content,
      id: draft.originalId ?? LOCAL_TEXT_PREVIEW_ID,
      ownerId: null,
      revision: 0,
      rotation: draft.rotation,
      scaleX: draft.scaleX,
      scaleY: draft.scaleY,
      style: draft.style,
      x: draft.point.x,
      y: draft.point.y,
    };
    const parsedPreview = sceneTextSchema.safeParse(previewCandidate);
    const previewBounds = this.textRenderer.renderPreview(
      {
        hiddenTextId: draft.originalId,
        layer: draft.layer,
        text: parsedPreview.success ? parsedPreview.data : null,
      },
      { gm: this.gmWorld, map: this.world, token: this.tokenWorld },
    );
    editor.layout({
      fontFamily: sceneTextFontStack(draft.style.fontFamily)
        .map((family) => `"${family}"`)
        .join(', '),
      fontSize,
      left: screen.x,
      minimumHeight: fontSize * 1.25,
      minimumWidth: fontSize * 2,
      padding: strokeWidth + 2,
      previewHeight: (previewBounds?.height ?? 0) * this.camera.zoom,
      previewWidth: (previewBounds?.width ?? 0) * this.camera.zoom,
      rotation: draft.rotation,
      scaleX: draft.scaleX,
      scaleY: draft.scaleY,
      top: screen.y,
    });
    if (loadFonts && content) {
      if (this.textDraftFontTimer) {
        clearTimeout(this.textDraftFontTimer);
      }
      this.textDraftFontTimer = setTimeout(() => {
        this.textDraftFontTimer = null;
        void ensureSceneTextFontsLoaded(content).then(() => {
          if (this.activeTextEditor === editor && editor.content === content) {
            this.syncTextEditor(false);
          }
        });
      }, 80);
    }
  }

  private async finishTextEditor(commit: boolean): Promise<void> {
    const editor = this.activeTextEditor;
    if (!editor) {
      return;
    }
    if (!commit) {
      editor.cancel();
      return;
    }
    await editor.commit();
  }

  private async commitTextEditor(
    editor: SceneTextEditorController,
  ): Promise<string | null> {
    if (this.activeTextEditor !== editor || !this.scene) {
      return 'The active scene changed before the text could be saved.';
    }
    const { draft } = editor;
    const content = editor.content;
    if (!/\S/u.test(content)) {
      return null;
    }
    const before = sceneObjectStateOf(this.scene);
    const after = structuredClone(before);
    let text: SceneText;
    if (draft.originalId) {
      const existing = after.texts[draft.layer].find(
        (candidate) => candidate.id === draft.originalId,
      );
      if (!existing || existing.content === content) {
        return null;
      }
      existing.content = content;
      text = existing;
    } else {
      text = {
        content,
        id: crypto.randomUUID(),
        ownerId: null,
        revision: 0,
        rotation: draft.rotation,
        scaleX: draft.scaleX,
        scaleY: draft.scaleY,
        style: draft.style,
        x: draft.point.x,
        y: draft.point.y,
      };
      after.texts[draft.layer].push(text);
      after.objectOrder[draft.layer].push(text.id);
    }
    const textValidation = sceneTextSchema.safeParse(text);
    if (!textValidation.success) {
      return textValidation.error.issues[0]?.message ?? 'Text is not valid.';
    }
    const layersValidation = sceneTextLayersSchema.safeParse(after.texts);
    if (!layersValidation.success) {
      return layersValidation.error.issues[0]?.message ?? 'Text is not valid.';
    }
    this.committing = true;
    let saved: SceneRecord | null | undefined;
    try {
      saved = await this.interaction.onCommit?.(after, crypto.randomUUID());
    } catch {
      saved = null;
    } finally {
      this.committing = false;
    }
    if (!saved) {
      return 'Text could not be saved because the scene changed. Try again.';
    }
    this.scene = saved;
    this.rebuildScene();
    return null;
  }

  private closeTextEditor(editor: SceneTextEditorController): void {
    if (this.activeTextEditor === editor) {
      this.activeTextEditor = null;
      if (this.textDraftFontTimer) {
        clearTimeout(this.textDraftFontTimer);
        this.textDraftFontTimer = null;
      }
      this.textRenderer.clearPreview();
    }
    this.container?.focus();
  }

  private placedImageAt(point: { x: number; y: number }): boolean {
    const layers = this.scene?.images ?? createEmptyImageLayers();
    return (Object.values(layers) as SceneImage[][]).some((images) =>
      images.some((image) => containsPoint(image, point)),
    );
  }

  private editableDrawingAt(point: { x: number; y: number }): boolean {
    return this.activeTargets().some(
      (target) =>
        target.drawing &&
        containsDrawingPoint(target.drawing, point, 6 / this.camera.zoom),
    );
  }

  private editableShapeAt(point: { x: number; y: number }): boolean {
    return this.activeTargets().some(
      (target) => target.shape && containsShapePoint(target.shape, point),
    );
  }

  private beginPendingPing(
    event: PointerEvent,
    screenPoint: { x: number; y: number },
  ): void {
    const scenePoint = this.scenePointInside(screenPoint);
    if (
      !canBeginPendingPing({
        editable: this.interaction.editable,
        hasEditableDrawing:
          this.editableDrawingAt(
            screenToScene(this.camera, this.viewport, screenPoint),
          ) ||
          this.editableShapeAt(
            screenToScene(this.camera, this.viewport, screenPoint),
          ),
        hasHandle: Boolean(this.handleAt(screenPoint)),
        hasPingHandler: Boolean(this.interaction.onPing),
        overPlacedImage: Boolean(scenePoint && this.placedImageAt(scenePoint)),
        pingEnabled: Boolean(this.interaction.pingEnabled),
        pointInsideScene: Boolean(scenePoint),
      }) ||
      !scenePoint
    ) {
      return;
    }
    this.cancelPendingPing();
    const pointerId = event.pointerId;
    const timer = setTimeout(() => {
      const pending = this.pendingPing;
      if (!pending || pending.pointerId !== pointerId) {
        return;
      }
      this.pendingPing = null;
      if (this.editPointerId === pointerId) {
        this.cancelEditGesture();
      }
      this.selected = new Set(pending.selected);
      this.groupSelectionRotation = pending.groupRotation;
      this.pingConsumedPointers.add(pointerId);
      this.requestPing(pending.scenePoint, pending.pullPlayers);
      this.drawSelection();
    }, MAP_PING_HOLD_MS);
    this.pendingPing = {
      groupRotation: this.groupSelectionRotation,
      pointerId,
      pullPlayers: event.shiftKey,
      scenePoint,
      selected: new Set(this.selected),
      startClientX: event.clientX,
      startClientY: event.clientY,
      timer,
    };
    event.preventDefault();
    this.container?.focus();
    this.container?.setPointerCapture(pointerId);
  }

  private cancelPendingPing(pointerId?: number): void {
    if (
      !this.pendingPing ||
      (pointerId !== undefined &&
        this.pendingPing.pointerId !== pointerId)
    ) {
      return;
    }
    clearTimeout(this.pendingPing.timer);
    this.pendingPing = null;
  }

  private hitAt(point: { x: number; y: number }): string | null {
    const scenePoint = screenToScene(this.camera, this.viewport, point);
    if (this.playerFogCovers(scenePoint)) {
      return null;
    }
    const targets = this.activeTargets();
    for (let index = targets.length - 1; index >= 0; index -= 1) {
      if (
        targets[index].drawing
          ? containsDrawingPoint(
              targets[index].drawing!,
              scenePoint,
              6 / this.camera.zoom,
            )
          : targets[index].shape
            ? containsShapePoint(targets[index].shape!, scenePoint)
          : containsPoint(targets[index].image, scenePoint)
      ) {
        return targets[index].id;
      }
    }
    return null;
  }

  private playerFogCovers(point: { x: number; y: number }): boolean {
    return Boolean(
      this.scene &&
        this.interaction.actorId != null &&
        fogCoversPoint(this.scene.fog, point),
    );
  }

  private drawSelection(): void {
    this.selectionOverlay.draw({
      camera: this.camera,
      editable: this.interaction.editable,
      groupRotation: this.groupSelectionRotation,
      targets: this.selectedTargets(),
      viewport: this.viewport,
    });
  }

  private handleAt(point: { x: number; y: number }):
    | { mode: 'resize'; corner: number }
    | { mode: 'rotate' }
    | { mode: 'semantic'; handle: ShapeSemanticHandle }
    | null {
    return this.selectionOverlay.handleAt(point, {
      camera: this.camera,
      groupRotation: this.groupSelectionRotation,
      targets: this.selectedTargets(),
      viewport: this.viewport,
    });
  }

  private resizeCursor(corner: number): 'nesw-resize' | 'nwse-resize' {
    return this.selectionOverlay.resizeCursor(
      corner,
      this.selectedTargets(),
      this.groupSelectionRotation,
    );
  }

  private syncPaintCursor(): void {
    if (!this.container) {
      return;
    }
    this.container.style.cursor = '';
  }

  private updateHoverCursor(point: { x: number; y: number }): void {
    if (!this.container || !this.interaction.editable) {
      return;
    }
    const handle = this.handleAt(point);
    if (handle?.mode === 'resize') {
      this.container.style.cursor = this.resizeCursor(handle.corner);
    } else if (handle?.mode === 'rotate') {
      this.container.style.cursor = 'grab';
    } else if (handle?.mode === 'semantic') {
      this.container.style.cursor = 'crosshair';
    } else if (this.hitAt(point)) {
      this.container.style.cursor = 'move';
    } else {
      this.container.style.cursor = '';
    }
  }

  private async undo(redo: boolean): Promise<void> {
    if (!this.scene || this.committing) {
      return;
    }
    this.committing = true;
    try {
      await this.applyUndo(redo);
    } catch {
      // The scene store surfaces durable history failures. Keep the renderer
      // interactive even if the transport itself rejects.
    } finally {
      this.committing = false;
    }
  }

  private async applyUndo(redo: boolean): Promise<void> {
    if (!this.scene) {
      return;
    }
    const history = redo ? this.interaction.onRedo : this.interaction.onUndo;
    if (!history) {
      return;
    }
    const result = await history();
    if (result) {
      this.scene = result;
      this.selected = new Set(
        [...this.selected].filter((id) => this.target(id) !== null),
      );
      this.rebuildScene();
    }
  }

  private async deleteSelection(): Promise<void> {
    if (!this.scene || this.selected.size === 0) {
      return;
    }
    const before = sceneObjectStateOf(this.scene);
    const after = deleteSelectedObjects(before, this.selected);
    if (await this.commitState(before, after)) {
      this.selected.clear();
      this.groupSelectionRotation = 0;
      this.drawSelection();
    }
  }

  private selectedPlacedImages(): SceneImage[] {
    if (!this.scene || this.selected.has(CANONICAL_MAP_ID)) {
      return [];
    }
    return selectedPlacedImages(
      this.scene,
      this.selected,
      this.interaction.activeLayer,
    );
  }

  private canCopySelection(): boolean {
    if (!this.scene || this.committing || this.selected.size === 0) {
      return false;
    }
    return this.selectedPlacedImages().length === this.selected.size;
  }

  private canCreateImages(count: number): boolean {
    if (!this.scene || this.committing || count <= 0) {
      return false;
    }
    return canCreateSceneImages(
      this.scene,
      count,
      MAX_SCENE_IMAGES,
    );
  }

  private canDuplicateSelection(): boolean {
    return this.canCopySelection() && this.canCreateImages(this.selected.size);
  }

  private copyOffset(): number {
    return this.scene?.grid.type === 'square'
      ? this.scene.grid.size
      : GRIDLESS_COPY_OFFSET;
  }

  private copySelection(): void {
    if (!this.scene || !this.canCopySelection()) {
      return;
    }
    this.imageClipboard.copy(
      this.scene.id,
      this.selectedPlacedImages(),
      this.groupSelectionRotation,
    );
  }

  private async commitCreatedImages(
    images: SceneImage[],
    groupRotation: number,
  ): Promise<boolean> {
    if (!this.scene || !this.canCreateImages(images.length)) {
      return false;
    }
    const before = sceneObjectStateOf(this.scene);
    const after = structuredClone(before);
    after.images[this.interaction.activeLayer].push(...images);
    after.objectOrder[this.interaction.activeLayer].push(
      ...images.map((image) => image.id),
    );
    const beforeRotation = this.groupSelectionRotation;
    const afterRotation = images.length > 1 ? groupRotation : 0;
    if (
      !(await this.commitState(before, after, beforeRotation))
    ) {
      return false;
    }
    this.selected = new Set(images.map((image) => image.id));
    this.groupSelectionRotation = afterRotation;
    this.drawSelection();
    return true;
  }

  private async duplicateSelection(): Promise<void> {
    if (!this.canDuplicateSelection()) {
      return;
    }
    const offset = this.copyOffset();
    const groupRotation = this.groupSelectionRotation;
    const copies = duplicateSceneImages(
      this.selectedPlacedImages(),
      offset,
      () => crypto.randomUUID(),
    );
    await this.commitCreatedImages(copies, groupRotation);
  }

  private async pasteClipboard(): Promise<void> {
    if (
      !this.scene
    ) {
      return;
    }
    const offset = this.copyOffset();
    const paste = this.imageClipboard.createPaste({
      offset,
      targetSceneId: this.scene.id,
      viewportCenter: screenToScene(this.camera, this.viewport, {
        x: this.viewport.width / 2,
        y: this.viewport.height / 2,
      }),
    });
    if (
      !paste ||
      !this.canCreateImages(paste.images.length)
    ) {
      return;
    }
    if (
      await this.commitCreatedImages(
        paste.images,
        paste.groupRotation,
      )
    ) {
      paste.complete();
    }
  }

  private closeContextMenu(): void {
    this.contextMenu.close();
  }

  private openContextMenu(
    clientX: number,
    clientY: number,
    includePing = true,
  ): boolean {
    if (!this.scene) {
      return false;
    }
    const screenPoint = this.localPoint(
      { clientX, clientY } as MouseEvent,
    );
    const scenePoint = this.scenePointInside(screenPoint);
    const canPing = Boolean(
      includePing &&
        scenePoint &&
        this.interaction.pingEnabled &&
        this.interaction.onPing,
    );
    const hit = this.hitAt(screenPoint);
    const canEditImage = Boolean(this.interaction.editable && hit);
    if (!scenePoint || (!canPing && !canEditImage)) {
      this.closeContextMenu();
      return false;
    }
    if (canEditImage && hit && !this.selected.has(hit)) {
      this.selected = new Set([hit]);
      this.groupSelectionRotation = 0;
      this.drawSelection();
    }

    const entries: ContextMenuEntry[] = [];

    if (canPing) {
      entries.push(
        {
          kind: 'action',
          label: 'Ping here',
          onSelect: () => this.requestPing(scenePoint, false),
        },
        {
          kind: 'action',
          label: 'Pull players here',
          onSelect: () => this.requestPing(scenePoint, true),
        },
      );
    }
    if (canEditImage) {
      entries.push(
        {
          disabled: !this.canDuplicateSelection(),
          kind: 'action',
          label: 'Duplicate',
          onSelect: () => void this.duplicateSelection(),
        },
        { kind: 'divider' },
      );

      const includesCanonical = this.selected.has(CANONICAL_MAP_ID);
      for (const layer of ['gm', 'token', 'map'] as const) {
        entries.push({
          disabled:
            includesCanonical ||
            layer === this.interaction.activeLayer ||
            (this.interaction.actorId != null && layer !== 'token'),
          kind: 'action',
          label: `Move to ${layer === 'gm' ? 'GM' : `${layer[0].toUpperCase()}${layer.slice(1)}`} layer`,
          onSelect: () => void this.moveSelectionToLayer(layer),
        });
      }
      entries.push(
        { kind: 'divider' },
        {
          disabled: includesCanonical,
          kind: 'action',
          label: 'Bring to front',
          onSelect: () => void this.reorderSelection('front'),
        },
        {
          disabled: includesCanonical,
          kind: 'action',
          label: 'Bring forward',
          onSelect: () => void this.reorderSelection('forward'),
        },
        {
          disabled: includesCanonical,
          kind: 'action',
          label: 'Send backward',
          onSelect: () => void this.reorderSelection('backward'),
        },
        {
          disabled: includesCanonical,
          kind: 'action',
          label: 'Send to back',
          onSelect: () => void this.reorderSelection('back'),
        },
        {
          ariaLabel: 'Delete selection',
          danger: true,
          kind: 'action',
          label: 'Delete',
          onSelect: () => void this.deleteSelection(),
        },
      );
    }
    this.contextMenu.open(
      clientX,
      clientY,
      canEditImage ? 'Selection actions' : 'Canvas actions',
      entries,
      () => this.container?.focus(),
    );
    return true;
  }

  private readonly handleContextMenu = (event: MouseEvent) => {
    if (this.activeMeasurement) {
      event.preventDefault();
      this.addMeasurementPivot(event.clientX, event.clientY);
      return;
    }
    if (this.openContextMenu(event.clientX, event.clientY)) {
      event.preventDefault();
    }
  };

  private async moveSelectionToLayer(layer: SceneImageLayer): Promise<void> {
    if (!this.scene || this.selected.has(CANONICAL_MAP_ID)) {
      return;
    }
    const before = sceneObjectStateOf(this.scene);
    const after = moveSelectedObjectsToLayer(before, this.selected, layer);
    if (await this.commitState(
      before,
      after,
      this.groupSelectionRotation,
      crypto.randomUUID(),
      {
        kind: 'move-layer',
        targetLayer: layer,
        targets: [...this.selected],
      },
    )) {
      this.selected.clear();
      this.groupSelectionRotation = 0;
      this.drawSelection();
    }
  }

  private async reorderSelection(
    direction: 'back' | 'backward' | 'forward' | 'front',
  ): Promise<void> {
    if (!this.scene || this.selected.has(CANONICAL_MAP_ID)) {
      return;
    }
    const before = sceneObjectStateOf(this.scene);
    const after = reorderSelectedObjects(
      before,
      this.selected,
      this.interaction.activeLayer,
      direction,
    );
    await this.commitState(
      before,
      after,
      this.groupSelectionRotation,
      crypto.randomUUID(),
      { direction, kind: 'reorder', targets: [...this.selected] },
    );
  }

  private drawGrid(): void {
    this.grid.clear();
    if (!this.scene) {
      return;
    }
    const { grid } = this.scene;
    const visible = visibleBounds(this.camera, this.viewport);
    const lines = computeGridLines(this.scene, grid, visible, this.camera.zoom);
    if (lines.columns.length === 0 && lines.rows.length === 0) {
      return;
    }
    const left = Math.max(0, visible.minX);
    const right = Math.min(this.scene.width, visible.maxX);
    const top = Math.max(0, visible.minY);
    const bottom = Math.min(this.scene.height, visible.maxY);

    // Drawn in screen space, snapped to whole pixels. Inside the scaled world
    // container the lines land on fractional pixels and the antialiaser makes
    // them crawl and flicker as the camera moves; here they stay crisp, and the
    // thickness setting means the same number of pixels at every zoom.
    const start = sceneToScreen(this.camera, this.viewport, {
      x: left,
      y: top,
    });
    const end = sceneToScreen(this.camera, this.viewport, {
      x: right,
      y: bottom,
    });
    const halfPixel = Math.round(grid.lineThickness) % 2 === 1 ? 0.5 : 0;
    const snap = (value: number) => Math.round(value) + halfPixel;
    const [top_, bottom_] = [snap(start.y), snap(end.y)];
    const [left_, right_] = [snap(start.x), snap(end.x)];

    for (const x of lines.columns) {
      const screenX = snap(
        sceneToScreen(this.camera, this.viewport, { x, y: 0 }).x,
      );
      this.grid.moveTo(screenX, top_);
      this.grid.lineTo(screenX, bottom_);
    }
    for (const y of lines.rows) {
      const screenY = snap(
        sceneToScreen(this.camera, this.viewport, { x: 0, y }).y,
      );
      this.grid.moveTo(left_, screenY);
      this.grid.lineTo(right_, screenY);
    }
    this.grid.stroke({
      alignment: 0.5,
      alpha: grid.opacity,
      color: Number.parseInt(grid.color.slice(1), 16),
      width: grid.lineThickness,
    });
  }

  /** Marks where the scene ends, so its bounds read even with no map on it. */
  private drawOutline(): void {
    this.outline.clear();
    if (!this.scene) {
      return;
    }
    const topLeft = sceneToScreen(this.camera, this.viewport, { x: 0, y: 0 });
    const bottomRight = sceneToScreen(this.camera, this.viewport, {
      x: this.scene.width,
      y: this.scene.height,
    });
    const snap = (value: number) =>
      Math.round(value) + (SCENE_OUTLINE_WIDTH % 2 === 1 ? 0.5 : 0);
    const left = snap(topLeft.x);
    const top = snap(topLeft.y);
    this.outline
      .rect(left, top, snap(bottomRight.x) - left, snap(bottomRight.y) - top)
      .stroke({
        alignment: 0.5,
        color: readCssColor('--color-border-strong', FALLBACK_OUTLINE_COLOR),
        width: SCENE_OUTLINE_WIDTH,
      });
  }

  private applyCamera(): void {
    if (!this.mounted) {
      return;
    }
    this.world.scale.set(this.camera.zoom);
    this.world.position.set(
      this.viewport.width / 2 - this.camera.x * this.camera.zoom,
      this.viewport.height / 2 - this.camera.y * this.camera.zoom,
    );
    for (const container of [this.tokenWorld, this.gmWorld]) {
      container.scale.set(this.camera.zoom);
      container.position.set(
        this.viewport.width / 2 - this.camera.x * this.camera.zoom,
        this.viewport.height / 2 - this.camera.y * this.camera.zoom,
      );
    }
    // Screen-space overlays follow the camera by being redrawn.
    this.drawGrid();
    this.drawOutline();
    this.drawSelection();
    this.drawPings();
    this.drawMeasurements();
    this.drawRemotePaintPreviews();
    this.drawPaintPreview();
    this.renderShapes();
    if (this.localFogOperation) {
      this.scheduleFogFrame();
    } else {
      // Committed fog is camera-independent and this only updates its sprite
      // transform. Keep it in the same input turn as the map so fast wheel and
      // pinch input cannot leave fog visually trailing the scene by a frame.
      this.renderFog();
    }
    this.syncTextEditor();
  }

  private drawRemotePaintPreviews(): void {
    this.remotePaintGraphics.clear();
    for (const { preview } of this.remotePaintPreviews.values()) {
      const points = preview.points.map((point) =>
        sceneToScreen(this.camera, this.viewport, point),
      );
      strokeDrawingPath(this.remotePaintGraphics, {
        closed: preview.closed,
        points,
        style: {
          ...preview.style,
          strokeWidth: preview.style.strokeWidth * this.camera.zoom,
        },
      });
    }
  }

  private paintPoint(
    event: PointerEvent,
    snapPolyline = false,
  ): SceneDrawingPoint | null {
    const point = this.scenePointInside(this.localPoint(event));
    if (
      !point ||
      !snapPolyline ||
      !event.ctrlKey ||
      this.scene?.grid.type !== 'square'
    ) {
      return point;
    }
    return {
      x: snapValue(
        point.x,
        this.scene.grid.size,
        this.scene.grid.offsetX,
      ),
      y: snapValue(
        point.y,
        this.scene.grid.size,
        this.scene.grid.offsetY,
      ),
    };
  }

  private async commitPaintDrawing(
    points: SceneDrawingPoint[],
    kind: SceneDrawing['kind'],
    style: SceneDrawingStyle,
    operationId: string,
    closed = false,
  ): Promise<void> {
    if (
      !this.scene ||
      points.length === 0 ||
      (kind === 'polyline' && points.length < (closed ? 3 : 2))
    ) {
      return;
    }
    const before = sceneObjectStateOf(this.scene);
    const after = structuredClone(before);
    const layer =
      this.interaction.actorId == null
        ? this.interaction.activeLayer
        : 'token';
    const drawing = createSceneDrawing(
      points,
      kind,
      style,
      closed,
      crypto.randomUUID(),
      this.interaction.actorId ?? null,
    );
    after.drawings[layer].push(drawing);
    after.objectOrder[layer].push(drawing.id);
    await this.commitState(
      before,
      after,
      this.groupSelectionRotation,
      operationId,
    );
  }

  private emitPaintSnapshot(
    active: {
      operationId: string;
      sequence: number;
      style: SceneDrawingStyle;
    },
    kind: SceneDrawing['kind'],
    points: SceneDrawingPoint[],
    isActive: boolean,
    closed = false,
    reliable = false,
  ): void {
    if (!this.scene) {
      return;
    }
    active.sequence = (active.sequence + 1) >>> 0;
    const preview: RendererDrawingPreview = {
      active: isActive,
      closed,
      kind,
      layer:
        this.interaction.actorId == null
          ? this.interaction.activeLayer
          : 'token',
      operationId: active.operationId,
      points: isActive
        ? compactPreviewPoints(points, MAX_DRAWING_PREVIEW_POINTS)
        : [],
      ...(reliable ? { reliable: true } : {}),
      sceneId: this.scene.id,
      sequence: active.sequence,
      style: structuredClone(active.style),
    };
    if (reliable) {
      this.drawingPreviewRateLimiter.drop(
        (pending) => pending.operationId === active.operationId,
      );
      this.interaction.onDrawingPreview?.(preview);
    } else {
      this.drawingPreviewRateLimiter.push(preview);
    }
  }

  private finishPolyline(closed = false): void {
    const active = this.activePolyline;
    if (!active) {
      return;
    }
    this.emitPaintSnapshot(
      active,
      'polyline',
      [...active.points, active.hover],
      false,
      closed,
      true,
    );
    this.activePolyline = null;
    this.paintPreviewGraphics.clear();
    void this.commitPaintDrawing(
      active.points,
      'polyline',
      active.style,
      active.operationId,
      closed,
    );
  }

  private cancelPaintGesture(): void {
    if (this.activeFreeform) {
      this.emitPaintSnapshot(
        this.activeFreeform,
        'freeform',
        this.activeFreeform.points,
        false,
        false,
        true,
      );
    }
    if (this.activePolyline) {
      this.emitPaintSnapshot(
        this.activePolyline,
        'polyline',
        [...this.activePolyline.points, this.activePolyline.hover],
        false,
        false,
        true,
      );
    }
    if (
      this.activeFreeform &&
      this.container?.hasPointerCapture(this.activeFreeform.pointerId)
    ) {
      this.container.releasePointerCapture(this.activeFreeform.pointerId);
    }
    this.activeFreeform = null;
    this.activePolyline = null;
    this.paintPreviewGraphics.clear();
  }

  private fogBrushOperation(
    gesture: Extract<SceneGesture, { kind: 'fog-brush' }>,
    copyPoints = true,
  ): SceneFogOperation {
    return {
      hardness: gesture.hardness,
      id: gesture.operationId,
      kind: 'brush',
      mode: gesture.mode,
      points: copyPoints
        ? gesture.points.map((point) => ({ ...point }))
        : gesture.points,
      width: gesture.width,
    };
  }

  private fogBoxOperation(
    gesture: Extract<SceneGesture, { kind: 'fog-box' }>,
  ): SceneFogOperation {
    return {
      height: Math.abs(gesture.current.y - gesture.start.y),
      id: gesture.operationId,
      kind: 'box',
      mode: gesture.mode,
      width: Math.abs(gesture.current.x - gesture.start.x),
      x: Math.min(gesture.start.x, gesture.current.x),
      y: Math.min(gesture.start.y, gesture.current.y),
    };
  }

  private scheduleFogFrame(): void {
    if (this.fogFrameId !== null) {
      return;
    }
    const callback = () => {
      this.fogFrameId = null;
      if (this.destroyed) {
        return;
      }
      this.renderFog();
    };
    this.fogFrameId = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame(callback)
      : window.setTimeout(callback, ANIMATION_FRAME_MS);
  }

  private cancelScheduledFogFrame(): void {
    if (this.fogFrameId !== null) {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(this.fogFrameId);
      } else {
        window.clearTimeout(this.fogFrameId);
      }
    }
    this.fogFrameId = null;
  }

  private flushFogFrame(): void {
    if (this.fogFrameId === null) {
      return;
    }
    if (typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(this.fogFrameId);
    } else {
      window.clearTimeout(this.fogFrameId);
    }
    this.fogFrameId = null;
    this.renderFog();
  }

  private beginFogGesture(event: PointerEvent): boolean {
    if (
      event.button !== 0 ||
      !this.scene ||
      this.committing ||
      !this.interaction.fogEnabled ||
      !this.interaction.fogMode ||
      !this.interaction.fogSubtool ||
      !this.interaction.onFogCommit
    ) {
      return false;
    }
    const point = this.scenePointInside(this.localPoint(event));
    if (!point) {
      return true;
    }
    event.preventDefault();
    this.closeContextMenu();
    this.cancelPendingPing();
    this.container?.focus();
    const operationId = crypto.randomUUID();
    if (this.interaction.fogSubtool === 'brush') {
      const gesture: Extract<SceneGesture, { kind: 'fog-brush' }> = {
        hardness: this.interaction.fogBrushHardness ?? 1,
        kind: 'fog-brush',
        mode: this.interaction.fogMode,
        operationId,
        pointerId: event.pointerId,
        points: [point],
        width: this.interaction.fogBrushWidth ?? 70,
      };
      if (!this.beginGesture(gesture)) {
        return true;
      }
      this.localFogOperation = this.fogBrushOperation(gesture, false);
    } else {
      const gesture: Extract<SceneGesture, { kind: 'fog-box' }> = {
        current: point,
        kind: 'fog-box',
        mode: this.interaction.fogMode,
        operationId,
        pointerId: event.pointerId,
        start: point,
      };
      if (!this.beginGesture(gesture)) {
        return true;
      }
      this.localFogOperation = this.fogBoxOperation(gesture);
    }
    this.container?.setPointerCapture(event.pointerId);
    this.renderFog();
    return true;
  }

  private updateFogGesture(event: PointerEvent): boolean {
    const brush = this.activeFogBrush;
    if (brush?.pointerId === event.pointerId) {
      const point = this.scenePointInside(this.localPoint(event));
      if (
        point &&
        appendFreeformPoint(
          brush.points,
          point,
          this.camera.zoom,
          FOG_POINT_SPACING_PX,
        )
      ) {
        event.preventDefault();
        this.scheduleFogFrame();
      }
      return true;
    }
    const box = this.activeFogBox;
    if (box?.pointerId === event.pointerId) {
      const point = this.scenePointInside(this.localPoint(event));
      if (point) {
        event.preventDefault();
        box.current = point;
        this.localFogOperation = this.fogBoxOperation(box);
        this.scheduleFogFrame();
      }
      return true;
    }
    return false;
  }

  private finishFogGesture(event: PointerEvent): boolean {
    const brush = this.activeFogBrush;
    const box = this.activeFogBox;
    const gesture = brush ?? box;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return false;
    }
    event.preventDefault();
    if (event.type === 'pointercancel') {
      this.cancelScheduledFogFrame();
    } else {
      this.flushFogFrame();
    }
    if (this.container?.hasPointerCapture(event.pointerId)) {
      this.container.releasePointerCapture(event.pointerId);
    }
    this.finishGesture(gesture.kind);
    if (event.type === 'pointercancel') {
      this.localFogOperation = null;
      this.renderFog();
      return true;
    }
    const operation = brush
      ? {
          ...this.fogBrushOperation(brush),
          points: compactFogBrushPoints(brush.points, brush.width),
        }
      : this.fogBoxOperation(box!);
    if (
      (operation.kind === 'box' &&
        (operation.width <= 0 || operation.height <= 0)) ||
      !this.interaction.onFogCommit
    ) {
      this.localFogOperation = null;
      this.renderFog();
      return true;
    }
    this.localFogOperation = operation;
    void this.commitFogOperation(operation);
    return true;
  }

  private async commitFogOperation(
    operation: SceneFogOperation,
  ): Promise<void> {
    this.committing = true;
    try {
      const saved = await this.interaction.onFogCommit?.(
        { kind: 'append', operation },
        operation.id,
      );
      if (saved) {
        this.scene = saved;
      }
    } catch {
      // The local preview is discarded below if the TCP commit fails.
    } finally {
      this.committing = false;
      if (this.localFogOperation?.id === operation.id) {
        this.localFogOperation = null;
      }
      this.renderFog();
    }
  }

  private cancelFogGesture(): void {
    this.cancelScheduledFogFrame();
    const brush = this.activeFogBrush;
    const box = this.activeFogBox;
    const pointerId = brush?.pointerId ?? box?.pointerId;
    if (pointerId !== undefined && this.container?.hasPointerCapture(pointerId)) {
      this.container.releasePointerCapture(pointerId);
    }
    if (brush) {
      this.finishGesture('fog-brush');
    }
    if (box) {
      this.finishGesture('fog-box');
    }
    this.localFogOperation = null;
    this.renderFog();
  }

  private renderFog(): void {
    const localOperation = this.localFogOperation &&
        !this.scene?.fog.operations.some(
          (operation) => operation.id === this.localFogOperation?.id,
        )
      ? this.localFogOperation
      : null;
    this.fogRenderer.render({
      camera: this.camera,
      gmOpacity: this.interaction.fogGmOpacity ?? 0.35,
      isGameMaster: this.interaction.actorId == null,
      localOperation,
      scene: this.scene,
      viewport: this.viewport,
    });
  }

  private emitShapeSnapshot(
    active: Extract<SceneGesture, { kind: 'shape' }>,
    phase: ShapePreviewUpdate['phase'],
    shape: SceneShape | null,
  ): void {
    if (!this.scene) {
      return;
    }
    active.sequence = (active.sequence + 1) >>> 0;
    const previewShape = shape
      ? Object.fromEntries(
          Object.entries(shape).filter(
            ([key]) =>
              key !== 'ownerId' && key !== 'revision',
          ),
        ) as NonNullable<ShapePreviewUpdate['shape']>
      : null;
    this.interaction.onShapePreview?.({
      layer:
        this.interaction.actorId == null
          ? this.interaction.activeLayer
          : 'token',
      operationId: active.operationId,
      phase,
      ...(phase === 'update' ? {} : { reliable: true }),
      sceneId: this.scene.id,
      sequence: active.sequence,
      shape: previewShape,
    });
  }

  private cancelShapeGesture(): void {
    const active = this.activeShape;
    if (active && this.container?.hasPointerCapture(active.pointerId)) {
      this.container.releasePointerCapture(active.pointerId);
    }
    if (active) {
      this.emitShapeSnapshot(active, 'cancel', null);
      this.finishGesture('shape');
    }
    this.draftShape = null;
    this.renderShapes();
  }

  private drawPaintPreview(): void {
    this.paintPreviewGraphics.clear();
    const active = this.activeFreeform ?? this.activePolyline;
    if (!active) {
      return;
    }
    const points =
      'hover' in active
        ? [...active.points, active.hover]
        : active.points;
    if (points.length === 0) {
      return;
    }
    const screenPoints = points.map((point) =>
      sceneToScreen(this.camera, this.viewport, point),
    );
    strokeDrawingPath(this.paintPreviewGraphics, {
      closed: false,
      points: screenPoints,
      style: {
        ...active.style,
        fillEnabled: false,
        strokeWidth: active.style.strokeWidth * this.camera.zoom,
      },
    });
    if ('hover' in active) {
      for (const point of active.points) {
        const screen = sceneToScreen(this.camera, this.viewport, point);
        this.paintPreviewGraphics
          .circle(screen.x, screen.y, 4)
          .fill({
            color: Number.parseInt(active.style.strokeColor.slice(1), 16),
          });
      }
    }
  }

  private readonly handleWheel = (event: WheelEvent) => {
    if (!this.scene) {
      return;
    }
    this.cancelCameraAnimation();
    event.preventDefault();
    const rect = this.container?.getBoundingClientRect();
    const anchor = {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
    this.camera = zoomAt(
      this.camera,
      this.viewport,
      anchor,
      Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY),
    );
    this.applyCamera();
  };

  private readonly handlePointerDown = (event: PointerEvent) => {
    // Middle button only. The left button belongs to the tools — selecting,
    // painting, measuring — so it must never move the camera.
    if (!this.scene) {
      return;
    }
    if (this.beginFogGesture(event)) {
      return;
    }
    const paintKind = this.interaction.paintKind;
    const paintStyle = this.interaction.paintStyle;
    const plan = planPointerDown({
      button: event.button,
      committing: this.committing,
      editable: this.interaction.editable,
      hasCommit: Boolean(this.interaction.onCommit),
      hasPaintConfiguration: Boolean(
        this.interaction.paintEnabled && paintStyle && paintKind,
      ),
      hasShapeConfiguration: Boolean(
        this.interaction.shapeEnabled &&
        this.interaction.shapeKind &&
        this.interaction.shapeStyle,
      ),
      hasTextConfiguration: Boolean(
        this.interaction.textEnabled && this.interaction.textStyle,
      ),
      measureEnabled: Boolean(this.interaction.measureEnabled),
      pointerType: event.pointerType,
      touchCountAfter:
        this.touchPointers.size +
        (this.touchPointers.has(event.pointerId) ? 0 : 1),
    });
    if (plan.primary === 'block') {
      event.preventDefault();
      return;
    }
    if (plan.primary === 'text') {
      event.preventDefault();
      this.cancelPendingPing();
      this.closeContextMenu();
      if (this.activeTextEditor) {
        void this.finishTextEditor(true);
        return;
      }
      const screenPoint = this.localPoint(event);
      const point = this.scenePointInside(screenPoint);
      if (point && !this.editableTextAt(screenPoint)) {
        this.beginTextEditor(point);
      }
      return;
    }
    if (plan.primary === 'paint' && paintKind && paintStyle) {
      const point = this.paintPoint(
        event,
        paintKind === 'polyline',
      );
      if (!point) {
        return;
      }
      event.preventDefault();
      this.cancelPendingPing();
      this.closeContextMenu();
      this.container?.focus();
      if (paintKind === 'freeform') {
        const operationId = crypto.randomUUID();
        const active: Extract<SceneGesture, { kind: 'freeform' }> = {
          kind: 'freeform',
          operationId,
          pointerId: event.pointerId,
          points: [point],
          sequence: 0,
          style: structuredClone(paintStyle),
        };
        if (!this.beginGesture(active)) {
          return;
        }
        this.emitPaintSnapshot(
          active,
          'freeform',
          active.points,
          true,
          false,
          true,
        );
        this.container?.setPointerCapture(event.pointerId);
      } else if (!this.activePolyline) {
        const active: Extract<SceneGesture, { kind: 'polyline' }> = {
          hover: point,
          kind: 'polyline',
          operationId: crypto.randomUUID(),
          points: [point],
          sequence: 0,
          style: structuredClone(paintStyle),
        };
        if (!this.beginGesture(active)) {
          return;
        }
        this.emitPaintSnapshot(
          active,
          'polyline',
          [point],
          true,
          false,
          true,
        );
      } else {
        const outcome = advancePolyline(
          this.activePolyline.points,
          point,
          event.detail,
          this.camera.zoom,
        );
        if (outcome === 'close') {
          this.finishPolyline(true);
          return;
        }
        if (outcome === 'finish') {
          this.finishPolyline();
          return;
        }
        if (outcome === 'full') {
          return;
        }
        this.activePolyline.hover = point;
        this.emitPaintSnapshot(
          this.activePolyline,
          'polyline',
          [...this.activePolyline.points, this.activePolyline.hover],
          true,
          false,
          true,
        );
      }
      this.drawPaintPreview();
      return;
    }
    if (
      plan.primary === 'shape' &&
      this.interaction.shapeKind &&
      this.interaction.shapeStyle
    ) {
      const point = this.scenePointInside(this.localPoint(event));
      if (!point) {
        return;
      }
      event.preventDefault();
      void ensureSceneTextFontsLoaded();
      this.cancelPendingPing();
      this.closeContextMenu();
      this.container?.focus();
      const active: Extract<SceneGesture, { kind: 'shape' }> = {
        id: crypto.randomUUID(),
        kind: 'shape',
        operationId: crypto.randomUUID(),
        pointerId: event.pointerId,
        sequence: 0,
        shapeKind: this.interaction.shapeKind,
        start: point,
        style: structuredClone(this.interaction.shapeStyle),
      };
      if (this.beginGesture(active)) {
        this.emitShapeSnapshot(active, 'start', null);
        this.container?.setPointerCapture(event.pointerId);
      }
      return;
    }
    if (plan.primary === 'measure') {
      const point = this.scenePointInside(this.localPoint(event));
      if (!point) {
        return;
      }
      event.preventDefault();
      this.closeContextMenu();
      this.cancelPendingPing();
      this.container?.focus();
      this.activeMeasurement = beginMeasurement(
        this.scene,
        point,
        event.pointerId,
        crypto.randomUUID(),
      );
      this.container?.setPointerCapture(event.pointerId);
      this.emitMeasurementSnapshot(true);
      this.drawMeasurements();
      this.startAnimationLoop();
      return;
    }
    if (plan.startPendingPing) {
      this.beginPendingPing(event, this.localPoint(event));
    }
    if (plan.trackTouch) {
      this.touchPointers.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
      });
      if (this.touchPointers.size === 1) {
        if (this.touchLongPressTimer) {
          clearTimeout(this.touchLongPressTimer);
        }
        this.touchLongPressTimer = setTimeout(() => {
          this.touchLongPressTimer = null;
          const touch = this.touchPointers.get(event.pointerId);
          if (!touch || this.touchPointers.size !== 1) {
            return;
          }
          this.cancelEditGesture();
          this.touchLongPressOpened.add(event.pointerId);
          this.openContextMenu(touch.clientX, touch.clientY, false);
        }, 500);
      } else if (plan.primary === 'pinch') {
        if (this.touchLongPressTimer) {
          clearTimeout(this.touchLongPressTimer);
          this.touchLongPressTimer = null;
        }
        this.cancelEditGesture();
        this.cancelCameraAnimation();
        const frame = pinchFrame(
          [...this.touchPointers.values()].slice(0, 2),
        );
        if (frame) {
          this.beginGesture({ kind: 'pinch', last: frame });
        }
        this.container?.setPointerCapture(event.pointerId);
        return;
      }
    }
    if (plan.primary === 'edit') {
      event.preventDefault();
      this.closeContextMenu();
      this.container?.focus();
      const screenPoint = this.localPoint(event);
      const handle = this.handleAt(screenPoint);
      const hit = this.hitAt(screenPoint);
      let mode: Extract<
        SceneGesture,
        { kind: 'edit' }
      >['mode'];
      let resizeCorner = 0;
      let semanticHandle: ShapeSemanticHandle | null = null;
      if (handle) {
        mode = handle.mode;
        if (handle.mode === 'resize') {
          resizeCorner = handle.corner;
          if (this.container) {
            this.container.style.cursor = this.resizeCursor(handle.corner);
          }
        } else if (handle.mode === 'semantic') {
          semanticHandle = handle.handle;
          if (this.container) {
            this.container.style.cursor = 'crosshair';
          }
        } else if (this.container) {
          this.container.style.cursor = 'grabbing';
        }
      } else if (hit) {
        if (event.shiftKey) {
          if (this.selected.has(hit)) {
            this.selected.delete(hit);
          } else {
            this.selected.add(hit);
          }
          this.groupSelectionRotation = 0;
          this.drawSelection();
          return;
        }
        if (!this.selected.has(hit)) {
          this.selected = new Set([hit]);
          this.groupSelectionRotation = 0;
        }
        mode = 'move';
        if (this.container) {
          this.container.style.cursor = 'move';
        }
      } else {
        if (!event.shiftKey) {
          this.selected.clear();
          this.groupSelectionRotation = 0;
        }
        mode = 'marquee';
        if (this.container) {
          this.container.style.cursor = '';
        }
      }
      this.beginGesture({
        before: sceneObjectStateOf(this.scene),
        groupRotationBefore: this.groupSelectionRotation,
        kind: 'edit',
        mode,
        pointerId: event.pointerId,
        previewOperationId: null,
        previewPivot: { x: 0, y: 0 },
        resizeCorner,
        semanticHandle,
        start: screenToScene(
          this.camera,
          this.viewport,
          screenPoint,
        ),
      });
      this.startEditPreview();
      this.container?.setPointerCapture(event.pointerId);
      this.drawSelection();
      return;
    }
    if (plan.primary !== 'pan') {
      return;
    }
    this.cancelCameraAnimation();
    // Suppresses the platform's middle-click autoscroll.
    event.preventDefault();
    this.beginGesture({
      clientX: event.clientX,
      clientY: event.clientY,
      kind: 'pan',
      pointerId: event.pointerId,
    });
    this.container?.setPointerCapture(event.pointerId);
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (this.updateFogGesture(event)) {
      return;
    }
    const freeform = this.activeFreeform;
    const polyline = this.activePolyline;
    const shapeGesture = this.activeShape;
    const pendingPingDistance =
      this.pendingPing?.pointerId === event.pointerId
        ? Math.hypot(
            event.clientX - this.pendingPing.startClientX,
            event.clientY - this.pendingPing.startClientY,
          )
        : null;
    const plan = planPointerMove(this.interactionEngine, {
      hasScene: Boolean(this.scene),
      paintEnabled: Boolean(this.interaction.paintEnabled),
      pendingPingDistance,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      touchCount: this.touchPointers.size,
    });
    if (plan.primary === 'freeform' && freeform) {
      const point = this.paintPoint(event);
      if (point) {
        event.preventDefault();
        if (appendFreeformPoint(freeform.points, point, this.camera.zoom)) {
          this.emitPaintSnapshot(
            freeform,
            'freeform',
            freeform.points,
            true,
          );
          this.drawPaintPreview();
        }
      }
      return;
    }
    if (plan.primary === 'polyline' && polyline) {
      const point = this.paintPoint(event, true);
      if (point) {
        polyline.hover = point;
        this.emitPaintSnapshot(
          polyline,
          'polyline',
          [...polyline.points, point],
          true,
        );
        this.drawPaintPreview();
      }
      return;
    }
    if (plan.primary === 'shape' && shapeGesture && this.scene) {
      const point = this.scenePointInside(this.localPoint(event));
      if (!point) {
        return;
      }
      event.preventDefault();
      this.draftShape = createShapeFromDrag({
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        end: point,
        id: shapeGesture.id,
        kind: shapeGesture.shapeKind,
        ownerId: this.interaction.actorId ?? null,
        scene: this.scene,
        start: shapeGesture.start,
        style: shapeGesture.style,
      });
      if (this.draftShape) {
        this.emitShapeSnapshot(shapeGesture, 'update', this.draftShape);
      }
      this.renderShapes();
      return;
    }
    if (plan.primary === 'measurement' && this.activeMeasurement && this.scene) {
      event.preventDefault();
      moveMeasurement(
        this.activeMeasurement,
        this.scene,
        screenToScene(
          this.camera,
          this.viewport,
          this.localPoint(event),
        ),
      );
      this.emitMeasurementSnapshot();
      this.drawMeasurements();
      return;
    }
    if (plan.hover) {
      this.updateHoverCursor(this.localPoint(event));
    }
    if (this.pendingPing?.pointerId === event.pointerId) {
      this.pendingPing.pullPlayers = event.shiftKey;
      if (plan.stopForPendingPing) {
        event.preventDefault();
        return;
      }
      if (plan.cancelPendingPing) {
        this.cancelPendingPing(event.pointerId);
        this.startEditPreview();
      }
    }
    if (plan.trackTouch) {
      const touch = this.touchPointers.get(event.pointerId)!;
      touch.clientX = event.clientX;
      touch.clientY = event.clientY;
      if (
        Math.hypot(event.clientX - touch.startX, event.clientY - touch.startY) >
        8
      ) {
        if (this.touchLongPressTimer) {
          clearTimeout(this.touchLongPressTimer);
          this.touchLongPressTimer = null;
        }
      }
      const pinch = gestureOfKind(this.gesture, 'pinch');
      if (plan.primary === 'pinch' && pinch) {
        event.preventDefault();
        const next = pinchFrame(
          [...this.touchPointers.values()].slice(0, 2),
        );
        if (!next) {
          return;
        }
        const rect = this.container?.getBoundingClientRect();
        this.camera = updatePinchCamera(
          this.camera,
          this.viewport,
          {
            x: rect?.left ?? 0,
            y: rect?.top ?? 0,
          },
          pinch.last,
          next,
        );
        this.applyCamera();
        pinch.last = next;
        return;
      }
    }
    const activeEdit = this.editGesture;
    if (
      plan.primary === 'edit' &&
      this.scene &&
      activeEdit &&
      this.editStart &&
      this.editBefore &&
      this.editMode
    ) {
      event.preventDefault();
      const screenPoint = this.localPoint(event);
      const point = screenToScene(this.camera, this.viewport, screenPoint);
      if (this.editMode === 'marquee') {
        const start = sceneToScreen(
          this.camera,
          this.viewport,
          this.editStart,
        );
        this.selectionOverlay.drawMarquee(start, screenPoint);
        return;
      }
      if (this.editMode === 'semantic' && activeEdit.semanticHandle) {
        const shapeId = [...this.selected].find((id) =>
          Object.values(activeEdit.before.shapes)
            .flat()
            .some((shape) => shape.id === id),
        );
        const original = shapeId
          ? Object.values(activeEdit.before.shapes)
              .flat()
              .find((shape) => shape.id === shapeId)
          : null;
        const next = original
          ? editShapeWithSemanticHandle(
              original,
              activeEdit.semanticHandle,
              point,
              {
                freeform: this.leftAlt,
                increment: shapeIncrementPixels(this.scene),
              },
            )
          : null;
        if (!shapeId || !next) {
          return;
        }
        const state = structuredClone(activeEdit.before);
        for (const layer of Object.values(state.shapes)) {
          const index = layer.findIndex((shape) => shape.id === shapeId);
          if (index >= 0) {
            layer[index] = next;
            break;
          }
        }
        if (this.previewOperationId) {
          this.interaction.onPreviewUpdate?.({
            absolute: {
              height: next.height,
              rotation: next.rotation,
              ...(next.kind === 'cone' ? { spread: next.spread } : {}),
              width: next.width,
              x: next.x,
              y: next.y,
            },
            dx: 0,
            dy: 0,
            operationId: this.previewOperationId,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
          });
        }
        this.applyState(state);
        return;
      }
      const update = updateSceneEdit({
        currentGroupRotation: this.groupSelectionRotation,
        disableSnapping: this.leftAlt,
        gesture: activeEdit,
        point,
        preserveAspectRatio: !event.shiftKey,
        scene: this.scene,
        selected: this.selected,
        textBounds: (id) => this.textRenderer.bounds(id),
      });
      if (!update) {
        return;
      }
      this.groupSelectionRotation = update.groupRotation;
      if (update.preview) {
        this.interaction.onPreviewUpdate?.(update.preview);
      }
      this.applyState(update.state);
      return;
    }
    const panGesture = gestureOfKind(this.gesture, 'pan');
    if (plan.primary !== 'pan' || !panGesture) {
      return;
    }
    this.camera = pan(
      this.camera,
      event.clientX - panGesture.clientX,
      event.clientY - panGesture.clientY,
    );
    panGesture.clientX = event.clientX;
    panGesture.clientY = event.clientY;
    this.applyCamera();
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (this.finishFogGesture(event)) {
      return;
    }
    const plan = planPointerUp(this.interactionEngine, {
      button: event.button,
      cancelled: event.type === 'pointercancel',
      pointerId: event.pointerId,
      pointerType: event.pointerType,
    });
    if (plan.primary === 'freeform' && this.activeFreeform) {
      event.preventDefault();
      const active = this.activeFreeform;
      this.emitPaintSnapshot(
        active,
        'freeform',
        active.points,
        false,
        false,
        true,
      );
      this.activeFreeform = null;
      this.paintPreviewGraphics.clear();
      if (this.container?.hasPointerCapture(event.pointerId)) {
        this.container.releasePointerCapture(event.pointerId);
      }
      if (event.type !== 'pointercancel') {
        void this.commitPaintDrawing(
          active.points,
          'freeform',
          active.style,
          active.operationId,
        );
      }
      return;
    }
    if (plan.primary === 'ignore') {
      return;
    }
    if (plan.primary === 'shape' && this.activeShape) {
      event.preventDefault();
      const active = this.activeShape;
      const scene = this.scene;
      const releasePoint = scene
        ? this.scenePointInside(this.localPoint(event))
        : null;
      const shape =
        scene && releasePoint && event.type !== 'pointercancel'
          ? createShapeFromDrag({
              altKey: event.altKey,
              ctrlKey: event.ctrlKey,
              end: releasePoint,
              id: active.id,
              kind: active.shapeKind,
              ownerId: this.interaction.actorId ?? null,
              scene,
              start: active.start,
              style: active.style,
            })
          : null;
      const layer = this.interaction.actorId == null
        ? this.interaction.activeLayer
        : 'token';
      const shapeCount = scene
        ? Object.values(scene.shapes).reduce(
            (total, shapes) => total + shapes.length,
            0,
          )
        : MAX_SCENE_SHAPES;
      const canCommit = Boolean(
        shape &&
        scene &&
        event.type !== 'pointercancel' &&
        shapeCount < MAX_SCENE_SHAPES,
      );
      this.emitShapeSnapshot(
        active,
        canCommit ? 'final' : 'cancel',
        canCommit ? shape : null,
      );
      this.finishGesture('shape');
      this.draftShape = null;
      this.renderShapes();
      if (this.container?.hasPointerCapture(event.pointerId)) {
        this.container.releasePointerCapture(event.pointerId);
      }
      if (!shape || !scene || !canCommit) {
        return;
      }
      const before = sceneObjectStateOf(scene);
      const after = structuredClone(before);
      after.shapes[layer].push(shape);
      const imageIds = new Set(after.images[layer].map((image) => image.id));
      const firstImageIndex = after.objectOrder[layer].findIndex((id) =>
        imageIds.has(id));
      after.objectOrder[layer].splice(
        firstImageIndex < 0 ? after.objectOrder[layer].length : firstImageIndex,
        0,
        shape.id,
      );
      void this.commitState(
        before,
        after,
        this.groupSelectionRotation,
        active.operationId,
      ).then((committed) => {
        if (!committed) {
          this.emitShapeSnapshot(active, 'cancel', null);
        }
      });
      return;
    }
    if (plan.primary === 'measurement') {
      event.preventDefault();
      this.cancelMeasurement();
      return;
    }
    if (plan.primary === 'ping' && this.pingConsumedPointers.delete(event.pointerId)) {
      event.preventDefault();
      this.cancelPendingPing(event.pointerId);
      if (this.container?.hasPointerCapture(event.pointerId)) {
        this.container.releasePointerCapture(event.pointerId);
      }
      return;
    }
    this.cancelPendingPing(event.pointerId);
    if (plan.releaseTouch) {
      if (this.touchLongPressTimer) {
        clearTimeout(this.touchLongPressTimer);
        this.touchLongPressTimer = null;
      }
      const wasPinching = this.pinching;
      this.touchPointers.delete(event.pointerId);
      if (this.touchPointers.size < 2) {
        this.finishGesture('pinch');
      }
      if (this.touchLongPressOpened.delete(event.pointerId) || wasPinching) {
        event.preventDefault();
        return;
      }
    }
    if (plan.primary === 'edit') {
      const mode = this.editMode;
      const before = this.editBefore;
      const current = this.scene ? sceneObjectStateOf(this.scene) : null;
      if (event.type === 'pointercancel' && before && this.scene) {
        this.applyState(before);
        this.groupSelectionRotation = this.editGroupRotationBefore;
        if (this.previewOperationId) {
          this.interaction.onPreviewCancel?.(
            this.previewOperationId,
            this.scene.id,
          );
        }
      } else if (mode === 'marquee' && this.editStart && this.scene) {
        const end = screenToScene(
          this.camera,
          this.viewport,
          this.localPoint(event),
        );
        const selectionBox = {
          maxX: Math.max(this.editStart.x, end.x),
          maxY: Math.max(this.editStart.y, end.y),
          minX: Math.min(this.editStart.x, end.x),
          minY: Math.min(this.editStart.y, end.y),
        };
        let changed = false;
        for (const target of this.activeTargets()) {
          if (rectangleCoverage(target.image, selectionBox) >= 0.5) {
            if (event.shiftKey && this.selected.has(target.id)) {
              this.selected.delete(target.id);
            } else {
              this.selected.add(target.id);
            }
            changed = true;
          }
        }
        if (changed) {
          this.groupSelectionRotation = 0;
        }
      } else if (before && current) {
        if (JSON.stringify(before) === JSON.stringify(current)) {
          if (this.previewOperationId) {
            this.interaction.onPreviewCancel?.(
              this.previewOperationId,
              this.scene!.id,
            );
          }
        } else {
          void this.commitState(
            before,
            current,
            this.editGroupRotationBefore,
            this.previewOperationId ?? undefined,
          );
        }
      }
      this.selectionOverlay.clearMarquee();
      this.finishGesture('edit');
      this.drawSelection();
      this.updateHoverCursor(this.localPoint(event));
      if (this.container?.hasPointerCapture(event.pointerId)) {
        this.container.releasePointerCapture(event.pointerId);
      }
      return;
    }
    if (plan.primary !== 'pan') {
      return;
    }
    this.finishGesture('pan');
    this.syncPaintCursor();
    if (this.container?.hasPointerCapture(event.pointerId)) {
      this.container.releasePointerCapture(event.pointerId);
    }
  };

  private cancelEditGesture(): void {
    if (!this.scene || !this.editBefore) {
      return;
    }
    this.applyState(this.editBefore);
    this.groupSelectionRotation = this.editGroupRotationBefore;
    if (this.previewOperationId) {
      this.interaction.onPreviewCancel?.(
        this.previewOperationId,
        this.scene.id,
      );
    }
    if (
      this.editPointerId !== null &&
      this.container?.hasPointerCapture(this.editPointerId)
    ) {
      this.container.releasePointerCapture(this.editPointerId);
    }
    this.finishGesture('edit');
    this.selectionOverlay.clearMarquee();
    if (this.container) {
      this.container.style.cursor = '';
    }
  }

  private beginNudge(): void {
    if (!this.scene || this.gesture.kind !== 'idle') {
      return;
    }
    const nudge: Extract<SceneGesture, { kind: 'nudge' }> = {
      before: sceneObjectStateOf(this.scene),
      keys: new Set(),
      kind: 'nudge',
      operationId: null,
      startTargets: snapshotEditTargets(this.selectedTargets()),
    };
    this.beginGesture(nudge);
    if (
      this.interaction.activeLayer !== 'gm' &&
      nudge.startTargets.length > 0
    ) {
      const frame = this.selectionFrame(nudge.startTargets);
      if (frame) {
        nudge.operationId = crypto.randomUUID();
        this.interaction.onPreviewStart?.({
          kind: 'nudge',
          operationId: nudge.operationId,
          pivotX: frame.center.x,
          pivotY: frame.center.y,
          revision: this.scene.revision,
          sceneId: this.scene.id,
          startingTransforms: nudge.startTargets.map((target) => ({
            id: target.id,
            transform: target.drawing
              ? drawingTransformOf(target.drawing)
              : target.text
                ? textTransformOf(target.text)
              : imageTransformOf(target.image),
          })),
          targets: nudge.startTargets.map((target) => target.id),
        });
      }
    }
  }

  private async finishNudge(cancel = false): Promise<void> {
    const nudge = this.nudgeGesture;
    if (!this.scene || !nudge) {
      return;
    }
    const before = nudge.before;
    const after = sceneObjectStateOf(this.scene);
    if (cancel) {
      this.applyState(before);
      if (nudge.operationId) {
        this.interaction.onPreviewCancel?.(
          nudge.operationId,
          this.scene.id,
        );
      }
    } else {
      await this.commitState(
        before,
        after,
        this.groupSelectionRotation,
        nudge.operationId ?? undefined,
      );
    }
    this.finishGesture('nudge');
  }

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    if (
      this.interactionEngine.releaseKey(
        event.code,
        event.key,
        event.shiftKey,
      )
    ) {
      void this.finishNudge();
    }
  };

  private readonly handleDoubleClick = (event: MouseEvent) => {
    if (
      !this.scene ||
      (!this.interaction.textEnabled && !this.interaction.editable)
    ) {
      return;
    }
    const text = this.editableTextAt(this.localPoint(event));
    if (!text) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.cancelEditGesture();
    this.closeContextMenu();
    this.beginTextEditor({ x: text.x, y: text.y }, text);
  };

  private readonly handleBlur = () => {
    this.leftAlt = false;
    this.cancelPendingPing();
    this.pingConsumedPointers.clear();
    this.cancelMeasurement();
    this.cancelPaintGesture();
    this.cancelShapeGesture();
    this.cancelFogGesture();
    this.cancelEditGesture();
    if (this.nudgeBefore) {
      void this.finishNudge();
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (this.interactionEngine.pressModifier(event.code)) {
      return;
    }
    if (event.key === 'Escape' && this.activeShape) {
      event.preventDefault();
      this.cancelShapeGesture();
      return;
    }
    if (event.key === 'Escape' && (this.activeFogBrush || this.activeFogBox)) {
      event.preventDefault();
      this.cancelFogGesture();
      return;
    }
    const plan = planKeyDown({
      committing: this.committing,
      editable: this.interaction.editable,
      hasMeasurement: Boolean(this.activeMeasurement),
      hasPolyline: Boolean(this.activePolyline),
      hasScene: Boolean(this.scene),
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      selectedCount: this.selected.size,
      shiftKey: event.shiftKey,
    });
    if (plan === 'cancel-measurement') {
      event.preventDefault();
      this.cancelMeasurement();
      return;
    }
    const polyline = this.activePolyline;
    if (polyline) {
      if (plan === 'cancel-polyline') {
        event.preventDefault();
        this.cancelPaintGesture();
        return;
      }
      if (plan === 'finish-polyline') {
        event.preventDefault();
        this.finishPolyline();
        return;
      }
      if (plan === 'polyline-backspace') {
        event.preventDefault();
        polyline.points.pop();
        if (polyline.points.length === 0) {
          this.cancelPaintGesture();
        } else {
          polyline.hover = polyline.points[polyline.points.length - 1];
          this.emitPaintSnapshot(
            polyline,
            'polyline',
            [
              ...polyline.points,
              polyline.hover,
            ],
            true,
            false,
            true,
          );
          this.drawPaintPreview();
        }
        return;
      }
    }
    if (plan === 'ignore' || !this.scene) {
      return;
    }
    if (plan === 'undo' || plan === 'redo') {
      event.preventDefault();
      void this.undo(plan === 'redo');
      return;
    }
    if (
      plan === 'clipboard-copy' ||
      plan === 'clipboard-duplicate' ||
      plan === 'clipboard-paste'
    ) {
      event.preventDefault();
      if (event.repeat) {
        return;
      }
      if (plan === 'clipboard-copy') {
        this.copySelection();
      } else if (plan === 'clipboard-duplicate') {
        void this.duplicateSelection();
      } else {
        void this.pasteClipboard();
      }
      return;
    }
    if (plan === 'selection-escape') {
      if (this.editBefore) {
        this.cancelEditGesture();
      } else if (this.nudgeBefore) {
        void this.finishNudge(true);
      } else {
        this.selected.clear();
        this.groupSelectionRotation = 0;
      }
      this.drawSelection();
      return;
    }
    if (plan === 'delete') {
      event.preventDefault();
      if (this.selected.size > 0) {
        void this.deleteSelection();
      }
      return;
    }
    if (plan === 'nudge') {
      event.preventDefault();
      this.beginNudge();
      this.nudgeKeys.add(event.key);
      const after = nudgeSceneState(
        this.scene,
        this.selected,
        event.key,
        this.leftAlt,
        (id) => this.textRenderer.bounds(id),
      );
      this.applyState(after);
      if (this.nudgeOperationId && this.nudgeStartTargets.length > 0) {
        const preview = createNudgePreview(
          this.nudgeStartTargets,
          this.scene,
          this.nudgeOperationId,
        );
        if (preview) {
          this.interaction.onPreviewUpdate?.(preview);
        }
      }
    }
  };
}

export function createSceneRenderer(): SceneRendererHandle {
  return new SceneRenderer();
}
