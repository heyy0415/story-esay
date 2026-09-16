import { NextResponse } from "next/server";
import { getAI, MissingConfigError } from "@/lib/ai/provider";
import { classifyAIError } from "@/lib/ai/errors";
import { TurnRequestSchema, TurnMetaSchema, type StreamEvent, type TurnMeta } from "@/lib/story/schema";
import { buildTurnSystemPrompt, buildHistoryMessages, META_DELIMITER, MAX_TURNS } from "@/lib/story/prompts";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const encoder = new TextEncoder();

function sseLine(event: StreamEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/** 元数据解析失败时的兜底：给通用选项让游戏能继续，而不是卡死 */
const FALLBACK_META: TurnMeta = {
  choices: ["继续观察周围", "谨慎地前进", "停下来思考对策"],
  statChanges: {},
  newItems: [],
  isEnding: false,
};

function parseMeta(raw: string): TurnMeta {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = TurnMetaSchema.safeParse(JSON.parse(cleaned));
    if (parsed.success) return parsed.data;
    console.warn("[turn] meta 校验失败:", parsed.error.issues);
  } catch (e) {
    console.warn("[turn] meta JSON 解析失败:", e instanceof Error ? e.message : e);
  }
  return FALLBACK_META;
}

/**
 * POST /api/story/turn
 * 推进一回合。以 SSE 流式返回：叙事正文按增量推送，正文结束后推送一条 meta 事件。
 * 服务端不保存任何状态，完整游戏状态由客户端随请求带上。
 */
export async function POST(req: Request) {
  const limit = checkRateLimit(getClientKey(req), "turn");
  if (!limit.allowed) {
    return NextResponse.json({ error: `请求过于频繁，请 ${limit.retryAfterSec} 秒后再试` }, { status: 429 });
  }

  const body = TurnRequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    // config 校验失败说明配置有问题，引导去改配置而非提示参数不合法
    if (body.error.issues.some((i) => i.path[0] === "config")) {
      return NextResponse.json({ error: "模型配置不完整，请检查 API Key 与模型名", needConfig: true }, { status: 428 });
    }
    return NextResponse.json({ error: "请求参数不合法" }, { status: 400 });
  }
  const { state, action } = body.data;

  if (state.turnCount >= MAX_TURNS) {
    return NextResponse.json({ error: "故事已到达最大回合数" }, { status: 400 });
  }

  // 配置缺失时在建流之前返回 428，前端据此弹出配置表单
  let ai: ReturnType<typeof getAI>;
  try {
    ai = getAI(body.data.config);
  } catch (e) {
    if (e instanceof MissingConfigError) {
      return NextResponse.json({ error: e.message, needConfig: true }, { status: 428 });
    }
    throw e;
  }
  const { client, model } = ai;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 客户端可能提前断开（预取分支被取消是常态），此后 enqueue/close 都会抛错。
      // 用标志位收敛，避免异常在 catch/finally 里二次抛出并污染日志。
      let closed = false;

      const send = (event: StreamEvent): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(sseLine(event));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      try {
        // 透传客户端断开信号：预取分支被取消时立即停止上游生成，不再白烧 token
        const completion = await client.chat.completions.create(
          {
            model,
            temperature: 0.85,
            stream: true,
            messages: [
              { role: "system", content: buildTurnSystemPrompt(state) },
              ...buildHistoryMessages(state),
              { role: "user", content: action },
            ],
          },
          { signal: req.signal },
        );

        // 分隔符可能被切在多个 chunk 之间，所以需要保留尾部缓冲再判断
        let pending = "";
        let metaBuffer = "";
        let inMeta = false;

        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (!delta) continue;

          if (inMeta) {
            metaBuffer += delta;
            continue;
          }

          pending += delta;
          const idx = pending.indexOf(META_DELIMITER);
          if (idx !== -1) {
            const text = pending.slice(0, idx).trimEnd();
            if (text && !send({ type: "text", delta: text })) return;
            metaBuffer = pending.slice(idx + META_DELIMITER.length);
            pending = "";
            inMeta = true;
            continue;
          }

          // 只把不可能是分隔符前缀的部分推出去，尾部保留 delimiter 长度以防截断
          const safeLen = pending.length - META_DELIMITER.length;
          if (safeLen > 0) {
            if (!send({ type: "text", delta: pending.slice(0, safeLen) })) return;
            pending = pending.slice(safeLen);
          }
        }

        if (pending && !inMeta) {
          send({ type: "text", delta: pending });
        }

        const meta = inMeta ? parseMeta(metaBuffer) : FALLBACK_META;
        // 最后一回合模型若仍未给结局，强制收尾，避免客户端卡在无选项状态
        if (state.turnCount + 1 >= MAX_TURNS && !meta.isEnding) {
          meta.isEnding = true;
          meta.endingType = meta.endingType ?? "neutral";
          meta.choices = [];
        }
        send({ type: "meta", meta });
      } catch (e) {
        // 客户端断开是预取分支被取消时的正常路径，不记录也不推送错误
        if (!closed && !req.signal.aborted) {
          const { message } = classifyAIError(e, "剧情生成失败，请重试");
          console.error("[turn] 生成失败:", message, "|", e);
          send({ type: "error", message });
        }
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // 客户端已断开，忽略
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
