import path from 'node:path';
import { rmSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { configureInstanceProfile } from '../../../main/instanceProfile';

function app(packaged: boolean) {
  const paths: Record<string, string> = {
    appData: 'C:\\AppData',
    userData: 'C:\\Existing',
  };
  return {
    getName: () => 'blackboxvtt',
    getPath: (name: string) => paths[name],
    isPackaged: packaged,
    setPath: vi.fn((name: string, value: string) => {
      paths[name] = value;
    }),
  };
}

describe('configureInstanceProfile', () => {
  it('uses a dedicated persistent development root by default', () => {
    const electron = app(false);

    const profile = configureInstanceProfile(electron, []);

    expect(profile).toMatchObject({
      environment: 'development',
      label: 'default',
      profileKind: 'persistent',
    });
    expect(profile.userDataPath).toBe(
      path.join('C:\\AppData', 'blackboxvtt-development', 'profiles', 'default'),
    );
  });

  it('isolates a named profile and honors development windowed mode', () => {
    const electron = app(false);

    const profile = configureInstanceProfile(electron, [
      '--dev-profile=alice',
      '--windowed',
    ]);

    expect(profile.label).toBe('alice');
    expect(profile.windowed).toBe(true);
    expect(profile.userDataPath).toContain(path.join('profiles', 'alice'));
  });

  it('creates an explicitly marked disposable temporary profile', () => {
    const electron = app(false);

    const profile = configureInstanceProfile(electron, [
      '--temporary-profile=guest',
    ]);

    expect(profile.profileKind).toBe('temporary');
    expect(profile.cleanupPath).toBe(profile.userDataPath);
    expect(profile.userDataPath).toContain('blackboxvtt-development-');
    rmSync(profile.userDataPath, { force: true, recursive: true });
  });

  it('preserves explicit test harness user data', () => {
    const electron = app(false);

    const profile = configureInstanceProfile(electron, [
      '--user-data-dir=C:\\TestProfile',
    ]);

    expect(profile.profileKind).toBe('test');
    expect(profile.userDataPath).toBe('C:\\Existing');
    expect(electron.setPath).not.toHaveBeenCalled();
  });

  it('forces packaged builds onto the canonical profile and rejects dev flags', () => {
    const electron = app(true);

    const profile = configureInstanceProfile(electron, ['--dev-profile=alice']);

    expect(profile.userDataPath).toBe(path.join('C:\\AppData', 'blackboxvtt'));
    expect(profile.error).toContain('unavailable');
    expect(profile.profileKind).toBe('production');
  });

  it('rejects profile path traversal', () => {
    const electron = app(false);

    const profile = configureInstanceProfile(electron, [
      '--dev-profile=..\\production',
    ]);

    expect(profile.error).toContain('must use');
  });
});
