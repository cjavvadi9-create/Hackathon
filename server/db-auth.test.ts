import { afterEach, describe, expect, it, vi } from "vitest";
import { getUserByOpenId } from "./db";

describe("user lookup when the database is unavailable", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports storage unavailability instead of treating the account as missing", async () => {
    vi.stubEnv("DATABASE_URL", "");

    await expect(getUserByOpenId("test-open-id")).rejects.toThrow("Database is not available");
  });
});
