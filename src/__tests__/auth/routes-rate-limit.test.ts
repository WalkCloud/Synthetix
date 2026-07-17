import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findFirst: dbMocks.findFirst,
      count: dbMocks.count,
      create: dbMocks.create,
    },
  },
}));

vi.mock("@/lib/auth/password", () => ({
  verifyPassword: vi.fn(async () => false),
  hashPassword: vi.fn(async () => "hashed-password"),
}));

vi.mock("@/lib/auth/jwt", () => ({
  signAccessToken: vi.fn(async () => "access-token"),
  signRefreshToken: vi.fn(async () => "refresh-token"),
}));

vi.mock("@/lib/auth/session", () => ({
  setAuthCookies: vi.fn(async () => undefined),
}));

import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as setup } from "@/app/api/v1/auth/setup/route";
import { resetRateLimitsForTest } from "@/lib/auth/rate-limit";

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("auth route rate limiting", () => {
  beforeEach(() => {
    resetRateLimitsForTest();
    vi.clearAllMocks();
    dbMocks.findFirst.mockResolvedValue(null);
    dbMocks.count.mockResolvedValue(0);
  });

  it("limits repeated login failures before another user lookup", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await login(jsonRequest("/api/v1/auth/login", {
        username: " MissingUser ",
        password: "wrong",
      }));
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: "Invalid credentials",
        code: "unauthorized",
      });
    }

    const blocked = await login(jsonRequest("/api/v1/auth/login", {
      username: "missinguser",
      password: "wrong",
    }));

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    await expect(blocked.json()).resolves.toMatchObject({
      error: "Invalid credentials",
      code: "unauthorized",
    });
    expect(dbMocks.findFirst).toHaveBeenCalledTimes(5);
  });

  it("limits repeated setup failures and clears the IP key after success", async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await setup(jsonRequest("/api/v1/auth/setup", {
        username: "ab",
        password: "short",
      }));
      expect(response.status).toBe(400);
    }

    dbMocks.create.mockResolvedValue({
      id: "user-1",
      username: "admin",
      email: null,
      displayName: "Admin",
      role: "admin",
    });
    const success = await setup(jsonRequest("/api/v1/auth/setup", {
      username: "admin",
      password: "valid-password",
      displayName: "Admin",
    }));
    expect(success.status).toBe(201);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await setup(jsonRequest("/api/v1/auth/setup", {
        username: "ab",
        password: "short",
      }));
      expect(response.status).toBe(400);
    }

    const blocked = await setup(jsonRequest("/api/v1/auth/setup", {
      username: "ab",
      password: "short",
    }));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
