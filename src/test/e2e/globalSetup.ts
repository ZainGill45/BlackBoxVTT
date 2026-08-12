import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Playwright transpiles config and setup files to CommonJS, so `__dirname` is
// the portable choice here — `import.meta` is not available.
const root = path.resolve(__dirname, '../../..');

/**
 * Rebuilds before every run. Testing a stale bundle is the classic way for an
 * E2E suite to go green on code that no longer exists, and the build is a few
 * seconds. Set E2E_SKIP_BUILD=1 when iterating on the specs themselves.
 */
export default function globalSetup(): void {
  if (process.env.E2E_SKIP_BUILD === '1') {
    const requiredArtifacts = [
      '.vite/build/main.js',
      '.vite/build/preload.js',
      '.vite/build/detachedCharacterPreload.js',
      '.vite/renderer/main_window/detached-character.html',
      '.vite/renderer/main_window/index.html',
    ];
    const missing = requiredArtifacts.filter(
      (artifact) => !existsSync(path.join(root, artifact)),
    );
    if (missing.length > 0) {
      throw new Error(
        `E2E_SKIP_BUILD=1 was set but the E2E build is incomplete (missing ${missing.join(
          ', ',
        )}). Run \`npm run build:e2e\` first.`,
      );
    }
    return;
  }
  execFileSync(process.execPath, [path.join(root, 'src/test/e2e/build.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
}
