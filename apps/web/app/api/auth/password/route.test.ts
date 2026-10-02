import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("../../../../lib/demo-mode", () => ({ isDemoMode: vi.fn(() => false) }));
vi.mock("../../../../lib/workflow-runtime", () => {
  class UnauthenticatedAccountError extends Error {
    constructor() {
      super("未登录，请先登录后再操作。");
      this.name = "UnauthenticatedAccountError";
    }
  }
  return {
    isMultiUserEnabled: vi.fn(() => false),
    hasLoginPassword: vi.fn(async () => true),
    setSingleUserPassword: vi.fn(async () => ({ ok: true })),
    clearSingleUserPassword: vi.fn(async () => {}),
    requireAuthenticatedAccountId: vi.fn(async () => "acct_default"),
    UnauthenticatedAccountError,
  };
});

import { isDemoMode } from "../../../../lib/demo-mode";
import {
  hasLoginPassword,
  clearSingleUserPassword,
  requireAuthenticatedAccountId,
  setSingleUserPassword,
  UnauthenticatedAccountError,
  isMultiUserEnabled,
} from "../../../../lib/workflow-runtime";
import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/auth/password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isDemoMode as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (isMultiUserEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (hasLoginPassword as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (requireAuthenticatedAccountId as ReturnType<typeof vi.fn>).mockResolvedValue("acct_default");
    (setSingleUserPassword as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
  });

  it("lets an authenticated remote request change the password", async () => {
    const res = await post({ password: "s3cret-rotated" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, passwordSet: true });
    expect(setSingleUserPassword).toHaveBeenCalledWith("s3cret-rotated");
  });

  // 域名挂上公网后这条是扫描器实际打出来的请求。回归点：绝不能退化成 500。
  it("401 (not 500) for an anonymous request once a password exists", async () => {
    (requireAuthenticatedAccountId as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnauthenticatedAccountError(),
    );
    for (const body of [{ password: "hijack" }, { clear: true }]) {
      const res = await post(body);
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: "未登录，请先登录后再操作。" });
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(setSingleUserPassword).not.toHaveBeenCalled();
    expect(clearSingleUserPassword).not.toHaveBeenCalled();
  });

  it('still requires auth when the password state reads "unknown"', async () => {
    // 读不出状态必须按「已设密码」处理，否则远程匿名请求能把密码清掉。
    (hasLoginPassword as ReturnType<typeof vi.fn>).mockResolvedValue("unknown");
    (requireAuthenticatedAccountId as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnauthenticatedAccountError(),
    );
    const res = await post({ clear: true });
    expect(res.status).toBe(401);
    expect(clearSingleUserPassword).not.toHaveBeenCalled();
  });

  it("first claim stays open: no password set yet → no auth required", async () => {
    (hasLoginPassword as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await post({ password: "first-one" });
    expect(res.status).toBe(200);
    expect(requireAuthenticatedAccountId).not.toHaveBeenCalled();
    expect(setSingleUserPassword).toHaveBeenCalledWith("first-one");
  });

  it("rejects a weak password with 400", async () => {
    (setSingleUserPassword as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: "密码太短",
    });
    const res = await post({ password: "1" });
    expect(res.status).toBe(400);
  });

  it("403 in demo mode (read-only)", async () => {
    (isDemoMode as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const res = await post({ password: "whatever" });
    expect(res.status).toBe(403);
    expect(setSingleUserPassword).not.toHaveBeenCalled();
  });
});
