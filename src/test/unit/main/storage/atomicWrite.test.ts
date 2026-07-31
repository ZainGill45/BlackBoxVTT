import { beforeEach, describe, expect, it, vi } from 'vitest';

const filesystem = vi.hoisted(() => ({
  mkdir: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  ...filesystem,
  default: filesystem,
}));

import { writeFileAtomic } from '../../../../main/storage/atomicWrite';

describe('writeFileAtomic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    filesystem.mkdir.mockResolvedValue(undefined);
    filesystem.rename.mockResolvedValue(undefined);
    filesystem.rm.mockResolvedValue(undefined);
    filesystem.writeFile.mockResolvedValue(undefined);
  });

  it('retries a transient destination lock without rewriting the temporary file', async () => {
    filesystem.rename
      .mockRejectedValueOnce(
        Object.assign(new Error('destination is temporarily locked'), {
          code: 'EPERM',
        }),
      )
      .mockResolvedValueOnce(undefined);

    await writeFileAtomic('scenes.json', '{"revision":1}', {
      temporaryPath: 'scenes.json.tmp',
    });

    expect(filesystem.writeFile).toHaveBeenCalledOnce();
    expect(filesystem.rename).toHaveBeenCalledTimes(2);
    expect(filesystem.rm).toHaveBeenCalledWith('scenes.json.tmp', {
      force: true,
    });
  });

  it('does not retry a permanent rename failure', async () => {
    const failure = Object.assign(new Error('target directory is missing'), {
      code: 'ENOENT',
    });
    filesystem.rename.mockRejectedValue(failure);

    await expect(
      writeFileAtomic('scenes.json', '{}', {
        temporaryPath: 'scenes.json.tmp',
      }),
    ).rejects.toBe(failure);

    expect(filesystem.rename).toHaveBeenCalledOnce();
    expect(filesystem.rm).toHaveBeenCalledWith('scenes.json.tmp', {
      force: true,
    });
  });
});
