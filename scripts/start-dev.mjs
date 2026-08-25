import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const electron = require('electron');
const forgePackagePath = require.resolve('@electron-forge/cli/package.json');
const forgePackage = require(forgePackagePath);
const forgeCli = path.join(path.dirname(forgePackagePath), forgePackage.bin['electron-forge']);
const sessionKey = createHash('sha256').update(root).digest('hex').slice(0, 16);
const sessionFile = path.join(tmpdir(), `blackboxvtt-development-${sessionKey}.json`);
const temporaryProfilePrefix = 'blackboxvtt-development-';
const temporaryProfileMarker = '.blackboxvtt-temporary-profile.json';

function option(name) {
  const inline = process.argv.slice(2).find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function profileNames() {
  const values = (option('--profiles') ?? 'default')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0 || values.some((value) => !/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(value))) {
    throw new Error('Profiles must use 1-32 letters, numbers, underscores, or hyphens.');
  }
  return [...new Set(values)];
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function refuseActiveSession() {
  try {
    const existing = JSON.parse(await readFile(sessionFile, 'utf8'));
    if (processIsAlive(existing.ownerPid)) {
      throw new Error('A BlackBox development session is already running. Use npm run start:instance to add another profile.');
    }
  } catch (error) {
    if (error instanceof SyntaxError || error?.code === 'ENOENT') return;
    throw error;
  }
  await rm(sessionFile, { force: true });
}

async function pruneStaleTemporaryProfiles() {
  const temporaryRoot = path.resolve(tmpdir());
  const entries = await readdir(temporaryRoot, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(temporaryProfilePrefix))
    .map(async (entry) => {
      const directory = path.resolve(temporaryRoot, entry.name);
      if (path.dirname(directory) !== temporaryRoot) return;
      try {
        const marker = JSON.parse(await readFile(path.join(directory, temporaryProfileMarker), 'utf8'));
        if (
          marker.kind === 'blackboxvtt-temporary-profile' &&
          !processIsAlive(marker.processId)
        ) {
          await rm(directory, { force: true, recursive: true });
        }
      } catch {
        // Unknown temporary directories are never removed.
      }
    }));
}

async function waitForSession(ownerPid) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const session = JSON.parse(await readFile(sessionFile, 'utf8'));
      if (session.ownerPid === ownerPid && session.ready === true) return;
    } catch {
      // The Forge build or first Electron process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The first development instance did not become ready within 60 seconds.');
}

await refuseActiveSession();
await pruneStaleTemporaryProfiles();
const profiles = profileNames();
const windowed = process.argv.includes('--windowed');
const ownerPid = process.pid;
const appArguments = [
  `--dev-profile=${profiles[0]}`,
  `--dev-owner-pid=${ownerPid}`,
  `--dev-session-file=${sessionFile}`,
  ...(windowed ? ['--windowed'] : []),
];
const forge = spawn(
  process.execPath,
  [forgeCli, 'start', '.', '--', ...appArguments],
  { cwd: root, stdio: 'inherit' },
);
const instances = [];
let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of instances) {
    if (!child.killed) child.kill();
  }
  if (!forge.killed) forge.kill();
  void rm(sessionFile, { force: true });
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
process.once('exit', stop);

try {
  await waitForSession(ownerPid);
  for (const profile of profiles.slice(1)) {
    instances.push(spawn(
      electron,
      [
        root,
        `--dev-profile=${profile}`,
        `--dev-owner-pid=${ownerPid}`,
        ...(windowed ? ['--windowed'] : []),
      ],
      { cwd: root, stdio: 'inherit' },
    ));
  }
} catch (error) {
  stop();
  throw error;
}

const exitCode = await new Promise((resolve, reject) => {
  forge.once('error', reject);
  forge.once('exit', (code) => resolve(code ?? 1));
});
stop();
process.exitCode = exitCode;
