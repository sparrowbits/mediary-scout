/**
 * 固定窗口限流（worker 触发端点在**未配 secret** 时的兜底闸门）。
 *
 * 为什么需要它：`/api/workflows/run-next` 与 `/api/workflows/run-type3` 是给外部
 * cron 用的。默认单用户自部署**没有**登录，也不强制要求 secret（历史兼容，见
 * `worker-api-guard.ts`），于是同一台机器上的任意进程 —— 以及 `:3000` 可达范围内
 * 的任何人 —— 都能反复触发**真实获取**（消耗网盘调用预算、真实写盘、产生通知）。
 * 不能靠「反正是局域网」赌安全：部署指南本身把 Tailscale / Cloudflare Tunnel 列为
 * 常规用法，暴露面从来不止本机。
 *
 * 设计（与 `login-throttle.ts` 同一套取舍）：
 *  - 进程内 Map，无 DB、无 Redis：本项目就是单进程自托管。横向扩展时退化为
 *    「每副本各算一份」，届时须迁到共享存储。
 *  - 只限**未配 secret** 的路径：配了 secret 的编排（多实例 / serverless cron）
 *    已经证明自己知道密钥，不该被限流误伤。
 *  - 按 `path` 分桶，不按 IP：XFF 客户端可伪造，拿它做 allow-list 只会给出假的
 *    安全性；而这里的目标是**封顶触发频次**，与来源无关。
 */

export type RateVerdict =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSec: number };

/** 窗口长度：1 分钟。 */
const WINDOW_MS = 60_000;
/**
 * 每窗口允许的触发次数。外部 cron 的常规节奏是 run-next 每 15s 一次（=4/min），
 * 30/min 给了 7.5× 余量，正常编排碰不到；而匿名猛刷会在几秒内被 429 截住。
 */
const DEFAULT_LIMIT_PER_WINDOW = 30;
/** 桶数硬上限（攻击者轮换路径名时不至于把内存当免费存储）。 */
const DEFAULT_MAX_BUCKETS = 1_000;

interface Bucket {
  windowStart: number;
  count: number;
}

const buckets = new Map<string, Bucket>();
let maxBuckets = DEFAULT_MAX_BUCKETS;
let limitPerWindow = DEFAULT_LIMIT_PER_WINDOW;

/**
 * 消费一次配额。`key` 建议用请求路径（调用方负责截断到有界长度）。
 * 超限时返回最早可重试的秒数，供 `Retry-After` 使用。
 */
export function consumeWorkerTrigger(key: string, now: number): RateVerdict {
  const boundedKey = key.slice(0, 128);
  const bucket = buckets.get(boundedKey);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    // 新窗口。只有确实要新建桶时才查容量——容量已满就整体拒绝（fail closed）。
    // 绝不能在这里「顺手放行」，否则轮换 key 就是绕过限流的正门。
    if (!bucket && buckets.size >= maxBuckets) {
      let soonest = Infinity;
      for (const b of buckets.values()) {
        if (b.windowStart + WINDOW_MS < soonest) soonest = b.windowStart + WINDOW_MS;
      }
      if (!Number.isFinite(soonest)) return { allowed: false, retryAfterSec: 1 };
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((soonest - now) / 1000)) };
    }
    buckets.set(boundedKey, { windowStart: now, count: 1 });
    return { allowed: true, remaining: limitPerWindow - 1 };
  }
  if (bucket.count >= limitPerWindow) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000)),
    };
  }
  bucket.count += 1;
  return { allowed: true, remaining: limitPerWindow - bucket.count };
}

/** 仅测试用：清空窗口并恢复默认参数。 */
export function _resetWorkerRateLimitForTest(): void {
  buckets.clear();
  maxBuckets = DEFAULT_MAX_BUCKETS;
  limitPerWindow = DEFAULT_LIMIT_PER_WINDOW;
}

/** 仅测试用：下调限额/容量，以便用几次循环覆盖拒绝与饱和路径。 */
export function _setWorkerRateLimitForTest(options: { limitPerWindow?: number; maxBuckets?: number }): void {
  if (options.limitPerWindow !== undefined) {
    if (!Number.isInteger(options.limitPerWindow) || options.limitPerWindow < 1) {
      throw new RangeError(`limitPerWindow 需要 >= 1 的整数，收到 ${options.limitPerWindow}`);
    }
    limitPerWindow = options.limitPerWindow;
  }
  if (options.maxBuckets !== undefined) {
    if (!Number.isInteger(options.maxBuckets) || options.maxBuckets < 1) {
      throw new RangeError(`maxBuckets 需要 >= 1 的整数，收到 ${options.maxBuckets}`);
    }
    maxBuckets = options.maxBuckets;
  }
}
