/**
 * 内存滑动窗口限流。Vercel Serverless 实例不共享内存，所以这是"尽力而为"的防护：
 * 单实例内能拦住脚本刷量，跨实例可能略超限，但对公开 demo 足够。
 * 生产级方案应换 Upstash Redis 等外部存储。
 */

/**
 * 按接口类型分桶。预取会让每次玩家移动产生多个并发 turn/illustrate 请求，
 * 因此这两类配额需要留足余量；setup 每局仅一次且最贵，单独收紧。
 */
const QUOTAS = {
  /**
   * 回合生成：预取让每次移动产生约 3 个请求。取 60 可支撑单分钟内走完
   * 整局（MAX_TURNS=15，约需 45 次），避免玩家快速推进时在结局前撞限流。
   */
  turn: { windowMs: 60_000, max: 60 },
  /** 插图：与 turn 一比一产生；超限后果仅是无图降级，不必更高 */
  illustrate: { windowMs: 60_000, max: 60 },
  /** 开局：每局一次，压低可挡住反复刷世界设定这类最烧 token 的滥用 */
  setup: { windowMs: 60_000, max: 5 },
} as const;

export type QuotaKind = keyof typeof QUOTAS;

const buckets = new Map<string, number[]>();

/**
 * 检查某个客户端在指定配额下是否超限
 * @param key 客户端标识，通常取 getClientKey(req)
 * @param kind 配额类型，不同接口互不干扰
 * @returns allowed 为 false 时附带需等待的秒数
 */
export function checkRateLimit(key: string, kind: QuotaKind = "turn"): { allowed: boolean; retryAfterSec: number } {
  const { windowMs, max } = QUOTAS[kind];
  const bucketKey = `${kind}:${key}`;
  const now = Date.now();
  const timestamps = (buckets.get(bucketKey) ?? []).filter((t) => now - t < windowMs);

  if (timestamps.length >= max) {
    const retryAfterSec = Math.ceil((timestamps[0] + windowMs - now) / 1000);
    return { allowed: false, retryAfterSec };
  }

  timestamps.push(now);
  buckets.set(bucketKey, timestamps);

  // 避免 Map 无限增长：偶发地清理空桶
  if (buckets.size > 5000) {
    const maxWindow = Math.max(...Object.values(QUOTAS).map((q) => q.windowMs));
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= maxWindow)) buckets.delete(k);
    }
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** 从请求头提取客户端 IP，Vercel 会注入 x-forwarded-for */
export function getClientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0].trim() || req.headers.get("x-real-ip") || "anonymous";
}
