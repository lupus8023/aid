import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ProviderResponseMetadata } from '@/lib/pipeline/providerPayload';

export interface SeriesGenerationState {
  version: 1;
  responses?: Array<{ at: string; kind: 'generation' | 'repair' | 'continuation'; metadata: ProviderResponseMetadata }>;
  refusal?: string;
  objectGrounding?: { evidenceOnly: true };
  recovery?: { status: 'pending' | 'failed' | 'completed'; originalDraft: string; response?: string; error?: string };
}

/** Keep legacy .txt drafts readable. A sidecar stores diagnostics, while an
 * exclusive durable marker limits continuation to one submission per input. */
export function createSeriesGenerationCache(root: string, key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid series draft key');
  const directory = path.join(root, 'series-drafts');
  const base = path.join(directory, key);
  const read = async (filename: string) => {
    try { return await readFile(filename, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  };
  const atomicSave = async (filename: string, value: string) => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${filename}.${randomUUID()}.tmp`;
    await writeFile(temporary, value, { mode: 0o600 });
    await rename(temporary, filename);
  };
  return {
    read: () => read(`${base}.txt`),
    save: (raw: string) => atomicSave(`${base}.txt`, raw),
    readState: async (): Promise<SeriesGenerationState | undefined> => {
      const raw = await read(`${base}.meta.json`);
      if (!raw) return undefined;
      const state = JSON.parse(raw);
      if (state?.version !== 1) throw new Error('无法读取剧本恢复记录；为避免重复生成，已停止提交');
      return state;
    },
    saveState: (state: SeriesGenerationState) => atomicSave(`${base}.meta.json`, JSON.stringify(state)),
    claimRecovery: async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      try {
        // Claim BEFORE the request. A crash/timeout with an unknown outcome
        // must not buy another continuation after the application restarts.
        await writeFile(`${base}.continuation.json`, JSON.stringify({ startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
        return true;
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
    },
  };
}
