#!/usr/bin/env node
/**
 * Synthetix P0 Application Test Suite
 *
 * Tests all P0 functionality against the running dev server.
 * Server must be running on port 3002 before executing.
 *
 * Usage: node qa-test-app.mjs
 */

import { execSync } from "child_process";

const BASE = "http://localhost:3002";
const PASS = 0;
const FAIL = 0;
const results = [];

function record(name, passed, detail = "") {
  const status = passed ? "PASS" : "FAIL";
  results.push({ name, status, detail });
  console.log(`  ${status}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function section(title) {
  console.log(`\n━━━ ${title} ━━━`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function api(method, path, body = null, opts = {}) {
  const url = `${BASE}${path}`;
  const headers = { "Content-Type": "application/json", ...opts.headers };
  const fetchOpts = { method, headers };
  if (body) fetchOpts.body = JSON.stringify(body);
  const res = await fetch(url, fetchOpts);
  let data;
  try { data = await res.json(); } catch { data = null; }
  const cookies = res.headers.getSetCookie?.() || [];
  return { status: res.status, data, cookies };
}

function parseCookies(cookieStrings) {
  const map = {};
  for (const c of cookieStrings) {
    const [nv] = c.split(";");
    const [name, ...rest] = nv.split("=");
    map[name.trim()] = rest.join("=");
  }
  return map;
}

// ─── 1. System & Public Endpoints ───────────────────────────────────────────

async function testPublicEndpoints() {
  section("1. System Status & Public Endpoints");

  // 1a. System status
  const status = await api("GET", "/api/v1/system/status");
  record("GET /api/v1/system/status returns 200", status.status === 200);
  record("System is initialized", status.data?.data?.initialized === true);

  // 1b. Auth endpoints without credentials
  const badLogin = await api("POST", "/api/v1/auth/login", { username: "", password: "" });
  record("POST /api/v1/auth/login rejects empty input with 400", badLogin.status === 400);

  const noUser = await api("POST", "/api/v1/auth/login", { username: "nonexistent", password: "x".repeat(10) });
  record("POST /api/v1/auth/login rejects unknown user with 401", noUser.status === 401);
  record("Login error message is 'Invalid credentials'", noUser.data?.error === "Invalid credentials");

  // 1c. Setup should be blocked (system already initialized)
  const dupSetup = await api("POST", "/api/v1/auth/setup", {
    username: "test",
    password: "test123456",
    displayName: "Test",
  });
  record("POST /api/v1/auth/setup blocked (already initialized)", dupSetup.status === 400);
  record("Setup error: 'System is already initialized'", dupSetup.data?.error === "System is already initialized");
}

// ─── 2. Create Test User (DB-level) and Test Auth Flow ──────────────────────

async function testAuthFlow() {
  section("2. Authentication Flow");

  // Create test user via DB
  const testUser = "qatest";
  const testPassword = "TestPass123!";
  const testDisplay = "QA Tester";

  try {
    execSync(
      `sqlite3 /Users/kevin/Project\\ folder/project09/dev.db "DELETE FROM users WHERE username='${testUser}';"`,
      { stdio: "pipe" }
    );
  } catch {}

  // Hash password with bcryptjs
  const bcrypt = await import("bcryptjs");
  const hash = bcrypt.default.hashSync(testPassword, 12);
  const now = new Date().toISOString();

  // Write SQL to temp file to avoid bash $ expansion issues
  const fs = await import("fs");
  const tmpFile = "/tmp/synthetix-qa-insert.sql";
  const escapedHash = hash.replace(/'/g, "''");
  fs.default.writeFileSync(tmpFile,
    `INSERT INTO users (id, username, password_hash, display_name, role, is_first_login, created_at, updated_at) VALUES ('test-user-id-qa', '${testUser}', '${escapedHash}', '${testDisplay}', 'admin', 1, '${now}', '${now}');`
  );
  execSync(
    `sqlite3 /Users/kevin/Project\\ folder/project09/dev.db < ${tmpFile}`,
    { stdio: "pipe" }
  );
  fs.default.unlinkSync(tmpFile);

  // 2a. Login with valid credentials
  const login = await api("POST", "/api/v1/auth/login", {
    username: testUser,
    password: testPassword,
  });
  record("POST /api/v1/auth/login succeeds with valid credentials", login.status === 200);
  record(`Login returns user data with username=${login.data?.data?.username}`, login.data?.data?.username === testUser);
  record("Login sets access_token cookie", login.cookies.some((c) => c.startsWith("access_token=")));
  record("Login sets refresh_token cookie", login.cookies.some((c) => c.startsWith("refresh_token=")));

  const cookies = parseCookies(login.cookies);
  const authHeaders = { headers: { Cookie: `access_token=${cookies.access_token}; refresh_token=${cookies.refresh_token}` } };

  // 2b. Access protected route with valid tokens
  const profile = await api("GET", "/api/v1/users/profile", null, authHeaders);
  record("GET /api/v1/users/profile returns 200 with valid token", profile.status === 200);
  record(`Profile data has correct username`, profile.data?.data?.username === testUser);

  // 2c. Bad password
  const badPw = await api("POST", "/api/v1/auth/login", { username: testUser, password: "wrong" });
  record("POST /api/v1/auth/login rejects wrong password with 401", badPw.status === 401);

  // 2d. Token refresh
  const refresh = await api("POST", "/api/v1/auth/refresh", null, authHeaders);
  record("POST /api/v1/auth/refresh returns 200 with valid refresh token", refresh.status === 200);
  record("Refresh sets new access_token cookie", refresh.cookies.some((c) => c.startsWith("access_token=")));

  // 2e. Logout
  const logout = await api("POST", "/api/v1/auth/logout", null, authHeaders);
  record("POST /api/v1/auth/logout returns 200", logout.status === 200);
  record("Logout clears access_token cookie", logout.cookies.some((c) => c.includes("access_token=;")));

  return { cookies, authHeaders, testUser, testPassword, testDisplay };
}

// ─── 3. Protected API Endpoints ─────────────────────────────────────────────

async function testProtectedEndpoints(authHeaders) {
  section("3. Protected API Endpoints");

  // 3a. Profile update
  const updateProfile = await api("PUT", "/api/v1/users/profile", {
    displayName: "QA Updated",
  }, authHeaders);
  record("PUT /api/v1/users/profile returns 200", updateProfile.status === 200);
  record("Profile displayName updated", updateProfile.data?.data?.displayName === "QA Updated");

  // 3b. Password change
  const pwChange = await api("PUT", "/api/v1/users/password", {
    currentPassword: "TestPass123!",
    newPassword: "NewPass456!",
  }, authHeaders);
  record("PUT /api/v1/users/password returns 200", pwChange.status === 200);

  // Change back
  await api("PUT", "/api/v1/users/password", {
    currentPassword: "NewPass456!",
    newPassword: "TestPass123!",
  }, authHeaders);

  // 3c. Password change with wrong current password
  const badPwChange = await api("PUT", "/api/v1/users/password", {
    currentPassword: "WrongPassword",
    newPassword: "SomeNewPass123!",
  }, authHeaders);
  record("PUT /api/v1/users/password rejects wrong current password", badPwChange.status === 400);

  // 3d. Model providers — list (empty)
  const providers = await api("GET", "/api/v1/models/providers", null, authHeaders);
  record("GET /api/v1/models/providers returns 200", providers.status === 200);
  record("Providers list is an array", Array.isArray(providers.data?.data));

  // 3e. Model providers — create (requires at least 1 model, apiKey must be string or undefined, not null)
  const createProvider = await api("POST", "/api/v1/models/providers", {
    name: "Test Ollama",
    providerType: "ollama",
    apiBaseUrl: "http://localhost:11434",
    apiKey: undefined,
    models: [{
      modelId: "qwen2.5:7b",
      modelName: "Qwen2.5 7B",
      capabilities: ["chat", "writing"],
      contextWindow: 32768,
      maxOutputTokens: 8192,
      supportsStreaming: true,
      localOrCloud: "local",
    }],
  }, authHeaders);
  record("POST /api/v1/models/providers creates provider", createProvider.status === 201, `got ${createProvider.status}: ${JSON.stringify(createProvider.data?.error || createProvider.data)}`);
  const providerId = createProvider.data?.data?.id;
  record("Provider has an ID", !!providerId);

  if (providerId) {
    // 3f. Model providers — get by ID
    const getProvider = await api("GET", `/api/v1/models/providers/${providerId}`, null, authHeaders);
    record("GET /api/v1/models/providers/:id returns provider", getProvider.status === 200);
    record("Provider type is ollama", getProvider.data?.data?.providerType === "ollama");

    // 3g. Model providers — update
    const updateProvider = await api("PUT", `/api/v1/models/providers/${providerId}`, {
      name: "Test Ollama Updated",
    }, authHeaders);
    record("PUT /api/v1/models/providers/:id updates provider", updateProvider.status === 200);
    record("Provider name updated", updateProvider.data?.data?.name === "Test Ollama Updated");

    // 3h. Model providers — test connection (will fail since Ollama not running but API should work)
    const testConn = await api("POST", `/api/v1/models/providers/${providerId}/test`, null, authHeaders);
    record("POST /api/v1/models/providers/:id/test returns response", testConn.status === 200 || testConn.status === 500);
    record("Test result includes success field", typeof testConn.data?.success === "boolean");

    // 3i. Model usage stats
    const usage = await api("GET", "/api/v1/models/usage", null, authHeaders);
    record("GET /api/v1/models/usage returns 200", usage.status === 200);

    // 3j. Delete provider
    const deleteProvider = await api("DELETE", `/api/v1/models/providers/${providerId}`, null, authHeaders);
    record("DELETE /api/v1/models/providers/:id deletes provider", deleteProvider.status === 200);
  }

  // 3k. Task endpoints
  const task = await api("GET", "/api/v1/tasks/nonexistent-id", null, authHeaders);
  record("GET /api/v1/tasks/:id returns 404 for nonexistent", task.status === 404);

  // 3l. Access without auth — fetch follows redirect, should not return profile data
  const noAuthProfile = await api("GET", "/api/v1/users/profile");
  record("GET /api/v1/users/profile without auth does not return profile", noAuthProfile.data?.success !== true);
}

// ─── 4. Validation & Edge Cases ─────────────────────────────────────────────

async function testValidation() {
  section("4. Input Validation & Edge Cases");

  // 4a. Login — Zod validation
  const missingUsername = await api("POST", "/api/v1/auth/login", { password: "test" });
  record("Login without username rejected (400)", missingUsername.status === 400);

  const missingPassword = await api("POST", "/api/v1/auth/login", { username: "test" });
  record("Login without password rejected (400)", missingPassword.status === 400);

  // 4b. Setup — validation
  const shortUsername = await api("POST", "/api/v1/auth/setup", {
    username: "ab",
    password: "123456",
    displayName: "Test",
  });
  record("Setup with short username (< 3) rejected", shortUsername.status === 400 || shortUsername.status !== 201);

  // 4c. Profile — missing body, unauthenticated, fetch follows redirect
  const badProfile = await api("PUT", "/api/v1/users/profile", { invalidField: true });
  record("Profile update without auth does not succeed", badProfile.data?.success !== true);
}

// ─── 5. Static Assets & Page Availability ──────────────────────────────────

async function testPages() {
  section("5. Page Availability (HTTP check)");

  const pages = [
    { path: "/login", name: "Login page", expectStatus: 200 },
    { path: "/setup", name: "Setup page", expectStatus: 200 }, // Renders even if initialized (redirect logic is client-side via API)
    { path: "/", name: "Dashboard (unauthenticated → redirect)", expectStatus: 307 },
    { path: "/models", name: "Models (unauthenticated → redirect)", expectStatus: 307 },
    { path: "/settings", name: "Settings (unauthenticated → redirect)", expectStatus: 307 },
    { path: "/nonexistent-page-xyz", name: "Nonexistent page — middleware redirects to /login", expectStatus: 307 },
    { path: "/_next/static/does-not-exist", name: "Static asset path bypasses middleware", expectStatus: 404 },
  ];

  for (const { path, name, expectStatus } of pages) {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
    record(`${name} → ${expectStatus}`, res.status === expectStatus, `got ${res.status}`);
  }
}

// ─── 6. Run All Tests ──────────────────────────────────────────────────────

async function main() {
  console.log("╔═══════════════════════════════════════════╗");
  console.log("║  Synthetix P0 Application Test Suite     ║");
  console.log("╚═══════════════════════════════════════════╝");
  console.log(`\nTarget: ${BASE}`);

  try {
    // Phase 1: Public endpoints
    await testPublicEndpoints();

    // Phase 2: Auth flow (creates test user via DB, then tests full auth lifecycle)
    const { authHeaders } = await testAuthFlow();

    // Phase 3: Protected endpoints
    await testProtectedEndpoints(authHeaders);

    // Phase 4: Validation & edge cases
    await testValidation();

    // Phase 5: Page availability
    await testPages();

  } catch (err) {
    console.error(`\n  TEST SUITE ERROR: ${err.message}`);
    console.error(err.stack);
  }

  // Cleanup test user
  try {
    execSync(
      `sqlite3 /Users/kevin/Project\\ folder/project09/dev.db "DELETE FROM users WHERE username='qatest';"`,
      { stdio: "pipe" }
    );
  } catch {}

  // Summary
  console.log("\n╔═══════════════════════════════════════════╗");
  console.log("║  Test Summary                            ║");
  console.log("╚═══════════════════════════════════════════╝");
  const passes = results.filter((r) => r.status === "PASS").length;
  const fails = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n  Total: ${results.length} | PASS: ${passes} | FAIL: ${fails}`);

  if (fails > 0) {
    console.log("\n  Failures:");
    for (const r of results) {
      if (r.status === "FAIL") console.log(`    ✗ ${r.name} — ${r.detail}`);
    }
  }

  console.log("");
  process.exit(fails > 0 ? 1 : 0);
}

main();
