import OpenAI from "openai";
import type { AIConfig } from "@/lib/config/schema";

/** 缺少配置时抛出，供路由转换为引导用户去配置的响应 */
export class MissingConfigError extends Error {
  constructor() {
    super("尚未配置模型，请点击右上角「模型配置」填写 API Key");
    this.name = "MissingConfigError";
  }
}

/**
 * 按请求携带的配置创建 AI client。
 *
 * 配置由用户在前端填写并随请求发来，因此不能像单例那样跨请求缓存——
 * 不同用户的 key 与 baseURL 各不相同。OpenAI SDK 自带连接池，
 * 每请求新建 client 的开销远小于一次模型调用。
 *
 * @throws MissingConfigError 配置缺失时抛出
 */
export function getAI(config: AIConfig | undefined): { client: OpenAI; model: string } {
  if (!config?.apiKey || !config.model) throw new MissingConfigError();

  return {
    // baseURL 留空时 SDK 使用 OpenAI 官方地址
    client: new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || undefined,
    }),
    model: config.model,
  };
}
