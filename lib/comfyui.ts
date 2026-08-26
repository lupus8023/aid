import { createHash, randomBytes } from 'crypto';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { gunzipSync } from 'zlib';
import { promisify } from 'util';
import { access, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { homedir, tmpdir } from 'os';
import path from 'path';
import net from 'net';
import { Client, type SFTPWrapper } from 'ssh2';
import { MAX_H3_SPEECH_TURNS } from '@/lib/speechAudioContract';

const execFileAsync = promisify(execFile);

const SSH_CONNECT_TIMEOUT_SECONDS = 120;
const SSH_TUNNEL_READY_TIMEOUT_MS = 180_000;
const H3_REFERENCE_AUDIO_TOTAL_BUDGET_SECONDS = 14.7;
const H3_REFERENCE_AUDIO_MIN_SECONDS = 2;
const VIDEO_SUFFIXES = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v']);

const ASPECT_ALIASES: Record<string, string> = {
  '16:9': '16:9 (Widescreen)',
  '9:16': '9:16 (Portrait Widescreen)',
  '1:1': '1:1 (Square)',
  '4:3': '4:3 (Standard)',
  '3:4': '3:4 (Portrait Standard)',
};

export const COMFYUI_TASK_PREFIX = 'comfyui:';
export const COMFYUI_LONG_TASK_PREFIX = 'comfyui-long:';
export const COMFYUI_IMAGE_TASK_PREFIX = 'comfyui-image:';
export const MAX_COMFYUI_REFERENCE_IMAGES = 5;
export const SCAIL2_FRAME_COUNTS = [17, 33, 49, 65, 81] as const;
export const H3_VIDEO_FPS = 24;

/**
 * The H3 workflow can only render frame counts whose latent length is valid
 * for its 17-frame temporal blocks. The remote workflow rounds the requested
 * duration to frames, then advances to the next frame count congruent to 5
 * modulo 17. Keep speech/audio conditioning on that same real duration;
 * otherwise the unmatched final frames are free to become static or buzz.
 */
export function h3AlignedFrameCount(duration: number, fps = H3_VIDEO_FPS): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : H3_VIDEO_FPS;
  const requestedFrames = Math.max(5, Math.round((Number(duration) || 0) * safeFps));
  return requestedFrames + ((5 - (requestedFrames % 17)) + 17) % 17;
}

export function h3AlignedDurationSeconds(duration: number, fps = H3_VIDEO_FPS): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : H3_VIDEO_FPS;
  return h3AlignedFrameCount(duration, safeFps) / safeFps;
}

export type ComfyUIWorkflow =
  | 'aid_single_reference'
  | 'aid_multi_reference'
  | 'aid_first_last';

const WORKFLOW_SEARCH_PATTERNS: Record<ComfyUIWorkflow, string> = {
  aid_single_reference: '*单图生视频*4步lora*.json',
  aid_multi_reference: '*多图生视频*4步lora*.json',
  aid_first_last: '*首尾帧生视频*4步lora*.json',
};

export interface ComfyUIClientSettings {
  sshHost?: string;
  sshPort?: number | string;
  sshUser?: string;
  sshKeyPath?: string;
  sshPrivateKey?: string;
  sshPrivateKeyPassphrase?: string;
  comfyPort?: number | string;
  workflowRoot?: string;
  imageWorkflowPath?: string;
  multiImageWorkflowPath?: string;
  firstLastWorkflowPath?: string;
  characterReplaceWorkflowPath?: string;
  timeoutSeconds?: number | string;
}

interface ComfyUIConfig {
  sshHost: string;
  sshPort: number;
  sshUser: string;
  sshKeyPath: string;
  sshPrivateKey: string;
  sshPrivateKeyPassphrase: string;
  sshHostFingerprint: string;
  jsSshClient?: Client;
  jsSshReady?: Promise<Client>;
  comfyPort: number;
  workflowRoot: string;
  imageWorkflowPath: string;
  multiImageWorkflowPath: string;
  firstLastWorkflowPath: string;
  characterReplaceWorkflowPath: string;
  timeoutSeconds: number;
}

type JsonRecord = Record<string, any>;

export class ComfyUIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComfyUIError';
  }
}

function envOrValue(value: unknown, envName: string, fallback: string): string {
  if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  return String(process.env[envName] || fallback).trim();
}

function positiveInt(value: string, fallback: number, minimum = 1): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
}

function normalizePrivateKey(value: string, source: string): string {
  const privateKey = value.trim();
  if (!privateKey) return '';
  if (!privateKey.includes('PRIVATE KEY-----') || privateKey.length > 128 * 1024) {
    throw new ComfyUIError(`${source} 不包含有效的 SSH 私钥`);
  }
  return `${privateKey}\n`;
}

function privateKeyFromSettingsOrEnv(settings: ComfyUIClientSettings): string {
  const isLocalCompanion = process.env.AID_LOCAL_COMPANION === '1';
  // A packaged Companion owns its key material. Never allow browser settings
  // to override it with a different machine key during polling or download.
  if (isLocalCompanion && process.env.AID_COMPANION_SYSTEM_SSH === '1') return '';

  // A key selected in the browser is request-scoped and takes precedence over
  // the optional Netlify/server environment-variable fallback.
  const requestKey = String(settings.sshPrivateKey || '');
  if (!isLocalCompanion && requestKey.trim()) return normalizePrivateKey(requestKey, '浏览器选择的文件');

  const encoded = String(process.env.COMFYUI_SSH_PRIVATE_KEY_B64 || '').trim();
  if (!encoded) return '';
  let decoded = '';
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    throw new ComfyUIError('COMFYUI_SSH_PRIVATE_KEY_B64 不是有效的 Base64');
  }
  return normalizePrivateKey(decoded, 'COMFYUI_SSH_PRIVATE_KEY_B64');
}

export function getComfyUIConfig(settings: ComfyUIClientSettings = {}): ComfyUIConfig {
  const isLocalCompanion = process.env.AID_LOCAL_COMPANION === '1';
  const requestedSshHost = envOrValue(settings.sshHost, 'COMFYUI_SSH_HOST', '');
  const directSshHost = String(process.env.COMFYUI_SSH_DIRECT_HOST || '').trim();
  const originalSshHost = String(process.env.COMFYUI_SSH_ORIGINAL_HOST || '').trim();
  const sshHost = isLocalCompanion
    && directSshHost
    && requestedSshHost === originalSshHost
    ? directSshHost
    : requestedSshHost;
  const sshUser = envOrValue(settings.sshUser, 'COMFYUI_SSH_USER', 'root');
  if (sshHost && !/^[a-zA-Z0-9._:-]+$/.test(sshHost)) {
    throw new ComfyUIError('ComfyUI SSH Host 格式无效');
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(sshUser)) {
    throw new ComfyUIError('ComfyUI SSH User 格式无效');
  }
  return {
    sshHost,
    sshPort: positiveInt(envOrValue(settings.sshPort, 'COMFYUI_SSH_PORT', '22'), 22),
    sshUser,
    // The local Companion's generated key is authoritative. A website-stored
    // ~/.ssh path belongs to the browser machine and must not replace it.
    sshKeyPath: isLocalCompanion
      ? String(process.env.COMFYUI_SSH_KEY_PATH || '').trim()
      : envOrValue(settings.sshKeyPath, 'COMFYUI_SSH_KEY_PATH', ''),
    sshPrivateKey: privateKeyFromSettingsOrEnv(settings),
    sshPrivateKeyPassphrase: String(settings.sshPrivateKeyPassphrase || ''),
    sshHostFingerprint: String(process.env.COMFYUI_SSH_HOST_FINGERPRINT || '').trim(),
    comfyPort: positiveInt(envOrValue(settings.comfyPort, 'COMFYUI_PORT', '8188'), 8188),
    workflowRoot: envOrValue(settings.workflowRoot, 'COMFYUI_WORKFLOW_ROOT', '/root/ComfyUI'),
    imageWorkflowPath: envOrValue(settings.imageWorkflowPath, 'COMFYUI_IMAGE_WORKFLOW_PATH', ''),
    multiImageWorkflowPath: envOrValue(settings.multiImageWorkflowPath, 'COMFYUI_MULTI_IMAGE_WORKFLOW_PATH', ''),
    firstLastWorkflowPath: envOrValue(settings.firstLastWorkflowPath, 'COMFYUI_FIRST_LAST_WORKFLOW_PATH', ''),
    characterReplaceWorkflowPath: envOrValue(
      settings.characterReplaceWorkflowPath,
      'COMFYUI_CHARACTER_REPLACE_WORKFLOW_PATH',
      '/root/ComfyUI/aid_workflows/AID视频换人物_SCAIL2_INT8_API.json',
    ),
    timeoutSeconds: positiveInt(envOrValue(settings.timeoutSeconds, 'COMFYUI_TIMEOUT_SECONDS', '7200'), 7200, 60),
  };
}

export function isComfyUITask(taskId: string): boolean {
  const value = String(taskId || '');
  return value.startsWith(COMFYUI_TASK_PREFIX) || value.startsWith(COMFYUI_LONG_TASK_PREFIX);
}

export function isComfyUIImageTask(taskId: string): boolean {
  return String(taskId || '').startsWith(COMFYUI_IMAGE_TASK_PREFIX);
}

function unwrapComfyUIImageTaskId(taskId: string): string {
  const promptId = String(taskId || '').replace(/^comfyui-image:/, '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(promptId)) throw new ComfyUIError('ComfyUI 图片任务 ID 无效');
  return promptId;
}

export function unwrapComfyUITaskId(taskId: string): string {
  const value = String(taskId || '');
  const promptId = value.startsWith(COMFYUI_LONG_TASK_PREFIX)
    ? value.slice(COMFYUI_LONG_TASK_PREFIX.length).trim()
    : value.slice(COMFYUI_TASK_PREFIX.length).trim();
  if (!promptId || !/^[a-zA-Z0-9-]+$/.test(promptId)) {
    throw new ComfyUIError('ComfyUI task ID 无效');
  }
  return promptId;
}

export function selectComfyUIWorkflow(input: {
  auxiliaryImages?: string[];
  endFrame?: string;
} = {}): ComfyUIWorkflow {
  if (input.endFrame) return 'aid_first_last';
  if ((input.auxiliaryImages || []).some(Boolean)) return 'aid_multi_reference';
  return 'aid_single_reference';
}

function expandHome(filePath: string): string {
  return filePath === '~' ? homedir() : filePath.startsWith('~/') ? path.join(homedir(), filePath.slice(2)) : filePath;
}

async function identityArgs(config: ComfyUIConfig): Promise<string[]> {
  if (!config.sshKeyPath) return [];
  const keyPath = path.resolve(expandHome(config.sshKeyPath));
  try {
    await access(keyPath, fsConstants.R_OK);
  } catch {
    throw new ComfyUIError('ComfyUI SSH 私钥路径不存在或不可读；请清空以使用 ssh-agent，或填写服务端真实私钥路径');
  }
  return ['-i', keyPath];
}

async function cleanupPrivateKey(config: ComfyUIConfig): Promise<void> {
  const client = config.jsSshClient;
  config.jsSshClient = undefined;
  config.jsSshReady = undefined;
  client?.end();
}

function decodedPrivateKey(config: ComfyUIConfig): Buffer {
  return Buffer.from(config.sshPrivateKey, 'utf8');
}

function sshAuthenticationError(error: Error, config: ComfyUIConfig): ComfyUIError {
  if (/all configured authentication methods failed|authentication failed|permission denied/i.test(error.message)) {
    return new ComfyUIError(
      `SSH 认证失败：当前仙宫云实例没有授权本机公钥。请在本机终端执行设置页显示的“首次连接 / 实例重启后”授权命令，再重新测试连接。当前公钥：${publicKeyPath(config)}`,
    );
  }
  if (/encrypted.*key|passphrase/i.test(error.message)) {
    return new ComfyUIError('SSH 私钥需要口令，请在设置中填写 Private Key Passphrase');
  }
  return new ComfyUIError(`SSH 连接失败：${error.message}`);
}

function expectedHostHash(fingerprint: string): string {
  const value = fingerprint.trim().replace(/^SHA256:/i, '');
  if (/^[a-f0-9]{64}$/i.test(value)) return value.toLowerCase();
  try {
    const hex = Buffer.from(value, 'base64').toString('hex');
    return hex.length === 64 ? hex : '';
  } catch {
    return '';
  }
}

async function getJsSshClient(config: ComfyUIConfig): Promise<Client> {
  if (config.jsSshReady) return await config.jsSshReady;
  const client = new Client();
  config.jsSshClient = client;
  config.jsSshReady = new Promise<Client>((resolve, reject) => {
    const onError = (error: Error) => reject(sshAuthenticationError(error, config));
    client.once('ready', () => {
      client.removeListener('error', onError);
      client.on('error', () => { /* handled by the active operation */ });
      resolve(client);
    });
    client.once('error', onError);
    const expectedHash = expectedHostHash(config.sshHostFingerprint);
    try {
      client.connect({
        host: config.sshHost,
        port: config.sshPort,
        username: config.sshUser,
        privateKey: decodedPrivateKey(config),
        passphrase: config.sshPrivateKeyPassphrase || undefined,
        readyTimeout: SSH_CONNECT_TIMEOUT_SECONDS * 1000,
        keepaliveInterval: 30_000,
        keepaliveCountMax: 2,
        hostHash: expectedHash ? 'sha256' : undefined,
        hostVerifier: expectedHash ? (hash: string) => hash.toLowerCase() === expectedHash : undefined,
      });
    } catch (error) {
      reject(sshAuthenticationError(error instanceof Error ? error : new Error(String(error)), config));
    }
  });
  return await config.jsSshReady;
}

async function runSshJs(config: ComfyUIConfig, remoteCommand: string): Promise<string> {
  const client = await getJsSshClient(config);
  return await new Promise((resolve, reject) => {
    client.exec(remoteCommand, (error, stream) => {
      if (error) return reject(new ComfyUIError(`SSH 命令启动失败：${error.message}`));
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        stream.close();
        reject(new ComfyUIError('SSH 命令执行超时'));
      }, 300_000);
      stream.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      stream.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      stream.once('close', (code: number) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new ComfyUIError(stderr.trim() || `SSH 命令退出：${code}`));
      });
    });
  });
}

function controlPath(config: ComfyUIConfig): string {
  const endpoint = `${config.sshUser}@${config.sshHost}:${config.sshPort}`;
  const digest = createHash('sha256').update(endpoint).digest('hex').slice(0, 16);
  // Share the healthy OpenSSH master connection used by the local J18IP app.
  // aid can also create this socket itself when J18IP is not running.
  return `/tmp/j18ip-comfyui-${digest}.sock`;
}

function connectionReuseArgs(config: ComfyUIConfig, persist = true): string[] {
  return [
    '-o', 'ControlMaster=auto',
    '-o', `ControlPersist=${persist ? '86400' : 'no'}`,
    '-o', `ControlPath=${controlPath(config)}`,
  ];
}

async function sshPrefix(config: ComfyUIConfig, persist = true): Promise<string[]> {
  const companionHostKeyArgs = process.env.AID_LOCAL_COMPANION === '1'
    ? ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null']
    : ['-o', 'StrictHostKeyChecking=accept-new'];
  return [
    '-T',
    '-o', 'BatchMode=yes',
    // X-GPU's direct gateway IP and host key can rotate. Isolate that exception
    // to the local Companion instead of modifying the user's known_hosts file.
    ...companionHostKeyArgs,
    '-o', `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`,
    '-o', 'ConnectionAttempts=2',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=2',
    '-o', 'TCPKeepAlive=yes',
    '-p', String(config.sshPort),
    ...connectionReuseArgs(config, persist),
    ...(await identityArgs(config)),
    `${config.sshUser}@${config.sshHost}`,
  ];
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function publicKeyPath(config: ComfyUIConfig): string {
  const privateKeyPath = config.sshKeyPath || '~/.ssh/id_ed25519';
  return privateKeyPath.endsWith('.pub') ? privateKeyPath : `${privateKeyPath}.pub`;
}

function sshAuthorizationHint(config: ComfyUIConfig): string {
  const command = `cat ${shellQuote(publicKeyPath(config))} | ssh -p ${config.sshPort} ${config.sshUser}@${config.sshHost} 'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys'`;
  return `当前仙宫云实例没有授权本机公钥。请在本机终端执行设置页显示的授权命令后重试：${command}`;
}

async function runSsh(config: ComfyUIConfig, remoteCommand: string): Promise<string> {
  if (config.sshPrivateKey) return await runSshJs(config, remoteCommand);
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { stdout } = await execFileAsync('ssh', [...await sshPrefix(config), remoteCommand], {
        timeout: 300_000,
        maxBuffer: 64 * 1024 * 1024,
        encoding: 'utf8',
      });
      return stdout;
    } catch (error: any) {
      lastError = String(error?.stderr || error?.stdout || error?.message || error).trim();
      if (attempt < 2) await delay(1000 * 2 ** attempt);
    }
  }
  throw new ComfyUIError(`读取云端工作流失败：${lastError || 'SSH 命令失败'}`);
}

async function probeSshAuthorization(config: ComfyUIConfig): Promise<string> {
  if (config.sshPrivateKey) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        runSshJs(config, 'printf AID_SSH_READY'),
        new Promise<string>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new ComfyUIError('SSH 连接超时；请确认仙宫云实例正在运行，且 SSH Host/Port 仍为当前值')),
            75_000,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  try {
    const baseArgs = await sshPrefix(config);
    const args = baseArgs.flatMap((arg, index) => {
      if (arg === '-o' && /^ConnectTimeout=/.test(baseArgs[index + 1] || '')) return [];
      if (/^ConnectTimeout=/.test(arg)) return [];
      if (arg === '-o' && /^ConnectionAttempts=/.test(baseArgs[index + 1] || '')) return [];
      if (/^ConnectionAttempts=/.test(arg)) return [];
      return [arg];
    });
    const { stdout } = await execFileAsync('ssh', [
      '-o', 'ConnectTimeout=45',
      '-o', 'ConnectionAttempts=1',
      ...args,
      'printf AID_SSH_READY',
    ], {
      timeout: 75_000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    });
    return stdout;
  } catch (error: any) {
    const detail = String(error?.stderr || error?.stdout || error?.message || error).trim();
    if (/permission denied|authentication failed/i.test(detail)) {
      throw new ComfyUIError('本机设备密钥尚未获得当前仙宫云实例授权，请在 Companion 中重新授权');
    }
    throw new ComfyUIError(`SSH 无法连接；请确认仙宫云实例正在运行，且 SSH Host/Port 仍为当前值${detail ? `：${detail}` : ''}`);
  }
}

async function runSshUntilMarker(
  config: ComfyUIConfig,
  remoteCommand: string,
  marker: string,
): Promise<string> {
  if (config.sshPrivateKey) return await runSsh(config, remoteCommand);
  const markerLine = `\n${marker}\n`;
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const args = [...await sshPrefix(config), remoteCommand];
      return await new Promise<string>((resolve, reject) => {
        const child = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (error?: Error, value = '') => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (child.exitCode === null) child.kill('SIGTERM');
          if (error) reject(error);
          else resolve(value);
        };
        const timer = setTimeout(
          () => finish(new Error(stderr.trim() || 'SSH 文件分块传输超时')),
          180_000,
        );
        child.stdout?.on('data', chunk => {
          stdout += String(chunk);
          const markerOffset = stdout.indexOf(markerLine);
          if (markerOffset >= 0) finish(undefined, stdout.slice(0, markerOffset));
        });
        child.stderr?.on('data', chunk => { stderr += String(chunk); });
        child.once('error', error => finish(error));
        child.once('exit', code => {
          if (!settled) finish(new Error(stderr.trim() || `SSH 文件分块命令退出：${code ?? '未知'}`));
        });
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 2) await delay(1000 * 2 ** attempt);
    }
  }
  throw new ComfyUIError(`云端视频下载失败：${lastError || 'SSH 文件传输失败'}`);
}

async function downloadRemoteFileInChunks(config: ComfyUIConfig, remotePath: string): Promise<Buffer> {
  const sizeText = (await runSsh(config, `wc -c < ${shellQuote(remotePath)}`)).trim();
  const size = Number(sizeText);
  if (!Number.isSafeInteger(size) || size <= 0) throw new ComfyUIError('云端视频文件大小无效');
  if (size > 4 * 1024 * 1024 * 1024) throw new ComfyUIError('云端视频超过 4GB，暂不支持浏览器下载');
  // X-GPU's SSH gateway can stall after roughly 256KB of command output.
  // Base64 expands data by 4/3, so keep each raw block comfortably below it.
  const chunkSize = 64 * 1024;
  const chunks: Buffer[] = [];
  for (let index = 0, offset = 0; offset < size; index += 1, offset += chunkSize) {
    const expected = Math.min(chunkSize, size - offset);
    const marker = `AID_CHUNK_END_${index}_${randomBytes(6).toString('hex')}`;
    const encoded = await runSshUntilMarker(
      config,
      `dd if=${shellQuote(remotePath)} bs=${chunkSize} skip=${index} count=1 2>/dev/null | base64; printf '\\n%s\\n' ${shellQuote(marker)}`,
      marker,
    );
    const chunk = Buffer.from(encoded.replace(/\s/g, ''), 'base64');
    if (chunk.length !== expected) {
      throw new ComfyUIError(`云端视频第 ${index + 1} 块不完整（${chunk.length}/${expected} bytes）`);
    }
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (buffer.length !== size) throw new ComfyUIError(`云端视频下载不完整（${buffer.length}/${size} bytes）`);
  return buffer;
}

async function chooseFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function responseError(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  return `${response.status} ${response.statusText}${body ? `：${body.slice(0, 2000)}` : ''}`;
}

class ComfyUITunnel {
  private process: ChildProcess | null = null;
  private jsServer: net.Server | null = null;
  private jsSockets = new Set<net.Socket>();
  private controlForward = '';
  baseUrl = '';

  constructor(private readonly config: ComfyUIConfig) {}

  async open(): Promise<void> {
    if (this.config.sshPrivateKey) {
      await this.openJsTunnel();
      await this.waitUntilReady();
      return;
    }
    const localPort = await chooseFreePort();
    this.baseUrl = `http://127.0.0.1:${localPort}`;
    const forward = `127.0.0.1:${localPort}:127.0.0.1:${this.config.comfyPort}`;
    if (await this.hasExistingControlMaster()) {
      await execFileAsync('ssh', [
        '-S', controlPath(this.config), '-O', 'forward', '-L', forward,
        '-p', String(this.config.sshPort), `${this.config.sshUser}@${this.config.sshHost}`,
      ], { timeout: 30_000, encoding: 'utf8' });
      this.controlForward = forward;
      await this.waitUntilReady();
      return;
    }
    const args = await sshPrefix(this.config, false);
    args.unshift(
      '-N', '-o', 'ExitOnForwardFailure=yes',
      '-L', forward,
    );
    this.process = spawn('ssh', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let spawnError = '';
    this.process.stderr?.on('data', chunk => { stderr += String(chunk); });
    this.process.once('error', error => { spawnError = error.message; });

    await this.waitUntilReady(() => {
      if (spawnError) return `SSH 隧道进程启动失败：${spawnError}`;
      if (!this.process || this.process.exitCode !== null) return `SSH 隧道建立失败：${stderr.trim() || 'ssh 已退出'}`;
      return '';
    });
  }

  private async openJsTunnel(): Promise<void> {
    const client = await getJsSshClient(this.config);
    this.jsServer = net.createServer(socket => {
      this.jsSockets.add(socket);
      socket.once('close', () => this.jsSockets.delete(socket));
      client.forwardOut(
        socket.remoteAddress || '127.0.0.1',
        socket.remotePort || 0,
        '127.0.0.1',
        this.config.comfyPort,
        (error, stream) => {
          if (error) {
            socket.destroy(error);
            return;
          }
          socket.pipe(stream).pipe(socket);
          stream.once('error', (streamError: Error) => socket.destroy(streamError));
          socket.once('error', () => stream.destroy());
        },
      );
    });
    await new Promise<void>((resolve, reject) => {
      this.jsServer!.once('error', reject);
      this.jsServer!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.jsServer.address();
    if (!address || typeof address === 'string') throw new ComfyUIError('无法建立本地 ComfyUI 转发端口');
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }

  private async waitUntilReady(processError?: () => string): Promise<void> {
    const deadline = Date.now() + SSH_TUNNEL_READY_TIMEOUT_MS;
    let lastError = '';
    while (Date.now() < deadline) {
      const processFailure = processError?.() || '';
      if (processFailure) {
        await this.close();
        throw new ComfyUIError(
          /permission denied|publickey/i.test(processFailure)
            ? `SSH 隧道建立失败：${processFailure}；${sshAuthorizationHint(this.config)}`
            : processFailure,
        );
      }
      try {
        const response = await fetch(`${this.baseUrl}/system_stats`, { signal: AbortSignal.timeout(5000) });
        if (response.ok) return;
        lastError = await responseError(response);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await delay(500);
    }
    await this.close();
    throw new ComfyUIError(`SSH 隧道建立超时：${lastError}`);
  }

  private async hasExistingControlMaster(): Promise<boolean> {
    try {
      await execFileAsync('ssh', [
        '-S', controlPath(this.config), '-O', 'check',
        '-p', String(this.config.sshPort), `${this.config.sshUser}@${this.config.sshHost}`,
      ], { timeout: 10_000, encoding: 'utf8' });
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    for (const socket of this.jsSockets) socket.destroy();
    this.jsSockets.clear();
    const server = this.jsServer;
    this.jsServer = null;
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    const forward = this.controlForward;
    this.controlForward = '';
    if (forward) {
      await execFileAsync('ssh', [
        '-S', controlPath(this.config), '-O', 'cancel', '-L', forward,
        '-p', String(this.config.sshPort), `${this.config.sshUser}@${this.config.sshHost}`,
      ], { timeout: 30_000, encoding: 'utf8' }).catch(() => undefined);
    }
    const process = this.process;
    this.process = null;
    if (!process || process.exitCode !== null) return;
    process.kill('SIGTERM');
    await Promise.race([
      new Promise<void>(resolve => process.once('exit', () => resolve())),
      delay(5000),
    ]);
    if (process.exitCode === null) process.kill('SIGKILL');
  }
}

async function withTunnel<T>(config: ComfyUIConfig, callback: (baseUrl: string) => Promise<T>): Promise<T> {
  const tunnel = new ComfyUITunnel(config);
  await tunnel.open();
  try {
    return await callback(tunnel.baseUrl);
  } finally {
    await tunnel.close();
  }
}

function configuredWorkflowPath(config: ComfyUIConfig, variant: ComfyUIWorkflow): string {
  if (variant === 'aid_single_reference') return config.imageWorkflowPath;
  if (variant === 'aid_multi_reference') return config.multiImageWorkflowPath;
  return config.firstLastWorkflowPath;
}

const workflowCache = new Map<string, { workflow: JsonRecord; path: string }>();
const definitionCache = new Map<string, JsonRecord>();

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

async function readRemoteDefinitions(config: ComfyUIConfig): Promise<JsonRecord> {
  const cacheKey = [config.sshHost, config.sshPort, config.sshUser, config.comfyPort].join('|');
  const cached = definitionCache.get(cacheKey);
  if (cached) return cached;
  // Fetch and compress on the server. Streaming the multi-megabyte JSON through
  // many HTTP requests over X-GPU's SSH forward is prone to partial responses.
  const encoded = await runSsh(
    config,
    `curl -fsS --max-time 180 http://127.0.0.1:${config.comfyPort}/object_info | gzip -c | base64`,
  );
  try {
    const definitions = JSON.parse(gunzipSync(Buffer.from(encoded.replace(/\s/g, ''), 'base64')).toString('utf8'));
    if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) throw new Error('missing definitions');
    definitionCache.set(cacheKey, definitions);
    return definitions;
  } catch (error) {
    throw new ComfyUIError(
      `云端节点定义不是有效 JSON：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function readRemoteWorkflow(config: ComfyUIConfig, variant: ComfyUIWorkflow): Promise<{ workflow: JsonRecord; path: string }> {
  const explicitPath = configuredWorkflowPath(config, variant);
  const cacheKey = [config.sshHost, config.sshPort, config.sshUser, config.workflowRoot, explicitPath, variant].join('|');
  const cached = workflowCache.get(cacheKey);
  if (cached) return { workflow: cloneJson(cached.workflow), path: cached.path };

  let workflowPath = explicitPath;
  if (!workflowPath) {
    const pattern = WORKFLOW_SEARCH_PATTERNS[variant];
    workflowPath = (await runSsh(
      config,
      `find ${shellQuote(config.workflowRoot)} -type f -name ${shellQuote(pattern)} -print -quit`,
    )).trim();
  }
  if (!workflowPath) {
    throw new ComfyUIError(`云端没有找到 ${variant} 的基础工作流；请在设置中填写工作流路径`);
  }
  const encoded = await runSsh(config, `gzip -c -- ${shellQuote(workflowPath)} | base64`);
  try {
    const workflow = JSON.parse(gunzipSync(Buffer.from(encoded.replace(/\s/g, ''), 'base64')).toString('utf8'));
    if (!workflow || typeof workflow !== 'object' || !Array.isArray(workflow.nodes)) {
      throw new Error('missing nodes');
    }
    workflowCache.set(cacheKey, { workflow: cloneJson(workflow), path: workflowPath });
    return { workflow, path: workflowPath };
  } catch (error) {
    throw new ComfyUIError(`云端工作流不是有效 JSON：${workflowPath}（${error instanceof Error ? error.message : String(error)}）`);
  }
}

function normalizeLinks(rawLinks: any[]): Map<number, JsonRecord> {
  const result = new Map<number, JsonRecord>();
  for (const raw of rawLinks || []) {
    const link = Array.isArray(raw)
      ? { id: raw[0], origin_id: raw[1], origin_slot: raw[2], target_id: raw[3], target_slot: raw[4] }
      : { ...raw };
    result.set(Number(link.id), link);
  }
  return result;
}

function widgetValues(node: JsonRecord): JsonRecord {
  const raw = node.widgets_values || [];
  if (!Array.isArray(raw)) return { ...raw };
  const names = (node.inputs || [])
    .filter((slot: JsonRecord) => slot.widget)
    .map((slot: JsonRecord) => slot.widget?.name || slot.name);
  return Object.fromEntries(
    names
      .map((name: string, index: number): [string, unknown] => [name, raw[index]])
      .filter((entry: [string, unknown]) => entry[1] !== undefined),
  );
}

function setWidget(node: JsonRecord, name: string, value: unknown): void {
  const raw = node.widgets_values ?? (node.widgets_values = []);
  if (!Array.isArray(raw)) {
    raw[name] = value;
    return;
  }
  const names = (node.inputs || [])
    .filter((slot: JsonRecord) => slot.widget)
    .map((slot: JsonRecord) => slot.widget?.name || slot.name);
  const index = names.indexOf(name);
  if (index < 0) throw new ComfyUIError(`工作流节点 ${node.id} 缺少可配置字段 ${name}`);
  while (raw.length <= index) raw.push(null);
  raw[index] = value;
}

function loaderNodes(workflow: JsonRecord): JsonRecord[] {
  return (workflow.nodes || []).filter((node: JsonRecord) => node.type === 'LoadImage');
}

function patchWorkflow(workflow: JsonRecord, input: {
  variant: ComfyUIWorkflow;
  imageRefs: string[];
  prompt: string;
  duration: number;
  aspectRatio: string;
  seed: number;
  outputPrefix: string;
}): void {
  const loaders = loaderNodes(workflow);
  // The exported workflow only contains the image loaders that were visible
  // when it was saved (currently two). Extra H3 ref_images are dynamic API
  // inputs and are injected after compilation below.
  input.imageRefs.slice(0, loaders.length).forEach((image, index) => setWidget(loaders[index], 'image', image));
  for (const node of workflow.nodes || []) {
    const nodeType = String(node.type || '');
    const title = String(node.title || '').toLowerCase();
    if (nodeType === 'PrimitiveStringMultiline' && title.includes('input text')) setWidget(node, 'value', input.prompt);
    else if (nodeType === 'PrimitiveFloat' && title.includes('duration')) setWidget(node, 'value', input.duration);
    else if (nodeType === 'RandomNoise') setWidget(node, 'noise_seed', input.seed);
    else if (nodeType === 'ResolutionSelector') setWidget(node, 'aspect_ratio', ASPECT_ALIASES[input.aspectRatio] || input.aspectRatio);
    else if (nodeType === 'SaveVideo' || nodeType === 'VHS_VideoCombine') {
      if ('filename_prefix' in widgetValues(node)) setWidget(node, 'filename_prefix', input.outputPrefix);
    }
  }
}

function compileFrontendWorkflow(workflow: JsonRecord): JsonRecord {
  if (workflow.definitions?.subgraphs?.length) {
    throw new ComfyUIError('当前 ComfyUI 接入仅接受不含子图的加速工作流');
  }
  const nodes = new Map<number, JsonRecord>(
    (workflow.nodes || []).filter((node: JsonRecord) => Number(node.mode || 0) === 0).map((node: JsonRecord) => [Number(node.id), node]),
  );
  const links = normalizeLinks(workflow.links || []);
  const outputTypes = new Set(['SaveVideo', 'VHS_VideoCombine', 'SaveImage', 'PreviewImage']);
  const reachable = new Set<number>();
  const visit = (nodeId: number) => {
    if (reachable.has(nodeId) || !nodes.has(nodeId)) return;
    reachable.add(nodeId);
    for (const slot of nodes.get(nodeId)?.inputs || []) {
      if (slot.link === null || slot.link === undefined) continue;
      const link = links.get(Number(slot.link));
      if (link) visit(Number(link.origin_id));
    }
  };
  for (const [nodeId, node] of nodes) if (outputTypes.has(node.type)) visit(nodeId);
  if (!reachable.size) throw new ComfyUIError('工作流没有可执行的输出节点');

  const prompt: JsonRecord = {};
  for (const nodeId of [...reachable].sort((a, b) => a - b)) {
    const node = nodes.get(nodeId)!;
    const widgets = widgetValues(node);
    const inputs: JsonRecord = {};
    for (const slot of node.inputs || []) {
      const name = String(slot.name || '');
      const link = slot.link === null || slot.link === undefined ? undefined : links.get(Number(slot.link));
      if (link) inputs[name] = [String(link.origin_id), Number(link.origin_slot)];
      else if (slot.widget && name in widgets) inputs[name] = widgets[name];
    }
    prompt[String(nodeId)] = {
      class_type: String(node.type || ''),
      inputs,
      _meta: { title: String(node.title || node.type || '') },
    };
  }
  return prompt;
}

function conditioningNode(prompt: JsonRecord): JsonRecord {
  const matches = Object.values(prompt).filter((node: any) => node.class_type === 'MiniMaxH3AudioConditioningT8') as JsonRecord[];
  if (matches.length !== 1) throw new ComfyUIError('工作流必须且只能包含一个 MiniMaxH3AudioConditioningT8 节点');
  return matches[0];
}

function nextNodeId(prompt: JsonRecord): string {
  return String(Math.max(0, ...Object.keys(prompt).map(Number).filter(Number.isFinite)) + 1);
}

function injectReferenceImages(prompt: JsonRecord, variant: ComfyUIWorkflow, remoteImages: string[]): void {
  const inputs = conditioningNode(prompt).inputs;
  inputs.task_type = h3VisualTaskType(variant);
  if (variant === 'aid_first_last') return;
  for (const key of Object.keys(inputs)) {
    if (key.startsWith('ref_images.ref_image_')) delete inputs[key];
  }
  remoteImages.forEach((remoteImage, index) => {
    const nodeId = nextNodeId(prompt);
    prompt[nodeId] = {
      class_type: 'LoadImage',
      inputs: { image: remoteImage },
      _meta: { title: `AID reference image ${index + 1}` },
    };
    inputs[`ref_images.ref_image_${index}`] = [nodeId, 0];
  });
}

export function h3VisualTaskType(variant: ComfyUIWorkflow): 'FL2VA' | 'Ref2VA' {
  // The downloaded single-image workflow can retain FL2VA in its saved widget
  // state. Once AID injects the image through ref_images, H3 rejects FL2VA
  // ("cannot include reference media"). Both one and many reference images
  // therefore use Ref2VA; only the dedicated first/last-frame graph uses FL2VA.
  return variant === 'aid_first_last' ? 'FL2VA' : 'Ref2VA';
}

export function h3ConditioningTaskType(
  visualTaskType: 'FL2VA' | 'Ref2VA',
  referenceAudioCount: number,
): 'FL2VA' | 'Ref2VA' | 'Hybrid' {
  // H3 treats voice samples as reference media too. Pure FL2VA rejects any
  // reference media, so first/last-frame continuity plus a character voice
  // reference must run through Hybrid.
  return visualTaskType === 'FL2VA' && referenceAudioCount > 0 ? 'Hybrid' : visualTaskType;
}

export function h3ReferenceAudioPolicy(referenceAudioCount: number): {
  audio_mode: 'native';
  add_source_as_reference: false;
  prompt_primary_audio_ordinal: number;
} {
  return {
    // `ref_audios` are voice/style references, not a drive track. The H3 T8
    // node requires `drive_audio` for every non-native mode, including the
    // misleadingly named `reference_only` mode. Native mode still consumes
    // ref_audios and generates a fresh synchronized soundtrack.
    audio_mode: 'native',
    add_source_as_reference: false,
    prompt_primary_audio_ordinal: referenceAudioCount > 0 ? 1 : 0,
  };
}

function injectReferenceAudios(prompt: JsonRecord, remoteAudios: string[]): void {
  const inputs = conditioningNode(prompt).inputs;
  for (const key of Object.keys(inputs)) {
    if (key.startsWith('ref_audios.ref_audio_')) delete inputs[key];
  }
  const savedTaskType = String(inputs.task_type || 'auto');
  const taskType = ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'Ref2VA', 'Hybrid']
    .find(value => savedTaskType === value || savedTaskType.startsWith(`${value} `));
  inputs.task_type = taskType || 'auto';
  remoteAudios.forEach((remoteAudio, index) => {
    const nodeId = nextNodeId(prompt);
    prompt[nodeId] = {
      class_type: 'LoadAudio',
      inputs: { audio: remoteAudio },
      _meta: { title: `AID voice reference ${index + 1}` },
    };
    inputs[`ref_audios.ref_audio_${index}`] = [nodeId, 0];
  });
  inputs.task_type = h3ConditioningTaskType(
    inputs.task_type === 'FL2VA' ? 'FL2VA' : 'Ref2VA',
    remoteAudios.length,
  );
  Object.assign(inputs, h3ReferenceAudioPolicy(remoteAudios.length));
  inputs.strict_prompt_tags = true;
}

export interface H3NativeDialogueTurn {
  speakerId?: string;
  character: string;
  exactLine: string;
  emotion?: string;
  delivery?: string;
  start?: number;
  end?: number;
}

function h3PromptText(prompt: JsonRecord): string {
  const promptNode = Object.values(prompt).find((node: any) => (
    node.class_type === 'PrimitiveStringMultiline'
    && String(node?._meta?.title || '').toLowerCase().includes('input text')
  )) as JsonRecord | undefined;
  return typeof promptNode?.inputs?.value === 'string' ? promptNode.inputs.value : '';
}

/** Keep dialogue inside the one native H3 audiovisual generation. */
export function injectH3NativeDialogue(
  prompt: JsonRecord,
  remoteAudios: string[],
  referenceAudioNames: string[],
  speechTurns: H3NativeDialogueTurn[],
  duration: number,
  language: 'zh' | 'en',
): boolean {
  const turns = speechTurns.map(turn => ({
    ...turn,
    speakerId: String(turn.speakerId || '').trim(),
    character: String(turn.character || '').trim(),
    exactLine: String(turn.exactLine || '').trim(),
    start: Number(turn.start),
    end: Number(turn.end),
  }));
  if (!turns.length) {
    return false;
  }
  const incompleteTurnIndex = turns.findIndex(turn => !turn.character || !turn.exactLine);
  if (incompleteTurnIndex >= 0) {
    throw new ComfyUIError(`第 ${incompleteTurnIndex + 1} 轮精确台词缺少角色名或逐字文本，已阻止静默丢弃`);
  }
  if (turns.length > MAX_H3_SPEECH_TURNS) {
    throw new ComfyUIError(`精确台词共有 ${turns.length} 轮，超过 H3 的 ${MAX_H3_SPEECH_TURNS} 轮上限`);
  }
  if (!remoteAudios.length) throw new ComfyUIError('原生 H3 台词缺少角色音色参考');
  if (remoteAudios.length !== referenceAudioNames.length) {
    throw new ComfyUIError(`角色音色文件与名称数量不一致（${remoteAudios.length}/${referenceAudioNames.length}）`);
  }
  const requestedDuration = Number(duration);
  if (!Number.isFinite(requestedDuration) || requestedDuration <= 0) {
    throw new ComfyUIError('精确台词片段缺少有效的母带时长');
  }
  const renderSeconds = Math.min(15.08, Math.max(5.17, requestedDuration));
  turns.forEach((turn, turnIndex) => {
    const label = `第 ${turnIndex + 1} 轮台词`;
    if (!Number.isFinite(turn.start) || !Number.isFinite(turn.end) || turn.start < 0 || turn.end <= turn.start) {
      throw new ComfyUIError(`${label}缺少有效的开始/结束时间`);
    }
    if (turn.end - turn.start < 0.001) {
      throw new ComfyUIError(`${label}的时间槽短于 1 毫秒，无法生成有效音频`);
    }
    if (turn.end > renderSeconds + 0.005) {
      throw new ComfyUIError(`${label}结束于 ${turn.end.toFixed(3)} 秒，超过片段母带 ${renderSeconds.toFixed(3)} 秒`);
    }
    const previous = turns[turnIndex - 1];
    if (previous && turn.start < previous.end - 0.005) {
      throw new ComfyUIError(`${label}与上一轮台词时间重叠或顺序错误`);
    }
  });
  const speakingCharacters = [...new Set(turns.map(turn => turn.character))];
  const missingReferences = speakingCharacters.filter(character => (
    !referenceAudioNames.some((name, index) => String(name || '').trim() === character && remoteAudios[index])
  ));
  if (missingReferences.length) {
    throw new ComfyUIError(`原生 H3 台词缺少音色绑定：${missingReferences.join('、')}`);
  }

  const promptText = h3PromptText(prompt);
  if (!promptText) throw new ComfyUIError('H3 工作流缺少最终视频提示词');
  const taggedLines = [...promptText.matchAll(/<d>\s*\[(Chinese|English|Japanese|Korean)\]\s*([\s\S]*?)\s*<\/d>/gi)]
    .map(match => ({ language: match[1].toLowerCase(), text: match[2].trim() }));
  const expectedLanguage = language === 'en' ? 'english' : 'chinese';
  if (taggedLines.length !== turns.length) {
    throw new ComfyUIError(`H3 提示词含 ${taggedLines.length} 个对白标签，但剧本计划为 ${turns.length} 个`);
  }
  taggedLines.forEach((tagged, index) => {
    if (tagged.language !== expectedLanguage || tagged.text !== turns[index].exactLine) {
      throw new ComfyUIError(`H3 提示词第 ${index + 1} 条对白与剧本逐字文本或项目语言不一致`);
    }
  });
  if (!/(?:^|\n)(?:subject_definitions:|integrated_multimodal_description:)/.test(promptText)
    || !/(?:^|\n)overall_soundscape:/.test(promptText)
    || !/(?:^|\n)non_diegetic_music:/.test(promptText)) {
    throw new ComfyUIError('H3 台词提示词缺少官方结构或声音字段');
  }

  injectReferenceAudios(prompt, remoteAudios);
  const inputs = conditioningNode(prompt).inputs;
  delete inputs.drive_audio;
  delete inputs.final_audio;
  // The cloud MiniMaxH3AudioConditioningT8 schema requires this field even in
  // native mode. A value of 1 keeps audio fully native instead of carrying the
  // low denoise value formerly used by the removed drive-audio remix path.
  inputs.audio_denoise_strength = 1;
  Object.assign(inputs, h3ReferenceAudioPolicy(remoteAudios.length));
  inputs.strict_prompt_tags = true;
  return true;
}

function validatePrompt(prompt: JsonRecord, definitions: JsonRecord): void {
  const missing = [...new Set(Object.values(prompt).map((node: any) => String(node.class_type || '')).filter(type => !definitions[type]))].sort();
  if (missing.length) throw new ComfyUIError(`云端缺少工作流节点：${missing.join(', ')}`);
  const errors: string[] = [];
  for (const [nodeId, node] of Object.entries(prompt) as [string, JsonRecord][]) {
    const required = definitions[node.class_type]?.input?.required || {};
    for (const [field, spec] of Object.entries(required) as [string, any][]) {
      const dynamicPresent = Object.keys(node.inputs || {}).some(key => key.startsWith(`${field}.`));
      if (!(field in (node.inputs || {})) && !dynamicPresent) errors.push(`${nodeId}:${node.class_type} 缺少 ${field}`);
      if (!(field in (node.inputs || {})) || !Array.isArray(spec) || !spec.length) continue;
      const rawOptions = Array.isArray(spec[0]) ? spec[0] : spec[1]?.options;
      const options = Array.isArray(rawOptions)
        ? rawOptions.map(option => (
          option && typeof option === 'object' && 'key' in option ? String(option.key) : option
        ))
        : undefined;
      const isFileLoader = ['LoadImage', 'LoadAudio', 'LoadVideo', 'VHS_LoadVideo'].includes(node.class_type);
      const value = node.inputs[field];
      if (options && !isFileLoader && !Array.isArray(value) && !options.includes(value)) {
        errors.push(`${nodeId}:${field}=${JSON.stringify(value)} 不在云端可选值中`);
      }
    }
  }
  if (errors.length) throw new ComfyUIError(`工作流 API 校验失败：${errors.slice(0, 20).join('；')}`);
}

function sanitizeUnavailablePictureOrdinals(prompt: string, availableCount: number): string {
  const fallback = /[\u3400-\u9fff]/.test(prompt) ? '上一段生成结果' : 'the prior generated output';
  return String(prompt || '').replace(/<?\b(?:picture|image)\s+(\d+)\b>?/gi, (match, ordinal) => (
    Number(ordinal) <= Math.max(0, availableCount) ? match : fallback
  ));
}

export function sanitizeSubmittedH3Prompt(prompt: string): string {
  return String(prompt || '').split(/(<d>[\s\S]*?<\/d>)/gi).map(part => {
    if (/^<d>/i.test(part)) return part;
    return part
      .replace(/画面中可见的成因/g, '画面中的对应动作')
      .replace(/画面中可见/g, '画面中有')
      .replace(/可见物体为/g, '镜头内物体包括')
      .replace(/上述可见动作/g, '上述动作')
      .replace(/只由可见动作/g, '只由画面动作')
      .replace(/跟随可见动作/g, '跟随画面动作')
      .replace(/完成可见表演/g, '完成镜头内表演')
      .replace(/不可见/g, '画面不呈现')
      .replace(/可见/g, '画面呈现')
      // H3 may perform stop-control prose as an additional vocal event. The
      // closing </d> tag is the sole dialogue boundary; never supplement it
      // with instructions about mouths, final words, silence, or filling time.
      .replace(/(?:说完|念完|读完)[^。！？\n]{0,80}(?:闭嘴|闭口|嘴巴闭合|口型闭合|停止说话|停止人声)[。！？.!]?/gi, ' ')
      .replace(/(?:闭嘴|闭口|嘴巴闭合|口型闭合|停止说话|停止人声)[。！？.!]?/gi, ' ')
      .replace(/\b(?:the\s+|his\s+|her\s+)?(?:mouth|lips|jaw)\s+(?:closes?|close|meet|meets|ceases?\s+(?:speaking\s+)?motion)[^.!?\n]*[.!?]?/gi, ' ')
      .replace(/\b(?:stop(?:s|ped)?\s+(?:speaking|voice)|zero\s+human\s+voice|room\s+tone\s+only|only\s+say\s+once|says?\s+once|final\s+word)[^.!?\n]*[.!?]?/gi, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,.!?;，。！？；])/g, '$1');
  }).join('').trim();
}

export function taggedPrompt(visualPrompt: string, variant: ComfyUIWorkflow, auxiliaryCount: number, referenceAudioCount: number, referenceAudioNames?: string[]): string {
  const availablePictureCount = variant === 'aid_first_last'
    ? 2
    : variant === 'aid_multi_reference'
      ? 1 + Math.max(0, auxiliaryCount)
      : 1;
  const prompt = sanitizeSubmittedH3Prompt(
    sanitizeUnavailablePictureOrdinals(visualPrompt, availablePictureCount),
  );
  // The Story prompt builder now emits MiniMax's official base or Ref2VA
  // structure, including picture/audio labels and subject bindings. Appending
  // a second free-form contract would break the documented field order and
  // dilute the chronological shot description.
  const isOfficialH3Prompt = /(?:^|\n)(?:subject_definitions:|integrated_multimodal_description:)/.test(prompt)
    && /(?:^|\n)overall_soundscape:/.test(prompt)
    && /(?:^|\n)non_diegetic_music:/.test(prompt);
  if (isOfficialH3Prompt) return prompt.trim();

  const rules = variant === 'aid_first_last'
    ? ['Use the supplied first frame as the exact opening frame and the supplied last frame as the exact ending frame. Every person and object in the motion must already be present in one of these two frames — introduce no new character or subject.']
    : auxiliaryCount
      ? [`Use ${Array.from({ length: 1 + auxiliaryCount }, (_, index) => `<Picture ${index + 1}>`).join(', ')} as distinct visual identity, product, wardrobe, and scene references. Do not merge or duplicate their subjects unless the prompt explicitly asks for it. Do not introduce any character, person, or subject that is not already present in these reference images.`]
      : ['Use <Picture 1> as the sole visual source of truth for this shot. The video is a motion rendering of <Picture 1> only — every person, character, product, object, costume, and environment element in the frame must come from <Picture 1>. Do not introduce any new character, person, or subject that is not already present in <Picture 1>. Do not add, remove, swap, or re-cast people. Dialogue, if any, may only be performed by the characters already visible in <Picture 1>.'];
  if (referenceAudioCount) {
    const bindings = (referenceAudioNames || []).slice(0, referenceAudioCount);
    if (bindings.length === referenceAudioCount && bindings.every(Boolean)) {
      const bindingText = bindings.map((name, i) => `<Audio ${i + 1}> = ${name}`).join(', ');
      rules.push(`Voice-to-character binding: ${bindingText}. Each reference supplies timbre and delivery for its bound character; the written timed dialogue remains the sole spoken wording.`);
    } else {
      rules.push(`Use ${Array.from({ length: referenceAudioCount }, (_, index) => `<Audio ${index + 1}>`).join(', ')} as voice-timbre references; the written timed dialogue is authoritative.`);
    }
  } else {
    rules.push('Follow the written sound fields exactly. With no scripted line, keep natural ambience and visible-action Foley while on-screen faces remain in non-speaking performance.');
  }
  return `${prompt.trim()}\n\nAID INPUT CONTRACT:\n${rules.join('\n')}`;
}

function extensionFromMime(mime: string): string {
  const known: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
    'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/mp4': '.m4a',
    'audio/aac': '.aac', 'audio/flac': '.flac', 'audio/ogg': '.ogg', 'audio/webm': '.webm',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  };
  return known[mime.toLowerCase()] || '';
}

type MaterialSource = string | {
  arrayBuffer(): Promise<ArrayBuffer>;
  type?: string;
  name?: string;
};

async function materializeSource(source: MaterialSource, directory: string, label: string): Promise<string> {
  if (!source) throw new ComfyUIError(`${label} 未提供`);
  const sourcePreview = typeof source === 'string'
    ? `${source.slice(0, 32)}... (len=${source.length})`
    : 'non-string source';
  console.log(`[comfyui] materializeSource ${label}: ${sourcePreview}`);
  let buffer: Buffer;
  let extension = '';
  if (typeof source !== 'string') {
    buffer = Buffer.from(await source.arrayBuffer());
    extension = extensionFromMime(String(source.type || '')) || path.extname(String(source.name || ''));
  } else {
    const dataMatch = source.match(/^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]+)$/);
    if (dataMatch) {
      extension = extensionFromMime(dataMatch[1]);
      buffer = Buffer.from(dataMatch[2], 'base64');
    } else if (/^https?:\/\//i.test(source)) {
      const response = await fetch(source, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new ComfyUIError(`下载 ${label} 失败：${await responseError(response)}`);
      buffer = Buffer.from(await response.arrayBuffer());
      extension = extensionFromMime(response.headers.get('content-type')?.split(';')[0] || '') || path.extname(new URL(source).pathname);
    } else {
      const localPath = path.resolve(expandHome(source));
      buffer = await readFile(localPath);
      extension = path.extname(localPath);
    }
  }
  if (!buffer.length) throw new ComfyUIError(`${label} 内容为空`);
  const safeExtension = /^\.[a-zA-Z0-9]{1,6}$/.test(extension) ? extension.toLowerCase() : '.bin';
  const destination = path.join(directory, `${label.replace(/[^a-zA-Z0-9_-]/g, '_')}-${randomBytes(5).toString('hex')}${safeExtension}`);
  await writeFile(destination, buffer);
  return destination;
}

interface NormalizedAudio {
  path: string;
  duration: number;
}

async function probeReferenceAudio(sourcePath: string, index: number): Promise<number> {
  let duration = 0;
  try {
    const { stdout } = await execFileAsync(process.env.FFPROBE_PATH || 'ffprobe', [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,channels,sample_rate:format=duration',
      '-of', 'json',
      sourcePath,
    ], { timeout: 30_000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
    const probe = JSON.parse(stdout);
    if (!probe.streams?.length) throw new Error('文件中没有音频轨道');
    duration = Number(probe.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取音频时长');
  } catch (error) {
    throw new ComfyUIError(`参考音频 ${index} 无法解析：${error instanceof Error ? error.message : String(error)}`);
  }

  return duration;
}

export function fitH3ReferenceAudioDurations(
  durations: number[],
  totalBudget = H3_REFERENCE_AUDIO_TOTAL_BUDGET_SECONDS,
  minimum = H3_REFERENCE_AUDIO_MIN_SECONDS,
): number[] {
  if (!durations.length) return [];
  if (durations.some(duration => !Number.isFinite(duration) || duration <= 0)) {
    throw new ComfyUIError('MiniMax H3 参考音频时长无效');
  }
  if (durations.length * minimum > totalBudget) {
    throw new ComfyUIError(`参考音频数量过多，无法同时满足每条至少 ${minimum} 秒和总计不超过 ${totalBudget} 秒`);
  }

  const paddedDurations = durations.map(duration => Math.max(duration, minimum));
  const targets = paddedDurations.map(duration => Math.min(duration, minimum));
  let remaining = totalBudget - targets.reduce((total, duration) => total + duration, 0);
  const epsilon = 0.0001;

  while (remaining > epsilon) {
    const expandable = targets
      .map((target, index) => ({ index, capacity: paddedDurations[index] - target }))
      .filter(item => item.capacity > epsilon);
    if (!expandable.length) break;

    const fairShare = remaining / expandable.length;
    let used = 0;
    for (const item of expandable) {
      const increment = Math.min(item.capacity, fairShare);
      targets[item.index] += increment;
      used += increment;
    }
    if (used <= epsilon) break;
    remaining -= used;
  }

  return targets;
}

async function normalizeReferenceAudio(
  sourcePath: string,
  directory: string,
  index: number,
  sourceDuration: number,
  targetDuration: number,
): Promise<NormalizedAudio> {
  if (targetDuration < sourceDuration - 0.01) {
    console.log(`[comfyui] trim reference audio ${index}: ${sourceDuration.toFixed(1)}s -> ${targetDuration.toFixed(1)}s`);
  }

  const outputPath = path.join(directory, `audio_reference_${index}_32k_stereo.wav`);
  try {
    const padFilter = targetDuration > sourceDuration + 0.01 ? ['-af', 'apad'] : [];
    await execFileAsync(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', sourcePath,
      '-map', '0:a:0', '-vn',
      ...padFilter,
      '-ar', '32000', '-ac', '2', '-c:a', 'pcm_s16le',
      '-t', targetDuration.toFixed(3),
      outputPath,
    ], { timeout: 180_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' });
  } catch (error: any) {
    const details = String(error?.stderr || error?.message || error).trim();
    throw new ComfyUIError(`参考音频 ${index} 转换为 32kHz WAV 失败：${details}`);
  }
  return { path: outputPath, duration: targetDuration };
}

async function uploadAsset(config: ComfyUIConfig, localPath: string, subfolder: string): Promise<string> {
  const safeName = `${randomBytes(5).toString('hex')}${path.extname(localPath).toLowerCase()}`;
  const remoteDirectory = `${config.workflowRoot.replace(/\/$/, '')}/input/${subfolder}`;
  await runSsh(config, `mkdir -p -- ${shellQuote(remoteDirectory)}`);
  const remotePath = `${remoteDirectory}/${safeName}`;
  console.log(`[comfyui] uploadAsset: ${localPath} -> ${remotePath}`);
  if (config.sshPrivateKey) {
    const client = await getJsSshClient(config);
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((error, value) => error ? reject(error) : resolve(value));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        sftp.fastPut(localPath, remotePath, error => error ? reject(error) : resolve());
      });
      return `${subfolder}/${safeName}`;
    } catch (error) {
      throw new ComfyUIError(`SFTP 上传失败：${path.basename(localPath)}；${error instanceof Error ? error.message : String(error)}`);
    } finally {
      sftp.end();
    }
  }
  let lastError = '';
  const args = [
    '-q', '-P', String(config.sshPort),
    '-o', 'BatchMode=yes', '-o', `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`,
    '-o', 'ConnectionAttempts=2', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=2',
    ...connectionReuseArgs(config), ...(await identityArgs(config)),
    localPath, `${config.sshUser}@${config.sshHost}:${remotePath}`,
  ];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await execFileAsync('scp', args, { timeout: 600_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' });
      return `${subfolder}/${safeName}`;
    } catch (error: any) {
      lastError = String(error?.stderr || error?.stdout || error?.message || error).trim();
      if (attempt < 2) await delay(1000);
    }
  }
  throw new ComfyUIError(`SCP 上传失败：${path.basename(localPath)}；${lastError || '未知错误'}`);
}

async function fetchJson(baseUrl: string, route: string, init: RequestInit = {}, timeout = 120_000): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${route}`, { ...init, signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    throw new ComfyUIError(
      `ComfyUI API ${route} 请求失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) throw new ComfyUIError(`ComfyUI API ${route} 请求失败：${await responseError(response)}`);
  try {
    return await response.json();
  } catch (error) {
    throw new ComfyUIError(
      `ComfyUI API ${route} 返回了不完整 JSON：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const characterReplacePromptCache = new Map<string, JsonRecord>();

async function readCharacterReplacePrompt(config: ComfyUIConfig): Promise<JsonRecord> {
  const workflowPath = config.characterReplaceWorkflowPath;
  const cacheKey = [config.sshHost, config.sshPort, config.sshUser, workflowPath].join('|');
  const cached = characterReplacePromptCache.get(cacheKey);
  if (cached) return cloneJson(cached);
  const encoded = await runSsh(config, `gzip -c -- ${shellQuote(workflowPath)} | base64`);
  try {
    const prompt = JSON.parse(gunzipSync(Buffer.from(encoded.replace(/\s/g, ''), 'base64')).toString('utf8'));
    if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt) || !prompt['213:114'] || !prompt['202']) {
      throw new Error('missing SCAIL2 nodes');
    }
    characterReplacePromptCache.set(cacheKey, cloneJson(prompt));
    return prompt;
  } catch (error) {
    throw new ComfyUIError(
      `云端换人物 API 工作流无效：${workflowPath}（${error instanceof Error ? error.message : String(error)}）`,
    );
  }
}

function clampSCAIL2Size(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = longest > 896 ? 896 / longest : 1;
  return {
    width: Math.max(32, Math.floor(width * scale / 32) * 32),
    height: Math.max(32, Math.floor(height * scale / 32) * 32),
  };
}

function validSCAIL2FrameCount(value: number): number {
  const bounded = Math.min(81, Math.max(1, Math.floor(value)));
  return bounded - ((bounded - 1) % 4);
}

function validSCAIL2TotalFrameCount(value: number): number {
  const bounded = Math.max(1, Math.floor(value));
  return bounded - ((bounded - 1) % 4);
}

function segmentSCAIL2Frames(totalFrames: number): number[] {
  const totalSegmentCount = totalFrames <= 81 ? 1 : 1 + Math.ceil((totalFrames - 81) / 76);
  return Array.from(
    { length: totalSegmentCount },
    (_, index) => Math.min(81, totalFrames - index * 76),
  );
}

export function getSCAIL2SegmentFrames(sourceFrames: number): number[] {
  return segmentSCAIL2Frames(validSCAIL2TotalFrameCount(sourceFrames));
}

interface RemoteVideoInfo {
  width: number;
  height: number;
  frames: number;
  fps: number;
  duration: number;
}

async function probeRemoteVideo(config: ComfyUIConfig, relativePath: string): Promise<RemoteVideoInfo> {
  const absolutePath = `${config.workflowRoot.replace(/\/$/, '')}/input/${relativePath}`;
  const output = await runSsh(
    config,
    `ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=width,height,avg_frame_rate,nb_read_frames,nb_frames,duration -of json -- ${shellQuote(absolutePath)}`,
  );
  try {
    const stream = JSON.parse(output).streams?.[0] || {};
    const [numerator, denominator] = String(stream.avg_frame_rate || '0/1').split('/').map(Number);
    const fps = denominator ? numerator / denominator : 0;
    const duration = Number(stream.duration) || 0;
    const frames = Number(stream.nb_read_frames || stream.nb_frames) || Math.floor(duration * fps);
    const info = { width: Number(stream.width), height: Number(stream.height), frames, fps, duration };
    if (!info.width || !info.height || !info.frames || !info.fps) throw new Error('missing video metadata');
    return info;
  } catch (error) {
    throw new ComfyUIError(`无法读取驱动视频参数：${error instanceof Error ? error.message : String(error)}`);
  }
}

function requirePromptNode(prompt: JsonRecord, id: string): JsonRecord {
  const node = prompt[id];
  if (!node?.inputs) throw new ComfyUIError(`换人物工作流缺少节点 ${id}`);
  return node;
}

export async function createComfyUICharacterReplaceTask(input: {
  drivingVideo: MaterialSource;
  referenceImage: MaterialSource;
  productReferenceImage?: MaterialSource;
  prompt: string;
  videoSubject?: string;
  referenceSubject?: string;
  productMode?: 'preserve' | 'replace' | 'none';
  productSubject?: string;
  productReferenceSubject?: string;
  frameCount?: number | 'auto' | 'full';
  seed?: number;
  settings?: ComfyUIClientSettings;
}): Promise<{
  taskId: string;
  promptId?: string;
  workflowPath: string;
  parameters: { width: number; height: number; frameCount: number; sourceFrames: number; fps: number; duration: number; totalSegments: number; productMode?: string };
}> {
  const config = getComfyUIConfig(input.settings);
  try {
    if (!config.sshHost) throw new ComfyUIError('ComfyUI SSH Host 未配置');
    if (!input.drivingVideo || !input.referenceImage || !input.prompt.trim()) {
      throw new ComfyUIError('驱动视频、替换人物图和替换描述均为必填项');
    }
    const productMode = ['preserve', 'replace', 'none'].includes(String(input.productMode))
      ? input.productMode as 'preserve' | 'replace' | 'none'
      : 'replace';
    const productSubject = String(input.productSubject || '').trim();
    if (productMode !== 'none' && !productSubject) {
      throw new ComfyUIError('保留或替换产品时，请填写原视频产品检测词');
    }
    if (productMode === 'replace' && !input.productReferenceImage) {
      throw new ComfyUIError('同时替换产品时，请上传单独的产品参考图');
    }
    const runId = randomBytes(6).toString('hex');
    const subfolder = `aid/character_replace/${runId}`;
    const directory = await mkdtemp(path.join(tmpdir(), 'aid-scail2-'));
    try {
      const localVideo = await materializeSource(input.drivingVideo, directory, 'driving_video');
      const localImage = await materializeSource(input.referenceImage, directory, 'reference_character');
      const localProductImage = input.productReferenceImage
        ? await materializeSource(input.productReferenceImage, directory, 'reference_product')
        : '';
      const remoteVideo = await uploadAsset(config, localVideo, subfolder);
      const remoteImage = await uploadAsset(config, localImage, subfolder);
      const remoteProductImage = localProductImage ? await uploadAsset(config, localProductImage, subfolder) : '';
      const source = await probeRemoteVideo(config, remoteVideo);
      const size = clampSCAIL2Size(source.width, source.height);
      // The 81-frame limit applies to one SCAIL2 segment, not to the source
      // video. Normalise the complete source to 4n+1 before splitting it.
      const availableFrames = validSCAIL2TotalFrameCount(source.frames);
      if (availableFrames < 17) throw new ComfyUIError('驱动视频至少需要 17 帧');
      const wantsFullVideo = input.frameCount === 'auto' || input.frameCount === 'full' || !input.frameCount;
      const requestedFrames = wantsFullVideo ? availableFrames : validSCAIL2FrameCount(Number(input.frameCount));
      if (!wantsFullVideo && !SCAIL2_FRAME_COUNTS.includes(requestedFrames as typeof SCAIL2_FRAME_COUNTS[number])) {
        throw new ComfyUIError(`处理帧数必须是完整视频或 ${SCAIL2_FRAME_COUNTS.join('、')} 之一`);
      }
      const frameCount = Math.min(requestedFrames, availableFrames);
      const segmentFrames = segmentSCAIL2Frames(frameCount);
      const totalSegments = segmentFrames.length;
      if (wantsFullVideo && source.frames > 81 && totalSegments < 2) {
        throw new ComfyUIError(`长视频分段计算失败：源视频 ${source.frames} 帧却只得到 ${totalSegments} 段`);
      }

      const useBackgroundRunner = wantsFullVideo || productMode !== 'none';
      if (useBackgroundRunner) {
        const outputDirectory = `${config.workflowRoot.replace(/\/$/, '')}/output/${subfolder}`;
        const inputDirectory = `${config.workflowRoot.replace(/\/$/, '')}/input`;
        const runnerPath = path.join(process.cwd(), 'scripts', 'aid_scail2_long_runner.py');
        try {
          await access(runnerPath, fsConstants.R_OK);
        } catch {
          throw new ComfyUIError('AID 长视频分段执行器不存在，请重新安装或构建本地 Companion');
        }
        const runnerRemote = await uploadAsset(config, runnerPath, subfolder);
        const seed = Number.isFinite(input.seed)
          ? Math.max(0, Math.floor(Number(input.seed)))
          : Number(BigInt(`0x${randomBytes(7).toString('hex')}`));
        const runnerConfigPath = path.join(directory, 'long-video-config.json');
        const runnerConfig = {
          run_id: runId,
          comfy_root: config.workflowRoot.replace(/\/$/, ''),
          comfy_url: `http://127.0.0.1:${config.comfyPort}`,
          source_file: remoteVideo,
          reference_file: remoteImage,
          input_subfolder: subfolder,
          output_prefix: subfolder,
          width: size.width,
          height: size.height,
          seed,
          prompt: input.prompt.trim(),
          video_subject: String(input.videoSubject || 'person').trim() || 'person',
          reference_subject: String(input.referenceSubject || 'person').trim() || 'person',
          product_mode: productMode,
          product_subject: productSubject,
          product_reference_file: remoteProductImage,
          product_reference_subject: String(input.productReferenceSubject || productSubject).trim() || productSubject,
          segment_frames: segmentFrames,
          source_frames: source.frames,
          target_frames: frameCount,
          requested_mode: wantsFullVideo ? 'full' : 'fixed',
          base_template: config.characterReplaceWorkflowPath,
          status_path: `${outputDirectory}/status.json`,
          final_path: `${outputDirectory}/final.mp4`,
        };
        await writeFile(runnerConfigPath, JSON.stringify(runnerConfig), 'utf8');
        const configRemote = await uploadAsset(config, runnerConfigPath, subfolder);
        const runnerAbsolute = `${inputDirectory}/${runnerRemote}`;
        const configAbsolute = `${inputDirectory}/${configRemote}`;
        await runSsh(
          config,
          `mkdir -p -- ${shellQuote(outputDirectory)}; setsid -f python3 ${shellQuote(runnerAbsolute)} ${shellQuote(configAbsolute)} > ${shellQuote(`${outputDirectory}/runner.log`)} 2>&1 < /dev/null; printf '%s' started`,
        );
        return {
          taskId: `${COMFYUI_LONG_TASK_PREFIX}${runId}`,
          workflowPath: config.characterReplaceWorkflowPath,
          parameters: {
            ...size,
            frameCount,
            sourceFrames: source.frames,
            fps: source.fps,
            duration: frameCount / source.fps,
            totalSegments,
            productMode,
          },
        };
      }
      const prompt = await readCharacterReplacePrompt(config);
      requirePromptNode(prompt, '155').inputs.file = remoteVideo;
      requirePromptNode(prompt, '30').inputs.image = remoteImage;
      requirePromptNode(prompt, '213:3').inputs.text = input.prompt.trim();
      requirePromptNode(prompt, '213:191').inputs.text = String(input.videoSubject || 'person').trim() || 'person';
      requirePromptNode(prompt, '213:212').inputs.text = String(input.referenceSubject || 'person').trim() || 'person';
      requirePromptNode(prompt, '213:177').inputs.length = frameCount;
      requirePromptNode(prompt, '213:178').inputs.value = size.width;
      requirePromptNode(prompt, '213:179').inputs.value = size.height;
      requirePromptNode(prompt, '213:183').inputs.value = 1;
      requirePromptNode(prompt, '213:203').inputs.value = true;
      requirePromptNode(prompt, '213:19').inputs.noise_seed = Number.isFinite(input.seed)
        ? Math.max(0, Math.floor(Number(input.seed)))
        : Number(BigInt(`0x${randomBytes(7).toString('hex')}`));
      requirePromptNode(prompt, '202').inputs.filename_prefix = `aid/character_replace/${runId}/result`;

      const promptId = await withTunnel(config, async baseUrl => {
        const definitions = await readRemoteDefinitions(config);
        validatePrompt(prompt, definitions);
        const response = await fetchJson(baseUrl, '/prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, client_id: `aid-scail2-${runId}` }),
        });
        const submittedId = String(response.prompt_id || '').trim();
        if (!submittedId) throw new ComfyUIError('ComfyUI 提交响应没有 prompt_id');
        return submittedId;
      });
      return {
        taskId: `${COMFYUI_TASK_PREFIX}${promptId}`,
        promptId,
        workflowPath: config.characterReplaceWorkflowPath,
        parameters: {
          ...size,
          frameCount,
          sourceFrames: source.frames,
          fps: source.fps,
          duration: frameCount / source.fps,
          totalSegments: 1,
        },
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } finally {
    await cleanupPrivateKey(config);
  }
}

export async function createComfyUIVideoTask(input: {
  firstFrame: string;
  prompt: string;
  duration: number;
  aspectRatio: string;
  auxiliaryImages?: string[];
  endFrame?: string;
  referenceAudios?: string[];
  referenceAudioNames?: string[];
  speechTurns?: H3NativeDialogueTurn[];
  language?: 'zh' | 'en';
  settings?: ComfyUIClientSettings;
}): Promise<{ taskId: string; promptId: string; workflow: ComfyUIWorkflow; workflowPath: string; prompt: string }> {
  const config = getComfyUIConfig(input.settings);
  try {
    if (!config.sshHost) throw new ComfyUIError('ComfyUI SSH Host 未配置');

    const auxiliaryImages = (input.auxiliaryImages || []).filter(Boolean);
    const referenceAudios = (input.referenceAudios || []).filter(Boolean);
    const renderDuration = Math.min(15, Math.max(2, Number(input.duration) || 5));
    const alignedRenderDuration = h3AlignedDurationSeconds(renderDuration);
    if (1 + auxiliaryImages.length > MAX_COMFYUI_REFERENCE_IMAGES) {
      throw new ComfyUIError(`MiniMax H3 多图参考在 AID 中最多使用 ${MAX_COMFYUI_REFERENCE_IMAGES} 张图片`);
    }
    if (referenceAudios.length > 3) throw new ComfyUIError('MiniMax H3 最多接受 3 条参考音频');
    const variant = selectComfyUIWorkflow({ auxiliaryImages, endFrame: input.endFrame });
    const { workflow, path: workflowPath } = await readRemoteWorkflow(config, variant);
    const runId = randomBytes(6).toString('hex');
    const subfolder = `aid/${variant}/${runId}`;
    const directory = await mkdtemp(path.join(tmpdir(), 'aid-comfy-'));
    try {
      const imageSources = [input.firstFrame, ...(input.endFrame ? [input.endFrame] : auxiliaryImages)];
      const localImages = await Promise.all(imageSources.map((source, index) => materializeSource(source, directory, `reference_${index + 1}`)));
      const sourceAudios = await Promise.all(referenceAudios.map((source, index) => materializeSource(source, directory, `audio_reference_${index + 1}`)));
      const sourceAudioDurations = await Promise.all(sourceAudios.map((source, index) => probeReferenceAudio(source, index + 1)));
      const targetAudioDurations = fitH3ReferenceAudioDurations(sourceAudioDurations);
      const normalizedAudios = await Promise.all(sourceAudios.map((source, index) => normalizeReferenceAudio(
        source,
        directory,
        index + 1,
        sourceAudioDurations[index],
        targetAudioDurations[index],
      )));
      const totalSourceAudioDuration = sourceAudioDurations.reduce((total, duration) => total + duration, 0);
      const totalTargetAudioDuration = targetAudioDurations.reduce((total, duration) => total + duration, 0);
      if (totalTargetAudioDuration < totalSourceAudioDuration - 0.01) {
        console.log(`[comfyui] fit ${sourceAudios.length} reference audios: ${totalSourceAudioDuration.toFixed(1)}s -> ${totalTargetAudioDuration.toFixed(1)}s total (H3 safe budget)`);
      }
      const localAudios = normalizedAudios.map(audio => audio.path);

      const remoteImages: string[] = [];
      for (const image of localImages) remoteImages.push(await uploadAsset(config, image, subfolder));
      const remoteAudios: string[] = [];
      for (const audio of localAudios) remoteAudios.push(await uploadAsset(config, audio, subfolder));

      const finalPrompt = taggedPrompt(
        input.prompt,
        variant,
        variant === 'aid_multi_reference' ? auxiliaryImages.length : 0,
        referenceAudios.length,
        input.referenceAudioNames,
      );
      patchWorkflow(workflow, {
        variant,
        imageRefs: remoteImages,
        prompt: finalPrompt,
        duration: renderDuration,
        aspectRatio: input.aspectRatio || '9:16',
        seed: Number(BigInt(`0x${randomBytes(7).toString('hex')}`)),
        outputPrefix: `aid/${variant}/${runId}`,
      });
      const apiPrompt = compileFrontendWorkflow(workflow);
      injectReferenceImages(apiPrompt, variant, remoteImages);
      const usesNativeDialogue = injectH3NativeDialogue(
        apiPrompt,
        remoteAudios,
        input.referenceAudioNames || [],
        input.speechTurns || [],
        alignedRenderDuration,
        input.language === 'en' ? 'en' : 'zh',
      );
      if (!usesNativeDialogue) injectReferenceAudios(apiPrompt, remoteAudios);

      const promptId = await withTunnel(config, async baseUrl => {
        const definitions = await readRemoteDefinitions(config);
        validatePrompt(apiPrompt, definitions);
        const response = await fetchJson(baseUrl, '/prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: apiPrompt, client_id: `aid-${runId}` }),
        });
        const submittedId = String(response.prompt_id || '').trim();
        if (!submittedId) throw new ComfyUIError(`ComfyUI 提交响应没有 prompt_id：${JSON.stringify(response).slice(0, 1000)}`);
        return submittedId;
      });
      return { taskId: `${COMFYUI_TASK_PREFIX}${promptId}`, promptId, workflow: variant, workflowPath, prompt: finalPrompt };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } finally {
    await cleanupPrivateKey(config);
  }
}

function zImageDimensions(aspectRatio: string): { width: number; height: number } {
  if (aspectRatio === '9:16') return { width: 768, height: 1344 };
  if (aspectRatio === '16:9') return { width: 1344, height: 768 };
  if (aspectRatio === '4:3') return { width: 1152, height: 864 };
  return { width: 1024, height: 1024 };
}

function zImageApiPrompt(input: {
  prompt: string;
  width: number;
  height: number;
  seed: number;
  outputPrefix: string;
}): JsonRecord {
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: 'z_image_turbo_bf16.safetensors', weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_4b.safetensors', type: 'lumina2', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: input.prompt, clip: ['2', 0] } },
    '5': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } },
    '6': { class_type: 'EmptySD3LatentImage', inputs: { width: input.width, height: input.height, batch_size: 1 } },
    '7': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3 } },
    '8': {
      class_type: 'KSampler',
      inputs: {
        model: ['7', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0],
        seed: input.seed, steps: 8, cfg: 1, sampler_name: 'res_multistep', scheduler: 'simple', denoise: 1,
      },
    },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: input.outputPrefix } },
  };
}

export async function createComfyUIImageTask(input: {
  prompt: string;
  aspectRatio?: string;
  seed?: number;
  settings?: ComfyUIClientSettings;
}): Promise<{ taskId: string; promptId: string; width: number; height: number }> {
  const config = getComfyUIConfig(input.settings);
  try {
    if (!config.sshHost) throw new ComfyUIError('ComfyUI SSH Host 未配置');
    const promptText = String(input.prompt || '').trim();
    if (!promptText) throw new ComfyUIError('Z-Image-Turbo 提示词不能为空');
    const { width, height } = zImageDimensions(input.aspectRatio || '1:1');
    const runId = randomBytes(6).toString('hex');
    const seed = Number.isFinite(input.seed)
      ? Math.max(0, Math.floor(Number(input.seed)))
      : Number(BigInt(`0x${randomBytes(7).toString('hex')}`));
    const prompt = zImageApiPrompt({
      prompt: promptText,
      width,
      height,
      seed,
      outputPrefix: `aid/z_image/${runId}/result`,
    });
    const promptId = await withTunnel(config, async baseUrl => {
      const definitions = await readRemoteDefinitions(config);
      validatePrompt(prompt, definitions);
      const response = await fetchJson(baseUrl, '/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, client_id: `aid-zimage-${runId}` }),
      });
      const submittedId = String(response.prompt_id || '').trim();
      if (!submittedId) throw new ComfyUIError('ComfyUI 提交响应没有 prompt_id');
      return submittedId;
    });
    return { taskId: `${COMFYUI_IMAGE_TASK_PREFIX}${promptId}`, promptId, width, height };
  } finally {
    await cleanupPrivateKey(config);
  }
}

interface ComfyOutputRef { filename: string; subfolder: string; type: string }

function historyApiPrompt(item: JsonRecord | undefined): JsonRecord {
  const candidate = Array.isArray(item?.prompt) ? item.prompt[2] : undefined;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as JsonRecord
    : {};
}

function comfyUIExecutionError(messages: unknown, apiPrompt: JsonRecord = {}): string {
  if (Array.isArray(messages)) {
    for (const message of messages) {
      if (!Array.isArray(message) || message[0] !== 'execution_error') continue;
      const details = message[1] as JsonRecord | undefined;
      const node = details?.node_type || details?.node_id;
      const exception = details?.exception_message || details?.exception_type;
      if (exception) {
        const nodeId = String(details?.node_id || '');
        const nodeDefinition = apiPrompt[nodeId];
        const rawException = String(exception);
        const speechMetrics = rawException.match(
          /speech verification failed:\s*text_similarity=([0-9.]+),\s*speaker_similarity=([0-9.]+)/i,
        );
        if (
          details?.node_type === 'MiniMaxH3SpeechVerifyT8'
          && speechMetrics
          && nodeDefinition?.inputs?.speaker_check_mode === 'off'
        ) {
          const threshold = Number(nodeDefinition.inputs.min_similarity);
          const thresholdLabel = Number.isFinite(threshold) ? threshold.toFixed(3) : '配置值';
          return `MiniMaxH3SpeechVerifyT8: 台词 ASR 校验失败：文本相似度 ${speechMetrics[1]}，要求至少 ${thresholdLabel}；音色相似度未启用（原始 0.000 不是音色不匹配）`;
        }
        return `${node ? `${node}: ` : ''}${rawException}`;
      }
    }
  }
  return JSON.stringify(messages || []).slice(0, 3000);
}

function collectFileRefs(value: unknown): ComfyOutputRef[] {
  if (Array.isArray(value)) return value.flatMap(collectFileRefs);
  if (!value || typeof value !== 'object') return [];
  const record = value as JsonRecord;
  if ('filename' in record) return [{ filename: String(record.filename), subfolder: String(record.subfolder || ''), type: String(record.type || 'output') }];
  return Object.values(record).flatMap(collectFileRefs);
}

const IMAGE_SUFFIXES = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export async function getComfyUIImageStatus(taskId: string, settings: ComfyUIClientSettings = {}): Promise<{
  status: 'processing' | 'completed' | 'failed';
  error?: string;
  output?: ComfyOutputRef;
}> {
  const promptId = unwrapComfyUIImageTaskId(taskId);
  const config = getComfyUIConfig(settings);
  try {
    return await withTunnel(config, async baseUrl => {
      const history = await fetchJson(baseUrl, `/history/${encodeURIComponent(promptId)}`, {}, 30_000);
      const item = history[promptId];
      if (!item) return { status: 'processing' as const };
      const status = item.status || {};
      if (status.status_str === 'error') {
        return {
          status: 'failed' as const,
          error: `ComfyUI 执行失败：${comfyUIExecutionError(status.messages, historyApiPrompt(item))}`,
        };
      }
      const output = collectFileRefs(item.outputs || {}).find(ref => IMAGE_SUFFIXES.has(path.extname(ref.filename).toLowerCase()));
      if (!output) return { status: 'failed' as const, error: 'Z-Image-Turbo 已结束但没有返回图片文件' };
      return { status: 'completed' as const, output };
    });
  } finally {
    await cleanupPrivateKey(config);
  }
}

export async function downloadComfyUIImageOutput(
  taskId: string,
  output: ComfyOutputRef,
  settings: ComfyUIClientSettings = {},
): Promise<Buffer> {
  unwrapComfyUIImageTaskId(taskId);
  const config = getComfyUIConfig(settings);
  try {
    return await withTunnel(config, async baseUrl => {
      const params = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder, type: output.type });
      const response = await fetch(`${baseUrl}/view?${params}`, { signal: AbortSignal.timeout(300_000) });
      if (!response.ok) throw new ComfyUIError(`ComfyUI 图片下载失败：${await responseError(response)}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) throw new ComfyUIError('ComfyUI 图片下载结果为空');
      return buffer;
    });
  } finally {
    await cleanupPrivateKey(config);
  }
}

export function selectComfyUIVideoOutput(value: unknown): ComfyOutputRef | undefined {
  const videos = collectFileRefs(value)
    .filter(ref => VIDEO_SUFFIXES.has(path.extname(ref.filename).toLowerCase()));
  // VHS_VideoCombine can report both its temporary video-only MP4 and the
  // final muxed `-audio.mp4`. ComfyUI does not guarantee their array order, so
  // taking the first video silently drops the entire soundtrack.
  return videos.sort((left, right) => {
    const audioRank = (ref: ComfyOutputRef) => /-audio\.[^.]+$/i.test(ref.filename) ? 0 : 1;
    return audioRank(left) - audioRank(right);
  })[0];
}

export function comfyUIQueueContainsPrompt(value: unknown, promptId: string): boolean {
  if (!value || typeof value !== 'object' || !promptId) return false;
  const queue = value as JsonRecord;
  const entries = [queue.queue_running, queue.queue_pending]
    .flatMap(group => Array.isArray(group) ? group : []);
  return entries.some(entry => {
    if (Array.isArray(entry)) return String(entry[1] || '') === promptId;
    if (entry && typeof entry === 'object') {
      const record = entry as JsonRecord;
      return String(record.prompt_id || record.promptId || '') === promptId;
    }
    return false;
  });
}

export async function getComfyUIVideoStatus(taskId: string, settings: ComfyUIClientSettings = {}): Promise<{
  status: 'processing' | 'completed' | 'failed';
  error?: string;
  output?: ComfyOutputRef;
  stage?: string;
  progress?: number;
  currentSegment?: number;
  completedSegments?: number;
  totalSegments?: number;
}> {
  const promptId = unwrapComfyUITaskId(taskId);
  const config = getComfyUIConfig(settings);
  try {
    if (!config.sshHost) throw new ComfyUIError('ComfyUI SSH Host 未配置');
    if (String(taskId).startsWith(COMFYUI_LONG_TASK_PREFIX)) {
      const statusPath = `${config.workflowRoot.replace(/\/$/, '')}/output/aid/character_replace/${promptId}/status.json`;
      const raw = await runSsh(
        config,
        `if [ -f ${shellQuote(statusPath)} ]; then cat -- ${shellQuote(statusPath)}; else printf '%s' '{"status":"processing","stage":"starting","progress":0}'; fi`,
      );
      let status: JsonRecord;
      try {
        status = JSON.parse(raw);
      } catch {
        throw new ComfyUIError('长视频任务状态文件损坏');
      }
      return {
        status: status.status === 'completed' ? 'completed' : status.status === 'failed' ? 'failed' : 'processing',
        error: status.error ? String(status.error) : undefined,
        output: status.output,
        stage: String(status.stage || 'processing'),
        progress: Number(status.progress || 0),
        currentSegment: Number(status.currentSegment || 0),
        completedSegments: Number(status.completedSegments || 0),
        totalSegments: Number(status.totalSegments || 0),
      };
    }
    return await withTunnel(config, async baseUrl => {
      const history = await fetchJson(baseUrl, `/history/${encodeURIComponent(promptId)}`, {}, 30_000);
      const item = history[promptId];
      if (!item) {
        // A persisted id is recoverable only while it exists in ComfyUI's
        // queue or history. Previously a missing id was reported as processing
        // forever, leaving Story locked even though the backend had no job.
        const queue = await fetchJson(baseUrl, '/queue', {}, 30_000);
        return comfyUIQueueContainsPrompt(queue, promptId)
          ? { status: 'processing' as const }
          : { status: 'failed' as const, error: 'ComfyUI 中未找到该任务；已解除生成锁，请重新提交' };
      }
      const status = item.status || {};
      if (status.status_str === 'error') {
        return {
          status: 'failed' as const,
          error: `ComfyUI 执行失败：${comfyUIExecutionError(status.messages, historyApiPrompt(item))}`,
        };
      }
      const output = selectComfyUIVideoOutput(item.outputs || {});
      if (!output) return { status: 'failed' as const, error: 'ComfyUI 任务完成但没有返回视频文件' };
      return { status: 'completed' as const, output };
    });
  } finally {
    await cleanupPrivateKey(config);
  }
}

export async function downloadComfyUIOutput(taskId: string, output: ComfyOutputRef, settings: ComfyUIClientSettings = {}): Promise<Buffer> {
  const promptId = unwrapComfyUITaskId(taskId);
  const config = getComfyUIConfig(settings);
  try {
    if (String(taskId).startsWith(COMFYUI_LONG_TASK_PREFIX)) {
      const safeFilename = path.basename(String(output.filename || 'final.mp4'));
      const expectedSubfolder = `aid/character_replace/${promptId}`;
      if (String(output.subfolder || '') !== expectedSubfolder || !VIDEO_SUFFIXES.has(path.extname(safeFilename).toLowerCase())) {
        throw new ComfyUIError('长视频输出路径无效');
      }
      const remotePath = `${config.workflowRoot.replace(/\/$/, '')}/output/${expectedSubfolder}/${safeFilename}`;
      return await downloadRemoteFileInChunks(config, remotePath);
    }
    return await withTunnel(config, async baseUrl => {
      const params = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder, type: output.type });
      const response = await fetch(`${baseUrl}/view?${params}`, { signal: AbortSignal.timeout(300_000) });
      if (!response.ok) throw new ComfyUIError(`ComfyUI 视频下载失败：${await responseError(response)}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) throw new ComfyUIError('ComfyUI 视频下载结果为空');
      return buffer;
    });
  } finally {
    await cleanupPrivateKey(config);
  }
}

export async function testComfyUIConnection(settings: ComfyUIClientSettings = {}): Promise<JsonRecord> {
  const config = getComfyUIConfig(settings);
  const stage = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (error) {
      throw new ComfyUIError(`${name}失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  try {
    if (!config.sshHost) throw new ComfyUIError('ComfyUI SSH Host 未配置');
    const sshProbe = await stage('验证 Companion 设备密钥', () => probeSshAuthorization(config));
    if (sshProbe !== 'AID_SSH_READY') throw new ComfyUIError('SSH 已连接但没有返回预期响应');
    const workflows: Record<string, JsonRecord> = {};
    const prompts: Array<{ variant: ComfyUIWorkflow; prompt: JsonRecord; workflowPath: string; baseReferenceImages: number }> = [];
    for (const variant of ['aid_single_reference', 'aid_multi_reference', 'aid_first_last'] as ComfyUIWorkflow[]) {
      const { workflow, path: workflowPath } = await stage(
        `读取 ${variant} 工作流`,
        () => readRemoteWorkflow(config, variant),
      );
      const apiPrompt = compileFrontendWorkflow(workflow);
      const baseReferenceImages = Object.keys(conditioningNode(apiPrompt).inputs)
        .filter(key => key.startsWith('ref_images.ref_image_')).length;
      if (variant === 'aid_multi_reference') {
        injectReferenceImages(
          apiPrompt,
          variant,
          Array.from({ length: MAX_COMFYUI_REFERENCE_IMAGES }, (_, index) => `aid-validation/reference-${index + 1}.png`),
        );
      }
      injectReferenceAudios(apiPrompt, []);
      prompts.push({ variant, prompt: apiPrompt, workflowPath, baseReferenceImages });
    }
    const { stats, h3Definition } = await stage('检查 ComfyUI API', () => withTunnel(config, async baseUrl => ({
      stats: await fetchJson(baseUrl, '/system_stats', {}, 30_000),
      h3Definition: await fetchJson(baseUrl, '/object_info/MiniMaxH3AudioConditioningT8', {}, 30_000),
    })));
    for (const { variant, prompt: apiPrompt, workflowPath, baseReferenceImages } of prompts) {
      const h3Inputs = conditioningNode(apiPrompt).inputs;
      workflows[variant] = {
        path: workflowPath,
        taskType: h3Inputs.task_type,
        audioMode: h3Inputs.audio_mode,
        referenceImages: baseReferenceImages,
        validatedReferenceImages: Object.keys(h3Inputs).filter(key => key.startsWith('ref_images.ref_image_')).length,
        hasFirstFrame: Boolean(h3Inputs.first_frame),
        hasLastFrame: Boolean(h3Inputs.last_frame),
      };
    }
    const remoteRefImageMax = Number(
      h3Definition.MiniMaxH3AudioConditioningT8?.input?.optional?.ref_images?.[1]?.template?.max || 0,
    );
    return {
      ok: true,
      scope: 'story-video',
      ssh: 'authorized',
      version: stats.system?.comfyui_version || 'connected',
      workflows,
      referenceImages: {
        remoteMax: remoteRefImageMax,
        aidMax: Math.min(MAX_COMFYUI_REFERENCE_IMAGES, remoteRefImageMax || MAX_COMFYUI_REFERENCE_IMAGES),
      },
    };
  } finally {
    await cleanupPrivateKey(config);
  }
}
