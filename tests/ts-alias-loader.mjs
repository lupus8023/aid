import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';

const root = resolvePath(fileURLToPath(new URL('..', import.meta.url)));

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/server') return nextResolve('next/server.js', context);
  const candidates = [];
  if (specifier.startsWith('@/')) candidates.push(resolvePath(root, specifier.slice(2)));
  else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    candidates.push(fileURLToPath(new URL(specifier, context.parentURL)));
  }
  for (const candidate of candidates) {
    for (const suffix of ['', '.ts', '.tsx', '/index.ts']) {
      const file = `${candidate}${suffix}`;
      if (existsSync(file) && statSync(file).isFile()) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
