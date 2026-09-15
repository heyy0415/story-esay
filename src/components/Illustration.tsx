"use client";

import { useState } from "react";
import { useCreepingProgress } from "@/lib/useCreepingProgress";
import { isWarmed } from "@/lib/story/image-warm";

/** 各阶段实测耗时，用于换算进度爬升速度 */
const PROMPT_EXPECTED_MS = 8_000;
const IMAGE_EXPECTED_MS = 35_000;

interface Props {
  /** 插图地址，null 表示尚无地址（prompt 生成中）或生成失败 */
  imageUrl: string | null;
  /** prompt 生成中（还没拿到图片地址） */
  loading: boolean;
}

/**
 * 场景插图。图片由第三方文生图服务按 URL 直出，未预热的新图约需数十秒，
 * 因此先显示带进度的占位，加载完成再淡入；加载失败则整块隐藏，退回纯文字体验。
 */
export function Illustration({ imageUrl, loading }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // 已预热的图约 1 秒即到，显示进度条只会闪一下，反而不如直接留空
  const prewarmed = !!imageUrl && isWarmed(imageUrl);

  // 两个阶段耗时差一个量级，分开计时才能让进度贴近实际
  const inPromptPhase = loading && !imageUrl;
  const active = (loading || !!imageUrl) && !loaded && !prewarmed;
  const [percent, capped] = useCreepingProgress(active, inPromptPhase ? PROMPT_EXPECTED_MS : IMAGE_EXPECTED_MS);

  // 无地址且不在生成中，或图片加载失败：不占版面
  if ((!imageUrl && !loading) || failed) return null;

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60">
      {/* 已预热时只用微光占位，避免为约 1 秒的加载闪一个进度条 */}
      {!loaded && prewarmed && <div className="absolute inset-0 animate-pulse bg-zinc-800/40" />}

      {!loaded && !prewarmed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8">
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-zinc-800/50 via-zinc-900/30 to-zinc-800/50" />

          <div className="relative flex w-full max-w-xs flex-col gap-2">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-zinc-400">{stageLabel(inPromptPhase, capped)}</span>
              <span className="tabular-nums text-amber-300">{percent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-amber-400/80 transition-all duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {imageUrl && (
        // 第三方图片地址，不走 next/image 优化（避免 Vercel 免费版图片转换额度）
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt="场景插图"
          className={`h-full w-full object-cover transition-opacity duration-700 ${loaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

/** 封顶后改文案，不假装即将完成——服务慢时确实可能还要等一会 */
function stageLabel(inPromptPhase: boolean, capped: boolean): string {
  if (inPromptPhase) return "构思画面…";
  return capped ? "仍在绘制，请稍候" : "绘制场景中";
}
