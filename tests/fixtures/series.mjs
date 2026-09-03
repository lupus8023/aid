export function outlineFixture() {
  return {
    bible: { logline: '修复师越接近失踪父亲，越忘记父亲。', theme: '记忆与选择', conflictEngine: '修复照片获得线索，同时失去记忆，使调查依赖更不可靠的人。', rules: ['每张照片只重现拍摄前十秒', '每次使用能力失去一段记忆'], ending: '女儿选择保存真相，将父亲留下的证据公开。', arcs: [{ start: 1, end: 3, goal: '查清父亲失踪', reversal: '父亲主动留下照片' }], promises: [{ question: '谁带走了父亲？', plantedIn: 1, payoffIn: 2, answer: '叔叔在帮助父亲脱身' }, { question: '记忆消失的原因？', plantedIn: 1, payoffIn: 3, answer: '父亲为保护女儿设置了照片的代价' }] },
    characters: [
      { name: '林知夏', aliases: ['知夏'], role: '旧照片修复师', description: '二十多岁的女性，短发，深蓝色工作服，手腕有修复工具留下的划痕。', want: '找到失踪的父亲', secret: '童年记忆不完整', arc: '从执着于记住父亲到选择保存真相', voiceBrief: '普通话，年轻女性，清晰克制，略有沙哑', gender: 'female', ageGroup: 'young_adult', speaking: true, appearance: 'on_screen', importance: 'lead' },
      { name: '陈叔', aliases: ['陈建国'], role: '父亲的老友', description: '五十岁男性，旧灰色外套，左手有旧伤。', want: '保护父亲留下的证据', secret: '参与了父亲失踪的安排', arc: '从隐瞒到坦白', voiceBrief: '普通话，成年男性，低沉沉稳，语速适中', gender: 'male', ageGroup: 'adult', speaking: true, appearance: 'on_screen', importance: 'supporting' }
    ],
    locations: [{ name: '旧照相馆', description: '狭窄的木质柜台、暗红窗帘、桌上的旧台灯和显影盘。' }]
  };
}
export function episodeFixtures() {
  const stories = [
    ['旧照片', '知夏在修复照片时看见父亲失踪前的十秒。她追查照片中的手表，却发现自己忘记了父亲的声音。她仍决定继续，照片里的男人转过身，正是陈叔。', '照片在显影盘中浮现异常', '辨认照片中的男人', '记忆开始消失，陈叔拒绝谈论往事', '牺牲一段记忆换取线索', '看清了带走父亲的人', '照片里的人转过身，正是陈叔。', '真相反转', '知夏带着照片质问陈叔', ['p1', 'p2'], [], ['知夏发现照片能重现十秒', '知夏忘记父亲声音']],
    ['说谎的人', '知夏质问陈叔并用照片验证他的解释。照片显示陈叔在拦住追赶父亲的人。知夏暂时选择相信他，拿到父亲留下的钥匙，钥匙后刻着只有她知道的日期。', '知夏带着照片质问陈叔', '证实陈叔的身份', '陈叔隐瞒去向，知夏不愿再相信他', '冒险将照片交给陈叔', '陈叔确实在保护父亲', '钥匙后刻着知夏失去记忆的日期。', '新线索', '知夏用钥匙打开父亲的柜子', [], ['p1'], ['陈叔参与保护父亲', '知夏得到柜子钥匙']],
    ['不要找我', '知夏打开柜子发现录音，明白照片的力量是父亲留下的保护。她选择公开证据，即使忘记父亲。记忆淡去后，她在相馆重新挂上父亲的照片，背面写着一句不用记得我。', '知夏用钥匙打开父亲的柜子', '查清失忆原因并决定是否继续', '公开证据意味着失去最后的记忆', '公开证据并承担代价', '父亲的真相公开，主线完成', '她望着陌生的照片，却仍将它挂在最亮的地方。', '终局余韵', '', [], ['p2'], ['真相被公开', '知夏接受失忆代价']]
  ];
  return { episodes: stories.map((s, i) => ({ number: i + 1, title: s[0], synopsis: s[1], opening: s[2], goal: s[3], conflict: s[4], choice: s[5], resolution: s[6], hook: s[7], hookType: s[8], nextOpening: s[9], plants: s[10], paysOff: s[11], stateChanges: s[12], characterIds: ['c1', 'c2'], locationIds: ['l1'], knowledgeChanges: [{ characterId: 'c1', learns: s[6] }] })) };
}
export function shotFixture() {
  return { shots: Array.from({ length: 16 }, (_, i) => ({ number: i + 1, seconds: i < 8 ? 8 : 7, locationId: 'l1', characterIds: ['c1'], visual: i === 15 ? '特写，照片中的男人转身。' : '近景，显影盘中的照片逐渐清晰。', action: i === 15 ? '知夏认出陈叔，手停在半空。' : '知夏用镊子缓缓夹起照片，仔细观察。', dialogue: i === 4 ? [{ characterId: 'c1', text: '这块表，我见过。', emotion: '克制的疑惑' }] : [], sound: '台灯低鸣，街上远处的雨声。', purpose: i === 15 ? '兑现辨认目标，留下陈叔身份悬念。' : '积累异常线索与人物反应。' })) };
}
