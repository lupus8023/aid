/**
 * The projected T8 adapter is checkpoint-specific, not a generic pruned LoRA.
 * Its safetensors metadata declares exact_checkpoint_sha256_only. Keep this
 * pair shared by ordinary I2V (including Story/Series) and Director.
 */
export const H3_DASIWA_4TURBO_PROFILE = Object.freeze({
  name: 'dasiwa4' as const,
  diffusionModel: 'DasiwaMinimaxH3_dasiwaREF2VAHybridV1.safetensors',
  diffusionModelSha256: '71c61492faf65b410d0726840ac3b27b017fcfeb76b16ae11589223d81b7121c',
  textEncoder: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
  lora: 'minimax_h3_turbo_4step_dasiwa_ref2va_hybrid_v1_T8.safetensors',
  steps: 4,
  shiftVideo: 12,
  shiftAudio: 3,
  loraStrength: 1,
  samplerName: 'dual_clock_euler',
  scheduler: 'simple',
  loraSha256: 'd2a9a723d97520232f17b6fec33335f9e94b03b2c67b56f91f16780355479274',
});
