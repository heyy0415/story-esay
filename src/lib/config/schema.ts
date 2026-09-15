import { z } from "zod";

/**
 * 模型配置。由用户在前端填写并存于 localStorage，随每次请求发往服务端。
 *
 * 注意：这意味着 key 存在浏览器且出现在请求体中。这是有意的取舍——
 * 公开演示时每位体验者使用自己的额度，站点不承担成本，也无需保管他人密钥。
 */
export const AIConfigSchema = z.object({
  apiKey: z.string().min(1, "API Key 不能为空").max(500),
  model: z.string().min(1, "模型名不能为空").max(100),
  /** 留空则走 OpenAI 官方地址 */
  baseUrl: z
    .string()
    .max(500)
    .refine((v) => !v || /^https?:\/\/.+/.test(v), "需以 http:// 或 https:// 开头")
    .default(""),
});
export type AIConfig = z.infer<typeof AIConfigSchema>;

/** 服务端接收的配置：与前端同构，但允许缺省以便返回明确的引导错误 */
export const AIConfigInputSchema = AIConfigSchema.optional();
