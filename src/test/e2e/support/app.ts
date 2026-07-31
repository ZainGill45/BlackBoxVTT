import { createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import { randomInt } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

// Playwright transpiles specs to CommonJS, so `__dirname` is the portable
// choice here — `import.meta` is not available.
const root = path.resolve(__dirname, '../../../..');
// Outside an Electron runtime the `electron` package resolves to the path of
// its binary, which is not what its types describe.
const electronBinary = createRequire(__filename)('electron') as string;

export interface LaunchedApp {
  app: ElectronApplication;
  window: Page;
  /** The isolated profile this instance was given. */
  userDataPath: string;
}

/** Gracefully closes Electron, with a process fallback for broken shutdowns. */
async function closeApplication(app: ElectronApplication): Promise<void> {
  let child: ReturnType<ElectronApplication['process']>;
  try {
    child = app.process();
  } catch {
    // Tests that explicitly exercise quit/restart leave a closed handle in the
    // fixture; there is no process left for teardown to close a second time.
    return;
  }
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      app.close(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Electron did not close within 5 seconds.')),
          5_000,
        );
      }),
    ]);
  } catch {
    if (!child.killed) {
      child.kill();
    }
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

/**
 * One Electron instance with a profile of its own.
 *
 * Every participant in a multi-user test is a separate process, exactly as it
 * would be on separate machines. Isolating `--user-data-dir` is what makes that
 * safe: it separates the campaign store, the saved connection history, and the
 * `requestSingleInstanceLock` that would otherwise make the second launch hand
 * off to the first and exit.
 */
export async function launchApp(existingUserDataPath?: string): Promise<LaunchedApp> {
  const userDataPath =
    existingUserDataPath ?? (await mkdtemp(path.join(tmpdir(), 'blackbox-e2e-')));
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      executablePath: electronBinary,
      args: [
        path.join(root, '.vite/build/main.js'),
        `--user-data-dir=${userDataPath}`,
      ],
      cwd: root,
    });
    const window = await app.firstWindow();
    // The window is created hidden and only revealed once the renderer reports
    // it has real data, so waiting on the tab is what tells us the app is usable
    // rather than merely launched.
    await window.getByRole('tab', { name: 'Create Campaign' }).waitFor();
    return { app, userDataPath, window };
  } catch (error) {
    // A failure before AppFixture can register the instance must not leave an
    // Electron process or its temporary profile behind.
    if (app) {
      await closeApplication(app);
    }
    if (!existingUserDataPath) {
      await rm(userDataPath, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
    throw error;
  }
}

/**
 * Tracks launched instances so a spec can tear all of them down, including the
 * ones a failing assertion skipped past.
 */
export class AppFixture {
  private readonly launched: LaunchedApp[] = [];

  async launch(): Promise<LaunchedApp> {
    const instance = await launchApp();
    this.launched.push(instance);
    return instance;
  }

  /** Launches against a profile an earlier instance already wrote to. */
  async launchInto(userDataPath: string): Promise<LaunchedApp> {
    const instance = await launchApp(userDataPath);
    this.launched.push(instance);
    return instance;
  }

  async disposeAll(): Promise<void> {
    // A profile can back more than one entry once an instance has been
    // relaunched, so removal is deduplicated and left until every app is shut.
    const instances = this.launched.splice(0);
    for (const instance of instances) {
      await closeApplication(instance.app);
    }
    for (const userDataPath of new Set(instances.map((i) => i.userDataPath))) {
      await rm(userDataPath, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
  }
}

/** A port the OS has just confirmed is free. */
export async function availablePort(): Promise<number> {
  // The campaign host binds both TCP and UDP to the configured number. A TCP-
  // only probe can hand the test a port already occupied by an unrelated UDP
  // socket, making the UI's port switch fail while the old Online badge remains.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tcp = createServer();
    const port = randomInt(10_000, 65_000);
    try {
      await new Promise<void>((resolve, reject) => {
        tcp.once('error', reject);
        tcp.listen(port, '127.0.0.1', resolve);
      });
    } catch {
      continue;
    }
    const udp = createSocket('udp4');
    try {
      await new Promise<void>((resolve, reject) => {
        udp.once('error', reject);
        udp.bind(port, '127.0.0.1', resolve);
      });
      await new Promise<void>((resolve) => udp.close(() => resolve()));
      await new Promise<void>((resolve) => tcp.close(() => resolve()));
      return port;
    } catch {
      await new Promise<void>((resolve) => {
        try {
          udp.close(() => resolve());
        } catch {
          resolve();
        }
      });
      await new Promise<void>((resolve) => tcp.close(() => resolve()));
    }
  }
  throw new Error('Could not find a port free for both TCP and UDP.');
}
