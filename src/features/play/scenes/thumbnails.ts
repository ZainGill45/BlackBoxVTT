/** Long edge of a generated thumbnail, in device pixels. */
export const THUMBNAIL_MAX_EDGE = 512;
const THUMBNAIL_TYPE = 'image/webp';
const THUMBNAIL_QUALITY = 0.8;

interface Size {
  height: number;
  width: number;
}

interface ThumbnailResult {
  blob: Blob;
  /** The source image's real dimensions, not the thumbnail's. */
  sourceHeight: number;
  sourceWidth: number;
}

/** Scales a source down to fit `maxEdge`, never up, preserving aspect ratio. */
export function fitWithin(source: Size, maxEdge: number): Size {
  const longest = Math.max(source.width, source.height);
  if (longest <= 0) {
    return { height: 0, width: 0 };
  }
  if (longest <= maxEdge) {
    return { height: Math.round(source.height), width: Math.round(source.width) };
  }
  const scale = maxEdge / longest;
  return {
    height: Math.max(1, Math.round(source.height * scale)),
    width: Math.max(1, Math.round(source.width * scale)),
  };
}

function encode(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), THUMBNAIL_TYPE, THUMBNAIL_QUALITY);
  });
}

/**
 * Decodes `source` and re-encodes it small.
 *
 * `createImageBitmap`'s resize options do the decode and the downscale off the
 * main thread, which is the point: a scene list of 4000px maps would otherwise
 * block the UI thread decoding tens of megapixels just to paint thumbnails.
 *
 * Returns null when the platform cannot do this, so callers can fall back to the
 * full-size image rather than showing nothing.
 */
export async function createThumbnail(
  source: Blob,
  maxEdge = THUMBNAIL_MAX_EDGE,
): Promise<ThumbnailResult | null> {
  if (typeof createImageBitmap !== 'function') {
    return null;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source);
  } catch {
    return null;
  }

  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;

  try {
    const size = fitWithin(bitmap, maxEdge);
    if (size.width === 0 || size.height === 0) {
      return null;
    }

    let scaled: ImageBitmap = bitmap;
    if (size.width !== bitmap.width || size.height !== bitmap.height) {
      try {
        scaled = await createImageBitmap(source, {
          resizeHeight: size.height,
          resizeQuality: 'high',
          resizeWidth: size.width,
        });
      } catch {
        // Resize options are unsupported; the canvas draw below still scales.
        scaled = bitmap;
      }
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d');
      if (!context) {
        return null;
      }
      context.drawImage(scaled, 0, 0, size.width, size.height);
      const blob = await encode(canvas);
      return blob ? { blob, sourceHeight, sourceWidth } : null;
    } finally {
      if (scaled !== bitmap) {
        scaled.close();
      }
    }
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}
