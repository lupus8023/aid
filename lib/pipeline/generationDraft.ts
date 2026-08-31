import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Provider keys participate only in the hash; no credentials are written to a
// draft. Cache each bounded writing/directing batch, including invalid output.
export function generationDraft(kind: string, identity: unknown[]) {
  const root = process.env.AID_COMPANION_DATA_DIR;
  const key = createHash('sha256').update(JSON.stringify([kind, ...identity])).digest('hex');
  const file = root ? path.join(root, 'pipeline-drafts', `${key}.txt`) : undefined;
  return {
    async read(): Promise<string | undefined> {
      if (!file) return undefined;
      try { return await readFile(file, 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    },
    async save(raw: string): Promise<void> {
      if (!file) return;
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, raw, { mode: 0o600 });
      await rename(temporary, file);
    },
  };
}

export async function recoverGeneration<T>(input: {
  draft: ReturnType<typeof generationDraft>;
  parse: (raw: string) => T;
  generate: (previous: string | undefined, error: unknown, attempt: number) => Promise<string>;
  attempts: number;
}): Promise<T> {
  let raw = await input.draft.read();
  let lastError: unknown;
  if (raw) {
    try { return input.parse(raw); }
    catch (error) { lastError = error; }
  }
  for (let attempt = 1; attempt <= input.attempts; attempt++) {
    // Transport failures do not replace a retained draft with an error page.
    try {
      raw = await input.generate(raw, lastError, attempt);
    } catch (error) { lastError = error; continue; }
    await input.draft.save(raw);
    try { return input.parse(raw); }
    catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error('生成未通过校验');
}
