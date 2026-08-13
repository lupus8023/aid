const { app, BrowserWindow, Tray, Menu, clipboard, ipcMain, shell, nativeImage } = require('electron');
const { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync, createWriteStream } = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const PORT = 3018;
const WEBSITE = 'https://pandais.beauty';
let window;
let tray;
let serverProcess;
let serverRoot;
let publicKey = '';
let isQuitting = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

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

function startServer(privatePem) {
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
      AID_COMPANION_VERSION: app.getVersion(),
      COMFYUI_SSH_PRIVATE_KEY_B64: Buffer.from(privatePem).toString('base64'),
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
  serverProcess.once('exit', () => window?.webContents.send('companion:server-exit'));
}

function createWindow() {
  window = new BrowserWindow({
    width: 760,
    height: 760,
    minWidth: 660,
    minHeight: 640,
    title: 'AID Companion',
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
  window.once('ready-to-show', () => window.show());
  window.on('close', event => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip('AID Companion');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 AID Companion', click: () => { window.show(); window.focus(); } },
    { label: '打开 pandais.beauty', click: () => shell.openExternal(WEBSITE) },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => window.show());
}

function authorizeWithPassword({ host, port, user, password }) {
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
      readyTimeout: 90000,
    });
  });
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  const key = ensureKeyPair();
  startServer(key.privatePem);
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
  ipcMain.handle('companion:quit', () => { isQuitting = true; app.quit(); });
});

app.on('second-instance', () => {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});

app.on('window-all-closed', event => event.preventDefault());
