import { NextResponse } from "next/server";
import { getAI } from "@/lib/ai/provider";
import { IllustrateRequestSchema } from "@/lib/story/schema";
import { IMAGE_PROMPT_SYSTEM, buildImagePromptRequest } from "@/lib/story/prompts";
import { buildImageUrl, deriveSeed } from "@/lib/story/image";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

/** 绘画 prompt 的合理长度上限，超长说明模型没遵守指令 */
const MAX_PROMPT_LENGTH = 600;

/**
 * POST /api/story/illustrate
 * 为一段叙事生成场景插图，返回图片 URL（不代理图片字节，省带宽）。
 *
 * 这是非关键路径：任何失败都返回 200 + imageUrl:null，
 * 前端静默降级为纯文字，绝不因插图失败影响剧情推进。
 */
export async function POST(req: Request) {
  const limit = checkRateLimit(getClientKey(req), "illustrate");
  if (!limit.allowed) return NextResponse.json({ imageUrl: null });

  const body = IllustrateRequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ imageUrl: null });

  let ai: ReturnType<typeof getAI>;
  try {
    ai = getAI();
  } catch {
    return NextResponse.json({ imageUrl: null });
  }

  const { genre, narrative } = body.data;

  try {
    // 先把中文剧情翻成英文绘画 prompt——图像模型对英文+摄影术语的响应远好于中文原文
    // 透传断开信号：预取分支被取消时停止上游生成
    const completion = await ai.client.chat.completions.create(
      {
        model: ai.model,
        temperature: 0.7,
        messages: [
          { role: "system", content: IMAGE_PROMPT_SYSTEM },
          { role: "user", content: buildImagePromptRequest(genre, narrative) },
        ],
      },
      { signal: req.signal },
    );

    const prompt = completion.choices[0]?.message?.content?.trim().replace(/\s+/g, " ") ?? "";
    if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
      console.warn("[illustrate] prompt 不合法，长度:", prompt.length);
      return NextResponse.json({ imageUrl: null });
    }

    return NextResponse.json({
      imageUrl: buildImageUrl(prompt, deriveSeed(narrative)),
      prompt,
    });
  } catch (e) {
    // 取消是预取被丢弃时的正常路径，不记为失败以免污染日志
    if (!req.signal.aborted) {
      console.warn("[illustrate] 生成失败:", e instanceof Error ? e.message : e);
    }
    return NextResponse.json({ imageUrl: null });
  }
}
