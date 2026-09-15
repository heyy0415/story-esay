/**
 * 内存滑动窗口限流。Vercel Serverless 实例不共享内存，所以这是"尽力而为"的防护：
 * 单实例内能拦住脚本刷量，跨实例可能略超限，但对公开 demo 足够。
 * 生产级方案应换 Upstash Redis 等外部存储。
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

const buckets = new Map<string, number[]>();

/**
 * 检查某个 key（通常是 IP）在当前窗口内是否超限
 * @returns allowed 为 false 时附带需等待的秒数
 */
export function checkRateLimit(key: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const timestamps = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

  if (timestamps.length >= MAX_PER_WINDOW) {
    const retryAfterSec = Math.ceil((timestamps[0] + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSec };
  }

  timestamps.push(now);
  buckets.set(key, timestamps);

  // 避免 Map 无限增长：偶发地清理空桶
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= WINDOW_MS)) buckets.delete(k);
    }
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** 从请求头提取客户端 IP，Vercel 会注入 x-forwarded-for */
export function getClientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0].trim() || req.headers.get("x-real-ip") || "anonymous";
}
