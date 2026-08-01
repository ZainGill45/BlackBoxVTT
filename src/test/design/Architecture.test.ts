import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(process.cwd());
const sourceRoot = join(repositoryRoot, 'src');

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'test' ? [] : collectSourceFiles(path);
    }
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : [];
  });
}

function sourceFile(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
}

function resolveLocalImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) {
    return null;
  }
  const base = resolve(dirname(from), specifier);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (sourceFiles.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

function importedSpecifiers(path: string): string[] {
  const result: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      result.push(node.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      result.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      result.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile(path));
  return result;
}

const files = collectSourceFiles(sourceRoot);
const sourceFiles = new Set(files);
const imports = new Map(
  files.map((file) => [
    file,
    importedSpecifiers(file).flatMap((specifier) => {
      const target = resolveLocalImport(file, specifier);
      return target ? [target] : [];
    }),
  ]),
);

function label(path: string): string {
  return relative(repositoryRoot, path).replaceAll('\\', '/');
}

function importCycles(): string[][] {
  let nextIndex = 0;
  const stack: string[] = [];
  const stacked = new Set<string>();
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const cycles: string[][] = [];

  const visit = (file: string) => {
    index.set(file, nextIndex);
    lowLink.set(file, nextIndex);
    nextIndex += 1;
    stack.push(file);
    stacked.add(file);

    for (const dependency of imports.get(file) ?? []) {
      if (!index.has(dependency)) {
        visit(dependency);
        lowLink.set(
          file,
          Math.min(lowLink.get(file)!, lowLink.get(dependency)!),
        );
      } else if (stacked.has(dependency)) {
        lowLink.set(
          file,
          Math.min(lowLink.get(file)!, index.get(dependency)!),
        );
      }
    }

    if (lowLink.get(file) !== index.get(file)) {
      return;
    }
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      stacked.delete(member);
      component.push(member);
    } while (member !== file);
    if (component.length > 1) {
      cycles.push(component.map(label));
    }
  };

  for (const file of files) {
    if (!index.has(file)) {
      visit(file);
    }
  }
  return cycles;
}

describe('architecture boundaries', () => {
  it('keeps the production dependency graph acyclic', () => {
    expect(importCycles()).toEqual([]);
  });

  it('keeps shared contracts independent of process-specific code', () => {
    const offenders = files
      .filter((file) => label(file).startsWith('src/shared/'))
      .flatMap((file) =>
        (imports.get(file) ?? [])
          .filter((dependency) => !label(dependency).startsWith('src/shared/'))
          .map((dependency) => `${label(file)} -> ${label(dependency)}`),
      );
    expect(offenders).toEqual([]);
  });

  it('does not make the main process depend on renderer modules', () => {
    const rendererRoots = ['src/app/', 'src/components/', 'src/features/'];
    const offenders = files
      .filter((file) => label(file).startsWith('src/main/'))
      .flatMap((file) =>
        (imports.get(file) ?? [])
          .filter((dependency) =>
            rendererRoots.some((root) => label(dependency).startsWith(root)),
          )
          .map((dependency) => `${label(file)} -> ${label(dependency)}`),
      );
    expect(offenders).toEqual([]);
  });

  it('keeps campaign table rules independent of network transports', () => {
    const transportModules = new Set([
      'src/main/network/campaignClient.ts',
      'src/main/network/campaignHostServer.ts',
      'src/main/network/clientNetworkSession.ts',
      'src/main/network/hostClient.ts',
      'src/main/network/tcpProtocol.ts',
      'src/main/network/udpProtocol.ts',
    ]);
    const offenders = files
      .filter((file) => label(file).startsWith('src/main/campaignTable/'))
      .flatMap((file) =>
        (imports.get(file) ?? [])
          .filter((dependency) => transportModules.has(label(dependency)))
          .map((dependency) => `${label(file)} -> ${label(dependency)}`),
      );
    expect(offenders).toEqual([]);
  });

  it('keeps transport implementations behind campaign session owners', () => {
    const manager = files.find(
      (file) => label(file) === 'src/main/network/networkManager.ts',
    );
    expect(manager).toBeDefined();
    const forbidden = new Set([
      'src/main/network/assetCache.ts',
      'src/main/network/campaignClient.ts',
      'src/main/network/campaignHostServer.ts',
      'src/main/network/clientNetworkSession.ts',
    ]);
    const offenders = (imports.get(manager!) ?? [])
      .filter((dependency) => forbidden.has(label(dependency)))
      .map((dependency) => `${label(manager!)} -> ${label(dependency)}`);
    expect(offenders).toEqual([]);
  });

  it('constructs campaign repositories only in the workspace owner', () => {
    const repositoryClasses = new Set([
      'AssetRepository',
      'CampaignIdentityRepository',
      'ChatRepository',
      'SceneRepository',
      'ServerConfigRepository',
    ]);
    const offenders: string[] = [];
    for (const file of files) {
      const parsed = sourceFile(file);
      const visit = (node: ts.Node) => {
        if (
          ts.isNewExpression(node) &&
          ts.isIdentifier(node.expression) &&
          repositoryClasses.has(node.expression.text) &&
          label(file) !== 'src/main/campaignWorkspace.ts'
        ) {
          offenders.push(`${label(file)}:${node.expression.text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps preload bridge access at the app composition root', () => {
    const offenders = files
      .filter((file) => readFileSync(file, 'utf8').includes('window.blackBox'))
      .map(label)
      .filter((file) => file !== 'src/app/App.tsx');
    expect(offenders).toEqual([]);
  });

  it('keeps canvas interaction rules independent of Pixi and the DOM', () => {
    const interactionFiles = files.filter((file) => {
      const name = label(file);
      return (
        name.startsWith('src/features/play/canvas/scene') &&
        (name.endsWith('Interaction.ts') ||
          name.endsWith('InteractionEngine.ts') ||
          name.endsWith('sceneSelection.ts') ||
          name.endsWith('sceneTransformPreview.ts'))
      );
    });
    const offenders = interactionFiles.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return source.includes("from 'pixi.js'") ||
        /\b(?:document|window)\./u.test(source)
        ? [label(file)]
        : [];
    });
    expect(offenders).toEqual([]);
  });

  it('keeps production capability interfaces total', () => {
    const capabilityInterfaces = new Set([
      'ApplicationApi',
      'AssetApi',
      'CampaignApi',
      'CampaignNetworkSession',
      'NetworkApi',
      'SceneApi',
      'SceneRendererHandle',
    ]);
    const optionalMembers: string[] = [];
    for (const file of files) {
      const parsed = sourceFile(file);
      parsed.forEachChild((node) => {
        if (
          !ts.isInterfaceDeclaration(node) ||
          !capabilityInterfaces.has(node.name.text)
        ) {
          return;
        }
        for (const member of node.members) {
          if (member.questionToken) {
            optionalMembers.push(
              `${label(file)}:${node.name.text}.${member.name?.getText(parsed)}`,
            );
          }
        }
      });
    }
    expect(optionalMembers).toEqual([]);
  });
});
