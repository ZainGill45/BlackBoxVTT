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
  currentFrame = 0;
  playing = true;

  constructor(source: GifSource) {
    super();
    this.texture = new Texture(source.width, source.height);
  }

  play(): void {
    this.playing = true;
  }

  stop(): void {
    this.playing = false;
  }
}
