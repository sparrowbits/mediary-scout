import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  _resetWorkerApiGuardForTest,
  workerApiGuard,
} from "./worker-api-guard";
import { _resetWorkerRateLimitForTest, _setWorkerRateLimitForTest } from "./worker-rate-limit";

const T0 = 1_700_000_000_000;

function request(options: { secret?: string; force?: boolean; path?: string } = {}) {
  const url = new URL(`http://localhost${options.path ?? "/api/workflows/run-type3"}`);
  if (options.force) url.searchParams.set("force", "1");
  return new NextRequest(url, {
    method: "POST",
    ...(options.secret ? { headers: { "x-media-track-worker-secret": options.secret } } : {}),
  });
}

describe("workerApiGuard", () => {
  beforeEach(() => {
    vi.stubEnv("MEDIA_TRACK_DEMO_MODE", "");
    vi.stubEnv("MEDIA_TRACK_MULTI_USER", "");
    vi.stubEnv("MEDIA_TRACK_WORKER_SECRET", "");
    _resetWorkerRateLimitForTest();
    _resetWorkerApiGuardForTest();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("403s a demo instance even for a gated (non-forced) trigger", () => {
    vi.stubEnv("MEDIA_TRACK_DEMO_MODE", "1");
    expect(workerApiGuard(request(), { now: () => T0 })?.status).toBe(403);
  });

  it("accepts the right secret and 401s anything else", () => {
    vi.stubEnv("MEDIA_TRACK_WORKER_SECRET", "expected");
    expect(workerApiGuard(request({ secret: "expected" }), { now: () => T0 })).toBeNull();
    expect(workerApiGuard(request({ secret: "wrong" }), { now: () => T0 })?.status).toBe(401);
    expect(workerApiGuard(request(), { now: () => T0 })?.status).toBe(401);
  });

  it("never rate-limits a caller that proved the secret (free cron cadence)", () => {
    vi.stubEnv("MEDIA_TRACK_WORKER_SECRET", "expected");
    _setWorkerRateLimitForTest({ limitPerWindow: 2 });
    for (let i = 0; i < 10; i += 1) {
      expect(workerApiGuard(request({ secret: "expected" }), { now: () => T0 })).toBeNull();
    }
  });

  it("401s a secretless multi-user instance", () => {
    vi.stubEnv("MEDIA_TRACK_MULTI_USER", "1");
    expect(workerApiGuard(request(), { now: () => T0 })?.status).toBe(401);
  });

  it("401s an anonymous ?force=1 — forcing the sweep is never free", () => {
    // The route parses `?force=1` and passes it in — that wiring is covered by
    // apps/web/app/api/workflows/run-type3/route.test.ts; here we assert the gate.
    const denied = workerApiGuard(request({ force: true }), { now: () => T0, force: true });
    expect(denied?.status).toBe(401);
  });

  it("allows a secretless gated cron ping but 429s past the window budget", async () => {
    _setWorkerRateLimitForTest({ limitPerWindow: 3 });
    for (let i = 0; i < 3; i += 1) {
      expect(workerApiGuard(request({ path: "/api/workflows/run-next" }), { now: () => T0 + i })).toBeNull();
    }
    const denied = workerApiGuard(request({ path: "/api/workflows/run-next" }), { now: () => T0 + 3 });
    expect(denied?.status).toBe(429);
    expect(denied?.headers.get("retry-after")).toBeTruthy();

    // 窗口滚过 → 恢复
    expect(workerApiGuard(request({ path: "/api/workflows/run-next" }), { now: () => T0 + 60_001 })).toBeNull();
  });

  it("warns the operator once (not per request) about the secretless mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    workerApiGuard(request(), { now: () => T0 });
    workerApiGuard(request(), { now: () => T0 + 1 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("MEDIA_TRACK_WORKER_SECRET");
    warn.mockRestore();
  });
});
