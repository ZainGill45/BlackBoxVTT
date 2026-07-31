import { Sprite, Texture } from './pixiStub';

export class GifSource {
  destroyed = false;
  readonly height = 1;
  readonly width = 1;

  static from(): GifSource {
    return new GifSource();
  }

  destroy(): void {
    this.destroyed = true;
  }
}

export class GifSprite extends Sprite {
  constructor(source: GifSource) {
    super();
    this.texture = new Texture(source.width, source.height);
  }

  play(): void {
    // Animation timing belongs to Pixi; renderer tests only need the display node.
  }
}
