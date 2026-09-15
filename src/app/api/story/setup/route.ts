import { NextResponse } from "next/server";
import { getAI, MissingConfigError } from "@/lib/ai/provider";
import { SetupRequestSchema, StorySetupSchema } from "@/lib/story/schema";
import { SETUP_SYSTEM_PROMPT } from "@/lib/story/prompts";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

/** 模型偶发输出非法 JSON 时的重试次数 */
const MAX_ATTEMPTS = 2;

/** 兼容模型偶尔无视指令包裹 ```json 代码块的情况 */
function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

/**
 * POST /api/story/setup
 * 根据一句话创意生成故事开局。非流式，因为客户端需要完整结构才能渲染。
 */
export async function POST(req: Request) {
  const limit = checkRateLimit(getClientKey(req), "setup");
  if (!limit.allowed) {
    return NextResponse.json({ error: `请求过于频繁，请 ${limit.retryAfterSec} 秒后再试` }, { status: 429 });
  }

  const body = SetupRequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    // config 校验失败说明配置有问题而非创意有问题，引导去改配置
    const isConfigIssue = body.error.issues.some((i) => i.path[0] === "config");
    if (isConfigIssue) {
      return NextResponse.json({ error: "模型配置不完整，请检查 API Key 与模型名", needConfig: true }, { status: 428 });
    }
    return NextResponse.json({ error: "创意描述需在 2-300 字之间" }, { status: 400 });
  }

  // 配置缺失时返回 428，前端据此弹出配置表单
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

  let lastError = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.9,
        messages: [
          { role: "system", content: SETUP_SYSTEM_PROMPT },
          { role: "user", content: body.data.idea },
        ],
      });

      const raw = stripCodeFence(completion.choices[0]?.message?.content ?? "");
      const parsed = StorySetupSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return NextResponse.json(parsed.data);

      lastError = parsed.error.issues.map((i) => i.message).join("; ");
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  console.error("[setup] 生成失败:", lastError);
  return NextResponse.json({ error: "故事生成失败，请换个描述重试" }, { status: 502 });
}
