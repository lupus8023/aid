import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const buildDir = path.join(root, '.next-companion');
const standaloneDir = path.join(buildDir, 'standalone');

await mkdir(path.join(standaloneDir, '.next-companion'), { recursive: true });
await cp(path.join(buildDir, 'static'), path.join(standaloneDir, '.next-companion', 'static'), {
  recursive: true,
  force: true,
});
await cp(path.join(root, 'public'), path.join(standaloneDir, 'public'), {
  recursive: true,
  force: true,
});
await mkdir(path.join(standaloneDir, 'scripts'), { recursive: true });
await cp(
  path.join(root, 'scripts', 'aid_scail2_long_runner.py'),
  path.join(standaloneDir, 'scripts', 'aid_scail2_long_runner.py'),
  { force: true },
);

console.log(`Companion standalone server prepared at ${standaloneDir}`);
