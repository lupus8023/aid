import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { generateFishSpeech } from './fishAudio';
import { ensureCloudinaryUploadReady, uploadBufferToCloudinary } from './cloudinaryUpload';
import { VOICE_REFERENCE_CONTRACT_VERSION, voiceReferenceSample } from './voiceReference';
import { verifyFishVoiceLanguage, type VoiceLanguageCheck } from './voiceLanguageCheck';

export class VoiceReferenceError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
interface Input { voiceId: string; fishAudioKey: string; language: 'zh' | 'en'; strictVoice: boolean; verifyLanguage?: boolean }
interface Cached { audio: string; voiceId: string; url?: string; duration?: number; languageCheck?: VoiceLanguageCheck }
interface Dependencies {
  root: string;
  ready: typeof ensureCloudinaryUploadReady;
  synthesize: typeof generateFishSpeech;
  upload: typeof uploadBufferToCloudinary;
  verify?: typeof verifyFishVoiceLanguage;
}

// A service instance coalesces concurrent requests; the atomic disk checkpoint
// survives service/app restarts, including upload failures after paid synthesis.
export function createVoiceReferenceService(deps: Dependencies) {
  type Result = { url: string; voiceId: string; duration: number; languageCheck?: VoiceLanguageCheck };
  const pending = new Map<string, Promise<Result>>();
  return async function run(input: Input): Promise<Result> {
    const sample = voiceReferenceSample(input.language);
    const id = createHash('sha256').update(JSON.stringify([input.fishAudioKey, input.voiceId, input.strictVoice, VOICE_REFERENCE_CONTRACT_VERSION, sample])).digest('hex');
    if (pending.has(id)) { await pending.get(id); return run(input); }
    const operation = (async () => {
      const filename = path.join(deps.root, `${id}.json`);
      let cached: Cached | undefined;
      const save = async () => {
        const temporary = `${filename}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(cached), { mode: 0o600 });
        await rename(temporary, filename);
      };
      try {
        await mkdir(deps.root, { recursive: true, mode: 0o700 });
        try { cached = JSON.parse(await readFile(filename, 'utf8')); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (cached && (!cached.voiceId || !cached.audio || Buffer.from(cached.audio, 'base64').length < 1000)) throw new Error('已保存试音损坏；已停止，避免重复生成');
        if (cached?.url && (!input.verifyLanguage || cached.languageCheck?.passed)) return { url: cached.url, duration: cached.duration || 0, voiceId: cached.voiceId, languageCheck: cached.languageCheck };
        if (!cached?.url) await deps.ready();
      } catch (error) {
        throw new VoiceReferenceError('VOICE_STORAGE_FAILED', `试音保存通道不可用：${error instanceof Error ? error.message : '存储错误'}。未提交新的试读。`);
      }
      if (!cached) {
        let speech;
        try {
          speech = await deps.synthesize(sample, input.voiceId, input.fishAudioKey, { strictVoice: input.strictVoice });
          if (speech.buffer.length < 1000) throw new Error('音色试读返回内容过短，未通过可用性检查');
        } catch (error) {
          const message = error instanceof Error ? error.message : '合成失败';
          // Only a positively identified unusable voice permits trying another
          // candidate. Auth, quota, timeouts and ambiguous transport errors stop.
          const unavailable = /reference\s+not\s+found|音色试读返回内容过短/i.test(message);
          throw new VoiceReferenceError(unavailable ? 'VOICE_UNAVAILABLE' : 'VOICE_SYNTHESIS_FAILED', message);
        }
        cached = { audio: speech.buffer.toString('base64'), voiceId: speech.voiceId };
        try { await save(); }
        catch { throw new VoiceReferenceError('VOICE_STORAGE_FAILED', '试读已合成，但本地磁盘无法保存；请检查磁盘空间与权限，避免反复重试。'); }
      }
      if (input.verifyLanguage) {
        if (!cached.languageCheck) {
          try {
            if (!deps.verify) throw new Error('当前服务不支持跨语言试音校验，请更新Companion');
            cached.languageCheck = await deps.verify(Buffer.from(cached.audio, 'base64'), input.language, input.fishAudioKey);
            await save();
          } catch (error) {
            throw new VoiceReferenceError('VOICE_VERIFICATION_FAILED', error instanceof Error ? error.message : '试音校验失败；已保留音频');
          }
        }
        if (!cached.languageCheck.passed) throw new VoiceReferenceError('VOICE_UNAVAILABLE', cached.languageCheck.reason);
      }
      if (cached.url) return { url: cached.url, duration: cached.duration || 0, voiceId: cached.voiceId, languageCheck: cached.languageCheck };
      try {
        const result = await deps.upload(Buffer.from(cached.audio, 'base64'), {
          folder: 'aid-voice-refs', resource_type: 'video',
          public_id: `voice-ref-${VOICE_REFERENCE_CONTRACT_VERSION}-${id}`, overwrite: false,
        });
        if (!result.secure_url?.startsWith('https://')) throw new Error('未返回有效的试音地址');
        cached.url = result.secure_url; cached.duration = result.duration || 0;
        await save();
        return { url: cached.url, duration: cached.duration || 0, voiceId: cached.voiceId, languageCheck: cached.languageCheck };
      } catch (error) {
        throw new VoiceReferenceError('VOICE_STORAGE_FAILED', `试读已保留，上传未完成：${error instanceof Error ? error.message : '上传错误'}。从断点重试只补上传，不再合成或更换音色。`);
      }
    })();
    pending.set(id, operation);
    try { return await operation; } finally { pending.delete(id); }
  };
}

let service: ReturnType<typeof createVoiceReferenceService> | undefined;
export function generateVoiceReference(input: Input) {
  service ||= createVoiceReferenceService({
    root: path.join(process.env.AID_COMPANION_DATA_DIR || tmpdir(), 'voice-reference-cache'),
    ready: ensureCloudinaryUploadReady, synthesize: generateFishSpeech, upload: uploadBufferToCloudinary, verify: verifyFishVoiceLanguage,
  });
  return service(input);
}
