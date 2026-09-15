import { z } from "zod";
import { AIConfigInputSchema } from "@/lib/config/schema";

/** 故事开局：由用户一句话创意生成的世界设定与初始状态 */
export const StorySetupSchema = z.object({
  title: z.string().min(1).max(40),
  genre: z.string().min(1).max(20),
  worldIntro: z.string().min(1),
  protagonist: z.object({
    name: z.string().min(1).max(20),
    description: z.string().min(1),
  }),
  /** 数值属性，键为属性名（如「体力」「声望」），值 0-100 */
  stats: z.record(z.string(), z.number().int().min(0).max(100)).refine((s) => Object.keys(s).length >= 2 && Object.keys(s).length <= 4, {
    message: "属性数量需在 2-4 个之间",
  }),
  /** 第一幕开场叙事 */
  opening: z.string().min(1),
  choices: z.array(z.string().min(1)).min(2).max(4),
});
export type StorySetup = z.infer<typeof StorySetupSchema>;

/** 每一回合叙事之后的结构化元数据（叙事正文单独流式输出，不在此 schema 内） */
export const TurnMetaSchema = z.object({
  choices: z.array(z.string().min(1)).max(4).default([]),
  /** 属性变化增量，正负均可，缺省表示无变化 */
  statChanges: z.record(z.string(), z.number().int().min(-50).max(50)).default({}),
  /** 新获得的物品/线索，用于左侧背包展示 */
  newItems: z.array(z.string()).default([]),
  isEnding: z.boolean().default(false),
  /** 结局类型，仅 isEnding 为 true 时有意义 */
  endingType: z.enum(["good", "bad", "neutral"]).optional(),
});
export type TurnMeta = z.infer<typeof TurnMetaSchema>;

/** 历史记录中的一条：玩家做了什么 → 发生了什么 */
export const HistoryEntrySchema = z.object({
  action: z.string(),
  narrative: z.string(),
  /** 该回合插图的图片地址，生成失败时为 null */
  imageUrl: z.string().nullable().default(null),
});

export const IllustrateRequestSchema = z.object({
  genre: z.string().min(1).max(20),
  narrative: z.string().min(1).max(2000),
  /** 模型配置由前端携带，服务端不持有密钥 */
  config: AIConfigInputSchema,
});

/** 客户端持有并回传服务端的完整游戏状态（服务端无状态） */
export const GameStateSchema = z.object({
  setup: StorySetupSchema,
  stats: z.record(z.string(), z.number()),
  items: z.array(z.string()),
  history: z.array(HistoryEntrySchema),
  turnCount: z.number().int().min(0),
  /** 开场插图地址，与 history 中各回合插图分开存放 */
  openingImageUrl: z.string().nullable().default(null),
});
export type GameState = z.infer<typeof GameStateSchema>;

export const TurnRequestSchema = z.object({
  state: GameStateSchema,
  action: z.string().min(1).max(200),
  /** 模型配置由前端携带，服务端不持有密钥 */
  config: AIConfigInputSchema,
});
export type TurnRequest = z.infer<typeof TurnRequestSchema>;

export const SetupRequestSchema = z.object({
  idea: z.string().min(2).max(300),
  /** 模型配置由前端携带，服务端不持有密钥 */
  config: AIConfigInputSchema,
});

/** SSE 事件协议：text 为叙事增量，meta 为回合结束后的结构化数据，error 为失败 */
export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "meta"; meta: TurnMeta }
  | { type: "error"; message: string };
