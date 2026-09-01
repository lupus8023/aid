import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { isProviderContentRejection } from '../pipeline/providerPayload';
import { isRequestDefinitelyNotSent } from '../providerConnection';

interface Receipt {
  fingerprint: string;
  state: 'pending' | 'submitted' | 'uncertain' | 'review' | 'not_sent';
  createdAt: string;
  taskId?: string;
  notSentReason?: 'connection_failed_before_request';
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** Save the provider receipt before replying to the browser. Never replace an
 * ambiguous reservation: a lost provider response is not permission to buy again.
 * Only hashes, state and task IDs are stored; no prompts or API credentials. */
export async function submitImageOnce(options: {
  directory: string;
  key: string;
  input: unknown;
  submit: () => Promise<string>;
  waitMs?: number;
}): Promise<string> {
  if (!/^[a-zA-Z0-9_-]{16,120}$/.test(options.key)) throw new Error('无效的图像提交编号');
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const file = path.join(options.directory, `${createHash('sha256').update(options.key).digest('hex')}.json`);
  const receipt: Receipt = { fingerprint: createHash('sha256').update(canonical(options.input)).digest('hex'), state: 'pending', createdAt: new Date().toISOString() };
  let owner = false;
  try {
    await writeFile(file, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
    owner = true;
  } catch (error: any) {
    if (error.code !== 'EEXIST') throw error;
  }
  const persist = async () => {
    const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(receipt), { mode: 0o600 });
    await rename(temp, file);
  };
  const submitOwned = async () => {
    try {
      receipt.taskId = await options.submit();
      if (!receipt.taskId) throw new Error('供应商未返回图像任务编号');
      receipt.state = 'submitted';
      await persist();
      return receipt.taskId;
    } catch (error) {
      receipt.state = isProviderContentRejection(error) ? 'review' : isRequestDefinitelyNotSent(error) ? 'not_sent' : 'uncertain';
      receipt.notSentReason = receipt.state === 'not_sent' ? 'connection_failed_before_request' : undefined;
      // If saving a successful response failed, retain its ID in this receipt.
      await persist().catch(() => undefined);
      throw error;
    }
  };
  if (owner) return submitOwned();
  const deadline = Date.now() + (options.waitMs ?? 120000);
  for (;;) {
    // A concurrent reader may observe the first write before its bytes arrive.
    let existing: Receipt | undefined;
    try { existing = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (Date.now() >= deadline) throw new Error('图像提交回执暂不可读；原提交保留，不重复计费'); }
    if (existing) {
      if (existing.fingerprint !== receipt.fingerprint) throw new Error('图像提交编号与内容不一致，已阻止重复提交');
      if (existing.taskId) return existing.taskId;
      if (existing.state === 'not_sent' && existing.notSentReason === 'connection_failed_before_request') {
        // Reconcile only a proven unsent request. Serialize recovery contenders,
        // then reserve pending before calling the provider. A crash after that
        // remains ambiguous and cannot expire into another purchase.
        const lock = `${file}.retry-lock`;
        let acquired = false;
        try {
          try { await writeFile(lock, '', { flag: 'wx', mode: 0o600 }); acquired = true; }
          catch (error: any) { if (error.code !== 'EEXIST') throw error; }
          if (acquired) {
            const latest: Receipt = JSON.parse(await readFile(file, 'utf8'));
            if (latest.fingerprint !== receipt.fingerprint) throw new Error('图像提交编号与内容不一致');
            if (latest.taskId) return latest.taskId;
            if (latest.state === 'not_sent' && latest.notSentReason === 'connection_failed_before_request') {
              await persist();
              return await submitOwned();
            }
          }
        } finally { if (acquired) await unlink(lock).catch(() => undefined); }
      }
      if (existing.state === 'review') throw new Error('原图像提交未通过上游内容审核；不自动重新提交');
      if (existing.state === 'uncertain' || Date.now() >= deadline) throw new Error('原图像提交结果尚未确认；已保留回执，需核对供应商任务，不重复计费');
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))));
  }
}
