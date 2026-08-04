import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(process.cwd(), 'src');
const tokensPath = join(sourceRoot, 'styles', 'tokens.css');
const globalStylesPath = join(sourceRoot, 'styles', 'global.css');

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
const globalStylesSource = readFileSync(globalStylesPath, 'utf8');

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

  it('hides scrollbars with one universal cross-browser rule', () => {
    expect(globalStylesSource).toMatch(
      /\*\s*\{[^}]*scrollbar-width:\s*none;[^}]*-ms-overflow-style:\s*none;[^}]*\}/is,
    );
    expect(globalStylesSource).toMatch(
      /\*::-webkit-scrollbar\s*\{[^}]*display:\s*none;[^}]*\}/is,
    );

    for (const file of cssFiles.filter((file) => file !== globalStylesPath)) {
      const source = readFileSync(file, 'utf8');
      expect(
        source,
        `${relative(sourceRoot, file)} defines component-specific scrollbar hiding`,
      ).not.toMatch(/scrollbar-width|-ms-overflow-style|::-webkit-scrollbar/i);
    }
  });

  it('scales the desktop layout between 720p and 4K', () => {
    const rootFontSize = tokensSource.match(
      /font-size:\s*clamp\(\s*([\d.]+)px\s*,\s*min\(\s*([\d.]+)vw\s*,\s*([\d.]+)vh\s*\)\s*,\s*([\d.]+)px\s*\)/i,
    );
    expect(rootFontSize, 'the root font size is not a viewport clamp').not.toBeNull();
    const [, floor, vw, vh, ceiling] = rootFontSize!.map(Number);

    // Assert the claim in the name rather than the digits that happen to
    // express it: the viewport terms should reach the floor at 1280x720 and the
    // ceiling at 3840x2160, so any equivalent rewrite of the clamp still passes.
    expect((1280 * vw) / 100).toBeCloseTo(floor, 3);
    expect((720 * vh) / 100).toBeCloseTo(floor, 3);
    expect((3840 * vw) / 100).toBeCloseTo(ceiling, 3);
    expect((2160 * vh) / 100).toBeCloseTo(ceiling, 3);

    expect(cssSource).not.toMatch(/min-width:\s*120rem/i);
    expect(cssSource).not.toMatch(/min-height:\s*67\.5rem/i);
  });

  it('uses scalable dimensions for rendered icons', () => {
    // Scoped to components that actually render an icon. Matching every
    // numeric width/height/size prop in the codebase flagged unrelated ones —
    // a canvas dimension or an input size is not a design-system violation.
    const numericDimension = String.raw`\s(?:size|width|height)=(?:\{\s*\d+(?:\.\d+)?\s*\}|"\d+(?:\.\d+)?")`;
    const offenders: string[] = [];

    for (const file of collectFiles(sourceRoot, '.tsx')) {
      const source = readFileSync(file, 'utf8');
      const iconNames = new Set(['Icon']);
      for (const [, imported] of source.matchAll(
        /import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g,
      )) {
        for (const entry of imported.split(',')) {
          const local = entry.trim().split(/\s+as\s+/).at(-1)?.trim();
          if (local) {
            iconNames.add(local);
          }
        }
      }

      for (const name of iconNames) {
        const usage = new RegExp(`<${name}\\b[^>]*${numericDimension}`, 'g');
        if (usage.test(source)) {
          offenders.push(`${relative(sourceRoot, file)} sizes <${name}> in pixels`);
        }
      }
    }

    expect(offenders).toEqual([]);
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
        ).toMatch(/^var\(--font-size-(?:xs|sm|md|lg|xl)\)$/);
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
