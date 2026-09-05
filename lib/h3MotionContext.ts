export const H3_MOTION_CONTEXT_FPS = 24;
export const H3_MOTION_CONTEXT_FRAME_OPTIONS = [5, 22, 39] as const;
export type H3MotionContextFrames = (typeof H3_MOTION_CONTEXT_FRAME_OPTIONS)[number];

export interface H3MotionContextRequest {
  chainId: string;
  segmentIndex: number;
  contextFrames: H3MotionContextFrames;
  continueAudio?: boolean;
  isFinalSegment?: boolean;
}

type JsonRecord = Record<string, any>;

function requiredSingleNode(prompt: JsonRecord, classType: string): [string, JsonRecord] {
  const matches = Object.entries(prompt).filter(([, node]) => node?.class_type === classType) as [string, JsonRecord][];
  if (matches.length !== 1) {
    throw new Error(`Motion Context requires exactly one ${classType} node; found ${matches.length}`);
  }
  return matches[0];
}

function allocateNodeId(prompt: JsonRecord): string {
  return String(Math.max(0, ...Object.keys(prompt).map(Number).filter(Number.isFinite)) + 1);
}

export function normalizeH3MotionContextRequest(value: unknown): H3MotionContextRequest | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const chainId = String(raw.chainId || '').trim();
  const segmentIndex = Number(raw.segmentIndex);
  const contextFrames = Number(raw.contextFrames);
  if (!chainId) throw new Error('Motion Context chainId is required');
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
    throw new Error('Motion Context segmentIndex must be a non-negative integer');
  }
  if (!H3_MOTION_CONTEXT_FRAME_OPTIONS.includes(contextFrames as H3MotionContextFrames)) {
    throw new Error('Motion Context contextFrames must be 5, 22, or 39');
  }
  return {
    chainId,
    segmentIndex,
    contextFrames: contextFrames as H3MotionContextFrames,
    continueAudio: raw.continueAudio !== false,
    isFinalSegment: raw.isFinalSegment === true,
  };
}

export function h3MotionContextHeadSeconds(input: Pick<H3MotionContextRequest, 'segmentIndex' | 'contextFrames'>): number {
  return input.segmentIndex > 0 ? input.contextFrames / H3_MOTION_CONTEXT_FPS : 0;
}

/**
 * H3 prompt timecodes target the sampled timeline. Continuation heads are
 * sampled and then removed, so every authored timecode must move by the same
 * amount. After AV trim, dialogue and action return to their original times.
 */
export function shiftH3PromptTimecodes(prompt: string, offsetSeconds: number): string {
  const offset = Number(offsetSeconds);
  if (!Number.isFinite(offset) || offset <= 0) return String(prompt || '');
  return String(prompt || '').replace(/\b(\d{2}):(\d{2})\.(\d{3})\b/g, (_match, minutes, seconds, millis) => {
    const original = Number(minutes) * 60 + Number(seconds) + Number(millis) / 1000;
    const shiftedMillis = Math.round((original + offset) * 1000);
    const shiftedMinutes = Math.floor(shiftedMillis / 60_000);
    const remainder = shiftedMillis - shiftedMinutes * 60_000;
    const shiftedSeconds = Math.floor(remainder / 1000);
    const shiftedFraction = remainder % 1000;
    return `${String(shiftedMinutes).padStart(2, '0')}:${String(shiftedSeconds).padStart(2, '0')}.${String(shiftedFraction).padStart(3, '0')}`;
  });
}

export function shiftH3SpeechTurns<T extends { start?: number; end?: number }>(turns: T[], offsetSeconds: number): T[] {
  const offset = Number(offsetSeconds);
  if (!Number.isFinite(offset) || offset <= 0) return turns.map(turn => ({ ...turn }));
  return turns.map(turn => ({
    ...turn,
    start: Number(turn.start) + offset,
    end: Number(turn.end) + offset,
  }));
}

/** Convert AID's normal first-frame wording into a latent-chain contract. */
export function adaptH3PromptForMotionContinuation(prompt: string): string {
  return String(prompt || '')
    .replace(
      /<Picture 1>是\[Shot 1\]的开场连续性画面。/g,
      '<Picture 1>是[Shot 1]的人物身份、服装、场景与构图参考；动态开场来自上一片段的音画上下文。',
    )
    .replace(
      /\[Shot 1\] 本镜以<Picture 1>作为构图参考。/g,
      '[Shot 1] 动态开场直接承接上一片段的音画尾部；<Picture 1>只持续约束人物身份、服装、场景与既定构图。',
    )
    .replace(
      /<Picture 1> is the opening continuity frame for \[Shot 1\]\./g,
      '<Picture 1>是[Shot 1]的人物身份、服装、场景与构图参考；动态开场来自上一片段的音画上下文。',
    )
    .replace(/\[locked-first-frame image-to-video([^\]]*)\]/gi, '[moving audiovisual context continuation$1]')
    .replace(
      /<Picture 1> \(\[Shot 1\] composition\): opening anchor -[^\n]*/g,
      '<Picture 1>（[Shot 1]构图）是持续参考：保持人物身份、服装、场景、光线和既定构图；开场运动由上一段动态上下文决定。',
    )
    .replace(
      /REFERENCE PRIORITY — LOCK to <Picture 1>; DO NOT REDRAW\. <Picture 1> is the exact first frame at 00:00\.000, not loose style inspiration\./g,
      '动态上下文优先：直接承接上一段的动态音画尾部。<Picture 1>只作为持续的人物身份、服装、场景和构图参考，不替换动态开场。',
    );
}

/**
 * Replace only the stable T8 conditioning/output seam. Model loading, LoRA,
 * sampling, native dialogue references and the source workflows stay intact.
 */
export function applyT8H3MotionContext(
  prompt: JsonRecord,
  request: H3MotionContextRequest,
  deliveredDurationSeconds: number,
): JsonRecord {
  const input = normalizeH3MotionContextRequest(request)!;
  const [conditioningId, conditioning] = requiredSingleNode(prompt, 'MiniMaxH3AudioConditioningT8');
  const [dualSamplerId, dualSampler] = requiredSingleNode(prompt, 'MiniMaxH3DualClockSamplerT8');
  const [guiderId, guider] = requiredSingleNode(prompt, 'BasicGuider');
  const [samplerId, sampler] = requiredSingleNode(prompt, 'SamplerCustomAdvanced');
  const [decodeId, decode] = requiredSingleNode(prompt, 'MiniMaxH3AVDecodeT8');
  const [, output] = requiredSingleNode(prompt, 'VHS_VideoCombine');

  if (input.segmentIndex === 0) {
    // The root clip has no reconstructed head and needs no model/layout patch.
    // Save its bounded AV tail while keeping the production graph bit-for-bit
    // identical upstream; continuation cost begins with segment 1.
    if (input.isFinalSegment) return prompt;
    const rootSaveId = allocateNodeId(prompt);
    prompt[rootSaveId] = {
      class_type: 'MiniMaxH3LongVideoContextSaveT8',
      inputs: {
        av_latent: [samplerId, 0],
        chain_id: input.chainId,
        segment_index: 0,
        save_context: true,
        model_id: 'AID MiniMax H3 T8 4-step',
        sampling_summary: 'dual_clock_euler / 4-step / shift 12/3',
      },
      _meta: { title: 'AID save root AV tail for next segment' },
    };
    return prompt;
  }

  const originalModel = dualSampler.inputs?.model;
  if (!Array.isArray(originalModel)) throw new Error('Motion Context could not find the H3 model input');
  if (!Array.isArray(decode.inputs?.av_latent) || String(decode.inputs.av_latent[0]) !== samplerId) {
    throw new Error('Motion Context requires SamplerCustomAdvanced to feed MiniMaxH3AVDecodeT8');
  }

  const plannerId = allocateNodeId(prompt);
  prompt[plannerId] = {
    class_type: 'MiniMaxH3LongVideoPlannerT8',
    inputs: {
      chain_id: input.chainId,
      segment_index: input.segmentIndex,
      new_duration_seconds: deliveredDurationSeconds,
      context_frames: input.contextFrames,
      minimum_render_frames: 124,
      timeline_start_seconds: -1,
      is_final_segment: input.isFinalSegment === true,
    },
    _meta: { title: 'AID Motion Context planner' },
  };

  const loadId = allocateNodeId(prompt);
  prompt[loadId] = {
    class_type: 'MiniMaxH3LongVideoContextLoadT8',
    inputs: { chain_id: [plannerId, 0], segment_index: [plannerId, 1] },
    _meta: { title: 'AID load previous AV context' },
  };

  conditioning.class_type = 'MiniMaxH3LongVideoConditioningT8';
  conditioning._meta = { ...(conditioning._meta || {}), title: 'AID H3 Motion Context conditioning' };
  conditioning.inputs = {
    ...conditioning.inputs,
    model: originalModel,
    context: [loadId, 0],
    segment_index: [plannerId, 1],
    context_frames: [plannerId, 3],
    context_audio: input.continueAudio === false ? 'video_only' : 'video_and_audio',
    length: [plannerId, 2],
  };
  if (input.segmentIndex > 0 && Array.isArray(conditioning.inputs.first_frame)) {
    // A continuation head owns frame zero. Preserve the authored storyboard
    // image as a non-timeline identity/scene reference instead of letting two
    // incompatible anchors fight at the join.
    conditioning.inputs.persistent_identity_image = conditioning.inputs.first_frame;
    conditioning.inputs.first_frame_reuse = 'persistent_identity_reference';
    conditioning.inputs.persistent_identity_strategy = 'single_reference';
    conditioning.inputs.persistent_identity_interval = 1;
    // Keep first_frame connected: current T8 uses its presence as the opt-in
    // gate, but context_active prevents it from becoming a frame-zero anchor.
    conditioning.inputs.task_type = 'Hybrid';
  }

  dualSampler.inputs.model = [conditioningId, 0];
  dualSampler.inputs.av_latent = [conditioningId, 2];
  guider.inputs.conditioning = [conditioningId, 1];
  sampler.inputs.latent_image = [conditioningId, 2];

  const saveId = allocateNodeId(prompt);
  prompt[saveId] = {
    class_type: 'MiniMaxH3LongVideoContextSaveT8',
    inputs: {
      av_latent: [samplerId, 0],
      chain_id: [plannerId, 0],
      segment_index: [plannerId, 1],
      save_context: [plannerId, 8],
      model_id: 'AID MiniMax H3 T8 4-step',
      sampling_summary: 'dual_clock_euler / 4-step / shift 12/3',
    },
    _meta: { title: 'AID save AV tail for next segment' },
  };

  const trimId = allocateNodeId(prompt);
  prompt[trimId] = {
    class_type: 'MiniMaxH3OutputTrimT8',
    inputs: {
      frames: [decodeId, 0],
      start_seconds: [plannerId, 4],
      duration_seconds: [plannerId, 5],
      fps: H3_MOTION_CONTEXT_FPS,
      audio: [decodeId, 1],
    },
    _meta: { title: 'AID trim reconstructed Motion Context head' },
  };
  output.inputs.images = [trimId, 0];
  output.inputs.audio = [trimId, 1];

  // Assert the remaining graph seam explicitly so a remote workflow change
  // fails before a paid render instead of silently bypassing continuation.
  if (!Array.isArray(guider.inputs?.model) || String(guider.inputs.model[0]) !== dualSamplerId) {
    throw new Error('Motion Context requires the T8 dual-clock sampler to feed BasicGuider');
  }
  if (!Array.isArray(sampler.inputs?.guider) || String(sampler.inputs.guider[0]) !== guiderId) {
    throw new Error('Motion Context requires BasicGuider to feed SamplerCustomAdvanced');
  }
  return prompt;
}
