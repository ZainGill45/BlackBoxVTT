import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { App } from 'electron';
import type { DiagnosticInstance } from '../shared/diagnostics';

const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
export const TEMPORARY_PROFILE_MARKER = '.blackboxvtt-temporary-profile.json';

export interface InstanceProfile {
  cleanupPath: string | null;
  environment: DiagnosticInstance['environment'];
  error: string | null;
  label: string;
  profileKind: DiagnosticInstance['profileKind'];
  userDataPath: string;
  windowed: boolean;
}

function argumentValue(argv: readonly string[], name: string): string | null {
  const prefix = `${name}=`;
  const inline = argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? '' : null;
}

export function configureInstanceProfile(
  app: Pick<App, 'getName' | 'getPath' | 'isPackaged' | 'setPath'>,
  argv: readonly string[],
): InstanceProfile {
  const persistentName = argumentValue(argv, '--dev-profile');
  const temporaryName = argumentValue(argv, '--temporary-profile');
  const explicitUserData = argumentValue(argv, '--user-data-dir');
  const hasDevelopmentFlag = persistentName !== null || temporaryName !== null;
  const windowed = argv.includes('--windowed');

  if (app.isPackaged) {
    const canonical = path.join(app.getPath('appData'), app.getName());
    app.setPath('userData', canonical);
    return {
      cleanupPath: null,
      environment: 'production',
      error: hasDevelopmentFlag || windowed
        ? 'Development instance options are unavailable in packaged builds.'
        : null,
      label: 'production',
      profileKind: 'production',
      userDataPath: canonical,
      windowed: false,
    };
  }

  if (persistentName !== null && temporaryName !== null) {
    return invalidProfile(
      app,
      'Choose either --dev-profile or --temporary-profile, not both.',
      windowed,
    );
  }
  const requestedName = temporaryName ?? persistentName;
  if (requestedName !== null && !PROFILE_NAME.test(requestedName)) {
    return invalidProfile(
      app,
      'Development profile names must use 1-32 letters, numbers, underscores, or hyphens.',
      windowed,
    );
  }

  if (explicitUserData) {
    return {
      cleanupPath: null,
      environment: 'test',
      error: null,
      label: 'test',
      profileKind: 'test',
      userDataPath: app.getPath('userData'),
      windowed,
    };
  }

  const label = requestedName ?? 'default';
  if (temporaryName !== null) {
    const directory = mkdtempSync(
      path.join(tmpdir(), 'blackboxvtt-development-'),
    );
    writeFileSync(
      path.join(directory, TEMPORARY_PROFILE_MARKER),
      JSON.stringify({
        kind: 'blackboxvtt-temporary-profile',
        label,
        processId: process.pid,
        startedAt: new Date().toISOString(),
      }),
      { encoding: 'utf8', flag: 'wx' },
    );
    app.setPath('userData', directory);
    return {
      cleanupPath: directory,
      environment: 'development',
      error: null,
      label,
      profileKind: 'temporary',
      userDataPath: directory,
      windowed,
    };
  }

  const directory = path.join(
    app.getPath('appData'),
    `${app.getName()}-development`,
    'profiles',
    label,
  );
  app.setPath('userData', directory);
  return {
    cleanupPath: null,
    environment: 'development',
    error: null,
    label,
    profileKind: 'persistent',
    userDataPath: directory,
    windowed,
  };
}

function invalidProfile(
  app: Pick<App, 'getName' | 'getPath' | 'setPath'>,
  error: string,
  windowed: boolean,
): InstanceProfile {
  const directory = path.join(
    app.getPath('appData'),
    `${app.getName()}-development`,
    'profiles',
    'invalid',
  );
  app.setPath('userData', directory);
  return {
    cleanupPath: null,
    environment: 'development',
    error,
    label: 'invalid',
    profileKind: 'persistent',
    userDataPath: directory,
    windowed,
  };
}
