import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { recordTokenUsage } from "@/lib/llm/usage";

const TEST_USER_ID = "test-token-usage-user";

async function ensureUser(): Promise<void> {
  await db.user.upsert({
    where: { id: TEST_USER_ID },
    create: { id: TEST_USER_ID, username: TEST_USER_ID, passwordHash: "test-hash" },
    update: {},
  });
}

async function clearUsage(): Promise<void> {
  await db.tokenUsage.deleteMany({ where: { userId: TEST_USER_ID } });
}

describe("recordTokenUsage", () => {
  beforeEach(async () => {
    await ensureUser();
    await clearUsage();
  });

  afterAll(async () => {
    await clearUsage();
  });

  it("records the call when only inputTokens is positive (output = 0)", async () => {
    await recordTokenUsage({
      userId: TEST_USER_ID,
      module: "embedding",
      inputTokens: 1234,
      outputTokens: 0,
    });
    const rows = await db.tokenUsage.findMany({ where: { userId: TEST_USER_ID } });
    expect(rows).toHaveLength(1);
    expect(rows[0].inputTokens).toBe(1234);
    expect(rows[0].outputTokens).toBe(0);
  });

  it("records the call when only outputTokens is positive (input = 0)", async () => {
    await recordTokenUsage({
      userId: TEST_USER_ID,
      module: "writing",
      inputTokens: 0,
      outputTokens: 567,
    });
    const rows = await db.tokenUsage.findMany({ where: { userId: TEST_USER_ID } });
    expect(rows).toHaveLength(1);
    expect(rows[0].outputTokens).toBe(567);
  });

  it("still skips writing when both inputTokens and outputTokens are zero", async () => {
    await recordTokenUsage({
      userId: TEST_USER_ID,
      module: "writing",
      inputTokens: 0,
      outputTokens: 0,
    });
    const rows = await db.tokenUsage.findMany({ where: { userId: TEST_USER_ID } });
    expect(rows).toHaveLength(0);
  });
});
