import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, connection: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("../../../../lib/workflow-runtime", () => ({
  runScheduledType3: vi.fn().mockResolvedValue({ status: "idle" }),
}));

import { GET, POST } from "./route";
import { runScheduledType3 } from "../../../../lib/workflow-runtime";
import { _resetWorkerRateLimitForTest } from "../../../../lib/worker-rate-limit";

function request(method: "GET" | "POST", options?: { secret?: string; force?: boolean }) {
  const url = new URL("http://localhost/api/workflows/run-type3");
  if (options?.force) url.searchParams.set("force", "1");
  return new NextRequest(url, {
    method,
    ...(options?.secret ? { headers: { "x-media-track-worker-secret": options.secret } } : {}),
  });
}

describe("/api/workflows/run-type3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("MEDIA_TRACK_DEMO_MODE", "");
    vi.stubEnv("MEDIA_TRACK_MULTI_USER", "");
    vi.stubEnv("MEDIA_TRACK_WORKER_SECRET", "");
    _resetWorkerRateLimitForTest();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects forced demo-mode sweeps without running patrol", async () => {
    vi.stubEnv("MEDIA_TRACK_DEMO_MODE", "1");

    const response = await GET(request("GET", { force: true }));

    expect(response.status).toBe(403);
    expect(runScheduledType3).not.toHaveBeenCalled();
  });

  it("fails closed in multi-user mode when no worker secret is configured", async () => {
    vi.stubEnv("MEDIA_TRACK_MULTI_USER", "1");

    const response = await POST(request("POST"));

    expect(response.status).toBe(401);
    expect(runScheduledType3).not.toHaveBeenCalled();
  });

  it("rejects a mismatched configured worker secret", async () => {
    vi.stubEnv("MEDIA_TRACK_WORKER_SECRET", "expected");

    const response = await POST(request("POST", { secret: "wrong" }));

    expect(response.status).toBe(401);
    expect(runScheduledType3).not.toHaveBeenCalled();
  });

  it("accepts a configured worker secret and preserves the force flag", async () => {
    vi.stubEnv("MEDIA_TRACK_WORKER_SECRET", "expected");

    const response = await GET(request("GET", { secret: "expected", force: true }));

    expect(response.status).toBe(200);
    expect(runScheduledType3).toHaveBeenCalledWith({ force: true });
  });

  // `?force=1` skips the once-per-Beijing-day gate, so it is the one trigger an
  // anonymous caller must never get: 401 unless the worker secret is presented.
  it("401s an anonymous forced sweep instead of bypassing the daily gate", async () => {
    const response = await GET(request("GET", { force: true }));

    expect(response.status).toBe(401);
    expect(runScheduledType3).not.toHaveBeenCalled();
  });

  it("preserves secretless single-user cron compatibility", async () => {
    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(runScheduledType3).toHaveBeenCalledWith({ force: false });
  });
});
