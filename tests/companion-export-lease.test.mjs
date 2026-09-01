import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { acquireExportLease } from '../lib/companionExportLease.ts';

test('concurrent route instances acquire one lease and recover a dead owner', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aid-export-lease-'));
  try {
    const owners = await Promise.all(Array.from({ length: 12 }, () => acquireExportLease(root)));
    assert.equal(owners.filter(Boolean).length, 1);
    assert.equal(await acquireExportLease(root), null, 'do not steal a live owner');
    await owners.find(Boolean)();
    const { stdout } = await promisify(execFile)(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
    await mkdir(path.join(root, '.export-lock'));
    await writeFile(path.join(root, '.export-lock', `owner-${stdout}-abcdef`), '');
    const recovered = await Promise.all(Array.from({ length: 12 }, () => acquireExportLease(root)));
    assert.equal(recovered.filter(Boolean).length, 1, 'simultaneous stale recovery cannot erase a new owner');
    assert.equal((await readdir(path.join(root, '.export-lock'))).length, 1);
    await recovered.find(Boolean)();
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
