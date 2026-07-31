import {
  Application,
  Container,
  Graphics,
  Sprite,
  Texture,
  TilingSprite,
} from 'pixi.js';
import type { GifSource, GifSprite } from 'pixi.js/gif';
import {
  MAX_TRANSFORM_PREVIEW_RATE,
  MAX_DRAWING_PREVIEW_POINTS,
  MAX_MEASUREMENT_POINTS,
  type DrawingPreviewEvent,
  type DrawingPreviewUpdate,
  type MapPing,
  type MeasurementEvent,
  type MeasurementPoint,
  type MeasurementUpdate,
} from '../../../shared/network';
import {
  createEmptyImageLayers,
  imageStateOf,
  MAX_DRAWING_POINTS,
  MAX_SCENE_IMAGES,
  type SceneDrawing,
  type SceneDrawingPoint,
  type SceneDrawingStyle,
  type SceneImage,
  type SceneImageLayer,
  type SceneImageState,
  type SceneMapImage,
  type SceneRecord,
  type SceneTransformPreviewCancel,
  type SceneTransformPreviewDelta,
  type SceneTransformPreviewStart,
} from '../../../shared/scenes';
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
  measurementPath,
  measurementPoint,
  sameMeasurementPoint,
} from './measurement';
import {
  bounds,
  CANONICAL_MAP_ID,
  containsPoint,
  corners,
  rectangleCoverage,
  reorderSelected,
  roundTransform,
  snapMove,
  snapValue,
  snappingActive,
} from './imageGeometry';
import { POLYLINE_PEN_CURSOR } from './paintCursors';
import { softBrushPasses } from './softBrush';
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
const MIDDLE_MOUSE_BUTTON = 1;
const MAP_IMAGE_Z_INDEX = 2;
const ADDITIONAL_MAP_Z_INDEX = 3;
const SELECTION_HANDLE_SIZE = 10;
const SELECTION_HANDLE_HIT_SIZE = 24;
const ROTATION_HANDLE_RADIUS = 5;
const ROTATION_HANDLE_OFFSET = 44;
const GRIDLESS_COPY_OFFSET = 20;
const MAP_PING_HOLD_MS = 500;
const MAP_PING_MOVE_TOLERANCE = 8;
const MAP_PING_COOLDOWN_MS = 500;
const MAP_PING_DURATION_MS = 1_200;
const CAMERA_PULL_DURATION_MS = 300;
const ANIMATION_FRAME_MS = 16;
const MEASUREMENT_UPDATE_INTERVAL_MS = 1_000 / MAX_TRANSFORM_PREVIEW_RATE;
const MEASUREMENT_KEEPALIVE_MS = 500;
const MEASUREMENT_EXPIRY_MS = 1_500;

type RendererMapPing = Omit<MapPing, 'campaignId'>;
type RendererMeasurementUpdate = Omit<MeasurementUpdate, 'campaignId'>;

interface EditTarget {
  drawing?: SceneDrawing;
  id: string;
  image: SceneMapImage;
}

export interface SceneRendererHandle {
  destroy(): void;
  fitToScene(): void;
  clientToScene?(clientX: number, clientY: number): { x: number; y: number };
  mount(element: HTMLElement): Promise<void>;
  resize(width: number, height: number): void;
  selectImages?(ids: string[]): void;
  showMeasurement?(update: MeasurementEvent): void;
  showDrawingPreview?(preview: DrawingPreviewEvent): void;
  showPing?(ping: RendererMapPing, centerCamera?: boolean): void;
  showTransformCancelled?(input: SceneTransformPreviewCancel): void;
  showTransformPreview?(input: SceneTransformPreviewDelta): void;
  showTransformStarted?(input: SceneTransformPreviewStart): void;
  setInteraction?(options: SceneRendererInteraction): void;
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
  pingEnabled?: boolean;
  onActiveLayerChange?: (layer: SceneImageLayer) => void;
  onCommit?: (
    state: SceneImageState,
    operationId: string,
  ) => Promise<SceneRecord | null>;
  onMeasurementUpdate?: (update: RendererMeasurementUpdate) => void;
  onDrawingPreview?: (
    preview: Omit<DrawingPreviewUpdate, 'campaignId'>,
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

function transformOf(image: SceneMapImage) {
  return {
    height: image.height,
    rotation: image.rotation,
    width: image.width,
    x: image.x,
    y: image.y,
  };
}

function drawingTransformOf(drawing: SceneDrawing) {
  return {
    rotation: drawing.rotation,
    scaleX: drawing.scaleX,
    scaleY: drawing.scaleY,
    x: drawing.x,
    y: drawing.y,
  };
}

function drawingLocalBounds(drawing: SceneDrawing) {
  const halfStroke = drawing.style.strokeWidth / 2;
  const xs = drawing.points.map((point) => point.x);
  const ys = drawing.points.map((point) => point.y);
  const minX = Math.min(...xs) - halfStroke;
  const maxX = Math.max(...xs) + halfStroke;
  const minY = Math.min(...ys) - halfStroke;
  const maxY = Math.max(...ys) + halfStroke;
  return {
    height: Math.max(1, maxY - minY),
    width: Math.max(1, maxX - minX),
  };
}

function drawingAsImage(drawing: SceneDrawing): SceneMapImage {
  const local = drawingLocalBounds(drawing);
  return {
    assetId: drawing.id,
    height: local.height * drawing.scaleY,
    rotation: drawing.rotation,
    width: local.width * drawing.scaleX,
    x: drawing.x,
    y: drawing.y,
  };
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

function shortestRotation(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

async function loadImageResource(
  url: string,
): Promise<{
  gif: GifSource | null;
  gifSpriteClass: typeof GifSprite | null;
  texture: Texture | null;
}> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Image request failed with ${response.status}.`);
  }
  const blob = await response.blob();
  if (blob.type === 'image/gif') {
    // Pixi exposes GIF support as an intentional package subpath; the legacy
    // ESLint resolver does not understand package subpaths without `exports`.
    // eslint-disable-next-line import/no-unresolved
    const { GifSource, GifSprite } = await import('pixi.js/gif');
    return {
      gif: GifSource.from(await blob.arrayBuffer()),
      gifSpriteClass: GifSprite,
      texture: null,
    };
  }
  const source =
    typeof createImageBitmap === 'function'
      ? await createImageBitmap(blob)
      : await new Promise<HTMLImageElement>((resolve, reject) => {
          const objectUrl = URL.createObjectURL(blob);
          const image = new Image();
          image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
          };
          image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('The image could not decode.'));
          };
          image.src = objectUrl;
        });
  return {
    gif: null,
    gifSpriteClass: null,
    texture: Texture.from(source),
  };
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
  private dragPointerId: number | null = null;
  private dragX = 0;
  private dragY = 0;
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
  private readonly imageSprites = new Map<string, Sprite>();
  private readonly drawingGraphics = new Map<string, Graphics>();
  private readonly imageTextures = new Map<string, Texture>();
  private readonly imageGifSources = new Map<string, GifSource>();
  private readonly imageLoadTokens = new Map<string, number>();
  private readonly imageLoadingUrls = new Map<string, string>();
  private readonly imagePlaceholders = new Map<string, Graphics>();
  private readonly imageResourceUrls = new Map<string, string>();
  private readonly imageSpriteKinds = new Map<string, 'gif' | 'texture'>();
  private gifSpriteClass: typeof GifSprite | null = null;
  private interaction: SceneRendererInteraction = {
    activeLayer: 'token',
    editable: false,
    measureEnabled: false,
    pingEnabled: false,
  };
  private activeMeasurement: {
    endpoint: MeasurementPoint;
    fixedPoints: MeasurementPoint[];
    id: string;
    lastSentAt: number;
    pointerId: number;
    sceneId: string;
  } | null = null;
  private measurementUpdateSequence = 0;
  private readonly remoteMeasurements = new Map<
    string,
    { lastAt: number; update: MeasurementEvent }
  >();
  private readonly remoteMeasurementVersions = new Map<string, number>();
  private selected = new Set<string>();
  private activeFreeform: {
    operationId: string;
    pointerId: number;
    points: SceneDrawingPoint[];
    sequence: number;
    style: SceneDrawingStyle;
  } | null = null;
  private activePolyline: {
    hover: SceneDrawingPoint;
    operationId: string;
    points: SceneDrawingPoint[];
    sequence: number;
    style: SceneDrawingStyle;
  } | null = null;
  private readonly paintPreviewGraphics = new Graphics();
  private readonly remotePaintGraphics = new Graphics();
  private brushCursor: SVGSVGElement | null = null;
  private brushCursorPoint: { x: number; y: number } | null = null;
  private pointerInside = false;
  private readonly remotePaintPreviews = new Map<
    string,
    { lastAt: number; preview: DrawingPreviewEvent }
  >();
  private readonly remoteTransformStarts = new Map<
    string,
    { base: SceneRecord; input: SceneTransformPreviewStart }
  >();
  private editPointerId: number | null = null;
  private editStart: { x: number; y: number } | null = null;
  private editBefore: SceneImageState | null = null;
  private editGroupRotationBefore = 0;
  private editMode: 'move' | 'rotate' | 'resize' | 'marquee' | null = null;
  private groupSelectionRotation = 0;
  private previewOperationId: string | null = null;
  private previewPivot = { x: 0, y: 0 };
  private resizeCorner = 0;
  private readonly selectionGraphics = new Graphics();
  private readonly marqueeGraphics = new Graphics();
  private contextMenu: HTMLDivElement | null = null;
  private contextMenuOutsideListener: ((event: Event) => void) | null = null;
  private imageClipboard: {
    groupRotation: number;
    images: SceneImage[];
    sourceSceneId: string;
  } | null = null;
  private pasteCount = 0;
  private pasteTargetSceneId: string | null = null;
  private leftAlt = false;
  private leftControl = false;
  private nudgeBefore: SceneImageState | null = null;
  private readonly nudgeKeys = new Set<string>();
  private nudgeOperationId: string | null = null;
  private nudgeStartTargets: EditTarget[] = [];
  private pinchLast: { distance: number; x: number; y: number } | null = null;
  private pinching = false;
  private lastSentPingAt: number | null = null;
  private pendingPing: {
    groupRotation: number;
    pointerId: number;
    pullPlayers: boolean;
    scenePoint: { x: number; y: number };
    selected: Set<string>;
    startClientX: number;
    startClientY: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private readonly pingConsumedPointers = new Set<number>();
  private touchLongPressOpened = new Set<number>();
  private touchLongPressTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly touchPointers = new Map<
    number,
    { clientX: number; clientY: number; startX: number; startY: number }
  >();
  private undoStacks = new Map<
    string,
    Array<{
      after: SceneImageState;
      afterRotation: number;
      before: SceneImageState;
      beforeRotation: number;
    }>
  >();
  private redoStacks = new Map<
    string,
    Array<{
      after: SceneImageState;
      afterRotation: number;
      before: SceneImageState;
      beforeRotation: number;
    }>
  >();
  private committing = false;
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
  private viewport: Viewport = { height: 0, width: 0 };
  private readonly world = new Container();
  private readonly tokenWorld = new Container();
  private readonly gmWorld = new Container();

  async mount(element: HTMLElement): Promise<void> {
    const width = Math.max(1, element.clientWidth);
    const height = Math.max(1, element.clientHeight);
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
    this.gmWorld.alpha = 0.5;
    this.app.stage.addChild(this.gmWorld);
    this.app.stage.addChild(this.remotePaintGraphics);
    this.app.stage.addChild(this.paintPreviewGraphics);
    this.app.stage.addChild(this.outline);
    this.app.stage.addChild(this.selectionGraphics);
    this.app.stage.addChild(this.marqueeGraphics);
    this.app.stage.addChild(this.pingGraphics);
    this.app.stage.addChild(this.measurementGraphics);

    const measurementLabels = document.createElement('div');
    measurementLabels.className = styles.measurementLabels;
    measurementLabels.setAttribute('aria-hidden', 'true');
    element.appendChild(measurementLabels);
    this.measurementLabels = measurementLabels;

    element.addEventListener('wheel', this.handleWheel, { passive: false });
    element.addEventListener('pointerdown', this.handlePointerDown);
    element.addEventListener('pointerenter', this.handlePointerEnter);
    element.addEventListener('pointerleave', this.handlePointerLeave);
    element.addEventListener('pointermove', this.handlePointerMove);
    element.addEventListener('pointerup', this.handlePointerUp);
    element.addEventListener('pointercancel', this.handlePointerUp);
    element.addEventListener('contextmenu', this.handleContextMenu);
    element.addEventListener('blur', this.handleBlur);
    element.addEventListener('keydown', this.handleKeyDown);
    element.addEventListener('keyup', this.handleKeyUp);

    const brushCursor = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg',
    );
    brushCursor.setAttribute('class', styles.brushCursor);
    brushCursor.setAttribute('aria-hidden', 'true');
    brushCursor.setAttribute('viewBox', '0 0 32 32');
    for (const [color, width] of [
      ['#000', '2.5'],
      ['#fff', '1'],
    ]) {
      const ring = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'circle',
      );
      ring.setAttribute('cx', '16');
      ring.setAttribute('cy', '16');
      ring.setAttribute('fill', 'none');
      ring.setAttribute('r', '15');
      ring.setAttribute('stroke', color);
      ring.setAttribute('stroke-width', width);
      ring.setAttribute('vector-effect', 'non-scaling-stroke');
      brushCursor.appendChild(ring);
    }
    element.appendChild(brushCursor);
    this.brushCursor = brushCursor;
    this.syncPaintCursor();

    this.rebuildScene();
  }

  setInteraction(options: SceneRendererInteraction): void {
    const layerChanged = options.activeLayer !== this.interaction.activeLayer;
    const editingDisabled =
      this.interaction.editable && !options.editable;
    const paintChanged =
      this.interaction.paintEnabled !== options.paintEnabled ||
      this.interaction.paintKind !== options.paintKind;
    const measurementDisabled =
      this.interaction.measureEnabled && !options.measureEnabled;
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
    this.interaction = options;
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
      this.remoteTransformStarts.clear();
    }
    if (sceneChanged) {
      this.cancelPaintGesture();
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
      this.undoStacks.set(scene.id, []);
      this.redoStacks.set(scene.id, []);
    }
    this.scene = scene;
    this.selected = new Set(
      [...this.selected].filter((id) => this.target(id) !== null),
    );
    this.imageUrls =
      typeof imageUrls === 'object' && imageUrls !== null ? imageUrls : {};
    const mapAssetId = scene?.mapImage?.assetId ?? null;
    const imageUrl =
      typeof imageUrls === 'string'
        ? imageUrls
        : scene?.mapImage
          ? this.imageUrls[scene.mapImage.assetId] ?? null
          : null;
    const sharedMapResourceReady = Boolean(
      mapAssetId &&
        (this.imageTextures.has(mapAssetId) ||
          this.imageGifSources.has(mapAssetId)),
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
        this.imageResourceUrls.get(mapAssetId) !== imageUrl &&
        this.imageLoadingUrls.get(mapAssetId) !== imageUrl
      ) {
        void this.loadAdditionalTexture(mapAssetId, imageUrl);
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
      element.removeEventListener('pointerenter', this.handlePointerEnter);
      element.removeEventListener('pointerleave', this.handlePointerLeave);
      element.removeEventListener('pointermove', this.handlePointerMove);
      element.removeEventListener('pointerup', this.handlePointerUp);
      element.removeEventListener('pointercancel', this.handlePointerUp);
      element.removeEventListener('contextmenu', this.handleContextMenu);
      element.removeEventListener('blur', this.handleBlur);
      element.removeEventListener('keydown', this.handleKeyDown);
      element.removeEventListener('keyup', this.handleKeyUp);
    }
    this.container = null;
    this.brushCursor?.remove();
    this.brushCursor = null;
    this.brushCursorPoint = null;
    this.pointerInside = false;
    this.measurementLabels?.remove();
    this.measurementLabels = null;
    this.mapTexture?.destroy(true);
    this.mapTexture = null;
    this.mapResourceAssetId = null;
    this.hatchTexture?.destroy(true);
    this.hatchTexture = null;
    for (const texture of this.imageTextures.values()) {
      texture.destroy(true);
    }
    this.imageTextures.clear();
    this.drawingGraphics.clear();
    this.imageResourceUrls.clear();
    for (const source of this.imageGifSources.values()) {
      source.destroy();
    }
    this.imageGifSources.clear();
    this.imageSpriteKinds.clear();
    for (const placeholder of this.imagePlaceholders.values()) {
      placeholder.destroy();
    }
    this.imagePlaceholders.clear();
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
    if (resource.gifSpriteClass) {
      this.gifSpriteClass = resource.gifSpriteClass;
    }
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
      !this.imageTextures.has(previousAssetId)
    ) {
      this.imageTextures.set(previousAssetId, previousTexture);
      if (this.imageUrl) {
        this.imageResourceUrls.set(previousAssetId, this.imageUrl);
      }
      transferredTexture = true;
    }
    if (
      previousAssetId &&
      previousStillPlaced &&
      previousGif &&
      !this.imageGifSources.has(previousAssetId)
    ) {
      this.imageGifSources.set(previousAssetId, previousGif);
      if (this.imageUrl) {
        this.imageResourceUrls.set(previousAssetId, this.imageUrl);
      }
      transferredGif = true;
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
    this.drawAdditionalImages();
    this.drawDrawings();
    this.applyCamera();
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
      this.imageTextures.get(placement.assetId) ??
      (ownsResource ? this.mapTexture : null);
    const gif =
      this.imageGifSources.get(placement.assetId) ??
      (ownsResource ? this.mapGifSource : null);
    const nextKind = gif ? 'gif' : texture ? 'texture' : null;
    if (!texture && (!gif || !this.gifSpriteClass)) {
      this.mapSprite?.destroy();
      this.mapSprite = null;
      this.mapSpriteKind = null;
      if (!this.mapPlaceholder) {
        this.mapPlaceholder = new Graphics();
        this.mapPlaceholder.zIndex = MAP_IMAGE_Z_INDEX;
        this.world.addChild(this.mapPlaceholder);
      }
      this.drawImagePlaceholder(
        this.mapPlaceholder,
        placement,
        true,
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
        gif && this.gifSpriteClass
          ? new this.gifSpriteClass(gif)
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
    const scene = structuredClone(active.base);
    const targets = new Set(active.input.targets);
    const applyAbsolute = (targetId: string): boolean => {
      if (!input.absolute) {
        return false;
      }
      if (targetId === CANONICAL_MAP_ID && scene.mapImage) {
        Object.assign(scene.mapImage, input.absolute);
        return true;
      }
      for (const layer of Object.values(scene.images) as SceneImage[][]) {
        const image = layer.find((candidate) => candidate.id === targetId);
        if (image) {
          Object.assign(image, input.absolute);
          return true;
        }
      }
      for (const layer of Object.values(scene.drawings) as SceneDrawing[][]) {
        const drawing = layer.find((candidate) => candidate.id === targetId);
        if (drawing) {
          Object.assign(drawing, input.absolute);
          return true;
        }
      }
      return false;
    };
    if (
      active.input.targets.length === 1 &&
      applyAbsolute(active.input.targets[0])
    ) {
      this.scene = scene;
      this.rebuildScene();
      return;
    }
    const radians = (input.rotation * Math.PI) / 180;
    const transformPoint = (x: number, y: number) => {
      const dx = (x - active.input.pivotX) * input.scaleX;
      const dy = (y - active.input.pivotY) * input.scaleY;
      return {
        x:
          active.input.pivotX +
          Math.cos(radians) * dx -
          Math.sin(radians) * dy +
          input.dx,
        y:
          active.input.pivotY +
          Math.sin(radians) * dx +
          Math.cos(radians) * dy +
          input.dy,
      };
    };
    const transformImage = <T extends SceneMapImage>(image: T): T => {
      const position = transformPoint(image.x, image.y);
      return {
        ...image,
        height: image.height * input.scaleY,
        rotation: image.rotation + input.rotation,
        width: image.width * input.scaleX,
        ...position,
      } as T;
    };
    if (targets.has(CANONICAL_MAP_ID) && scene.mapImage) {
      scene.mapImage = transformImage(scene.mapImage);
    }
    for (const layer of Object.values(scene.images) as SceneImage[][]) {
      for (let index = 0; index < layer.length; index += 1) {
        if (targets.has(layer[index].id)) {
          layer[index] = transformImage(layer[index]);
        }
      }
    }
    for (const layer of Object.values(scene.drawings) as SceneDrawing[][]) {
      for (let index = 0; index < layer.length; index += 1) {
        const drawing = layer[index];
        if (targets.has(drawing.id)) {
          layer[index] = {
            ...drawing,
            ...transformPoint(drawing.x, drawing.y),
            rotation: drawing.rotation + input.rotation,
            scaleX: drawing.scaleX * input.scaleX,
            scaleY: drawing.scaleY * input.scaleY,
          };
        }
      }
    }
    this.scene = scene;
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
    const measurement = this.activeMeasurement;
    return measurement
      ? measurementPath(measurement.fixedPoints, measurement.endpoint)
      : [];
  }

  private addMeasurementPivot(clientX: number, clientY: number): void {
    const measurement = this.activeMeasurement;
    if (!measurement || !this.scene) {
      return;
    }
    const point = measurementPoint(
      this.scene,
      screenToScene(
        this.camera,
        this.viewport,
        this.localPoint({ clientX, clientY } as MouseEvent),
      ),
    );
    measurement.endpoint = point;
    const last =
      measurement.fixedPoints[measurement.fixedPoints.length - 1];
    if (
      measurement.fixedPoints.length < MAX_MEASUREMENT_POINTS - 1 &&
      !sameMeasurementPoint(last, point)
    ) {
      measurement.fixedPoints.push(point);
    }
    this.emitMeasurementSnapshot(true);
    this.drawMeasurements();
  }

  private emitMeasurementSnapshot(force = false, now = Date.now()): void {
    const measurement = this.activeMeasurement;
    if (
      !measurement ||
      (!force &&
        now - measurement.lastSentAt < MEASUREMENT_UPDATE_INTERVAL_MS)
    ) {
      return;
    }
    measurement.lastSentAt = now;
    this.interaction.onMeasurementUpdate?.({
      active: true,
      measurementId: measurement.id,
      points: this.currentMeasurementPoints(),
      sceneId: measurement.sceneId,
      updateSequence: this.nextMeasurementSequence(),
    });
  }

  private cancelMeasurement(): void {
    const measurement = this.activeMeasurement;
    if (!measurement) {
      return;
    }
    this.activeMeasurement = null;
    this.interaction.onMeasurementUpdate?.({
      active: false,
      measurementId: measurement.id,
      points: [],
      sceneId: measurement.sceneId,
      updateSequence: this.nextMeasurementSequence(),
    });
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
    if (
      this.lastSentPingAt !== null &&
      now - this.lastSentPingAt < MAP_PING_COOLDOWN_MS
    ) {
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
    if (
      !this.scene ||
      !this.editMode ||
      this.editMode === 'marquee' ||
      this.interaction.activeLayer === 'gm' ||
      this.previewOperationId ||
      this.pendingPing?.pointerId === this.editPointerId
    ) {
      return;
    }
    const selected = this.selectedTargets();
    if (selected.length === 0) {
      return;
    }
    const frame = this.selectionFrame(selected);
    this.previewPivot = frame?.center ?? selected[0].image;
    this.previewOperationId = crypto.randomUUID();
    this.interaction.onPreviewStart?.({
      kind: this.editMode,
      operationId: this.previewOperationId,
      pivotX: this.previewPivot.x,
      pivotY: this.previewPivot.y,
      revision: this.scene.revision,
      sceneId: this.scene.id,
      startingTransforms: selected.map((target) => ({
        id: target.id,
        transform: target.drawing
          ? drawingTransformOf(target.drawing)
          : transformOf(target.image),
      })),
      targets: selected.map((target) => target.id),
    });
  }

  private drawAdditionalImages(): void {
    const layers = this.scene?.images ?? createEmptyImageLayers();
    const wanted = new Set<string>();
    const wantedAssets = new Set<string>();
    if (this.scene?.mapImage) {
      wantedAssets.add(this.scene.mapImage.assetId);
    }
    for (const layer of ['map', 'token', 'gm'] as const) {
      const container =
        layer === 'map'
          ? this.world
          : layer === 'token'
            ? this.tokenWorld
            : this.gmWorld;
      for (
        let imageIndex = 0;
        imageIndex < layers[layer].length;
        imageIndex += 1
      ) {
        const image = layers[layer][imageIndex];
        wanted.add(image.id);
        wantedAssets.add(image.assetId);
        const url = this.imageUrls[image.assetId];
        const sharesCanonicalResource =
          this.mapResourceAssetId === image.assetId;
        const texture =
          this.imageTextures.get(image.assetId) ??
          (sharesCanonicalResource ? this.mapTexture : null);
        const gif =
          this.imageGifSources.get(image.assetId) ??
          (sharesCanonicalResource ? this.mapGifSource : null);
        const resourceReady = Boolean(texture || (gif && this.gifSpriteClass));
        const nextKind = gif ? 'gif' : 'texture';
        let sprite = this.imageSprites.get(image.id);
        if (resourceReady) {
          if (sprite && this.imageSpriteKinds.get(image.id) !== nextKind) {
            sprite.parent?.removeChild(sprite);
            sprite.destroy();
            this.imageSprites.delete(image.id);
            this.imageSpriteKinds.delete(image.id);
            sprite = undefined;
          }
          if (!sprite) {
            sprite =
              gif && this.gifSpriteClass
                ? new this.gifSpriteClass(gif)
                : new Sprite();
            sprite.anchor.set(0.5);
            this.imageSprites.set(image.id, sprite);
            this.imageSpriteKinds.set(image.id, nextKind);
            container.addChild(sprite);
          } else if (sprite.parent !== container) {
            sprite.parent?.removeChild(sprite);
            container.addChild(sprite);
          }
          sprite.zIndex =
            layer === 'map'
              ? ADDITIONAL_MAP_Z_INDEX + imageIndex
              : imageIndex;
          sprite.width = image.width;
          sprite.height = image.height;
          sprite.position.set(image.x, image.y);
          sprite.angle = image.rotation;
          if (texture) {
            sprite.texture = texture;
          }
          this.removeImagePlaceholder(image.id);
        } else {
          if (sprite) {
            sprite.parent?.removeChild(sprite);
            sprite.destroy();
            this.imageSprites.delete(image.id);
            this.imageSpriteKinds.delete(image.id);
          }
          let placeholder = this.imagePlaceholders.get(image.id);
          if (!placeholder) {
            placeholder = new Graphics();
            this.imagePlaceholders.set(image.id, placeholder);
            container.addChild(placeholder);
          } else if (placeholder.parent !== container) {
            placeholder.parent?.removeChild(placeholder);
            container.addChild(placeholder);
          }
          placeholder.zIndex =
            layer === 'map'
              ? ADDITIONAL_MAP_Z_INDEX + imageIndex
              : imageIndex;
          this.drawImagePlaceholder(placeholder, image, true);
        }
        if (
          url &&
          this.imageLoadingUrls.get(image.assetId) !== url &&
          this.imageResourceUrls.get(image.assetId) !== url &&
          !(
            this.scene?.mapImage?.assetId === image.assetId &&
            this.mapResourceAssetId === image.assetId &&
            this.imageUrl === url
          )
        ) {
          void this.loadAdditionalTexture(image.assetId, url);
        }
      }
    }
    for (const [id, sprite] of this.imageSprites) {
      if (!wanted.has(id)) {
        sprite.parent?.removeChild(sprite);
        sprite.destroy();
        this.imageSprites.delete(id);
        this.imageSpriteKinds.delete(id);
      }
    }
    for (const id of this.imagePlaceholders.keys()) {
      if (!wanted.has(id)) {
        this.removeImagePlaceholder(id);
      }
    }
    for (const [assetId, texture] of this.imageTextures) {
      if (!wantedAssets.has(assetId)) {
        texture.destroy(true);
        this.imageTextures.delete(assetId);
        this.imageResourceUrls.delete(assetId);
      }
    }
    for (const [assetId, source] of this.imageGifSources) {
      if (!wantedAssets.has(assetId)) {
        source.destroy();
        this.imageGifSources.delete(assetId);
        this.imageResourceUrls.delete(assetId);
      }
    }
    this.world.sortChildren();
    this.tokenWorld.sortChildren();
    this.gmWorld.sortChildren();
  }

  private strokeDrawingPath(
    graphics: Graphics,
    drawing: Pick<SceneDrawing, 'closed' | 'points' | 'style'>,
  ): void {
    const points = drawing.points;
    const color = Number.parseInt(drawing.style.strokeColor.slice(1), 16);
    const passes =
      drawing.style.edge === 'soft'
        ? softBrushPasses(
            drawing.style.strokeWidth,
            drawing.style.strokeOpacity,
            drawing.style.hardness,
          )
        : [
            {
              alpha: drawing.style.strokeOpacity,
              width: drawing.style.strokeWidth,
            },
          ];
    if (points.length === 1) {
      const point = points[0];
      for (const pass of passes) {
        graphics
          .circle(point.x, point.y, pass.width / 2)
          .fill({ alpha: pass.alpha, color });
      }
      return;
    }
    const trace = () => {
      graphics.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) {
        graphics.lineTo(points[index].x, points[index].y);
      }
      if (drawing.closed) {
        graphics.lineTo(points[0].x, points[0].y);
      }
    };
    if (drawing.closed && drawing.style.fillEnabled) {
      trace();
      graphics.fill({
        alpha: drawing.style.fillOpacity,
        color: Number.parseInt(drawing.style.fillColor.slice(1), 16),
      });
    }
    for (const pass of passes) {
      trace();
      graphics.stroke({
        alpha: pass.alpha,
        cap: 'round',
        color,
        join: 'round',
        width: pass.width,
      });
    }
  }

  private drawDrawings(): void {
    const wanted = new Set<string>();
    const layers = this.scene?.drawings;
    if (!layers) {
      for (const [id, graphics] of this.drawingGraphics) {
        graphics.parent?.removeChild(graphics);
        graphics.destroy();
        this.drawingGraphics.delete(id);
      }
      return;
    }
    for (const layer of ['map', 'token', 'gm'] as const) {
      const container =
        layer === 'map'
          ? this.world
          : layer === 'token'
            ? this.tokenWorld
            : this.gmWorld;
      for (let index = 0; index < layers[layer].length; index += 1) {
        const drawing = layers[layer][index];
        wanted.add(drawing.id);
        let graphics = this.drawingGraphics.get(drawing.id);
        if (!graphics) {
          graphics = new Graphics();
          this.drawingGraphics.set(drawing.id, graphics);
          container.addChild(graphics);
        } else if (graphics.parent !== container) {
          graphics.parent?.removeChild(graphics);
          container.addChild(graphics);
        }
        graphics.clear();
        this.strokeDrawingPath(graphics, drawing);
        graphics.position.set(drawing.x, drawing.y);
        graphics.scale.set(drawing.scaleX, drawing.scaleY);
        graphics.angle = drawing.rotation;
        graphics.zIndex = 1_000_000 + index;
      }
    }
    for (const [id, graphics] of this.drawingGraphics) {
      if (!wanted.has(id)) {
        graphics.parent?.removeChild(graphics);
        graphics.destroy();
        this.drawingGraphics.delete(id);
      }
    }
    this.world.sortChildren();
    this.tokenWorld.sortChildren();
    this.gmWorld.sortChildren();
  }

  private async loadAdditionalTexture(assetId: string, url: string): Promise<void> {
    const token = (this.imageLoadTokens.get(assetId) ?? 0) + 1;
    this.imageLoadTokens.set(assetId, token);
    this.imageLoadingUrls.set(assetId, url);
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
    if (
      this.destroyed ||
      this.imageLoadTokens.get(assetId) !== token ||
      this.imageUrls[assetId] !== url
    ) {
      resource.texture?.destroy(true);
      resource.gif?.destroy();
      return;
    }
    this.imageLoadingUrls.delete(assetId);
    if (resource.gifSpriteClass) {
      this.gifSpriteClass = resource.gifSpriteClass;
    }
    if (resource.texture || resource.gif) {
      const previousTexture = this.imageTextures.get(assetId) ?? null;
      const previousGif = this.imageGifSources.get(assetId) ?? null;
      if (previousGif || resource.gif) {
        this.replaceAssetSprites(assetId);
        if (this.scene?.mapImage?.assetId === assetId) {
          this.mapSprite?.destroy();
          this.mapSprite = null;
          this.mapSpriteKind = null;
        }
      }
      this.imageTextures.delete(assetId);
      this.imageGifSources.delete(assetId);
      if (resource.texture) {
        this.imageTextures.set(assetId, resource.texture);
      } else if (resource.gif) {
        this.imageGifSources.set(assetId, resource.gif);
      }
      this.imageResourceUrls.set(assetId, url);
      this.rebuildScene();
      if (previousTexture && previousTexture !== resource.texture) {
        previousTexture.destroy(true);
      }
      if (previousGif && previousGif !== resource.gif) {
        previousGif.destroy();
      }
    }
  }

  private drawImagePlaceholder(
    graphic: Graphics,
    placement: SceneMapImage,
    centered: boolean,
  ): void {
    const left = centered ? -placement.width / 2 : 0;
    const top = centered ? -placement.height / 2 : 0;
    const color = this.placeholderColor;
    graphic
      .clear()
      .rect(left, top, placement.width, placement.height)
      .fill({ color: 0x24242a, alpha: 0.92 })
      .stroke({ color, width: 1 })
      .moveTo(left, top)
      .lineTo(left + placement.width, top + placement.height)
      .moveTo(left + placement.width, top)
      .lineTo(left, top + placement.height)
      .stroke({ color, width: 1 });
    graphic.position.set(placement.x, placement.y);
    graphic.angle = placement.rotation;
  }

  private removeImagePlaceholder(id: string): void {
    const placeholder = this.imagePlaceholders.get(id);
    if (!placeholder) {
      return;
    }
    placeholder.parent?.removeChild(placeholder);
    placeholder.destroy();
    this.imagePlaceholders.delete(id);
  }

  private replaceAssetSprites(assetId: string): void {
    for (const layer of Object.values(
      this.scene?.images ?? createEmptyImageLayers(),
    )) {
      for (const image of layer) {
        if (image.assetId !== assetId) {
          continue;
        }
        const sprite = this.imageSprites.get(image.id);
        sprite?.parent?.removeChild(sprite);
        sprite?.destroy();
        this.imageSprites.delete(image.id);
        this.imageSpriteKinds.delete(image.id);
      }
    }
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
      if (drawing && this.canEditDrawing(drawing)) {
        return drawingAsImage(drawing);
      }
    }
    return null;
  }

  private canEditDrawing(drawing: SceneDrawing): boolean {
    return (
      this.interaction.actorId == null ||
      drawing.ownerId === this.interaction.actorId
    );
  }

  private activeTargets(): EditTarget[] {
    if (!this.scene) {
      return [];
    }
    const layers = this.scene.images;
    const result: EditTarget[] =
      this.interaction.canEditImages === false
        ? []
        : layers[this.interaction.activeLayer].map((image) => ({
            id: image.id,
            image,
          }));
    if (
      this.interaction.canEditImages !== false &&
      this.interaction.activeLayer === 'map' &&
      this.scene.mapImage
    ) {
      result.unshift({ id: CANONICAL_MAP_ID, image: this.scene.mapImage });
    }
    for (const drawing of this.scene.drawings[this.interaction.activeLayer]) {
      if (this.canEditDrawing(drawing)) {
        result.push({
          drawing,
          id: drawing.id,
          image: drawingAsImage(drawing),
        });
      }
    }
    return result;
  }

  private selectedTargets(): EditTarget[] {
    if (!this.scene) {
      return [];
    }
    const lookup = new Map<string, EditTarget>();
    if (
      this.scene.mapImage &&
      this.interaction.canEditImages !== false
    ) {
      lookup.set(CANONICAL_MAP_ID, {
        id: CANONICAL_MAP_ID,
        image: this.scene.mapImage,
      });
    }
    if (this.interaction.canEditImages !== false) {
      for (const layer of Object.values(
        this.scene.images,
      ) as SceneImage[][]) {
        for (const image of layer) {
          lookup.set(image.id, { id: image.id, image });
        }
      }
    }
    for (const layer of Object.values(this.scene.drawings)) {
      for (const drawing of layer) {
        if (this.canEditDrawing(drawing)) {
          lookup.set(drawing.id, {
            drawing,
            id: drawing.id,
            image: drawingAsImage(drawing),
          });
        }
      }
    }
    return [...this.selected]
      .map((id) => lookup.get(id) ?? null)
      .filter(
        (target): target is EditTarget => target !== null,
      );
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
    if (targets.length === 0) {
      return null;
    }
    const angle =
      targets.length === 1
        ? targets[0].image.rotation
        : groupAngle;
    const radians = (-angle * Math.PI) / 180;
    const localPoints = targets.flatMap((target) =>
      corners(target.image).map((point) => ({
        x: Math.cos(radians) * point.x - Math.sin(radians) * point.y,
        y: Math.sin(radians) * point.x + Math.cos(radians) * point.y,
      })),
    );
    const minX = Math.min(...localPoints.map((point) => point.x));
    const maxX = Math.max(...localPoints.map((point) => point.x));
    const minY = Math.min(...localPoints.map((point) => point.y));
    const maxY = Math.max(...localPoints.map((point) => point.y));
    const localCorners = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
    const forward = (point: { x: number; y: number }) => {
      const forwardRadians = -radians;
      return {
        x:
          Math.cos(forwardRadians) * point.x -
          Math.sin(forwardRadians) * point.y,
        y:
          Math.sin(forwardRadians) * point.x +
          Math.cos(forwardRadians) * point.y,
      };
    };
    return {
      angle,
      center: forward({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }),
      corners: localCorners.map(forward),
      height: maxY - minY,
      width: maxX - minX,
    };
  }

  private selectedTargetsFromState(
    state: SceneImageState,
  ): EditTarget[] {
    const accessor = this.targetAccessor(state);
    return [...this.selected]
      .map((id) => {
        const image = accessor.read(id);
        const drawing = Object.values(state.drawings)
          .flat()
          .find((candidate) => candidate.id === id);
        return image ? { ...(drawing ? { drawing } : {}), id, image } : null;
      })
      .filter(
        (target): target is EditTarget => target !== null,
      );
  }

  private targetAccessor(state: SceneImageState): {
    read: (id: string) => SceneMapImage | null;
    write: (id: string, transform: SceneMapImage) => void;
  } {
    const locations = new Map<
      string,
      { index: number; layer: SceneImage[] }
    >();
    const drawingLocations = new Map<
      string,
      { index: number; layer: SceneDrawing[] }
    >();
    for (const layer of Object.values(state.images) as SceneImage[][]) {
      layer.forEach((image, index) => {
        locations.set(image.id, { index, layer });
      });
    }
    for (const layer of Object.values(state.drawings) as SceneDrawing[][]) {
      layer.forEach((drawing, index) => {
        drawingLocations.set(drawing.id, { index, layer });
      });
    }
    return {
      read: (id) => {
        if (id === CANONICAL_MAP_ID) {
          return state.mapImage;
        }
        const location = locations.get(id);
        if (location) {
          return location.layer[location.index];
        }
        const drawingLocation = drawingLocations.get(id);
        return drawingLocation
          ? drawingAsImage(drawingLocation.layer[drawingLocation.index])
          : null;
      },
      write: (id, transform) => {
        if (id === CANONICAL_MAP_ID) {
          state.mapImage = { ...transform };
          return;
        }
        const location = locations.get(id);
        if (location) {
          location.layer[location.index] = {
            ...location.layer[location.index],
            ...transform,
          };
          return;
        }
        const drawingLocation = drawingLocations.get(id);
        if (drawingLocation) {
          const drawing = drawingLocation.layer[drawingLocation.index];
          const local = drawingLocalBounds(drawing);
          drawingLocation.layer[drawingLocation.index] = {
            ...drawing,
            rotation: transform.rotation,
            scaleX: Math.max(0.001, transform.width / local.width),
            scaleY: Math.max(0.001, transform.height / local.height),
            x: transform.x,
            y: transform.y,
          };
        }
      },
    };
  }

  private applyState(state: SceneImageState): void {
    if (!this.scene) {
      return;
    }
    this.scene = { ...this.scene, ...state };
    this.rebuildScene();
  }

  private async commitState(
    before: SceneImageState,
    after: SceneImageState,
    record = true,
    beforeRotation = this.groupSelectionRotation,
    afterRotation = this.groupSelectionRotation,
    operationId: string = crypto.randomUUID(),
  ): Promise<boolean> {
    if (!this.scene || JSON.stringify(before) === JSON.stringify(after)) {
      return false;
    }
    const sceneId = this.scene.id;
    this.applyState(after);
    this.committing = true;
    let result: SceneRecord | null | undefined;
    try {
      result = await this.interaction.onCommit?.(after, operationId);
    } catch {
      result = null;
    } finally {
      this.committing = false;
    }
    if (!result) {
      this.applyState(before);
      this.groupSelectionRotation = beforeRotation;
      this.undoStacks.set(sceneId, []);
      this.redoStacks.set(sceneId, []);
      this.interaction.onPreviewCancel?.(operationId, sceneId);
      return false;
    }
    this.scene = result;
    if (record) {
      const undo = this.undoStacks.get(sceneId) ?? [];
      undo.push({ after, afterRotation, before, beforeRotation });
      this.undoStacks.set(sceneId, undo.slice(-100));
      this.redoStacks.set(sceneId, []);
    }
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

  private beginPendingPing(
    event: PointerEvent,
    screenPoint: { x: number; y: number },
  ): void {
    if (
      event.button !== 0 ||
      event.pointerType === 'touch' ||
      !this.interaction.pingEnabled ||
      !this.interaction.onPing ||
      (this.interaction.editable &&
        (this.handleAt(screenPoint) ||
          this.editableDrawingAt(
            screenToScene(this.camera, this.viewport, screenPoint),
          )))
    ) {
      return;
    }
    const scenePoint = this.scenePointInside(screenPoint);
    if (!scenePoint || this.placedImageAt(scenePoint)) {
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
    const targets = this.activeTargets();
    for (let index = targets.length - 1; index >= 0; index -= 1) {
      if (
        targets[index].drawing
          ? containsDrawingPoint(
              targets[index].drawing!,
              scenePoint,
              6 / this.camera.zoom,
            )
          : containsPoint(targets[index].image, scenePoint)
      ) {
        return targets[index].id;
      }
    }
    return null;
  }

  private selectionCorners(): Array<{ x: number; y: number }> {
    const frame = this.selectionFrame();
    return (frame?.corners ?? []).map((point) =>
      sceneToScreen(this.camera, this.viewport, point),
    );
  }

  private rotationHandle(points: Array<{ x: number; y: number }>) {
    const top = {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
    };
    const center = {
      x: (points[0].x + points[2].x) / 2,
      y: (points[0].y + points[2].y) / 2,
    };
    const dx = top.x - center.x;
    const dy = top.y - center.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    return {
      top,
      handle: {
        x: top.x + (dx / length) * ROTATION_HANDLE_OFFSET,
        y: top.y + (dy / length) * ROTATION_HANDLE_OFFSET,
      },
    };
  }

  private drawSelection(): void {
    this.selectionGraphics.clear();
    if (!this.interaction.editable || this.selected.size === 0) {
      return;
    }
    const points = this.selectionCorners();
    if (points.length !== 4) {
      return;
    }
    this.selectionGraphics.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      this.selectionGraphics.lineTo(points[index].x, points[index].y);
    }
    this.selectionGraphics.lineTo(points[0].x, points[0].y);
    this.selectionGraphics.stroke({
      color: readCssColor('--color-focus', '#eeeeee'),
      width: 2,
    });
    for (const point of points) {
      this.selectionGraphics
        .rect(
          point.x - SELECTION_HANDLE_SIZE / 2,
          point.y - SELECTION_HANDLE_SIZE / 2,
          SELECTION_HANDLE_SIZE,
          SELECTION_HANDLE_SIZE,
        )
        .fill({ color: readCssColor('--color-surface-raised', '#1d1d1d') })
        .stroke({
          color: readCssColor('--color-focus', '#eeeeee'),
          width: 2,
        });
    }
    const rotate = this.rotationHandle(points);
    this.selectionGraphics.moveTo(rotate.top.x, rotate.top.y);
    this.selectionGraphics.lineTo(rotate.handle.x, rotate.handle.y);
    this.selectionGraphics
      .stroke({
        color: readCssColor('--color-focus', '#eeeeee'),
        width: 2,
      })
      .circle(
        rotate.handle.x,
        rotate.handle.y,
        ROTATION_HANDLE_RADIUS,
      )
      .fill({ color: readCssColor('--color-surface-raised', '#1d1d1d') })
      .stroke({
        color: readCssColor('--color-focus', '#eeeeee'),
        width: 2,
      });
  }

  private handleAt(point: { x: number; y: number }):
    | { mode: 'resize'; corner: number }
    | { mode: 'rotate' }
    | null {
    const points = this.selectionCorners();
    if (points.length !== 4) {
      return null;
    }
    const threshold = SELECTION_HANDLE_HIT_SIZE / 2;
    for (let index = 0; index < points.length; index += 1) {
      if (Math.hypot(point.x - points[index].x, point.y - points[index].y) <= threshold) {
        return { mode: 'resize', corner: index };
      }
    }
    const rotate = this.rotationHandle(points).handle;
    return Math.hypot(point.x - rotate.x, point.y - rotate.y) <=
      SELECTION_HANDLE_HIT_SIZE / 2
      ? { mode: 'rotate' }
      : null;
  }

  private resizeCursor(corner: number): 'nesw-resize' | 'nwse-resize' {
    const angle = this.selectionFrame()?.angle ?? 0;
    const diagonal = ((angle + (corner % 2 === 0 ? 45 : 135)) % 180 + 180) %
      180;
    return diagonal < 90 ? 'nwse-resize' : 'nesw-resize';
  }

  private updateBrushCursor(): void {
    const style = this.interaction.paintStyle;
    const point = this.brushCursorPoint;
    const visible =
      this.pointerInside &&
      this.interaction.paintEnabled === true &&
      this.interaction.paintKind === 'freeform' &&
      style !== undefined &&
      point !== null;
    if (!this.brushCursor || !visible || !point) {
      if (this.brushCursor) {
        this.brushCursor.style.display = 'none';
      }
      return;
    }
    const diameter = Math.max(2, style.strokeWidth * this.camera.zoom);
    this.brushCursor.style.display = 'block';
    this.brushCursor.style.width = `${diameter}px`;
    this.brushCursor.style.height = `${diameter}px`;
    this.brushCursor.style.left = `${point.x}px`;
    this.brushCursor.style.top = `${point.y}px`;
  }

  private syncPaintCursor(): void {
    if (!this.container) {
      return;
    }
    if (
      this.interaction.paintEnabled &&
      this.interaction.paintKind === 'freeform'
    ) {
      this.container.style.cursor = 'none';
    } else if (
      this.interaction.paintEnabled &&
      this.interaction.paintKind === 'polyline'
    ) {
      this.container.style.cursor = POLYLINE_PEN_CURSOR;
    } else {
      this.container.style.cursor = '';
    }
    this.updateBrushCursor();
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
    const remoteHistory = redo
      ? this.interaction.onRedo
      : this.interaction.onUndo;
    if (remoteHistory) {
      const result = await remoteHistory();
      if (result) {
        this.scene = result;
        this.selected = new Set(
          [...this.selected].filter((id) => this.target(id) !== null),
        );
        this.rebuildScene();
      }
      return;
    }
    const source = redo ? this.redoStacks : this.undoStacks;
    const destination = redo ? this.undoStacks : this.redoStacks;
    const stack = source.get(this.scene.id) ?? [];
    const entry = stack.pop();
    if (!entry) {
      return;
    }
    const before = imageStateOf(this.scene);
    const previousRotation = this.groupSelectionRotation;
    const after = redo ? entry.after : entry.before;
    this.groupSelectionRotation = redo
      ? entry.afterRotation
      : entry.beforeRotation;
    source.set(this.scene.id, stack);
    const result = await this.interaction.onCommit?.(
      after,
      crypto.randomUUID(),
    );
    if (!result) {
      this.groupSelectionRotation = previousRotation;
      source.set(this.scene.id, [...stack, entry]);
      return;
    }
    destination.set(this.scene.id, [
      ...(destination.get(this.scene.id) ?? []),
      entry,
    ].slice(-100));
    this.scene = result;
    this.applyState(after);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      this.rebuildScene();
    }
  }

  private async deleteSelection(): Promise<void> {
    if (!this.scene || this.selected.size === 0) {
      return;
    }
    const before = imageStateOf(this.scene);
    const after = structuredClone(before);
    if (this.selected.has(CANONICAL_MAP_ID)) {
      after.mapImage = null;
    }
    for (const layer of Object.keys(after.images) as SceneImageLayer[]) {
      after.images[layer] = after.images[layer].filter(
        (image) => !this.selected.has(image.id),
      );
      after.drawings[layer] = after.drawings[layer].filter(
        (drawing) => !this.selected.has(drawing.id),
      );
    }
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
    return this.scene.images[this.interaction.activeLayer].filter((image) =>
      this.selected.has(image.id),
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
    const currentCount = Object.values(this.scene.images).reduce(
      (total, images) => total + images.length,
      0,
    );
    return currentCount + count <= MAX_SCENE_IMAGES;
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
    this.imageClipboard = {
      groupRotation: this.groupSelectionRotation,
      images: this.selectedPlacedImages().map((image) => ({ ...image })),
      sourceSceneId: this.scene.id,
    };
    this.pasteCount = 0;
    this.pasteTargetSceneId = null;
  }

  private async commitCreatedImages(
    images: SceneImage[],
    groupRotation: number,
  ): Promise<boolean> {
    if (!this.scene || !this.canCreateImages(images.length)) {
      return false;
    }
    const before = imageStateOf(this.scene);
    const after = structuredClone(before);
    after.images[this.interaction.activeLayer].push(...images);
    const beforeRotation = this.groupSelectionRotation;
    const afterRotation = images.length > 1 ? groupRotation : 0;
    if (
      !(await this.commitState(
        before,
        after,
        true,
        beforeRotation,
        afterRotation,
      ))
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
    const copies = this.selectedPlacedImages().map((image) =>
      roundTransform({
        ...image,
        id: crypto.randomUUID(),
        x: image.x + offset,
        y: image.y + offset,
      }),
    );
    await this.commitCreatedImages(copies, groupRotation);
  }

  private async pasteClipboard(): Promise<void> {
    if (
      !this.scene ||
      !this.imageClipboard ||
      !this.canCreateImages(this.imageClipboard.images.length)
    ) {
      return;
    }
    const clipboard = this.imageClipboard;
    const targetPasteCount =
      this.pasteTargetSceneId === this.scene.id ? this.pasteCount : 0;
    const offset = this.copyOffset();
    let dx: number;
    let dy: number;
    if (clipboard.sourceSceneId === this.scene.id) {
      dx = offset * (targetPasteCount + 1);
      dy = offset * (targetPasteCount + 1);
    } else {
      const clipboardBounds = bounds(clipboard.images);
      const clipboardCenter = {
        x: (clipboardBounds.minX + clipboardBounds.maxX) / 2,
        y: (clipboardBounds.minY + clipboardBounds.maxY) / 2,
      };
      const viewportCenter = screenToScene(this.camera, this.viewport, {
        x: this.viewport.width / 2,
        y: this.viewport.height / 2,
      });
      dx =
        viewportCenter.x -
        clipboardCenter.x +
        offset * targetPasteCount;
      dy =
        viewportCenter.y -
        clipboardCenter.y +
        offset * targetPasteCount;
    }
    const copies = clipboard.images.map((image) =>
      roundTransform({
        ...image,
        id: crypto.randomUUID(),
        x: image.x + dx,
        y: image.y + dy,
      }),
    );
    if (await this.commitCreatedImages(copies, clipboard.groupRotation)) {
      this.pasteTargetSceneId = this.scene.id;
      this.pasteCount = targetPasteCount + 1;
    }
  }

  private closeContextMenu(): void {
    this.contextMenu?.remove();
    this.contextMenu = null;
    if (this.contextMenuOutsideListener) {
      document.removeEventListener(
        'pointerdown',
        this.contextMenuOutsideListener,
        true,
      );
      this.contextMenuOutsideListener = null;
    }
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

    this.closeContextMenu();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.setAttribute(
      'aria-label',
      canPing ? 'Canvas actions' : 'Image actions',
    );
    menu.className = styles.contextMenu;
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;

    const add = (
      label: string,
      action: () => void,
      disabled = false,
    ) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.role = 'menuitem';
      button.textContent = label;
      button.disabled = disabled;
      button.className = styles.contextMenuItem;
      button.addEventListener('click', () => {
        this.closeContextMenu();
        action();
      });
      menu.appendChild(button);
      return button;
    };
    const addDivider = () => {
      const divider = document.createElement('div');
      divider.className = styles.contextMenuDivider;
      divider.role = 'separator';
      menu.appendChild(divider);
    };

    if (canPing) {
      add('Ping here', () => this.requestPing(scenePoint, false));
      add('Pull players here', () => this.requestPing(scenePoint, true));
    }
    if (canEditImage) {
      add(
        'Duplicate',
        () => void this.duplicateSelection(),
        !this.canDuplicateSelection(),
      );
      addDivider();

      const includesCanonical = this.selected.has(CANONICAL_MAP_ID);
      for (const layer of ['gm', 'token', 'map'] as const) {
        add(
          `Move to ${layer === 'gm' ? 'GM' : `${layer[0].toUpperCase()}${layer.slice(1)}`} layer`,
          () => void this.moveSelectionToLayer(layer),
          includesCanonical || layer === this.interaction.activeLayer,
        );
      }
      addDivider();
      add(
        'Bring to front',
        () => void this.reorderSelection('front'),
        includesCanonical,
      );
      add(
        'Bring forward',
        () => void this.reorderSelection('forward'),
        includesCanonical,
      );
      add(
        'Send backward',
        () => void this.reorderSelection('backward'),
        includesCanonical,
      );
      add(
        'Send to back',
        () => void this.reorderSelection('back'),
        includesCanonical,
      );

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.role = 'menuitem';
      deleteButton.className = `${styles.contextMenuItem} ${styles.contextMenuDelete}`;
      deleteButton.textContent = 'Delete';
      deleteButton.setAttribute('aria-label', 'Delete selection');
      deleteButton.addEventListener('click', () => {
        this.closeContextMenu();
        void this.deleteSelection();
      });
      menu.appendChild(deleteButton);
    }

    document.body.appendChild(menu);
    this.contextMenu = menu;
    const bounds = menu.getBoundingClientRect();
    const viewportPadding = 8;
    menu.style.left = `${Math.max(
      viewportPadding,
      Math.min(clientX, window.innerWidth - bounds.width - viewportPadding),
    )}px`;
    menu.style.top = `${Math.max(
      viewportPadding,
      Math.min(clientY, window.innerHeight - bounds.height - viewportPadding),
    )}px`;

    menu.addEventListener('keydown', (keyEvent) => {
      const buttons = [
        ...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
      ];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        this.closeContextMenu();
        this.container?.focus();
      } else if (
        keyEvent.key === 'ArrowDown' ||
        keyEvent.key === 'ArrowUp' ||
        keyEvent.key === 'Home' ||
        keyEvent.key === 'End'
      ) {
        keyEvent.preventDefault();
        const next =
          keyEvent.key === 'Home'
            ? 0
            : keyEvent.key === 'End'
              ? buttons.length - 1
              : (current +
                  (keyEvent.key === 'ArrowDown' ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }
    });
    (
      menu.querySelector(
        'button:not(:disabled)',
      ) as HTMLButtonElement | null
    )?.focus();
    const close = (closeEvent: Event) => {
      if (!menu.contains(closeEvent.target as Node)) {
        this.closeContextMenu();
      }
    };
    this.contextMenuOutsideListener = close;
    queueMicrotask(() => {
      if (this.contextMenu === menu) {
        document.addEventListener('pointerdown', close, true);
      }
    });
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
    const before = imageStateOf(this.scene);
    const after = structuredClone(before);
    const moved: SceneImage[] = [];
    for (const current of Object.keys(after.images) as SceneImageLayer[]) {
      const selected = after.images[current].filter((image) =>
        this.selected.has(image.id),
      );
      moved.push(...selected);
      after.images[current] = after.images[current].filter(
        (image) => !this.selected.has(image.id),
      );
    }
    after.images[layer].push(...moved);
    if (await this.commitState(before, after)) {
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
    const before = imageStateOf(this.scene);
    const after = structuredClone(before);
    after.images[this.interaction.activeLayer] = reorderSelected(
      after.images[this.interaction.activeLayer],
      this.selected,
      direction,
    );
    await this.commitState(before, after);
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
    // Both are screen-space, so they follow the camera by being redrawn.
    this.drawGrid();
    this.drawOutline();
    this.drawSelection();
    this.drawPings();
    this.drawMeasurements();
    this.drawRemotePaintPreviews();
    this.drawPaintPreview();
    this.updateBrushCursor();
  }

  private drawRemotePaintPreviews(): void {
    this.remotePaintGraphics.clear();
    for (const { preview } of this.remotePaintPreviews.values()) {
      const points = preview.points.map((point) =>
        sceneToScreen(this.camera, this.viewport, point),
      );
      this.strokeDrawingPath(this.remotePaintGraphics, {
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

  private simplifyFreeform(
    points: SceneDrawingPoint[],
  ): SceneDrawingPoint[] {
    if (points.length <= 2) {
      return points.map((point) => ({ ...point }));
    }
    const simplified = [points[0]];
    for (let index = 1; index < points.length - 1; index += 1) {
      const previous = simplified[simplified.length - 1];
      const point = points[index];
      if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.5) {
        simplified.push(point);
      }
    }
    simplified.push(points[points.length - 1]);
    if (simplified.length <= MAX_DRAWING_POINTS) {
      return simplified.map((point) => ({ ...point }));
    }
    const step =
      (simplified.length - 1) / (MAX_DRAWING_POINTS - 1);
    return Array.from({ length: MAX_DRAWING_POINTS }, (_, index) => ({
      ...simplified[Math.min(
        simplified.length - 1,
        Math.round(index * step),
      )],
    }));
  }

  private createDrawing(
    points: SceneDrawingPoint[],
    kind: SceneDrawing['kind'],
    style: SceneDrawingStyle,
    closed: boolean,
  ): SceneDrawing {
    const normalized =
      kind === 'freeform' ? this.simplifyFreeform(points) : points;
    const minX = Math.min(...normalized.map((point) => point.x));
    const maxX = Math.max(...normalized.map((point) => point.x));
    const minY = Math.min(...normalized.map((point) => point.y));
    const maxY = Math.max(...normalized.map((point) => point.y));
    const x = (minX + maxX) / 2;
    const y = (minY + maxY) / 2;
    return {
      closed,
      id: crypto.randomUUID(),
      kind,
      ownerId: this.interaction.actorId ?? null,
      points: normalized.map((point) => ({
        x: point.x - x,
        y: point.y - y,
      })),
      revision: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      style: {
        ...structuredClone(style),
        fillEnabled:
          kind === 'polyline' && closed && style.fillEnabled,
      },
      x,
      y,
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
    const before = imageStateOf(this.scene);
    const after = structuredClone(before);
    const layer =
      this.interaction.actorId == null
        ? this.interaction.activeLayer
        : 'token';
    after.drawings[layer].push(
      this.createDrawing(points, kind, style, closed),
    );
    await this.commitState(
      before,
      after,
      true,
      this.groupSelectionRotation,
      this.groupSelectionRotation,
      operationId,
    );
  }

  private compactPaintPreviewPoints(
    points: SceneDrawingPoint[],
  ): SceneDrawingPoint[] {
    if (points.length <= MAX_DRAWING_PREVIEW_POINTS) {
      return points.map((point) => ({ ...point }));
    }
    return Array.from({ length: MAX_DRAWING_PREVIEW_POINTS }, (_, index) => {
      const sourceIndex = Math.round(
        (index * (points.length - 1)) /
          (MAX_DRAWING_PREVIEW_POINTS - 1),
      );
      return { ...points[sourceIndex] };
    });
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
    this.interaction.onDrawingPreview?.({
      active: isActive,
      closed,
      kind,
      layer:
        this.interaction.actorId == null
          ? this.interaction.activeLayer
          : 'token',
      operationId: active.operationId,
      points: isActive
        ? this.compactPaintPreviewPoints(points)
        : [],
      ...(reliable ? { reliable: true } : {}),
      sceneId: this.scene.id,
      sequence: active.sequence,
      style: structuredClone(active.style),
    });
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
    this.strokeDrawingPath(this.paintPreviewGraphics, {
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
    if (event.button === 0 && this.committing) {
      event.preventDefault();
      return;
    }
    if (
      event.button === 0 &&
      this.interaction.paintEnabled &&
      this.interaction.paintStyle &&
      this.interaction.paintKind
    ) {
      const point = this.paintPoint(
        event,
        this.interaction.paintKind === 'polyline',
      );
      if (!point) {
        return;
      }
      event.preventDefault();
      this.cancelPendingPing();
      this.closeContextMenu();
      this.container?.focus();
      if (this.interaction.paintKind === 'freeform') {
        const operationId = crypto.randomUUID();
        this.activeFreeform = {
          operationId,
          pointerId: event.pointerId,
          points: [point],
          sequence: 0,
          style: structuredClone(this.interaction.paintStyle),
        };
        this.emitPaintSnapshot(
          this.activeFreeform,
          'freeform',
          this.activeFreeform.points,
          true,
          false,
          true,
        );
        this.container?.setPointerCapture(event.pointerId);
      } else if (!this.activePolyline) {
        this.activePolyline = {
          hover: point,
          operationId: crypto.randomUUID(),
          points: [point],
          sequence: 0,
          style: structuredClone(this.interaction.paintStyle),
        };
        this.emitPaintSnapshot(
          this.activePolyline,
          'polyline',
          [point],
          true,
          false,
          true,
        );
      } else {
        const first = this.activePolyline.points[0];
        if (
          this.activePolyline.points.length >= 3 &&
          Math.hypot(point.x - first.x, point.y - first.y) *
            this.camera.zoom <=
            10
        ) {
          this.finishPolyline(true);
          return;
        }
        if (event.detail >= 2) {
          this.finishPolyline();
          return;
        }
        if (this.activePolyline.points.length >= MAX_DRAWING_POINTS) {
          return;
        }
        this.activePolyline.points.push(point);
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
      event.button === 0 &&
      event.pointerType !== 'touch' &&
      this.interaction.measureEnabled
    ) {
      const point = this.scenePointInside(this.localPoint(event));
      if (!point) {
        return;
      }
      event.preventDefault();
      this.closeContextMenu();
      this.cancelPendingPing();
      this.container?.focus();
      const measured = measurementPoint(this.scene, point);
      this.activeMeasurement = {
        endpoint: measured,
        fixedPoints: [measured],
        id: crypto.randomUUID(),
        lastSentAt: 0,
        pointerId: event.pointerId,
        sceneId: this.scene.id,
      };
      this.container?.setPointerCapture(event.pointerId);
      this.emitMeasurementSnapshot(true);
      this.drawMeasurements();
      this.startAnimationLoop();
      return;
    }
    if (event.pointerType !== 'touch' && event.button === 0) {
      this.beginPendingPing(event, this.localPoint(event));
    }
    if (event.pointerType === 'touch') {
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
      } else {
        if (this.touchLongPressTimer) {
          clearTimeout(this.touchLongPressTimer);
          this.touchLongPressTimer = null;
        }
        this.cancelEditGesture();
        this.cancelCameraAnimation();
        const touches = [...this.touchPointers.values()].slice(0, 2);
        const first = touches[0];
        const second = touches[1];
        this.pinchLast = {
          distance: Math.hypot(
            second.clientX - first.clientX,
            second.clientY - first.clientY,
          ),
          x: (first.clientX + second.clientX) / 2,
          y: (first.clientY + second.clientY) / 2,
        };
        this.pinching = true;
        this.container?.setPointerCapture(event.pointerId);
        return;
      }
    }
    if (
      event.button === 0 &&
      this.interaction.editable &&
      this.interaction.onCommit
    ) {
      event.preventDefault();
      this.closeContextMenu();
      this.container?.focus();
      const screenPoint = this.localPoint(event);
      const handle = this.handleAt(screenPoint);
      const hit = this.hitAt(screenPoint);
      if (handle) {
        this.editMode = handle.mode;
        if (handle.mode === 'resize') {
          this.resizeCorner = handle.corner;
          if (this.container) {
            this.container.style.cursor = this.resizeCursor(handle.corner);
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
        this.editMode = 'move';
        if (this.container) {
          this.container.style.cursor = 'move';
        }
      } else {
        if (!event.shiftKey) {
          this.selected.clear();
          this.groupSelectionRotation = 0;
        }
        this.editMode = 'marquee';
        if (this.container) {
          this.container.style.cursor = '';
        }
      }
      this.editPointerId = event.pointerId;
      this.editStart = screenToScene(
        this.camera,
        this.viewport,
        screenPoint,
      );
      this.editBefore = imageStateOf(this.scene);
      this.editGroupRotationBefore = this.groupSelectionRotation;
      this.startEditPreview();
      this.container?.setPointerCapture(event.pointerId);
      this.drawSelection();
      return;
    }
    if (event.button !== MIDDLE_MOUSE_BUTTON) {
      return;
    }
    this.cancelCameraAnimation();
    // Suppresses the platform's middle-click autoscroll.
    event.preventDefault();
    this.dragPointerId = event.pointerId;
    this.dragX = event.clientX;
    this.dragY = event.clientY;
    this.container?.setPointerCapture(event.pointerId);
  };

  private readonly handlePointerEnter = (event: PointerEvent) => {
    this.pointerInside = true;
    this.brushCursorPoint = this.localPoint(event);
    this.updateBrushCursor();
  };

  private readonly handlePointerLeave = () => {
    this.pointerInside = false;
    this.updateBrushCursor();
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    this.pointerInside = true;
    this.brushCursorPoint = this.localPoint(event);
    this.updateBrushCursor();
    if (
      this.activeFreeform?.pointerId === event.pointerId
    ) {
      const point = this.paintPoint(event);
      if (point) {
        event.preventDefault();
        const previous =
          this.activeFreeform.points[this.activeFreeform.points.length - 1];
        if (
          Math.hypot(point.x - previous.x, point.y - previous.y) >=
          0.25 / this.camera.zoom
        ) {
          this.activeFreeform.points.push(point);
          this.emitPaintSnapshot(
            this.activeFreeform,
            'freeform',
            this.activeFreeform.points,
            true,
          );
          this.drawPaintPreview();
        }
      }
      return;
    }
    if (this.activePolyline && this.interaction.paintEnabled) {
      const point = this.paintPoint(event, true);
      if (point) {
        this.activePolyline.hover = point;
        this.emitPaintSnapshot(
          this.activePolyline,
          'polyline',
          [...this.activePolyline.points, point],
          true,
        );
        this.drawPaintPreview();
      }
      return;
    }
    if (
      this.activeMeasurement?.pointerId === event.pointerId &&
      this.scene
    ) {
      event.preventDefault();
      this.activeMeasurement.endpoint = measurementPoint(
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
    if (
      event.pointerType !== 'touch' &&
      this.editPointerId === null &&
      this.dragPointerId === null
    ) {
      this.updateHoverCursor(this.localPoint(event));
    }
    if (this.pendingPing?.pointerId === event.pointerId) {
      this.pendingPing.pullPlayers = event.shiftKey;
      const distance = Math.hypot(
        event.clientX - this.pendingPing.startClientX,
        event.clientY - this.pendingPing.startClientY,
      );
      if (distance <= MAP_PING_MOVE_TOLERANCE) {
        event.preventDefault();
        return;
      }
      this.cancelPendingPing(event.pointerId);
      this.startEditPreview();
    }
    if (event.pointerType === 'touch' && this.touchPointers.has(event.pointerId)) {
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
      if (this.pinching && this.touchPointers.size >= 2) {
        event.preventDefault();
        const touches = [...this.touchPointers.values()].slice(0, 2);
        const first = touches[0];
        const second = touches[1];
        const next = {
          distance: Math.max(
            1,
            Math.hypot(
              second.clientX - first.clientX,
              second.clientY - first.clientY,
            ),
          ),
          x: (first.clientX + second.clientX) / 2,
          y: (first.clientY + second.clientY) / 2,
        };
        if (this.pinchLast) {
          this.camera = pan(
            this.camera,
            next.x - this.pinchLast.x,
            next.y - this.pinchLast.y,
          );
          const rect = this.container?.getBoundingClientRect();
          this.camera = zoomAt(
            this.camera,
            this.viewport,
            {
              x: next.x - (rect?.left ?? 0),
              y: next.y - (rect?.top ?? 0),
            },
            next.distance / Math.max(1, this.pinchLast.distance),
          );
          this.applyCamera();
        }
        this.pinchLast = next;
        return;
      }
    }
    if (
      this.editPointerId === event.pointerId &&
      this.scene &&
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
        this.marqueeGraphics
          .clear()
          .rect(
            Math.min(start.x, screenPoint.x),
            Math.min(start.y, screenPoint.y),
            Math.abs(screenPoint.x - start.x),
            Math.abs(screenPoint.y - start.y),
          )
          .fill({
            alpha: 0.12,
            color: readCssColor('--color-focus', '#eeeeee'),
          })
          .stroke({
            color: readCssColor('--color-focus', '#eeeeee'),
            width: 1,
          });
        return;
      }
      const state: SceneImageState = structuredClone(this.editBefore);
      const stateTargets = this.targetAccessor(state);
      const selected = this.selectedTargetsFromState(this.editBefore);
      if (selected.length === 0) {
        return;
      }
      if (this.editMode === 'move') {
        let dx = point.x - this.editStart.x;
        let dy = point.y - this.editStart.y;
        if (snappingActive(this.scene.grid, this.leftAlt)) {
          const frame = this.selectionFrame(
            selected,
            this.editGroupRotationBefore,
          );
          const proposed = {
            ...selected[0].image,
            x: selected[0].image.x + dx,
            y: selected[0].image.y + dy,
          };
          if (selected.length === 1) {
            const snapped = snapMove(proposed, this.scene.grid);
            dx += snapped.x - proposed.x;
            dy += snapped.y - proposed.y;
          } else if (frame) {
            const topLeft = frame.corners[0];
            dx =
              snapValue(
                topLeft.x + dx,
                this.scene.grid.size,
                this.scene.grid.offsetX,
              ) - topLeft.x;
            dy =
              snapValue(
                topLeft.y + dy,
                this.scene.grid.size,
                this.scene.grid.offsetY,
              ) - topLeft.y;
          }
        }
        for (const target of selected) {
          stateTargets.write(target.id, {
            ...target.image,
            x: target.image.x + dx,
            y: target.image.y + dy,
          });
        }
      } else {
        const frame = this.selectionFrame(
          selected,
          this.editGroupRotationBefore,
        );
        if (!frame) {
          return;
        }
        const centre = frame.center;
        if (this.editMode === 'rotate') {
          const startAngle = Math.atan2(
            this.editStart.y - centre.y,
            this.editStart.x - centre.x,
          );
          const currentAngle = Math.atan2(
            point.y - centre.y,
            point.x - centre.x,
          );
          let delta =
            (Math.atan2(
              Math.sin(currentAngle - startAngle),
              Math.cos(currentAngle - startAngle),
            ) *
              180) /
            Math.PI;
          if (snappingActive(this.scene.grid, this.leftAlt)) {
            const startingAngle =
              selected.length > 1
                ? this.editGroupRotationBefore
                : selected[0].image.rotation;
            delta =
              Math.round((startingAngle + delta) / 15) * 15 -
              startingAngle;
          }
          const radians = (delta * Math.PI) / 180;
          if (selected.length > 1) {
            this.groupSelectionRotation =
              this.editGroupRotationBefore + delta;
          }
          for (const target of selected) {
            const dx = target.image.x - centre.x;
            const dy = target.image.y - centre.y;
            stateTargets.write(target.id, {
              ...target.image,
              rotation: target.image.rotation + delta,
              x: centre.x + Math.cos(radians) * dx - Math.sin(radians) * dy,
              y: centre.y + Math.sin(radians) * dx + Math.cos(radians) * dy,
            });
          }
        } else {
          const opposite = (this.resizeCorner + 2) % 4;
          const anchor = frame.corners[opposite];
          const startCorner = frame.corners[this.resizeCorner];
          let draggedPoint = {
            x: startCorner.x + point.x - this.editStart.x,
            y: startCorner.y + point.y - this.editStart.y,
          };
          if (snappingActive(this.scene.grid, this.leftAlt)) {
            draggedPoint = {
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
          const angle = (frame.angle * Math.PI) / 180;
          const basisX = { x: Math.cos(angle), y: Math.sin(angle) };
          const basisY = { x: -Math.sin(angle), y: Math.cos(angle) };
          const project = (
            value: { x: number; y: number },
            basis: { x: number; y: number },
          ) => value.x * basis.x + value.y * basis.y;
          const startVector = {
            x: startCorner.x - anchor.x,
            y: startCorner.y - anchor.y,
          };
          const pointerVector = {
            x: draggedPoint.x - anchor.x,
            y: draggedPoint.y - anchor.y,
          };
          let sx =
            project(pointerVector, basisX) /
            project(startVector, basisX);
          let sy =
            project(pointerVector, basisY) /
            project(startVector, basisY);
          if (!event.shiftKey) {
            const scale =
              Math.abs(point.x - this.editStart.x) >=
              Math.abs(point.y - this.editStart.y)
                ? sx
                : sy;
            sx = scale;
            sy = scale;
          }
          sx = Math.max(
            ...selected.map((target) => 1 / target.image.width),
            sx,
          );
          sy = Math.max(
            ...selected.map((target) => 1 / target.image.height),
            sy,
          );
          for (const target of selected) {
            const relative = {
              x: target.image.x - anchor.x,
              y: target.image.y - anchor.y,
            };
            const localX = project(relative, basisX) * sx;
            const localY = project(relative, basisY) * sy;
            stateTargets.write(target.id, {
              ...target.image,
              height: Math.max(1, target.image.height * sy),
              width: Math.max(1, target.image.width * sx),
              x: anchor.x + localX * basisX.x + localY * basisY.x,
              y: anchor.y + localX * basisX.y + localY * basisY.y,
            });
          }
        }
      }
      for (const target of this.selected) {
        const image = stateTargets.read(target);
        if (image) {
          const rounded = roundTransform(image);
          stateTargets.write(target, rounded);
        }
      }
      if (this.previewOperationId) {
        const first = selected[0];
        const next = stateTargets.read(first.id);
        if (next) {
          const scaleX = next.width / first.image.width;
          const scaleY = next.height / first.image.height;
          const rotation = shortestRotation(
            first.image.rotation,
            next.rotation,
          );
          const radians = (rotation * Math.PI) / 180;
          const relX = (first.image.x - this.previewPivot.x) * scaleX;
          const relY = (first.image.y - this.previewPivot.y) * scaleY;
          const nextDrawing = Object.values(state.drawings)
            .flat()
            .find((candidate) => candidate.id === first.id);
          this.interaction.onPreviewUpdate?.({
            ...(selected.length === 1
              ? {
                  absolute: nextDrawing
                    ? drawingTransformOf(nextDrawing)
                    : transformOf(next),
                }
              : {}),
            dx:
              next.x -
              (this.previewPivot.x +
                Math.cos(radians) * relX -
                Math.sin(radians) * relY),
            dy:
              next.y -
              (this.previewPivot.y +
                Math.sin(radians) * relX +
                Math.cos(radians) * relY),
            operationId: this.previewOperationId,
            rotation,
            scaleX,
            scaleY,
          });
        }
      }
      this.applyState(state);
      return;
    }
    if (this.dragPointerId !== event.pointerId) {
      return;
    }
    this.camera = pan(
      this.camera,
      event.clientX - this.dragX,
      event.clientY - this.dragY,
    );
    this.dragX = event.clientX;
    this.dragY = event.clientY;
    this.applyCamera();
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (this.activeFreeform?.pointerId === event.pointerId) {
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
    if (this.activeMeasurement?.pointerId === event.pointerId) {
      if (event.type !== 'pointercancel' && event.button !== 0) {
        return;
      }
      event.preventDefault();
      this.cancelMeasurement();
      return;
    }
    if (this.pingConsumedPointers.delete(event.pointerId)) {
      event.preventDefault();
      this.cancelPendingPing(event.pointerId);
      if (this.container?.hasPointerCapture(event.pointerId)) {
        this.container.releasePointerCapture(event.pointerId);
      }
      return;
    }
    this.cancelPendingPing(event.pointerId);
    if (event.pointerType === 'touch') {
      if (this.touchLongPressTimer) {
        clearTimeout(this.touchLongPressTimer);
        this.touchLongPressTimer = null;
      }
      const wasPinching = this.pinching;
      this.touchPointers.delete(event.pointerId);
      if (this.touchPointers.size < 2) {
        this.pinching = false;
        this.pinchLast = null;
      }
      if (this.touchLongPressOpened.delete(event.pointerId) || wasPinching) {
        event.preventDefault();
        return;
      }
    }
    if (this.editPointerId === event.pointerId) {
      const mode = this.editMode;
      const before = this.editBefore;
      const current = this.scene ? imageStateOf(this.scene) : null;
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
            true,
            this.editGroupRotationBefore,
            this.groupSelectionRotation,
            this.previewOperationId ?? undefined,
          );
        }
      }
      this.marqueeGraphics.clear();
      this.editPointerId = null;
      this.editStart = null;
      this.editBefore = null;
      this.editMode = null;
      this.previewOperationId = null;
      this.drawSelection();
      this.updateHoverCursor(this.localPoint(event));
      if (this.container?.hasPointerCapture(event.pointerId)) {
        this.container.releasePointerCapture(event.pointerId);
      }
      return;
    }
    if (this.dragPointerId !== event.pointerId) {
      return;
    }
    this.dragPointerId = null;
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
    this.editPointerId = null;
    this.editStart = null;
    this.editBefore = null;
    this.editMode = null;
    this.previewOperationId = null;
    this.marqueeGraphics.clear();
    if (this.container) {
      this.container.style.cursor = '';
    }
  }

  private beginNudge(): void {
    if (!this.scene || this.nudgeBefore) {
      return;
    }
    this.nudgeBefore = imageStateOf(this.scene);
    this.nudgeStartTargets = this.selectedTargets().map((target) => ({
      ...(target.drawing
        ? { drawing: structuredClone(target.drawing) }
        : {}),
      id: target.id,
      image: { ...target.image },
    }));
    if (
      this.interaction.activeLayer !== 'gm' &&
      this.nudgeStartTargets.length > 0
    ) {
      const frame = this.selectionFrame(this.nudgeStartTargets);
      if (frame) {
        this.nudgeOperationId = crypto.randomUUID();
        this.interaction.onPreviewStart?.({
          kind: 'nudge',
          operationId: this.nudgeOperationId,
          pivotX: frame.center.x,
          pivotY: frame.center.y,
          revision: this.scene.revision,
          sceneId: this.scene.id,
          startingTransforms: this.nudgeStartTargets.map((target) => ({
            id: target.id,
            transform: target.drawing
              ? drawingTransformOf(target.drawing)
              : transformOf(target.image),
          })),
          targets: this.nudgeStartTargets.map((target) => target.id),
        });
      }
    }
  }

  private async finishNudge(cancel = false): Promise<void> {
    if (!this.scene || !this.nudgeBefore) {
      return;
    }
    const before = this.nudgeBefore;
    const after = imageStateOf(this.scene);
    if (cancel) {
      this.applyState(before);
      if (this.nudgeOperationId) {
        this.interaction.onPreviewCancel?.(
          this.nudgeOperationId,
          this.scene.id,
        );
      }
    } else {
      await this.commitState(
        before,
        after,
        true,
        this.groupSelectionRotation,
        this.groupSelectionRotation,
        this.nudgeOperationId ?? undefined,
      );
    }
    this.nudgeBefore = null;
    this.nudgeOperationId = null;
    this.nudgeStartTargets = [];
    this.nudgeKeys.clear();
  }

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      if (this.pendingPing) {
        this.pendingPing.pullPlayers = event.shiftKey;
      }
    } else if (event.code === 'AltLeft') {
      this.leftAlt = false;
    } else if (event.code === 'ControlLeft' || event.code === 'ControlRight') {
      this.leftControl = false;
    } else if (event.key.startsWith('Arrow')) {
      this.nudgeKeys.delete(event.key);
      if (this.nudgeKeys.size === 0) {
        void this.finishNudge();
      }
    }
  };

  private readonly handleBlur = () => {
    this.leftAlt = false;
    this.leftControl = false;
    this.cancelPendingPing();
    this.pingConsumedPointers.clear();
    this.cancelMeasurement();
    this.cancelPaintGesture();
    this.cancelEditGesture();
    if (this.nudgeBefore) {
      void this.finishNudge();
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      if (this.pendingPing) {
        this.pendingPing.pullPlayers = true;
      }
    } else if (event.code === 'AltLeft') {
      this.leftAlt = true;
      return;
    }
    if (event.code === 'ControlLeft' || event.code === 'ControlRight') {
      this.leftControl = true;
    }
    if (event.key === 'Escape' && this.activeMeasurement) {
      event.preventDefault();
      this.cancelMeasurement();
      return;
    }
    if (this.activePolyline) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.cancelPaintGesture();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        this.finishPolyline();
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        this.activePolyline.points.pop();
        if (this.activePolyline.points.length === 0) {
          this.cancelPaintGesture();
        } else {
          this.activePolyline.hover =
            this.activePolyline.points[this.activePolyline.points.length - 1];
          this.emitPaintSnapshot(
            this.activePolyline,
            'polyline',
            [
              ...this.activePolyline.points,
              this.activePolyline.hover,
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
    if (!this.scene) {
      return;
    }
    if (this.committing) {
      return;
    }
    const primary = event.ctrlKey || event.metaKey;
    if (primary && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      void this.undo(event.shiftKey);
      return;
    }
    if (primary && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      void this.undo(true);
      return;
    }
    if (!this.interaction.editable) {
      return;
    }
    const shortcut = event.key.toLowerCase();
    if (
      event.ctrlKey &&
      !event.metaKey &&
      (shortcut === 'c' || shortcut === 'd' || shortcut === 'v')
    ) {
      event.preventDefault();
      if (event.repeat) {
        return;
      }
      if (shortcut === 'c') {
        this.copySelection();
      } else if (shortcut === 'd') {
        void this.duplicateSelection();
      } else {
        void this.pasteClipboard();
      }
      return;
    }
    if (event.key === 'Escape') {
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
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      if (this.selected.size > 0) {
        void this.deleteSelection();
      }
      return;
    }
    if (event.key.startsWith('Arrow') && this.selected.size > 0) {
      event.preventDefault();
      this.beginNudge();
      this.nudgeKeys.add(event.key);
      const after = imageStateOf(this.scene);
      const afterTargets = this.targetAccessor(after);
      const snapped = snappingActive(this.scene.grid, this.leftAlt);
      const step = snapped ? this.scene.grid.size : 1;
      const dx =
        event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy =
        event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      for (const target of this.selectedTargets()) {
        afterTargets.write(target.id, {
          ...target.image,
          x: target.image.x + dx,
          y: target.image.y + dy,
        });
      }
      this.applyState(after);
      if (this.nudgeOperationId && this.nudgeStartTargets.length > 0) {
        const first = this.nudgeStartTargets[0];
        const next = this.target(first.id);
        if (next) {
          const nextDrawing = Object.values(this.scene.drawings)
            .flat()
            .find((drawing) => drawing.id === first.id);
          this.interaction.onPreviewUpdate?.({
            ...(this.nudgeStartTargets.length === 1
              ? {
                  absolute: nextDrawing
                    ? drawingTransformOf(nextDrawing)
                    : transformOf(next),
                }
              : {}),
            dx: next.x - first.image.x,
            dy: next.y - first.image.y,
            operationId: this.nudgeOperationId,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
          });
        }
      }
    }
  };
}

export function createSceneRenderer(): SceneRendererHandle {
  return new SceneRenderer();
}
