import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const electron = require('electron');
const sessionKey = createHash('sha256').update(root).digest('hex').slice(0, 16);
const sessionFile = path.join(tmpdir(), `blackboxvtt-development-${sessionKey}.json`);

function option(name) {
  const inline = process.argv.slice(2).find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const persistent = option('--profile');
const temporary = option('--temporary');
if (Boolean(persistent) === Boolean(temporary)) {
  throw new Error('Choose exactly one of --profile <name> or --temporary <name>.');
}
const label = persistent ?? temporary;
if (!/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(label)) {
  throw new Error('Profile names must use 1-32 letters, numbers, underscores, or hyphens.');
}

let session;
try {
  session = JSON.parse(await readFile(sessionFile, 'utf8'));
  process.kill(session.ownerPid, 0);
} catch {
  throw new Error('No active BlackBox development session was found. Run npm start first.');
}

const child = spawn(
  electron,
  [
    root,
    `${persistent ? '--dev-profile' : '--temporary-profile'}=${label}`,
    `--dev-owner-pid=${session.ownerPid}`,
    ...(process.argv.includes('--windowed') ? ['--windowed'] : []),
  ],
  { cwd: root, detached: true, stdio: 'ignore' },
);
child.unref();

