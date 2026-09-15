import type { GameState } from "./schema";

/** 超过此回合数后，把更早的历史压缩成摘要，控制 prompt 长度 */
export const MAX_RECENT_TURNS = 6;

/** 分隔叙事正文与结构化元数据的标记，模型输出该标记后即切换为 JSON */
export const META_DELIMITER = "<<<META>>>";

/** 故事最长回合数，达到后强制引导结局，防止无限消耗 token */
export const MAX_TURNS = 15;

export const SETUP_SYSTEM_PROMPT = `你是一位互动小说游戏设计师。用户给出一句话创意，你要据此设计一个可玩的文字互动故事开局。
要求：
- 语言：简体中文，文风与题材匹配
- worldIntro 控制在 80-150 字，protagonist.description 控制在 30-60 字
- stats 设计 2-4 个与题材强相关的数值属性（如「体力」「理智」「金钱」「声望」），初始值 30-70
- opening 是第一幕开场，150-250 字，以一个需要抉择的情境结尾
- choices 给出 3 个风格明显不同的行动选项，每个 10-25 字
只输出 JSON，不要 markdown 代码块，不要多余解释。JSON 结构：
{"title":"","genre":"","worldIntro":"","protagonist":{"name":"","description":""},"stats":{"属性名":数值},"opening":"","choices":["","",""]}`;

/**
 * 插画 system prompt。生成纯图形 SVG 作为场景氛围插图。
 * 限制标签种类既是为了安全（见 svg.ts 的净化白名单），也为了让模型专注构图而非堆细节。
 */
/**
 * 把中文剧情转成英文绘画 prompt。
 * 图像模型对英文 prompt 的理解显著优于中文，且需要摄影术语才能出写实效果，
 * 所以先用文字模型做一次"翻译 + 视觉化"，而不是把中文原文直接丢给画图接口。
 */
export const IMAGE_PROMPT_SYSTEM = `You convert Chinese interactive-fiction scenes into English image-generation prompts.

Rules:
- Output ONE line of comma-separated English keywords. No Chinese, no sentences, no explanation.
- Always start with: cinematic film still, photorealistic
- Describe: the main subject and its action, the setting, time of day, lighting, mood, color palette
- Always include lighting and camera terms, e.g.: dramatic side lighting, golden hour, volumetric light, shallow depth of field, 35mm, anamorphic
- Lighting must be BRIGHT and well-exposed. Prefer "brightly lit", "strong key light", "luminous". Never use: dark, dim, shadowy, murky, underexposed, low light, gloomy — even for night scenes, describe the light source as bright (bright moonlight, glowing neon, blazing lanterns).
- Always end with: highly detailed, sharp focus, bright exposure, high dynamic range, clearly visible subject
- Keep it under 60 words. Pick ONE clear focal subject — do not list multiple competing scenes.
- Era/genre must be explicit (e.g. 1930s Shanghai, cyberpunk megacity, Ming dynasty China).
- No text, no watermark, no logo, no signature in the described image.

Output only the prompt line.`;

export function buildImagePromptRequest(genre: string, narrative: string): string {
  return `Genre: ${genre}
Scene (Chinese): ${narrative.slice(0, 280)}

Write the English image prompt.`;
}

/**
 * 构建回合 system prompt。叙事正文先流式输出以保证首字速度，
 * 之后用分隔符跟一段 JSON 元数据，服务端据此拆分。
 */
export function buildTurnSystemPrompt(state: GameState): string {
  const { setup, stats, items, turnCount } = state;
  const statsText = Object.entries(stats)
    .map(([k, v]) => `${k}=${v}`)
    .join("，");
  const itemsText = items.length ? items.join("、") : "无";
  const remaining = MAX_TURNS - turnCount;

  const pacingHint =
    remaining <= 1
      ? "这是最后一回合，必须在本回合给出结局（isEnding=true）。"
      : remaining <= 3
        ? `故事只剩 ${remaining} 回合，开始收束剧情、推向高潮。`
        : "剧情稠密推进，每回合都要有新信息或新冲突，避免原地打转。";

  return `你是《${setup.title}》的游戏主持人（${setup.genre}题材）。
世界设定：${setup.worldIntro}
主角：${setup.protagonist.name}，${setup.protagonist.description}
当前属性：${statsText}
持有物品/线索：${itemsText}
当前第 ${turnCount + 1} 回合。${pacingHint}

规则：
1. 根据玩家行动续写剧情，150-250 字，简体中文，第二人称「你」。行动的后果要与属性挂钩：属性低时行动更易失败。
2. 任何属性降到 0 应触发坏结局。
3. 正文写完后，另起一行输出 ${META_DELIMITER}，紧接着输出一段 JSON（无代码块）：
{"choices":["","",""],"statChanges":{"属性名":增减量},"newItems":[],"isEnding":false,"endingType":"good|bad|neutral"}
- choices 为 2-4 个下一步选项，结局时为空数组
- statChanges 只写有变化的属性，单次变化幅度 -30 到 +30
- 结局时 isEnding=true 并给出 endingType，非结局不要输出 endingType
只允许出现 ${META_DELIMITER} 一次，正文中不得出现它。`;
}

/**
 * 把历史记录转成对话消息。近期回合完整保留，更早的回合压缩为一段摘要，
 * 兼顾上下文连贯与 token 成本。
 */
export function buildHistoryMessages(state: GameState): { role: "user" | "assistant"; content: string }[] {
  const { setup, history } = state;
  const messages: { role: "user" | "assistant"; content: string }[] = [];

  const older = history.slice(0, -MAX_RECENT_TURNS);
  const recent = history.slice(-MAX_RECENT_TURNS);

  // 开场作为第一条 assistant 消息，让模型知道故事从哪开始
  let openingBlock = setup.opening;
  if (older.length) {
    const summary = older.map((h, i) => `第${i + 1}回合：玩家「${h.action}」→ ${h.narrative.slice(0, 60)}…`).join("\n");
    openingBlock += `\n\n【此前剧情摘要】\n${summary}`;
  }
  messages.push({ role: "assistant", content: openingBlock });

  for (const h of recent) {
    messages.push({ role: "user", content: h.action });
    messages.push({ role: "assistant", content: h.narrative });
  }
  return messages;
}
