import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  accessToken: null as string | null,
  refreshToken: null as string | null,
  authorization: null as string | null,
  verifyToken: vi.fn(),
  resolveApiKeyUser: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (key: string) => {
      const value = key === "access_token" ? state.accessToken : state.refreshToken;
      return value ? { value } : undefined;
    },
  }),
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === "authorization" ? state.authorization : null,
  }),
}));

vi.mock("@/lib/auth/jwt", () => ({
  verifyToken: state.verifyToken,
  signAccessToken: vi.fn(async () => "new-access"),
  signRefreshToken: vi.fn(async () => "new-refresh"),
}));

vi.mock("@/lib/auth/api-key", () => ({
  resolveApiKeyUser: state.resolveApiKeyUser,
}));

import { getAuthUser, refreshSession } from "@/lib/auth/session";

describe("auth session token locations", () => {
  beforeEach(() => {
    state.accessToken = null;
    state.refreshToken = null;
    state.authorization = null;
    state.verifyToken.mockReset();
    state.resolveApiKeyUser.mockReset();
  });

  it("authenticates ordinary requests with an access token", async () => {
    state.accessToken = "access";
    state.verifyToken.mockResolvedValue({
      userId: "user-1",
      username: "admin",
      role: "admin",
      kind: "access",
    });

    await expect(getAuthUser()).resolves.toMatchObject({ id: "user-1", username: "admin" });
    expect(state.verifyToken).toHaveBeenCalledWith("access", "access");
  });

  it("does not authenticate an ordinary request with only a refresh token", async () => {
    state.refreshToken = "refresh";
    await expect(getAuthUser()).resolves.toBeNull();
    expect(state.verifyToken).not.toHaveBeenCalled();
  });

  it("does not fall back to refresh when the access token is invalid", async () => {
    state.accessToken = "expired-access";
    state.refreshToken = "refresh";
    state.verifyToken.mockRejectedValue(new Error("expired"));

    await expect(getAuthUser()).resolves.toBeNull();
    expect(state.verifyToken).toHaveBeenCalledTimes(1);
    expect(state.verifyToken).toHaveBeenCalledWith("expired-access", "access");
  });

  it("uses the refresh token only through the refresh boundary", async () => {
    state.refreshToken = "refresh";
    state.verifyToken.mockResolvedValue({
      userId: "user-1",
      username: "admin",
      role: "admin",
      kind: "refresh",
    });

    await expect(refreshSession()).resolves.toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      user: { id: "user-1" },
    });
    expect(state.verifyToken).toHaveBeenCalledWith("refresh", "refresh");
  });

  it("falls back to API key when no cookie token is present", async () => {
    state.authorization = "Bearer sk-synt-test";
    state.resolveApiKeyUser.mockResolvedValue({
      id: "user-2",
      username: "mcp-client",
      email: null,
      displayName: "",
      role: "admin",
    });

    await expect(getAuthUser()).resolves.toMatchObject({ id: "user-2" });
    expect(state.resolveApiKeyUser).toHaveBeenCalledWith("Bearer sk-synt-test");
  });

  it("prefers a valid access token over an API key", async () => {
    state.accessToken = "access";
    state.authorization = "Bearer sk-synt-test";
    state.verifyToken.mockResolvedValue({
      userId: "user-1",
      username: "admin",
      role: "admin",
      kind: "access",
    });

    await expect(getAuthUser()).resolves.toMatchObject({ id: "user-1" });
    expect(state.resolveApiKeyUser).not.toHaveBeenCalled();
  });

  it("falls back to API key when the access token is invalid", async () => {
    state.accessToken = "expired";
    state.authorization = "Bearer sk-synt-test";
    state.verifyToken.mockRejectedValue(new Error("expired"));
    state.resolveApiKeyUser.mockResolvedValue({ id: "user-2", username: "mcp" });

    await expect(getAuthUser()).resolves.toMatchObject({ id: "user-2" });
    expect(state.resolveApiKeyUser).toHaveBeenCalledWith("Bearer sk-synt-test");
  });

  it("returns null when neither cookie nor API key authenticate", async () => {
    state.authorization = "Bearer invalid";
    state.resolveApiKeyUser.mockResolvedValue(null);

    await expect(getAuthUser()).resolves.toBeNull();
  });
});
