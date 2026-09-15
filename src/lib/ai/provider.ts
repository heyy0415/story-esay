import OpenAI from "openai";

let cached: { client: OpenAI; model: string } | null = null;

/**
 * 获取 AI client 与模型名。任何 OpenAI 兼容服务（OpenAI 官方、DeepSeek、中转网关）
 * 都通过 AI_BASE_URL / AI_API_KEY / AI_MODEL 三个环境变量配置。
 * 客户端在进程内缓存，避免每次请求重复创建连接池。
 * @throws 缺少必需环境变量时抛错，避免在请求深处才暴露配置问题
 */
export function getAI(): { client: OpenAI; model: string } {
  if (cached) return cached;

  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("缺少环境变量 AI_API_KEY");

  const model = process.env.AI_MODEL;
  if (!model) throw new Error("缺少环境变量 AI_MODEL");

  cached = {
    // baseURL 留空时 SDK 使用 OpenAI 官方地址
    client: new OpenAI({ apiKey, baseURL: process.env.AI_BASE_URL }),
    model,
  };
  return cached;
}
