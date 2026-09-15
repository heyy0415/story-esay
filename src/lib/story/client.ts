import type { GameState, StorySetup, StreamEvent, TurnMeta } from "./schema";
import { loadConfig } from "@/lib/config/storage";

/** 服务端用此状态码表示尚未配置模型 */
const NEED_CONFIG_STATUS = 428;

/** 配置缺失时抛出，由 UI 捕获并弹出配置表单 */
export class NeedConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NeedConfigError";
  }
}

/**
 * 安全解析响应体。服务端崩溃时 body 可能为空或是 HTML 错误页，
 * 直接 res.json() 会抛出解析错误并掩盖真正的 HTTP 状态。
 */
async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return `服务端错误（HTTP ${res.status}）`;
  try {
    const data = JSON.parse(text) as { error?: string };
    return data.error ?? `服务端错误（HTTP ${res.status}）`;
  } catch {
    // 非 JSON（如 Next.js 的 HTML 错误页），截断避免把整页塞进提示
    return `服务端错误（HTTP ${res.status}）：${text.slice(0, 120)}`;
  }
}

/** 统一抛错：配置缺失抛 NeedConfigError 以便 UI 弹出表单，其余抛普通 Error */
async function throwForStatus(res: Response): Promise<never> {
  const message = await readError(res);
  if (res.status === NEED_CONFIG_STATUS) throw new NeedConfigError(message);
  throw new Error(message);
}

/**
 * 请求故事开局
 * @throws 服务端返回非 2xx 或响应体不合法时抛出携带用户可读信息的 Error
 */
export async function requestSetup(idea: string): Promise<StorySetup> {
  const res = await fetch("/api/story/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idea, config: loadConfig() ?? undefined }),
  });

  if (!res.ok) await throwForStatus(res);

  const text = await res.text();
  try {
    return JSON.parse(text) as StorySetup;
  } catch {
    throw new Error("服务端返回了非法数据，请重试");
  }
}

/**
 * 请求场景插图，返回图片地址。这是非关键路径，任何失败都返回 null 而不抛错，
 * 调用方无需 try/catch，插图缺失时页面自然降级为纯文字。
 */
export async function requestIllustration(genre: string, narrative: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch("/api/story/illustrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ genre, narrative, config: loadConfig() ?? undefined }),
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { imageUrl?: string | null };
    return data.imageUrl ?? null;
  } catch {
    return null;
  }
}

interface TurnCallbacks {
  onText: (delta: string) => void;
  onMeta: (meta: TurnMeta) => void;
}

/**
 * 推进一回合并消费 SSE 流。
 * 用 fetch + ReadableStream 而非 EventSource，因为 EventSource 不支持 POST。
 * @throws 连接失败或服务端推送 error 事件时抛出
 */
export async function requestTurn(state: GameState, action: string, cb: TurnCallbacks, signal?: AbortSignal): Promise<void> {
  const res = await fetch("/api/story/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, action, config: loadConfig() ?? undefined }),
    signal,
  });

  if (!res.ok) await throwForStatus(res);
  if (!res.body) throw new Error("服务端未返回数据流");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // SSE 以空行分隔事件，一个 chunk 可能包含多个事件或半个事件
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data: ")) continue;

      let event: StreamEvent;
      try {
        event = JSON.parse(line.slice(6)) as StreamEvent;
      } catch {
        // 单条事件损坏不应中断整个流，跳过继续读后续事件
        console.warn("[stream] 跳过无法解析的事件");
        continue;
      }

      if (event.type === "text") cb.onText(event.delta);
      else if (event.type === "meta") cb.onMeta(event.meta);
      else if (event.type === "error") throw new Error(event.message);
    }
  }
}
