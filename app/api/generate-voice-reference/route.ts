import { NextRequest, NextResponse } from 'next/server';
import { uploadToCloudinary } from '@/lib/cloudinaryUpload';

// 生成角色声音参考音频：用一段简短文本捕捉音色，上传到 Cloudinary
export async function POST(request: NextRequest) {
  try {
    const { characterName, sampleText, voiceId, fishAudioKey } = await request.json();

    if (!sampleText || !fishAudioKey || !voiceId?.trim()) {
      return NextResponse.json({ error: 'sampleText、fishAudioKey 和已锁定的 voiceId 均为必填项' }, { status: 400 });
    }

    // 保证文本足够长，避免生成的音频 < 1.8s（Seedance 最低时长要求）
    // 中文约4.5字/秒，1.8s ≈ 8字；保险起见保持 ≥ 20字（约4.5s）
    const MIN_CHARS = 20;
    const paddedText = sampleText.length >= MIN_CHARS
      ? sampleText
      : `${sampleText}，这是我的声音，请记住这个音色特征，谢谢大家。`.slice(0, Math.max(MIN_CHARS, sampleText.length + 20));

    // 用 fish.audio 生成 TTS
    const ttsRes = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${fishAudioKey}`,
        'Content-Type': 'application/json',
        'model': 's2-pro',
      },
      body: JSON.stringify({
        text: paddedText,
        format: 'mp3',
        reference_id: voiceId.trim(),
      }),
    });

    if (!ttsRes.ok) {
      throw new Error(`fish.audio error: ${await ttsRes.text()}`);
    }

    const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
    const base64 = `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`;

    const result = await uploadToCloudinary(base64, {
      folder: 'aid-voice-refs',
      resource_type: 'video',
      public_id: `voice-ref-${characterName?.replace(/\s+/g, '-') || 'character'}-${Date.now()}`,
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
