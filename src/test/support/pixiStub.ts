/**
 * jsdom has no WebGL or WebGPU context, so `pixi.js` is aliased to this stub in
 * vitest.config.mts. It implements only the surface `SceneRenderer` touches, so
 * the renderer's own scene-graph bookkeeping still runs under test while the
 * GPU work becomes a no-op. Drawing itself is covered by camera and grid tests.
 */

class Point {
  x: number;
  y: number;

  constructor(x = 0, y = x) {
    this.x = x;
    this.y = y;
  }

  set(x: number, y = x) {
    this.x = x;
    this.y = y;
  }
}

export class Container {
  alpha = 1;
  children: Container[] = [];
  parent: Container | null = null;
  readonly position = new Point();
  readonly scale = new Point();
  sortableChildren = false;
  visible = true;
  zIndex = 0;

  addChild<T extends Container>(child: T): T {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  removeChild<T extends Container>(child: T): T {
    this.children = this.children.filter((candidate) => candidate !== child);
    child.parent = null;
    return child;
  }

  sortChildren(): void {
    this.children.sort((left, right) => left.zIndex - right.zIndex);
  }

  destroy(): void {
    this.children = [];
  }
}

interface GraphicsCall {
  args: unknown[];
  op: 'circle' | 'clear' | 'fill' | 'lineTo' | 'moveTo' | 'rect' | 'stroke';
}

export class Graphics extends Container {
  /** Recorded so tests can assert what was drawn without a GPU. */
  calls: GraphicsCall[] = [];

  private record(op: GraphicsCall['op'], args: unknown[]): this {
    this.calls.push({ args, op });
    return this;
  }

  clear(): this {
    this.calls = [];
    return this.record('clear', []);
  }

  circle(...args: unknown[]): this {
    return this.record('circle', args);
  }

  fill(...args: unknown[]): this {
    return this.record('fill', args);
  }

  lineTo(...args: unknown[]): this {
    return this.record('lineTo', args);
  }

  moveTo(...args: unknown[]): this {
    return this.record('moveTo', args);
  }

  rect(...args: unknown[]): this {
    return this.record('rect', args);
  }

  stroke(...args: unknown[]): this {
    return this.record('stroke', args);
  }
}

export class Texture {
  destroyed = false;
  height: number;
  width: number;

  constructor(width = 0, height = 0) {
    this.height = height;
    this.width = width;
  }

  static from(source?: {
    height?: number;
    naturalHeight?: number;
    naturalWidth?: number;
    width?: number;
  }) {
    return new Texture(
      source?.naturalWidth ?? source?.width ?? 0,
      source?.naturalHeight ?? source?.height ?? 0,
    );
  }

  destroy(): void {
    this.destroyed = true;
  }
}

export class Sprite extends Container {
  readonly anchor = new Point();
  angle = 0;
  height = 0;
  texture: Texture | null = null;
  width = 0;
}

export class Text extends Container {
  readonly anchor = new Point();
  angle = 0;
  style: {
    fontSize?: number;
    padding?: number;
    stroke?: { width?: number };
  } = {};
  text = '';

  constructor(options: { anchor?: number } = {}) {
    super();
    if (options.anchor !== undefined) {
      this.anchor.set(options.anchor);
    }
  }

  get height(): number {
    const size = this.style.fontSize ?? 16;
    const padding = this.style.padding ?? 0;
    return Math.max(1, this.text.split('\n').length * size * 1.2 + padding * 2);
  }

  get width(): number {
    const size = this.style.fontSize ?? 16;
    const padding = this.style.padding ?? 0;
    const longest = Math.max(
      1,
      ...this.text.split('\n').map((line) => [...line].length),
    );
    return Math.max(1, longest * size * 0.6 + padding * 2);
  }
}

export class TilingSprite extends Container {
  height: number;
  /** Real Pixi defaults this to 1, not 0. */
  readonly tileScale = new Point(1);
  tint = 0xffffff;
  width: number;

  constructor(options: { height?: number; width?: number } = {}) {
    super();
    this.height = options.height ?? 0;
    this.width = options.width ?? 0;
  }
}

export class Application {
  readonly canvas = document.createElement('canvas');
  destroyed = false;
  readonly renderer = {
    height: 0,
    resize(width: number, height: number) {
      this.width = width;
      this.height = height;
    },
    width: 0,
  };
  readonly stage = new Container();

  async init(options: { height?: number; width?: number } = {}): Promise<void> {
    this.renderer.resize(options.width ?? 0, options.height ?? 0);
  }

  destroy(): void {
    this.destroyed = true;
  }
}
