import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetWorkerRateLimitForTest,
  _setWorkerRateLimitForTest,
  consumeWorkerTrigger,
} from "./worker-rate-limit";

const T0 = 1_700_000_000_000;

describe("consumeWorkerTrigger", () => {
  beforeEach(() => _resetWorkerRateLimitForTest());

  it("allows up to the limit inside one window, then rejects with a retry hint", () => {
    _setWorkerRateLimitForTest({ limitPerWindow: 3 });

    expect(consumeWorkerTrigger("/run-next", T0)).toEqual({ allowed: true, remaining: 2 });
    expect(consumeWorkerTrigger("/run-next", T0 + 1_000).allowed).toBe(true);
    expect(consumeWorkerTrigger("/run-next", T0 + 2_000)).toEqual({ allowed: true, remaining: 0 });

    const denied = consumeWorkerTrigger("/run-next", T0 + 3_000);
    expect(denied.allowed).toBe(false);
    if (denied.allowed) throw new Error("expected rejection");
    // 剩余窗口 57s → 向上取整 57
    expect(denied.retryAfterSec).toBe(57);
  });

  it("resumes once the window rolls over", () => {
    _setWorkerRateLimitForTest({ limitPerWindow: 2 });
    consumeWorkerTrigger("/x", T0);
    consumeWorkerTrigger("/x", T0 + 1);
    expect(consumeWorkerTrigger("/x", T0 + 2).allowed).toBe(false);
    expect(consumeWorkerTrigger("/x", T0 + 60_001).allowed).toBe(true);
  });

  it("buckets per key so one hot endpoint cannot starve another", () => {
    _setWorkerRateLimitForTest({ limitPerWindow: 1 });
    expect(consumeWorkerTrigger("/a", T0).allowed).toBe(true);
    expect(consumeWorkerTrigger("/a", T0).allowed).toBe(false);
    expect(consumeWorkerTrigger("/b", T0).allowed).toBe(true);
  });

  it("fails closed when the bucket table is saturated (rotating keys must not bypass)", () => {
    _setWorkerRateLimitForTest({ limitPerWindow: 1, maxBuckets: 2 });
    expect(consumeWorkerTrigger("/a", T0).allowed).toBe(true);
    expect(consumeWorkerTrigger("/b", T0).allowed).toBe(true);

    const denied = consumeWorkerTrigger("/c", T0);
    expect(denied.allowed).toBe(false);
    if (denied.allowed) throw new Error("expected rejection");
    expect(denied.retryAfterSec).toBeGreaterThan(0);

    // 窗口滚过后，已有 key 仍然可用（拒绝只针对新 key 的容量扩张）
    expect(consumeWorkerTrigger("/a", T0 + 60_001).allowed).toBe(true);
  });

  it("bounds the key length so a caller cannot inflate memory with long paths", () => {
    _setWorkerRateLimitForTest({ limitPerWindow: 1 });
    const longKey = `/${"x".repeat(500)}`;
    expect(consumeWorkerTrigger(longKey, T0).allowed).toBe(true);
    // 同一条超长路径的不同前缀必须共用一个桶（键被截断到同一表示）
    expect(consumeWorkerTrigger(`${longKey}y`, T0).allowed).toBe(false);
  });

  it("rejects a nonsense test hook instead of silently disabling the limit", () => {
    expect(() => _setWorkerRateLimitForTest({ limitPerWindow: 0 })).toThrow(RangeError);
    expect(() => _setWorkerRateLimitForTest({ maxBuckets: -1 })).toThrow(RangeError);
  });
});
