import { NextRequest, NextResponse } from 'next/server';
import { generateVoiceReference } from '@/lib/voiceReferenceGeneration';

export const maxDuration = 300;

// 生成角色声音参考音频：用一段简短文本捕捉音色，上传到 Cloudinary
export async function POST(request: NextRequest) {
  try {
    const { characterName, voiceId, fishAudioKey, language = 'zh', strictVoice = false, verifyLanguage = false } = await request.json();

    if (!fishAudioKey || !voiceId?.trim()) {
      return NextResponse.json({ error: 'fishAudioKey 和已锁定的 voiceId 均为必填项' }, { status: 400 });
    }

    const result = await generateVoiceReference({ voiceId: voiceId.trim(), fishAudioKey, language: language === 'en' ? 'en' : 'zh', strictVoice: Boolean(strictVoice), verifyLanguage: Boolean(verifyLanguage) });

    return NextResponse.json({
      url: result.url,
      duration: result.duration ?? 0,
      characterName,
      voiceId: result.voiceId,
      languageCheck: result.languageCheck,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate voice reference', code: error.code }, { status: 500 });
  }
}
