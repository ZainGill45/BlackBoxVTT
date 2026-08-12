import { inflateSync } from 'node:zlib';

/**
 * Just enough PNG to answer "did anything actually get drawn?".
 *
 * The renderer's canvas is WebGL, and Pixi does not set `preserveDrawingBuffer`,
 * so reading it back with `toDataURL` from inside the page returns a blank
 * image. A Playwright screenshot goes through the compositor instead and always
 * reflects what was presented — but it arrives as a PNG, so it has to be
 * decoded before it can be asserted on.
 *
 * Handles the 8-bit RGB/RGBA non-interlaced images Playwright produces. Anything
 * else throws rather than guessing.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface DecodedPng {
  width: number;
  height: number;
  /** Row-major RGBA, 4 bytes per pixel. */
  pixels: Buffer;
}

export interface PixelRegion {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface Rgb {
  blue: number;
  green: number;
  red: number;
}

export function decodePng(png: Buffer): DecodedPng {
  if (!png.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('Not a PNG.');
  }

  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];

  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data.readUInt8(8);
      const colorType = data.readUInt8(9);
      const interlace = data.readUInt8(12);
      if (bitDepth !== 8 || interlace !== 0) {
        throw new Error(
          `Unsupported PNG: bit depth ${bitDepth}, interlace ${interlace}.`,
        );
      }
      if (colorType === 2) {
        channels = 3;
      } else if (colorType === 6) {
        channels = 4;
      } else {
        throw new Error(`Unsupported PNG colour type ${colorType}.`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }

    // 4 length + 4 type + data + 4 CRC.
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  // Reconstructed bytes of the previous row, needed by the Up/Average/Paeth
  // filters. The first row is filtered against an implicit row of zeroes.
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw.readUInt8(y * (stride + 1));
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));

    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      switch (filter) {
        case 0:
          break;
        case 1:
          value += left;
          break;
        case 2:
          value += up;
          break;
        case 3:
          value += Math.floor((left + up) / 2);
          break;
        case 4:
          value += paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`Unknown PNG filter ${filter}.`);
      }
      line[x] = value & 0xff;
    }

    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      pixels[target] = line[source];
      pixels[target + 1] = line[source + 1];
      pixels[target + 2] = line[source + 2];
      pixels[target + 3] = channels === 4 ? line[source + 3] : 0xff;
    }

    previous = line;
  }

  return { height, pixels, width };
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const dLeft = Math.abs(estimate - left);
  const dUp = Math.abs(estimate - up);
  const dUpLeft = Math.abs(estimate - upLeft);
  if (dLeft <= dUp && dLeft <= dUpLeft) {
    return left;
  }
  return dUp <= dUpLeft ? up : upLeft;
}

/**
 * The fraction of pixels that differ between two screenshots.
 *
 * Distinct-colour counts are a poor way to tell two frames apart — an empty
 * stage and a drawn one can land on similar counts by coincidence. Comparing
 * pixels directly says how much of the view actually changed, and the tolerance
 * absorbs the antialiasing jitter that makes consecutive frames of the same
 * scene differ slightly.
 */
export function pixelDifferenceRatio(
  before: Buffer,
  after: Buffer,
  tolerance = 8,
): number {
  const left = decodePng(before);
  const right = decodePng(after);
  if (
    Math.abs(left.width - right.width) > 1 ||
    Math.abs(left.height - right.height) > 1
  ) {
    throw new Error(
      `Screenshots differ in size: ${left.width}x${left.height} vs ${right.width}x${right.height}.`,
    );
  }

  let changed = 0;
  // Windows can round an Electron content view by one physical pixel between
  // captures. Compare the shared area; a larger layout change still fails
  // above, while the asserted scene pixels remain fully represented.
  const width = Math.min(left.width, right.width);
  const height = Math.min(left.height, right.height);
  const total = width * height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const leftIndex = (y * left.width + x) * 4;
      const rightIndex = (y * right.width + x) * 4;
      if (
        Math.abs(left.pixels[leftIndex] - right.pixels[rightIndex]) >
          tolerance ||
        Math.abs(left.pixels[leftIndex + 1] - right.pixels[rightIndex + 1]) >
          tolerance ||
        Math.abs(left.pixels[leftIndex + 2] - right.pixels[rightIndex + 2]) >
          tolerance
      ) {
        changed += 1;
      }
    }
  }
  return changed / total;
}

/**
 * The changed-pixel ratio inside one screenshot region.
 *
 * Transient effects such as a map ping occupy only a few hundred pixels. A
 * whole-canvas ratio dilutes that real signal below compositor noise, while a
 * region around the expected effect still asserts on pixels the user sees.
 */
export function pixelDifferenceRatioInRegion(
  before: Buffer,
  after: Buffer,
  region: PixelRegion,
  tolerance = 8,
): number {
  const left = decodePng(before);
  const right = decodePng(after);
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(
      `Screenshots differ in size: ${left.width}x${left.height} vs ${right.width}x${right.height}.`,
    );
  }

  const minX = Math.max(0, Math.floor(region.x));
  const minY = Math.max(0, Math.floor(region.y));
  const maxX = Math.min(left.width, Math.ceil(region.x + region.width));
  const maxY = Math.min(left.height, Math.ceil(region.y + region.height));
  if (maxX <= minX || maxY <= minY) {
    throw new Error('The requested pixel comparison region is empty.');
  }

  let changed = 0;
  const total = (maxX - minX) * (maxY - minY);
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const index = (y * left.width + x) * 4;
      if (
        Math.abs(left.pixels[index] - right.pixels[index]) > tolerance ||
        Math.abs(left.pixels[index + 1] - right.pixels[index + 1]) >
          tolerance ||
        Math.abs(left.pixels[index + 2] - right.pixels[index + 2]) > tolerance
      ) {
        changed += 1;
      }
    }
  }
  return changed / total;
}

/** Fraction of pixels within an RGB tolerance of a target colour. */
export function pixelColorCoverage(
  png: Buffer,
  target: Rgb,
  tolerance = 16,
): number {
  const { height, pixels, width } = decodePng(png);
  let matching = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (
      Math.abs(pixels[index] - target.red) <= tolerance &&
      Math.abs(pixels[index + 1] - target.green) <= tolerance &&
      Math.abs(pixels[index + 2] - target.blue) <= tolerance
    ) {
      matching += 1;
    }
  }
  return matching / (width * height);
}

/** Bounds containing every pixel matching any target colour. */
export function pixelColorBounds(
  png: Buffer,
  targets: readonly Rgb[],
  tolerance = 16,
): PixelRegion | null {
  const { height, pixels, width } = decodePng(png);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const index = pixel * 4;
    const matches = targets.some(
      (target) =>
        Math.abs(pixels[index] - target.red) <= tolerance &&
        Math.abs(pixels[index + 1] - target.green) <= tolerance &&
        Math.abs(pixels[index + 2] - target.blue) <= tolerance,
    );
    if (!matches) {
      continue;
    }
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (maxX < 0 || maxY < 0) {
    return null;
  }
  return {
    height: maxY - minY + 1,
    width: maxX - minX + 1,
    x: minX,
    y: minY,
  };
}

/** How many distinct RGB colours the image contains, capped for cheapness. */
export function countDistinctColors(png: Buffer, cap = 512): number {
  const { pixels } = decodePng(png);
  const seen = new Set<number>();
  for (let index = 0; index < pixels.length; index += 4) {
    seen.add((pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2]);
    if (seen.size >= cap) {
      return seen.size;
    }
  }
  return seen.size;
}
