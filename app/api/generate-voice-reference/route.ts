import { NextRequest, NextResponse } from 'next/server';
import { uploadToCloudinary } from '@/lib/cloudinaryUpload';
import { generateFishSpeech } from '@/lib/fishAudio';
import { voiceReferencePublicId, voiceReferenceSample } from '@/lib/voiceReference';

// 生成角色声音参考音频：用一段简短文本捕捉音色，上传到 Cloudinary
export async function POST(request: NextRequest) {
  try {
    const { characterName, voiceId, fishAudioKey, language = 'zh' } = await request.json();

    if (!fishAudioKey || !voiceId?.trim()) {
      return NextResponse.json({ error: 'fishAudioKey 和已锁定的 voiceId 均为必填项' }, { status: 400 });
    }

    // This is a timbre probe, not dialogue. Keep it non-lexical so H3 cannot
    // accidentally repeat a Fish reference word before the scripted line.
    const sampleText = voiceReferenceSample(language === 'en' ? 'en' : 'zh');

    const { buffer: audioBuffer } = await generateFishSpeech(sampleText, voiceId, fishAudioKey);
    const base64 = `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`;

    const result = await uploadToCloudinary(base64, {
      folder: 'aid-voice-refs',
      resource_type: 'video',
      public_id: voiceReferencePublicId(characterName),
    });

    return NextResponse.json({
      url: result.secure_url,
      duration: result.duration ?? 0,
      characterName,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate voice reference' }, { status: 500 });
  }
}
