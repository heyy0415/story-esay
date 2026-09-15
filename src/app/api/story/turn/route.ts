import { NextResponse } from "next/server";
import { getAI } from "@/lib/ai/provider";
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
  const limit = checkRateLimit(getClientKey(req));
  if (!limit.allowed) {
    return NextResponse.json({ error: `请求过于频繁，请 ${limit.retryAfterSec} 秒后再试` }, { status: 429 });
  }

  const body = TurnRequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "请求参数不合法" }, { status: 400 });
  }
  const { state, action } = body.data;

  if (state.turnCount >= MAX_TURNS) {
    return NextResponse.json({ error: "故事已到达最大回合数" }, { status: 400 });
  }

  // 配置缺失属于部署问题，在建流之前就返回 JSON 错误，避免前端拿到空 body
  let ai: ReturnType<typeof getAI>;
  try {
    ai = getAI();
  } catch (e) {
    const message = e instanceof Error ? e.message : "AI 配置错误";
    console.error("[turn] 配置错误:", message);
    return NextResponse.json({ error: `服务端配置错误：${message}` }, { status: 500 });
  }
  const { client, model } = ai;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const completion = await client.chat.completions.create({
          model,
          temperature: 0.85,
          stream: true,
          messages: [
            { role: "system", content: buildTurnSystemPrompt(state) },
            ...buildHistoryMessages(state),
            { role: "user", content: action },
          ],
        });

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
            if (text) controller.enqueue(sseLine({ type: "text", delta: text }));
            metaBuffer = pending.slice(idx + META_DELIMITER.length);
            pending = "";
            inMeta = true;
            continue;
          }

          // 只把不可能是分隔符前缀的部分推出去，尾部保留 delimiter 长度以防截断
          const safeLen = pending.length - META_DELIMITER.length;
          if (safeLen > 0) {
            controller.enqueue(sseLine({ type: "text", delta: pending.slice(0, safeLen) }));
            pending = pending.slice(safeLen);
          }
        }

        if (pending && !inMeta) {
          controller.enqueue(sseLine({ type: "text", delta: pending }));
        }

        const meta = inMeta ? parseMeta(metaBuffer) : FALLBACK_META;
        // 最后一回合模型若仍未给结局，强制收尾，避免客户端卡在无选项状态
        if (state.turnCount + 1 >= MAX_TURNS && !meta.isEnding) {
          meta.isEnding = true;
          meta.endingType = meta.endingType ?? "neutral";
          meta.choices = [];
        }
        controller.enqueue(sseLine({ type: "meta", meta }));
      } catch (e) {
        console.error("[turn] 生成失败:", e instanceof Error ? e.message : e);
        controller.enqueue(sseLine({ type: "error", message: "剧情生成失败，请重试" }));
      } finally {
        controller.close();
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
