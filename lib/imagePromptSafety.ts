export type ImageSafetyRisk = 'graphic-injury' | 'lethal-action' | 'distress-detail';

const RISK_PATTERNS: Array<{ risk: ImageSafetyRisk; pattern: RegExp }> = [
  {
    risk: 'graphic-injury',
    pattern: /(?:浑身是血|鲜血|血泊|血水|血迹|血痕|血珠|溢血|吐血|伤口|贯穿|刺穿|开膛|断肢|断头|露骨|blood(?:y|ied)?|gore|gory|open wound|bleeding|impal(?:e|ed)|dismember(?:ed|ment)?|severed limb)/gi,
  },
  {
    risk: 'lethal-action',
    pattern: /(?:围杀|斩杀|杀死|杀人|处决|割喉|抹脖|射进|刺入|反刺|横斩|砍下|尸体|死尸|已经死去|濒死|kill(?:ed|ing)?|execution|slit (?:his|her|their) throat|stab(?:bed|bing)?|corpse|dead body|fatal)/gi,
  },
  {
    risk: 'distress-detail',
    pattern: /(?:痛苦特写|垂死|濒临死亡|骨折|骨头外露|内脏|suffering close-up|dying|exposed bone|internal organs)/gi,
  },
];

const SAFE_PREFIX = 'CONTENT-SAFE STAGING (authoritative): non-graphic PG-13 cinematic action. Imply danger through blocking, silhouettes, weather, reaction and aftermath. No visible blood, wound, weapon penetration, exposed injury, corpse detail or suffering close-up.';
const STRONG_SAFE_PREFIX = 'STRICT FAMILY-SAFE STAGING (authoritative): depict only a tense, non-contact cinematic confrontation and its emotional reaction. Weapons remain separated from bodies or outside frame; every person is fully clothed and visibly intact. No blood, injury, death, penetration, cruelty or graphic aftermath.';

export function analyzeImagePromptSafety(prompt: string): ImageSafetyRisk[] {
  const risks = RISK_PATTERNS
    .filter(({ pattern }) => {
      pattern.lastIndex = 0;
      return pattern.test(prompt);
    })
    .map(({ risk }) => risk);
  return [...new Set(risks)];
}

function replaceUnsafePhrases(prompt: string): string {
  return prompt
    .replace(/浑身是血|鲜血|血泊|血水|血迹|血痕|血珠|溢血|吐血/gi, '风雪和尘土留下的非伤害性痕迹')
    .replace(/伤口|贯穿|刺穿|开膛|断肢|断头|露骨|骨头外露|内脏/gi, '被衣物完整遮挡的画外冲击')
    .replace(/围杀|斩杀|杀死|杀人|处决/gi, '紧张追捕并逼停')
    .replace(/割喉|抹脖/gi, '以武器保持距离进行威慑')
    .replace(/射进|刺入|反刺|横斩|砍下/gi, '在画外掠过并迫使对方后退')
    .replace(/尸体|死尸|已经死去|濒死|垂死|濒临死亡/gi, '失去行动能力但外观完整的人物')
    .replace(/痛苦特写/gi, '克制的反应镜头')
    .replace(/blood(?:y|ied)?|gore|gory|bleeding/gi, 'weathered, non-injury detail')
    .replace(/open wound|exposed bone|internal organs/gi, 'fully covered, intact clothing')
    .replace(/impal(?:e|ed)|stab(?:bed|bing)?|dismember(?:ed|ment)?|severed limb/gi, 'a non-contact near miss that forces a retreat')
    .replace(/kill(?:ed|ing)?|execution|fatal/gi, 'tense pursuit and capture')
    .replace(/corpse|dead body|dying/gi, 'an unconscious but visibly intact person')
    .replace(/slit (?:his|her|their) throat/gi, 'hold a weapon at a safe distance')
    .replace(/suffering close-up/gi, 'restrained reaction close-up');
}

export function rewriteImagePromptForSafety(prompt: string, level: 1 | 2 = 1): string {
  const prefix = level === 2 ? STRONG_SAFE_PREFIX : SAFE_PREFIX;
  const rewritten = replaceUnsafePhrases(prompt)
    .replace(/\s{2,}/g, ' ')
    .trim();
  return `${prefix}\n\n${rewritten}`;
}

export function isImageSafetyRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /(?:content safety|safety system|safety policy|moderation|policy violation|prompt .* rejected|input .* rejected|unsafe content|内容安全|安全策略|审核拒绝|违规)/i.test(message);
}

export function imageSafetyReasonLabel(risks: ImageSafetyRisk[]): string {
  const labels: Record<ImageSafetyRisk, string> = {
    'graphic-injury': '写实伤口/血液细节',
    'lethal-action': '致命动作或死亡措辞',
    'distress-detail': '痛苦或伤害特写',
  };
  return risks.length ? risks.map(risk => labels[risk]).join('、') : '供应商内容安全策略';
}

export function extractImageTaskError(payload: unknown): string {
  if (!payload) return 'Unknown image generation error';
  if (typeof payload === 'string') return payload;
  if (payload instanceof Error) return payload.message;
  if (typeof payload !== 'object') return String(payload);
  const data = payload as Record<string, any>;
  const candidates = [
    data.error?.message,
    data.error?.detail,
    typeof data.error === 'string' ? data.error : undefined,
    data.details?.message,
    data.details?.error?.message,
    data.message,
    data.reason,
    data.detail,
  ];
  return String(candidates.find(value => typeof value === 'string' && value.trim()) || 'Unknown image generation error');
}

