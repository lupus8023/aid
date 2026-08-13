import packager from '@electron/packager';
import { execFile } from 'node:child_process';
import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const root = process.cwd();
const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const appVersion = String(rootPackage.version || '0.1.0');
const platformArg = process.argv.find(value => value.startsWith('--platform='));
const archArg = process.argv.find(value => value.startsWith('--arch='));
const platform = platformArg?.split('=')[1] || process.platform;
const arch = archArg?.split('=')[1] || process.arch;
const appDir = path.join(root, '.companion-app');
const mediaDir = path.join(root, '.companion-media');
const serverDir = path.join(root, '.next-companion', 'standalone');

await access(path.join(serverDir, 'server.js'));
await rm(appDir, { recursive: true, force: true });
await rm(mediaDir, { recursive: true, force: true });
await mkdir(appDir, { recursive: true });
await mkdir(mediaDir, { recursive: true });
await cp(path.join(root, 'companion'), appDir, { recursive: true });
await cp(path.join(root, 'public', 'icon.png'), path.join(appDir, 'icon.png'));
const ffmpegPath = path.join(root, 'node_modules', 'ffmpeg-static', platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ffprobePath = path.join(root, 'node_modules', 'ffprobe-static', 'bin', platform, arch, platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
await cp(ffmpegPath, path.join(mediaDir, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
await cp(ffprobePath, path.join(mediaDir, platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'));
await writeFile(path.join(appDir, 'package.json'), JSON.stringify({
  name: 'aid-companion',
  version: appVersion,
  main: 'main.cjs',
}, null, 2));

const output = await packager({
  dir: appDir,
  out: path.join(root, 'out', 'companion'),
  overwrite: true,
  platform,
  arch,
  name: 'AID Companion',
  appBundleId: 'beauty.pandais.companion',
  appVersion,
  buildVersion: '1',
  // Packager appends the native extension (.icns/.ico) itself.
  icon: path.join(root, 'companion', 'app-icon'),
  asar: true,
  extraResource: [serverDir, mediaDir],
  prune: false,
});

// Electron's downloaded binaries carry linker signatures. After Packager adds
// resources those signatures no longer seal the final bundle, and Gatekeeper
// reports the downloaded app as "damaged". Apply a complete bundle signature
// before archiving. CI can provide an Apple Developer ID through
// MACOS_CODESIGN_IDENTITY; local/community builds use a valid ad-hoc signature.
if (platform === 'darwin') {
  const identity = String(process.env.MACOS_CODESIGN_IDENTITY || '-').trim() || '-';
  for (const outputDirectory of output) {
    const appPath = path.join(outputDirectory, 'AID Companion.app');
    await execFileAsync('codesign', [
      '--force', '--deep', '--sign', identity,
      ...(identity === '-' ? ['--timestamp=none'] : ['--timestamp', '--options', 'runtime']),
      appPath,
    ], { maxBuffer: 8 * 1024 * 1024 });
    await execFileAsync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
      maxBuffer: 8 * 1024 * 1024,
    });
  }
}

console.log(output.join('\n'));
