/**
 * 文生图渠道。当前使用 Pollinations（免费、无需 key），
 * 通过环境变量可切到任意兼容渠道，避免单点依赖。
 */

const POLLINATIONS_BASE = "https://image.pollinations.ai/prompt";

/** 16:9 适配故事插图的宽屏比例 */
const IMAGE_WIDTH = 1024;
const IMAGE_HEIGHT = 576;

/** 负向提示：抑制文字/水印类产物，以及写实场景里常见的畸变 */
const NEGATIVE_PROMPT = "text, watermark, logo, signature, caption, letters, deformed hands, extra limbs, blurry, low quality";

/**
 * 构建图片 URL。Pollinations 是 GET 取图，URL 本身即图片地址，
 * 因此直接把地址交给前端 <img> 加载，服务端不代理图片字节——
 * 省掉 Vercel 免费版的带宽与函数执行时间。
 *
 * @param prompt 英文绘画 prompt
 * @param seed 固定 seed 让同一场景重复请求命中缓存（缓存命中 1-3s，新图约 45s）
 */
export function buildImageUrl(prompt: string, seed: number): string {
  const base = process.env.IMAGE_BASE_URL || POLLINATIONS_BASE;
  const full = `${prompt}. Negative: ${NEGATIVE_PROMPT}`;

  const params = new URLSearchParams({
    width: String(IMAGE_WIDTH),
    height: String(IMAGE_HEIGHT),
    seed: String(seed),
    nologo: "true",
    model: process.env.IMAGE_MODEL || "flux",
  });

  return `${base}/${encodeURIComponent(full)}?${params}`;
}

/**
 * 由场景文本派生稳定 seed。
 * 相同剧情重复进入时命中图片缓存，既快又省额度；不同剧情得到不同画面。
 */
export function deriveSeed(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 1_000_000;
}
