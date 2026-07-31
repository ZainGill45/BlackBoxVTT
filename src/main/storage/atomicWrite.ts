import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import type { WriteFileOptions } from 'node:fs';

interface AtomicWriteOptions {
  /**
   * Created with `recursive: true` before writing. Omit when the directory is
   * already known to exist.
   */
  ensureDirectory?: string;
  /**
   * Where the bytes land before the rename. Defaults to a sibling of the
   * target; stores holding secrets pass a hidden name instead.
   */
  temporaryPath?: string;
  /**
   * Defaults to plain utf8. Stores holding credentials pass `flag: 'wx'` and a
   * restrictive `mode` so the file is created exclusively and stays
   * owner-only.
   */
  writeOptions?: WriteFileOptions;
}

/**
 * Writes a file so a reader never observes partial contents. The bytes go to a
 * temporary path first and are moved into place with a single rename, which is
 * atomic within a filesystem. A crash mid-write leaves the previous contents
 * intact and at most one orphaned temporary file.
 */
export async function writeFileAtomic(
  targetPath: string,
  contents: string,
  {
    ensureDirectory,
    temporaryPath = `${targetPath}.${randomUUID()}.tmp`,
    writeOptions = 'utf8',
  }: AtomicWriteOptions = {},
): Promise<void> {
  if (ensureDirectory) {
    await mkdir(ensureDirectory, { recursive: true });
  }

  try {
    await writeFile(temporaryPath, contents, writeOptions);
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

/** {@link writeFileAtomic} for JSON documents, formatted as stored on disk. */
export function writeJsonAtomic(
  targetPath: string,
  value: unknown,
  options: AtomicWriteOptions = {},
): Promise<void> {
  return writeFileAtomic(
    targetPath,
    `${JSON.stringify(value, null, 2)}\n`,
    options,
  );
}
