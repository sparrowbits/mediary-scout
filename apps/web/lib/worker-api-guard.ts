import { NextResponse, type NextRequest } from "next/server";
import { isDemoMode } from "./demo-mode";
import { consumeWorkerTrigger } from "./worker-rate-limit";

/**
 * 队列触发端点（`/api/workflows/run-next`、`/api/workflows/run-type3`）的统一门禁。
 *
 * 这两个端点会**真的执行**获取流程：调网盘 API、烧 115 调用预算、往盘里写文件。
 * 门禁层次（从最硬到最软）：
 *  1. demo 实例 → 一律 403。公网只读 demo 上任何匿名请求都不该产生写侧效应。
 *  2. 配了 `MEDIA_TRACK_WORKER_SECRET` → 必须带对 header，否则 401。带对了就是
 *     operator，**不限流**（多实例 / serverless cron 需要自由节拍）。
 *  3. 多用户模式但没配 secret → 401。多用户意味着这台实例不是「只有我自己」，
 *     不能假设能碰到端口的人都有权触发全站队列。
 *  4. 单用户 + 未配 secret（默认自部署形态，历史上一直免密，为兼容外部 cron 保留）：
 *     - `?force=1` **不再免密** → 401。force 绕过「每天只在设定点跑一次」的时间门，
 *       是这套端点里唯一能被匿名放大的昂贵路径；免密 cron 从来不需要它。
 *     - 其余请求走固定窗口限流（默认 30/min），超限 429 + `Retry-After`。
 *       这挡住的是「匿名猛刷把队列当免费算力」，不影响 15s 节拍的正常 cron。
 */
export interface WorkerGuardOptions {
  /** `?force=1`：绕过每日巡检时间门的高开销路径。 */
  force?: boolean;
  /** 注入时钟，保证限流在测试里确定（默认 `Date.now`）。 */
  now?: () => number;
}

let warnedSecretless = false;

function warnSecretlessOnce(): void {
  if (warnedSecretless) return;
  warnedSecretless = true;
  console.warn(
    "[media-track] worker 触发端点未配置 MEDIA_TRACK_WORKER_SECRET：" +
      "免密仅限单用户模式下的常规 cron（已限流），?force=1 会被拒绝。" +
      "外部编排请设该环境变量并在请求里带 x-media-track-worker-secret；详见 docs/deploy.md。",
  );
}

export function workerApiGuard(
  request: NextRequest,
  options: WorkerGuardOptions = {},
): NextResponse | null {
  if (isDemoMode()) {
    return NextResponse.json({ error: "demo mode is read-only" }, { status: 403 });
  }

  const secret = process.env.MEDIA_TRACK_WORKER_SECRET;
  if (secret) {
    return request.headers.get("x-media-track-worker-secret") === secret
      ? null
      : NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (process.env.MEDIA_TRACK_MULTI_USER === "1") {
    return NextResponse.json(
      { error: "unauthorized", hint: "多用户模式必须配置 MEDIA_TRACK_WORKER_SECRET" },
      { status: 401 },
    );
  }

  if (options.force) {
    return NextResponse.json(
      {
        error: "forced worker triggers require a worker secret",
        hint: "?force=1 会绕过每日巡检时间门。设置 MEDIA_TRACK_WORKER_SECRET 后带上 x-media-track-worker-secret，或在设置页用「立即巡检」按钮（走已鉴权的 server action）。",
      },
      { status: 401 },
    );
  }

  warnSecretlessOnce();
  const verdict = consumeWorkerTrigger(new URL(request.url).pathname, options.now?.() ?? Date.now());
  if (!verdict.allowed) {
    return NextResponse.json(
      {
        error: "worker trigger rate limited",
        retryAfterSec: verdict.retryAfterSec,
        hint: "免密触发的频次上限。配 MEDIA_TRACK_WORKER_SECRET 可解除限流。",
      },
      { status: 429, headers: { "retry-after": String(verdict.retryAfterSec) } },
    );
  }

  return null;
}

/** 仅测试用：复位免密告警与限流窗口。 */
export function _resetWorkerApiGuardForTest(): void {
  warnedSecretless = false;
}
