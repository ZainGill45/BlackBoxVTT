import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import type { WriteFileOptions } from 'node:fs';

const TRANSIENT_RENAME_ERRORS = new Set(['EACCES', 'EBUSY', 'EPERM']);
const RENAME_ATTEMPTS = 6;

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

async function replaceFile(sourcePath: string, targetPath: string): Promise<void> {
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt += 1) {
    try {
      await rename(sourcePath, targetPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        attempt === RENAME_ATTEMPTS ||
        !code ||
        !TRANSIENT_RENAME_ERRORS.has(code)
      ) {
        throw error;
      }
      // Antivirus, indexing, and a concurrent reader can briefly hold the
      // destination on Windows. Keep the old file intact and retry the atomic
      // replacement instead of turning that short-lived lock into data loss.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10 * 2 ** (attempt - 1));
      });
    }
  }
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
    await replaceFile(temporaryPath, targetPath);
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
