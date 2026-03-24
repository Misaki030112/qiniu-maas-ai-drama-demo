export const voiceCatalog = [
  {
    key: "narrative_atmosphere",
    label: "叙事氛围",
    voiceType: "qiniu_zh_female_ljfdxx",
    gender: "female",
    ageGroup: "adult",
    sceneTags: ["旁白", "叙事", "纪录", "悬念"],
    styleTags: ["克制", "沉稳", "叙事感"],
    supportsEmotion: false,
  },
  {
    key: "gentle_delicate",
    label: "温柔细腻",
    voiceType: "qiniu_zh_female_wwxkjx",
    gender: "female",
    ageGroup: "young_adult",
    sceneTags: ["爱情", "内心戏", "安抚"],
    styleTags: ["温柔", "细腻", "柔和"],
    supportsEmotion: true,
  },
  {
    key: "clear_explainer",
    label: "清晰解说",
    voiceType: "qiniu_zh_female_ljfdxx",
    gender: "female",
    ageGroup: "adult",
    sceneTags: ["说明", "旁白", "信息播报"],
    styleTags: ["清晰", "利落", "解释型"],
    supportsEmotion: false,
  },
  {
    key: "mature_resonant",
    label: "醇厚成熟",
    voiceType: "qiniu_zh_male_whxkxg",
    gender: "male",
    ageGroup: "adult",
    sceneTags: ["职场", "权威", "长辈"],
    styleTags: ["醇厚", "成熟", "沉稳"],
    supportsEmotion: true,
  },
  {
    key: "full_emotion",
    label: "饱满情绪",
    voiceType: "qiniu_zh_female_wwxkjx",
    gender: "female",
    ageGroup: "adult",
    sceneTags: ["争执", "爆发", "情绪戏"],
    styleTags: ["情绪饱满", "张力", "戏剧感"],
    supportsEmotion: true,
  },
  {
    key: "authoritative_male",
    label: "威严男声",
    voiceType: "qiniu_zh_male_whxkxg",
    gender: "male",
    ageGroup: "adult",
    sceneTags: ["领导", "审讯", "汇报"],
    styleTags: ["威严", "克制", "压迫感"],
    supportsEmotion: true,
  },
  {
    key: "cold_elegant_woman",
    label: "高冷御姐",
    voiceType: "qiniu_zh_female_wwxkjx",
    gender: "female",
    ageGroup: "adult",
    sceneTags: ["女主", "都市", "决策"],
    styleTags: ["高冷", "干练", "克制"],
    supportsEmotion: true,
  },
  {
    key: "sweet_energetic",
    label: "清甜元气",
    voiceType: "qiniu_zh_female_wwxkjx",
    gender: "female",
    ageGroup: "young_adult",
    sceneTags: ["校园", "轻喜", "青春"],
    styleTags: ["元气", "明快", "轻盈"],
    supportsEmotion: true,
  },
  {
    key: "elegant_boyfriend",
    label: "儒雅男友",
    voiceType: "qiniu_zh_male_whxkxg",
    gender: "male",
    ageGroup: "young_adult",
    sceneTags: ["爱情", "安抚", "对白"],
    styleTags: ["儒雅", "温和", "克制"],
    supportsEmotion: true,
  },
  {
    key: "sunny_youth",
    label: "阳光青年",
    voiceType: "qiniu_zh_male_whxkxg",
    gender: "male",
    ageGroup: "young_adult",
    sceneTags: ["青春", "热血", "伙伴"],
    styleTags: ["明朗", "干净", "积极"],
    supportsEmotion: true,
  },
];

export function getVoiceCatalog() {
  return voiceCatalog;
}

export function findVoicePresetByType(voiceType) {
  return voiceCatalog.find((item) => item.voiceType === voiceType) || null;
}

export function findVoicePresetByLabel(label) {
  return voiceCatalog.find((item) => item.label === label) || null;
}

export function defaultVoicePresetForGender(gender, speaker = "") {
  if (speaker === "旁白" || !speaker) {
    return findVoicePresetByLabel("叙事氛围") || voiceCatalog[0];
  }
  if (gender === "male") {
    return findVoicePresetByLabel("威严男声") || voiceCatalog.find((item) => item.gender === "male") || voiceCatalog[0];
  }
  return findVoicePresetByLabel("高冷御姐") || voiceCatalog.find((item) => item.gender === "female") || voiceCatalog[0];
}

export function normalizeVoiceProfile(profile, gender = "neutral", speaker = "") {
  const preset =
    findVoicePresetByType(profile?.voiceType) ||
    findVoicePresetByLabel(profile?.label) ||
    defaultVoicePresetForGender(gender, speaker);

  return {
    key: profile?.key || preset.key,
    label: profile?.label || preset.label,
    voiceType: profile?.voiceType || preset.voiceType,
    gender: profile?.gender || preset.gender,
    ageGroup: profile?.ageGroup || preset.ageGroup,
    sceneTags: Array.isArray(profile?.sceneTags) && profile.sceneTags.length ? profile.sceneTags : preset.sceneTags,
    styleTags: Array.isArray(profile?.styleTags) && profile.styleTags.length ? profile.styleTags : preset.styleTags,
    supportsEmotion: profile?.supportsEmotion ?? preset.supportsEmotion,
    emotion: profile?.emotion || "",
    speedRatio: Number(profile?.speedRatio || 1),
    volume: Number(profile?.volume || 5),
    pitch: Number(profile?.pitch || 1),
  };
}
