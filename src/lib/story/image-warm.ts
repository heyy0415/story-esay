"use client";

/**
 * 图片预热与串行队列。
 *
 * 文生图服务（Pollinations 免费层）有全平台共享的上游限流，实测并发 4 路只有 1 路成功、
 * 其余返回 429/500；串行则 100% 成功。因此所有图片请求必须排队串行发出。
 *
 * 预热的价值：同一 URL 首次请求触发生成（约 45 秒），生成后进入服务端缓存，
 * 再次请求仅约 1 秒。预热过的图在 <img> 加载时即为秒开。
 */

/** 串行队列的请求间隔，给上游留出恢复时间 */
const QUEUE_GAP_MS = 800;

/** 单张图的最大重试次数。首次请求常因上游限流失败，重试即可成功 */
const MAX_RETRIES = 3;

/** 单次请求超时。出图约 45 秒，留足余量 */
const REQUEST_TIMEOUT_MS = 120_000;

/** 已预热成功的 URL，避免重复预热 */
const warmed = new Set<string>();

/** 串行队列尾部，新任务链在其后 */
let queueTail: Promise<unknown> = Promise.resolve();

/**
 * 把任务加入串行队列。前一个任务完成后间隔 QUEUE_GAP_MS 再执行下一个，
 * 避免并发触发上游限流。
 */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queueTail.then(async () => {
    await new Promise((r) => setTimeout(r, QUEUE_GAP_MS));
    return task();
  });
  // 队列尾部吞掉错误，否则一次失败会阻断后续所有任务
  queueTail = result.catch(() => {});
  return result;
}

/**
 * 预热一张图片：请求 URL 触发服务端生成并落入其缓存。
 * 带重试，因为首次请求常因上游限流失败。
 *
 * @param onAttempt 每次尝试前回调，用于向 UI 报告进度
 * @returns 是否预热成功。失败不抛错——预热是优化手段，失败仅意味着玩家看图时要多等
 */
export function warmImage(url: string, signal?: AbortSignal, onAttempt?: (attempt: number) => void): Promise<boolean> {
  if (warmed.has(url)) return Promise.resolve(true);

  return enqueue(async () => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (signal?.aborted) return false;
      onAttempt?.(attempt);

      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const merged = signal ? AbortSignal.any([signal, timeout]) : timeout;

      try {
        const res = await fetch(url, { signal: merged, cache: "force-cache" });
        // 上游限流时服务端返回 500/429 且 body 是 JSON 错误而非图片
        if (res.ok && res.headers.get("content-type")?.startsWith("image/")) {
          // 必须读完 body，否则连接可能未完成、服务端缓存未落地
          await res.arrayBuffer();
          warmed.add(url);
          return true;
        }
      } catch {
        if (signal?.aborted) return false;
        // 超时或网络错误，继续重试
      }

      // 退避后重试，给上游限流窗口恢复时间
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
    return false;
  });
}

/** 该 URL 是否已预热（<img> 可期待秒开） */
export function isWarmed(url: string): boolean {
  return warmed.has(url);
}
