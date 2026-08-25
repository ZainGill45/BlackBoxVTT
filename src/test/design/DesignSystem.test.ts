import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(process.cwd());
const sourceRoot = join(repositoryRoot, 'src');

function collectFiles(directory: string, extensions: ReadonlySet<string>): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' ? [] : collectFiles(path, extensions);
    return extensions.has(extname(entry.name)) ? [path] : [];
  });
}

function label(path: string): string {
  return relative(repositoryRoot, path).replaceAll('\\', '/');
}

const productionScripts = collectFiles(sourceRoot, new Set(['.ts', '.tsx']));
const sharedTextControlStyles = new Set([
  'src/components/ui/DefaultInput.module.css',
  'src/components/ui/InlineInput.module.css',
]);
const surfaceDeclaration = /(?:^|[;{]\s*)(?:background(?:-color)?|border(?:-(?:top|right|bottom|left)(?:-color|-style|-width)?|-color|-style|-width)?|box-shadow|outline(?:-color|-offset|-style|-width)?):/u;

function parsed(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
}

const interactiveElements = new Set(['button', 'input', 'select', 'textarea']);
const elementOwners = new Map<string, ReadonlySet<string>>([
  ['button', new Set(['src/components/ui/Button.tsx'])],
  ['input', new Set([
    'src/components/ui/Checkbox.tsx',
    'src/components/ui/ColorInput.tsx',
    'src/components/ui/DefaultInput.tsx',
    'src/components/ui/InlineInput.tsx',
    'src/components/ui/RangeInput.tsx',
  ])],
  ['textarea', new Set(['src/components/ui/DefaultInput.tsx'])],
]);

describe('design-system boundaries', () => {
  it('keeps interactive DOM construction inside shared control roots', () => {
    const offenders: string[] = [];
    for (const file of productionScripts) {
      const source = parsed(file);
      const sourceName = label(file);
      const checkElement = (element: string, node: ts.Node) => {
        if (!interactiveElements.has(element) || elementOwners.get(element)?.has(sourceName)) return;
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        offenders.push(`${sourceName}:${position.line + 1}:<${element}>`);
      };
      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          checkElement(node.tagName.getText(source), node);
        } else if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText(source) === 'document' &&
          node.expression.name.text === 'createElement' &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          checkElement(node.arguments[0].text, node);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps content measurement inside InlineInput', () => {
    const offenders: string[] = [];
    for (const file of productionScripts.filter((path) => path.endsWith('.tsx'))) {
      const source = parsed(file);
      const visit = (node: ts.Node) => {
        if (
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          node.tagName.getText(source) === 'InlineInput' &&
          node.attributes.properties.some((property) =>
            ts.isJsxAttribute(property) && property.name.getText(source) === 'size',
          )
        ) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source));
          offenders.push(`${label(file)}:${position.line + 1}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps field sizing in the InlineInput root', () => {
    const offenders = collectFiles(sourceRoot, new Set(['.css']))
      .filter((file) => readFileSync(file, 'utf8').includes('field-sizing:'))
      .map(label)
      .filter((file) => file !== 'src/components/ui/InlineInput.module.css');
    expect(offenders).toEqual([]);
  });

  it('keeps CSS color literals in the theme palette', () => {
    const colorLiteral = /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(|\boklch\(/giu;
    const offenders = collectFiles(sourceRoot, new Set(['.css']))
      .filter((file) => label(file) !== 'src/styles/tokens.css')
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return [...source.matchAll(colorLiteral)].map((match) => {
          const line = source.slice(0, match.index).split(/\r?\n/u).length;
          return `${label(file)}:${line}:${match[0]}`;
        });
      });
    expect(offenders).toEqual([]);
  });

  it('keeps raw palette values behind semantic tokens', () => {
    const offenders = collectFiles(sourceRoot, new Set(['.css']))
      .filter((file) => label(file) !== 'src/styles/tokens.css')
      .filter((file) => readFileSync(file, 'utf8').includes('var(--palette-'))
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('keeps default text fields and dropdown triggers on one control surface', () => {
    const input = readFileSync(
      join(sourceRoot, 'components/ui/DefaultInput.module.css'),
      'utf8',
    );
    const dropdown = readFileSync(
      join(sourceRoot, 'components/ui/Dropdown.module.css'),
      'utf8',
    );
    const sharedTokens = [
      '--color-control-background',
      '--color-control-background-hover',
      '--color-control-border',
      '--color-control-border-hover',
      '--color-control-border-focus',
      '--color-control-text',
      '--font-size-control',
      '--control-height',
    ];

    for (const token of sharedTokens) {
      expect(input, `DefaultInput must consume ${token}`).toContain(`var(${token})`);
      expect(dropdown, `Dropdown must consume ${token}`).toContain(`var(${token})`);
    }
  });

  it('makes fill-height dropdowns occupy the entire available field', () => {
    const dropdown = readFileSync(
      join(sourceRoot, 'components/ui/Dropdown.module.css'),
      'utf8',
    );

    expect(dropdown).toMatch(
      /\.heightFill\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*\}/u,
    );
    expect(dropdown).toMatch(/\.heightFill>summary\s*\{[^}]*height:\s*100%;[^}]*\}/u);
  });

  it('keeps hover from repainting the canonical field surface', () => {
    const tokens = readFileSync(join(sourceRoot, 'styles/tokens.css'), 'utf8');
    expect(tokens).toMatch(
      /--color-control-background-hover:\s*var\(--color-control-background\);/u,
    );
  });

  it('keeps text-control surfaces inside shared input roots', () => {
    const offenders: string[] = [];

    for (const file of productionScripts.filter((path) => path.endsWith('.tsx'))) {
      const source = parsed(file);
      const styleImports = new Map<string, string>();

      for (const statement of source.statements) {
        if (
          ts.isImportDeclaration(statement) &&
          statement.importClause?.name &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text.endsWith('.module.css')
        ) {
          styleImports.set(
            statement.importClause.name.text,
            resolve(dirname(file), statement.moduleSpecifier.text),
          );
        }
      }

      const visit = (node: ts.Node) => {
        if (
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          ['DefaultInput', 'InlineInput'].includes(node.tagName.getText(source))
        ) {
          const className = node.attributes.properties.find((property) =>
            ts.isJsxAttribute(property) && property.name.getText(source) === 'className',
          );
          if (className && ts.isJsxAttribute(className) && className.initializer) {
            const expression = className.initializer.getText(source);
            for (const [identifier, cssPath] of styleImports) {
              const classReference = new RegExp(`\\b${identifier}\\.([A-Za-z_][A-Za-z0-9_]*)`, 'gu');
              for (const match of expression.matchAll(classReference)) {
                const classSelector = new RegExp(`\\.${match[1]}(?:[^A-Za-z0-9_-]|$)`, 'u');
                const css = readFileSync(cssPath, 'utf8');
                for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
                  if (classSelector.test(rule[1]) && surfaceDeclaration.test(`;${rule[2]}`)) {
                    offenders.push(`${label(cssPath)}:.${match[1]}`);
                  }
                }
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    for (const cssPath of collectFiles(sourceRoot, new Set(['.css']))) {
      if (sharedTextControlStyles.has(label(cssPath))) continue;
      const css = readFileSync(cssPath, 'utf8');
      for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
        if (
          /(?:^|[\s>+~])(?:input|textarea)(?=[^A-Za-z0-9_-]|$)/u.test(rule[1]) &&
          surfaceDeclaration.test(`;${rule[2]}`)
        ) {
          offenders.push(`${label(cssPath)}:${rule[1].trim()}`);
        }
      }
    }

    expect([...new Set(offenders)].sort()).toEqual([]);
  });

  it('keeps dropdown trigger presentation inside the Dropdown root', () => {
    const offenders = collectFiles(sourceRoot, new Set(['.css']))
      .filter((file) => label(file) !== 'src/components/ui/Dropdown.module.css')
      .filter((file) => /\bsummary\b/u.test(readFileSync(file, 'utf8')))
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('keeps button content layout inside the Button root', () => {
    const offenders: string[] = [];

    for (const file of productionScripts.filter((path) => path.endsWith('.tsx'))) {
      const source = parsed(file);
      const styleImports = new Map<string, string>();

      for (const statement of source.statements) {
        if (
          ts.isImportDeclaration(statement) &&
          statement.importClause?.name &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text.endsWith('.module.css')
        ) {
          styleImports.set(
            statement.importClause.name.text,
            resolve(dirname(file), statement.moduleSpecifier.text),
          );
        }
      }

      const visit = (node: ts.Node) => {
        if (
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          node.tagName.getText(source) === 'Button'
        ) {
          const className = node.attributes.properties.find((property) =>
            ts.isJsxAttribute(property) && property.name.getText(source) === 'className',
          );
          if (className && ts.isJsxAttribute(className) && className.initializer) {
            const expression = className.initializer.getText(source);
            for (const [identifier, cssPath] of styleImports) {
              const classReference = new RegExp(`\\b${identifier}\\.([A-Za-z_][A-Za-z0-9_]*)`, 'gu');
              for (const match of expression.matchAll(classReference)) {
                const classSelector = new RegExp(`\\.${match[1]}(?:[^A-Za-z0-9_-]|$)`, 'u');
                const css = readFileSync(cssPath, 'utf8');
                const ownsContentLayout = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
                  .some((rule) =>
                    classSelector.test(rule[1]) &&
                    /\b(?:justify-content|text-align)\s*:/u.test(rule[2]),
                  );
                if (ownsContentLayout) {
                  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
                  offenders.push(`${label(file)}:${position.line + 1}:.${match[1]}`);
                }
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect([...new Set(offenders)].sort()).toEqual([]);
  });

  it('keeps rollable important-stat labels aligned with ordinary labels', () => {
    const source = parsed(join(
      sourceRoot,
      'systems/dnd5e/renderer/CharacterSheetModal.tsx',
    ));
    const matchingButtons: ts.JsxOpeningElement[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'Button') {
        const ariaLabel = node.attributes.properties.find((property) =>
          ts.isJsxAttribute(property) && property.name.getText(source) === 'aria-label',
        );
        const labelSource = ariaLabel?.getText(source) ?? '';
        if (
          labelSource.includes('Roll Concentration saving throw') &&
          labelSource.includes('Roll Initiative')
        ) {
          matchingButtons.push(node);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    expect(matchingButtons).toHaveLength(1);
    expect(matchingButtons[0].attributes.properties.some((property) =>
      ts.isJsxAttribute(property) &&
      property.name.getText(source) === 'align' &&
      property.initializer?.getText(source) === '"left"',
    )).toBe(true);
  });

  it('keeps inline text buttons free of hover surfaces', () => {
    const buttonStyles = readFileSync(
      join(sourceRoot, 'components/ui/Button.module.css'),
      'utf8',
    );
    const textHoverRule = [...buttonStyles.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
      .find((rule) => rule[1].includes('.text:hover:not(:disabled)'));
    expect(textHoverRule?.[2]).toMatch(/\bbackground:\s*transparent\s*;/u);

    const characterSheet = readFileSync(
      join(sourceRoot, 'systems/dnd5e/renderer/CharacterSheetModal.tsx'),
      'utf8',
    );
    expect(characterSheet).toMatch(
      /aria-label=\{rollKind === 'concentration'[\s\S]*?variant="text"/u,
    );
  });
});
