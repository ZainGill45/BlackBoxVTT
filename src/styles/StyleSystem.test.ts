import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(process.cwd(), 'src');
const tokensPath = join(sourceRoot, 'styles', 'tokens.css');

function collectFiles(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectFiles(path, extension);
    }

    return entry.name.endsWith(extension) ? [path] : [];
  });
}

const cssFiles = collectFiles(sourceRoot, '.css');
const cssSource = cssFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
const tokensSource = readFileSync(tokensPath, 'utf8');
const tsxSource = collectFiles(sourceRoot, '.tsx')
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

describe('visual-system invariants', () => {
  it('uses one unconditional dark color scheme', () => {
    expect(tokensSource).toMatch(/\bcolor-scheme:\s*dark\b/i);
    expect(tokensSource).not.toMatch(/\bcolor-scheme:\s*light\b/i);
    expect(cssSource).not.toMatch(/prefers-color-scheme/i);
  });

  it('contains only grayscale values outside named server-status colors', () => {
    const hexColors = [...cssSource.matchAll(/#([0-9a-f]{6})\b/gi)];
    const rgbColors = [
      ...cssSource.matchAll(/rgb\(\s*(\d+)\s+(\d+)\s+(\d+)/gi),
    ];
    const allowedStatusColors = new Set([
      '2f7d32',
      'a33636',
      '6fbd73',
      'd76f6f',
    ]);

    for (const [, hex] of hexColors) {
      const normalizedHex = hex.toLowerCase();
      const isGrayscale =
        normalizedHex.slice(0, 2) === normalizedHex.slice(2, 4) &&
        normalizedHex.slice(2, 4) === normalizedHex.slice(4, 6);

      expect(isGrayscale || allowedStatusColors.has(normalizedHex)).toBe(true);
    }

    for (const [, red, green, blue] of rgbColors) {
      expect(red).toBe(green);
      expect(green).toBe(blue);
    }
  });

  it('keeps every border radius square', () => {
    const radiusValues = [
      ...cssSource.matchAll(/border-radius\s*:\s*([^;]+);/gi),
    ].map((match) => match[1].trim());

    expect(radiusValues.length).toBeGreaterThan(0);

    for (const radius of radiusValues) {
      expect(radius).toBe('0');
    }
  });

  it('scales the desktop layout between 720p and 4K', () => {
    expect(tokensSource).toMatch(
      /font-size:\s*clamp\(\s*10\.6667px,\s*min\(\s*0\.833333vw,\s*1\.481481vh\s*\),\s*32px\s*\)/i,
    );
    expect(cssSource).not.toMatch(/min-width:\s*120rem/i);
    expect(cssSource).not.toMatch(/min-height:\s*67\.5rem/i);
  });

  it('uses scalable dimensions for rendered icons', () => {
    expect(tsxSource).not.toMatch(
      /\b(?:height|size|width)=(?:\{\d+(?:\.\d+)?\}|"\d+(?:\.\d+)?")/,
    );
  });

  it('uses only the bundled type scale and approved font weights', () => {
    const declaredFontWeights = [
      ...tokensSource.matchAll(/@font-face\s*\{[^}]*font-weight:\s*(\d+);/gis),
    ].map((match) => Number(match[1]));

    expect(declaredFontWeights).toEqual([400, 500, 600]);
    expect(cssSource).not.toMatch(/font-weight\s*:\s*(?:bold|[7-9]00|750)\b/i);

    for (const file of cssFiles.filter((file) => file !== tokensPath)) {
      const source = readFileSync(file, 'utf8');
      const fontSizes = [
        ...source.matchAll(/font-size\s*:\s*([^;]+);/gi),
      ].map((match) => match[1].trim());

      for (const fontSize of fontSizes) {
        expect(
          fontSize,
          `${relative(sourceRoot, file)} contains an off-scale font size`,
        ).toMatch(/^var\(--font-size-(?:xs|sm|md|lg)\)$/);
      }
    }
  });

  it('uses the same two-direction grid treatment on both primary canvases', () => {
    const appStyles = readFileSync(
      join(sourceRoot, 'app', 'App.module.css'),
      'utf8',
    );
    const playStyles = readFileSync(
      join(sourceRoot, 'features', 'play', 'PlayScreen.module.css'),
      'utf8',
    );
    const appGridSize = appStyles.match(/background-size:\s*([^;]+);/)?.[1];
    const playGridSize = playStyles.match(/background-size:\s*([^;]+);/)?.[1];

    expect(appStyles.match(/^\s*linear-gradient\(/gm)).toHaveLength(2);
    expect(playStyles.match(/^\s*linear-gradient\(/gm)).toHaveLength(2);
    expect(appGridSize).toBeTruthy();
    expect(playGridSize).toBe(appGridSize);
    expect(`${appStyles}\n${playStyles}`).not.toMatch(/radial-gradient/i);
  });
});
