import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Route bundles do not share module-local Maps. Hold one disk lease per export. */
export async function acquireExportLease(directory: string): Promise<(() => Promise<void>) | null> {
  await mkdir(directory, { recursive: true });
  const owner = `owner-${process.pid}-${randomUUID()}`;
  const target = path.join(directory, '.export-lock');
  const candidate = path.join(directory, `.${owner}`);
  await mkdir(candidate);
  await writeFile(path.join(candidate, owner), '');
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // A populated directory cannot replace another populated directory.
        // Prepare the owner before publishing, so there is no empty-lock window.
        await rename(candidate, target);
        return async () => {
          await rm(path.join(target, owner), { force: true });
          await rmdir(target).catch((error: NodeJS.ErrnoException) => {
            if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code || '')) throw error;
          });
        };
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
      }
      const owners = await readdir(target).catch(() => []);
      for (const entry of owners) {
        const pid = Number(entry.match(/^owner-(\d+)-[a-f0-9-]+$/)?.[1]);
        if (!pid) continue;
        try { process.kill(pid, 0); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
            // Remove only this dead owner's immutable filename. Another caller
            // may already have acquired a new lease; never recursively remove it.
            await rm(path.join(target, entry), { force: true });
          }
        }
      }
      await rmdir(target).catch(() => undefined);
    }
    return null;
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
}
