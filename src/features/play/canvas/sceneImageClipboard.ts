import type { SceneImage } from '../../../shared/scenes';
import { bounds, roundTransform } from './imageGeometry';

interface ClipboardContents {
  groupRotation: number;
  images: SceneImage[];
  sourceSceneId: string;
}

interface PasteRequest {
  offset: number;
  targetSceneId: string;
  viewportCenter: { x: number; y: number };
}

export interface PendingImagePaste {
  complete(): void;
  groupRotation: number;
  images: SceneImage[];
}

/** Owns cross-scene image copies and successful-paste offset progression. */
export class SceneImageClipboard {
  private contents: ClipboardContents | null = null;
  private pasteCount = 0;
  private pasteTargetSceneId: string | null = null;

  constructor(
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  copy(
    sourceSceneId: string,
    images: SceneImage[],
    groupRotation: number,
  ): void {
    this.contents = {
      groupRotation,
      images: images.map((image) => ({ ...image })),
      sourceSceneId,
    };
    this.pasteCount = 0;
    this.pasteTargetSceneId = null;
  }

  createPaste(request: PasteRequest): PendingImagePaste | null {
    if (!this.contents) {
      return null;
    }
    const contents = this.contents;
    const targetPasteCount =
      this.pasteTargetSceneId === request.targetSceneId
        ? this.pasteCount
        : 0;
    let dx: number;
    let dy: number;
    if (contents.sourceSceneId === request.targetSceneId) {
      dx = request.offset * (targetPasteCount + 1);
      dy = request.offset * (targetPasteCount + 1);
    } else {
      const clipboardBounds = bounds(contents.images);
      const clipboardCenter = {
        x: (clipboardBounds.minX + clipboardBounds.maxX) / 2,
        y: (clipboardBounds.minY + clipboardBounds.maxY) / 2,
      };
      dx =
        request.viewportCenter.x -
        clipboardCenter.x +
        request.offset * targetPasteCount;
      dy =
        request.viewportCenter.y -
        clipboardCenter.y +
        request.offset * targetPasteCount;
    }
    return {
      complete: () => {
        this.pasteTargetSceneId = request.targetSceneId;
        this.pasteCount = targetPasteCount + 1;
      },
      groupRotation: contents.groupRotation,
      images: contents.images.map((image) =>
        roundTransform({
          ...image,
          id: this.createId(),
          x: image.x + dx,
          y: image.y + dy,
        }),
      ),
    };
  }
}
