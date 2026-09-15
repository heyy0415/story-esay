"use client";

import { useState } from "react";

interface Props {
  /** 插图地址，null 表示无插图（降级为纯文字） */
  imageUrl: string | null;
  /** prompt 生成中（还没拿到图片地址） */
  loading: boolean;
}

/**
 * 场景插图。图片由第三方文生图服务按 URL 直出，加载较慢（新图约 45 秒），
 * 因此始终先显示骨架占位，加载完成再淡入；加载失败则整块隐藏，退回纯文字体验。
 */
export function Illustration({ imageUrl, loading }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // 无地址且不在生成中，或图片加载失败：不占版面
  if ((!imageUrl && !loading) || failed) return null;

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-zinc-800/50 via-zinc-900/30 to-zinc-800/50" />
          <span className="relative text-sm text-zinc-500">{loading ? "构思画面中…" : "绘制场景中…"}</span>
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
