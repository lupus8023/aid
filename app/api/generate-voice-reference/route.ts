import { NextRequest, NextResponse } from 'next/server';
import { uploadToCloudinary } from '@/lib/cloudinaryUpload';
import { generateFishSpeech } from '@/lib/fishAudio';
import { voiceReferencePublicId, voiceReferenceSample } from '@/lib/voiceReference';

// 生成角色声音参考音频：用一段简短文本捕捉音色，上传到 Cloudinary
export async function POST(request: NextRequest) {
  try {
    const { characterName, voiceId, fishAudioKey, language = 'zh', strictVoice = false } = await request.json();

    if (!fishAudioKey || !voiceId?.trim()) {
      return NextResponse.json({ error: 'fishAudioKey 和已锁定的 voiceId 均为必填项' }, { status: 400 });
    }

    // This is a timbre calibration read, not delivered dialogue. A naturally
    // articulated sentence captures consonants, transitions and breath much
    // better than sustained vowels; the H3 exact-speech pass owns all final
    // words and timing independently.
    const sampleText = voiceReferenceSample(language === 'en' ? 'en' : 'zh');

    const { buffer: audioBuffer, voiceId: actualVoiceId } = await generateFishSpeech(sampleText, voiceId, fishAudioKey, { strictVoice });
    if (audioBuffer.length < 1000) throw new Error('音色试读返回内容过短，未通过可用性检查');
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
      voiceId: actualVoiceId,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate voice reference' }, { status: 500 });
  }
}
