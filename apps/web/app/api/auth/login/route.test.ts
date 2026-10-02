import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("../../../../lib/demo-mode", () => ({ isDemoMode: vi.fn(() => false) }));
vi.mock("../../../../lib/workflow-runtime", () => ({
  SESSION_COOKIE_NAME: "mt_session",
  isMultiUserEnabled: vi.fn(() => false),
  isCookieSecure: vi.fn(() => true),
  hasLoginPassword: vi.fn(async () => true),
  loginAccount: vi.fn(async () => ({ ok: false, error: "密码不正确。" })),
}));

import { isDemoMode } from "../../../../lib/demo-mode";
import {
  hasLoginPassword,
  isMultiUserEnabled,
  loginAccount,
} from "../../../../lib/workflow-runtime";
import { POST } from "./route";

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isDemoMode as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (isMultiUserEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (hasLoginPassword as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (loginAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: "密码不正确。",
    });
  });

  it("401 on a wrong password", async () => {
    const res = await post({ username: "ignored", password: "nope" });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "密码不正确。" });
  });

  // 限流命中必须与「密码错了」可区分，否则客户端把 401 当可无限重试的失败继续灌。
  it("429 + Retry-After when throttled", async () => {
    (loginAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: "尝试过于频繁，请 120 秒后再试。",
      retryAfterSec: 120,
    });
    const res = await post({ username: "", password: "nope" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ error: "尝试过于频繁，请 120 秒后再试。" });
  });

  it("keys the throttle on the rightmost XFF hop, and ignores the username in single-user mode", async () => {
    // 经 Caddy/nginx 反代时，最右段才是反代追加的真实对端；最左段由客户端自写。
    // 单用户模式身份恒为空 —— 换用户名不能换桶。
    await post(
      { username: "whoever", password: "nope" },
      { "x-forwarded-for": "203.0.113.1, 198.51.100.7" },
    );
    expect(loginAccount).toHaveBeenLastCalledWith("whoever", "nope", "|198.51.100.7");
  });

  it("keys the throttle on the username in multi-user mode", async () => {
    (isMultiUserEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
    await post({ username: "owner", password: "nope" }, { "cf-connecting-ip": "203.0.113.9" });
    expect(loginAccount).toHaveBeenLastCalledWith("owner", "nope", "owner|203.0.113.9");
  });

  it("404 when single-user instance has no password set yet", async () => {
    (hasLoginPassword as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await post({ username: "", password: "nope" });
    expect(res.status).toBe(404);
    expect(loginAccount).not.toHaveBeenCalled();
  });

  it("403 in demo mode (read-only)", async () => {
    (isDemoMode as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const res = await post({ username: "", password: "nope" });
    expect(res.status).toBe(403);
    expect(loginAccount).not.toHaveBeenCalled();
  });

  it("sets the session cookie on success", async () => {
    (loginAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      accountId: "acct_default",
      signedCookie: "signed-value",
    });
    const res = await post({ username: "", password: "right" });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().join("")).toContain("mt_session=signed-value");
  });
});
