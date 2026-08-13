import { NextRequest, NextResponse } from 'next/server';
import { createComfyUICharacterReplaceTask, SCAIL2_FRAME_COUNTS } from '@/lib/comfyui';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let payload: Record<string, any>;
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const drivingVideo = form.get('drivingVideo');
      const referenceImage = form.get('referenceImage');
      const productReferenceImage = form.get('productReferenceImage');
      let comfyui = {};
      try {
        comfyui = JSON.parse(String(form.get('comfyui') || '{}'));
      } catch {
        return NextResponse.json({ error: 'ComfyUI 设置格式无效' }, { status: 400 });
      }
      payload = {
        drivingVideo: drivingVideo instanceof File ? drivingVideo : null,
        referenceImage: referenceImage instanceof File ? referenceImage : null,
        productReferenceImage: productReferenceImage instanceof File ? productReferenceImage : null,
        prompt: String(form.get('prompt') || ''),
        videoSubject: String(form.get('videoSubject') || 'person'),
        referenceSubject: String(form.get('referenceSubject') || 'person'),
        productMode: String(form.get('productMode') || 'replace'),
        productSubject: String(form.get('productSubject') || ''),
        productReferenceSubject: String(form.get('productReferenceSubject') || ''),
        frameCount: String(form.get('frameCount') || 'full'),
        seed: String(form.get('seed') || ''),
        comfyui,
      };
    } else {
      payload = await request.json();
    }
    const {
      drivingVideo,
      referenceImage,
      productReferenceImage,
      prompt,
      videoSubject = 'person',
      referenceSubject = 'person',
      productMode = 'replace',
      productSubject = '',
      productReferenceSubject = '',
      frameCount = 'full',
      seed,
      comfyui = {},
    } = payload;

    if (!drivingVideo || !referenceImage || !String(prompt || '').trim()) {
      return NextResponse.json(
        { error: '请上传驱动视频、替换人物图并填写替换描述' },
        { status: 400 },
      );
    }
    if (!['auto', 'full'].includes(frameCount) && !SCAIL2_FRAME_COUNTS.includes(Number(frameCount) as typeof SCAIL2_FRAME_COUNTS[number])) {
      return NextResponse.json(
        { error: `处理帧数必须是完整视频或 ${SCAIL2_FRAME_COUNTS.join('、')}` },
        { status: 400 },
      );
    }
    if (!['preserve', 'replace', 'none'].includes(String(productMode))) {
      return NextResponse.json({ error: '产品处理方式无效' }, { status: 400 });
    }
    if (productMode !== 'none' && !String(productSubject).trim()) {
      return NextResponse.json({ error: '请填写原视频产品检测词，例如 mask package、bottle 或 handbag' }, { status: 400 });
    }
    if (productMode === 'replace' && !productReferenceImage) {
      return NextResponse.json({ error: '选择同时替换产品时，必须上传产品参考图' }, { status: 400 });
    }

    const result = await createComfyUICharacterReplaceTask({
      drivingVideo,
      referenceImage,
      productReferenceImage,
      prompt: String(prompt),
      videoSubject: String(videoSubject),
      referenceSubject: String(referenceSubject),
      productMode,
      productSubject: String(productSubject),
      productReferenceSubject: String(productReferenceSubject),
      frameCount: ['auto', 'full'].includes(frameCount) ? 'full' : Number(frameCount),
      seed: seed === '' || seed === undefined || seed === null ? undefined : Number(seed),
      settings: comfyui,
    });
    return NextResponse.json({
      success: true,
      provider: 'comfyui',
      workflow: 'scail2_character_replace',
      message: 'SCAIL2 视频换人物任务已提交，长视频将在云端自动分段续写',
      ...result,
    });
  } catch (error) {
    console.error('ComfyUI character replacement error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '视频换人物任务提交失败' },
      { status: 500 },
    );
  }
}
