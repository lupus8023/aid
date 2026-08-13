const { app, BrowserWindow, Tray, Menu, clipboard, ipcMain, shell, nativeImage } = require('electron');
const { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync, createWriteStream } = require('node:fs');
const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const PORT = 3018;
const WEBSITE = 'https://pandais.beauty';
let window;
let tray;
let serverProcess;
let serverRoot;
let publicKey = '';
let privateKeyPath = '';
let resolvedSshHost = '';
let isQuitting = false;
let serverRestartTimer;
let serverLaunchConfig;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function hasLiveWindow() {
  return Boolean(window && !window.isDestroyed() && !window.webContents.isDestroyed());
}

function showWindow() {
  if (!hasLiveWindow()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function sendToWindow(channel, payload) {
  if (!hasLiveWindow() || isQuitting) return;
  window.webContents.send(channel, payload);
}

function ensureKeyPair() {
  const keyDir = path.join(app.getPath('userData'), 'ssh');
  const privatePath = path.join(keyDir, 'id_ed25519');
  const publicPath = `${privatePath}.pub`;
  const { utils } = require(path.join(serverRoot || resolveServerRoot(), 'node_modules', 'ssh2'));
  mkdirSync(keyDir, { recursive: true });
  const existingKey = existsSync(privatePath) ? utils.parseKey(readFileSync(privatePath)) : new Error('missing key');
  if (!existsSync(publicPath) || existingKey instanceof Error) {
    const comment = `aid-companion@${os.hostname().replace(/\s+/g, '-')}`;
    const pair = utils.generateKeyPairSync('ed25519', { comment });
    publicKey = pair.public.trim();
    writeFileSync(privatePath, pair.private, { mode: 0o600 });
    writeFileSync(publicPath, `${publicKey}\n`, { mode: 0o644 });
  } else {
    publicKey = readFileSync(publicPath, 'utf8').trim();
  }
  try { chmodSync(privatePath, 0o600); } catch {}
  return { privatePath, privatePem: readFileSync(privatePath, 'utf8') };
}

function resolveServerRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'standalone')
    : path.join(__dirname, '..', '.next-companion', 'standalone');
}

function startServer(privatePath, privatePem, directSshHost = '') {
  serverLaunchConfig = { privatePath, privatePem, directSshHost };
  if (serverRestartTimer) {
    clearTimeout(serverRestartTimer);
    serverRestartTimer = undefined;
  }
  serverRoot = resolveServerRoot();
  const serverFile = path.join(serverRoot, 'server.js');
  const logPath = path.join(app.getPath('userData'), 'companion.log');
  const log = createWriteStream(logPath, { flags: 'a' });
  serverProcess = spawn(process.execPath, [serverFile], {
    cwd: serverRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      AID_LOCAL_COMPANION: '1',
      AID_COMPANION_SYSTEM_SSH: process.platform === 'win32' ? '0' : '1',
      AID_COMPANION_VERSION: app.getVersion(),
      // macOS/Linux ship OpenSSH and it is considerably more resilient on the
      // high-latency X-GPU gateway. Windows keeps the bundled ssh2 path so the
      // Companion does not depend on an optional Windows feature.
      COMFYUI_SSH_KEY_PATH: process.platform === 'win32' ? '' : privatePath,
      COMFYUI_SSH_PRIVATE_KEY_B64: process.platform === 'win32'
        ? Buffer.from(privatePem).toString('base64')
        : '',
      COMFYUI_SSH_ORIGINAL_HOST: 'me21gb3rds8p0h44.ssh.x-gpu.com',
      COMFYUI_SSH_DIRECT_HOST: directSshHost,
      FFMPEG_PATH: path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'), '.companion-media', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
      FFPROBE_PATH: path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'), '.companion-media', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
      HOSTNAME: '127.0.0.1',
      PORT: String(PORT),
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  serverProcess.stdout.pipe(log);
  serverProcess.stderr.pipe(log);
  serverProcess.once('exit', (code, signal) => {
    serverProcess = undefined;
    log.end();
    sendToWindow('companion:server-exit', { code, signal });
    if (isQuitting || !serverLaunchConfig) return;
    // The local API is the actual Companion service. Keep it alive even when
    // Next.js exits unexpectedly so a packaged install never depends on the
    // source repository or `npm run companion`.
    serverRestartTimer = setTimeout(() => {
      serverRestartTimer = undefined;
      if (!isQuitting && serverLaunchConfig) startServer(
        serverLaunchConfig.privatePath,
        serverLaunchConfig.privatePem,
        serverLaunchConfig.directSshHost,
      );
    }, 1500);
  });
}

function createWindow() {
  window = new BrowserWindow({
    width: 760,
    height: 760,
    minWidth: 660,
    minHeight: 640,
    title: 'AID Companion',
    icon: path.join(__dirname, 'app-icon.png'),
    backgroundColor: '#101214',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.removeMenu();
  window.loadFile(path.join(__dirname, 'window.html'));
  window.once('ready-to-show', showWindow);
  window.on('close', event => {
    if (!isQuitting) {
      event.preventDefault();
      if (hasLiveWindow()) window.hide();
    }
  });
  window.once('closed', () => { window = undefined; });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'app-icon.png')).resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip('AID Companion');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 AID Companion', click: showWindow },
    { label: '打开 pandais.beauty', click: () => shell.openExternal(WEBSITE) },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', showWindow);
}

function authorizeOnce({ host, port, user, password }) {
  return new Promise((resolve, reject) => {
    const { Client } = require(path.join(serverRoot, 'node_modules', 'ssh2'));
    const client = new Client();
    const encoded = Buffer.from(`${publicKey}\n`).toString('base64');
    const command = `umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; key=$(printf '%s' '${encoded}' | base64 -d); grep -qxF "$key" ~/.ssh/authorized_keys || printf '%s\\n' "$key" >> ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys`;
    const timer = setTimeout(() => {
      client.end();
      reject(new Error('连接超时，请检查 SSH 地址和端口'));
    }, 120000);
    client.on('ready', () => {
      client.exec(command, (error, stream) => {
        if (error) return reject(error);
        let stderr = '';
        stream.stderr.on('data', data => { stderr += String(data); });
        stream.on('close', code => {
          clearTimeout(timer);
          client.end();
          code === 0 ? resolve({ ok: true }) : reject(new Error(stderr || `授权命令退出：${code}`));
        });
      });
    });
    client.on('error', error => {
      clearTimeout(timer);
      reject(new Error(/authentication/i.test(error.message) ? 'SSH 密码不正确' : error.message));
    });
    client.connect({
      host: String(host || '').trim(),
      port: Number(port) || 22,
      username: String(user || 'root').trim(),
      password: String(password || ''),
      readyTimeout: 60000,
    });
  });
}

function isPrivateOrFakeIp(value) {
  return /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(String(value || ''));
}

async function resolveDirectHost(host) {
  const hostname = String(host || '').trim();
  if (!hostname || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return hostname;
  try {
    const response = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`, {
      signal: AbortSignal.timeout(10000),
      headers: { accept: 'application/dns-json' },
    });
    const data = await response.json();
    const address = data?.Answer?.find(item => item.type === 1 && !isPrivateOrFakeIp(item.data))?.data;
    return address || hostname;
  } catch {
    return hostname;
  }
}

async function stopStaleCompanionServer() {
  if (process.platform === 'win32') return;
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/companion/status`, {
      signal: AbortSignal.timeout(1500),
    });
    const status = await response.json();
    if (status?.name !== 'AID Companion' || status?.version === app.getVersion()) return;
    await new Promise(resolve => {
      execFile('lsof', ['-tiTCP:3018', '-sTCP:LISTEN'], { encoding: 'utf8' }, (_error, stdout) => {
        const pid = Number(String(stdout || '').trim().split(/\s+/)[0]);
        if (Number.isInteger(pid) && pid > 1 && pid !== process.pid) {
          try { process.kill(pid, 'SIGTERM'); } catch {}
        }
        resolve();
      });
    });
    await new Promise(resolve => setTimeout(resolve, 1200));
  } catch {}
}

async function authorizeWithPassword(input) {
  const existing = await verifyExistingAuthorization(input);
  if (existing.ok) return { ok: true, alreadyAuthorized: true };
  if (!String(input.password || '')) {
    throw new Error('当前密钥尚未授权，请输入仙宫云 SSH 密码');
  }
  let lastError;
  const directHost = await resolveDirectHost(input.host);
  const candidates = directHost && directHost !== input.host ? [directHost, directHost, input.host] : [input.host, input.host, input.host];
  for (let attempt = 1; attempt <= candidates.length; attempt += 1) {
    try {
      return await authorizeOnce({ ...input, host: candidates[attempt - 1] });
    } catch (error) {
      lastError = error;
      const transient = /ECONNRESET|connection lost before handshake|timed out|timeout|handshake|banner/i.test(String(error?.message || error));
      if (!transient || attempt === 3) break;
      await new Promise(resolve => setTimeout(resolve, attempt * 1800));
    }
  }
  const message = String(lastError?.message || lastError || '连接失败');
  if (/ECONNRESET|connection lost before handshake|timed out|timeout|handshake|banner/i.test(message)) {
    throw new Error('仙宫云 SSH 服务尚未就绪或连接被入口重置。请确认实例处于运行状态，并检查控制台显示的 SSH Host/Port 是否仍为当前值；等待约 30 秒后再试。');
  }
  throw lastError;
}

async function verifyExistingAuthorization(input = {}) {
  const host = String(input.host || 'me21gb3rds8p0h44.ssh.x-gpu.com').trim();
  const directHost = host === 'me21gb3rds8p0h44.ssh.x-gpu.com'
    ? (resolvedSshHost || await resolveDirectHost(host))
    : await resolveDirectHost(host);
  const port = Number(input.port) || 43213;
  const user = String(input.user || 'root').trim();
  if (process.platform !== 'win32') {
    return await new Promise(resolve => {
      execFile('ssh', [
        '-T', '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'ConnectTimeout=45', '-o', 'ConnectionAttempts=2',
        '-i', privateKeyPath, '-p', String(port), `${user}@${directHost}`,
        'printf AID_AUTHORIZED',
      ], { timeout: 120000, encoding: 'utf8' }, (error, stdout) => {
        resolve({ ok: !error && stdout === 'AID_AUTHORIZED', error: error?.message || '' });
      });
    });
  }
  return await new Promise(resolve => {
    const { Client } = require(path.join(serverRoot, 'node_modules', 'ssh2'));
    const client = new Client();
    const finish = result => { client.end(); resolve(result); };
    const timer = setTimeout(() => finish({ ok: false, error: '连接超时' }), 120000);
    client.once('ready', () => {
      clearTimeout(timer);
      client.exec('printf AID_AUTHORIZED', (error, stream) => {
        if (error) return finish({ ok: false, error: error.message });
        let stdout = '';
        stream.on('data', chunk => { stdout += String(chunk); });
        stream.once('close', code => finish({ ok: code === 0 && stdout === 'AID_AUTHORIZED' }));
      });
    });
    client.once('error', error => { clearTimeout(timer); finish({ ok: false, error: error.message }); });
    client.connect({
      host: directHost, port, username: user,
      privateKey: readFileSync(privateKeyPath), readyTimeout: 60000,
    });
  });
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, 'app-icon.png'));
  }
  await stopStaleCompanionServer();
  const key = ensureKeyPair();
  const directSshHost = await resolveDirectHost('me21gb3rds8p0h44.ssh.x-gpu.com');
  privateKeyPath = key.privatePath;
  resolvedSshHost = directSshHost;
  startServer(key.privatePath, key.privatePem, directSshHost);
  createWindow();
  createTray();

  ipcMain.handle('companion:get-state', () => ({
    publicKey,
    platform: process.platform,
    version: app.getVersion(),
    serviceUrl: `http://127.0.0.1:${PORT}`,
    launchAtLogin: app.getLoginItemSettings().openAtLogin,
  }));
  ipcMain.handle('companion:copy', (_event, value) => clipboard.writeText(String(value || '')));
  ipcMain.handle('companion:open-website', () => shell.openExternal(WEBSITE));
  ipcMain.handle('companion:set-login', (_event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), openAsHidden: true });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('companion:authorize', async (_event, input) => await authorizeWithPassword(input || {}));
  ipcMain.handle('companion:check-authorization', async (_event, input) => await verifyExistingAuthorization(input || {}));
  ipcMain.handle('companion:quit', () => { isQuitting = true; app.quit(); });
});

app.on('second-instance', () => {
  showWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  serverLaunchConfig = undefined;
  if (serverRestartTimer) {
    clearTimeout(serverRestartTimer);
    serverRestartTimer = undefined;
  }
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});

app.on('window-all-closed', event => event.preventDefault());
