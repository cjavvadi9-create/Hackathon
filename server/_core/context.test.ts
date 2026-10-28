import { TRPCError } from "@trpc/server";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { Request } from "express";
import { describe, expect, it } from "vitest";
import {
  AuthServiceUnavailableError,
  ForbiddenError,
  UserStorageUnavailableError,
} from "@shared/_core/errors";
import { createContextFactory } from "./context";

function contextOptions(): CreateExpressContextOptions {
  return {
    req: { headers: {} } as Request,
    res: {} as CreateExpressContextOptions["res"],
    info: {} as CreateExpressContextOptions["info"],
  };
}

describe("tRPC authentication context errors", () => {
  it("keeps missing or invalid sessions optional for public procedures", async () => {
    const context = createContextFactory(async () => {
      throw ForbiddenError("Invalid session cookie");
    });

    await expect(context(contextOptions())).resolves.toMatchObject({ user: null });
  });

  it("reports OAuth/configuration outages separately from user storage failures", async () => {
    const oauthContext = createContextFactory(async () => {
      throw new AuthServiceUnavailableError("provider");
    });
    const storageContext = createContextFactory(async () => {
      throw new UserStorageUnavailableError();
    });

    await expect(oauthContext(contextOptions())).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "The authentication service is unavailable. Try signing in again later.",
    });
    await expect(storageContext(contextOptions())).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "User storage is unavailable. Check the server database connection.",
    });
    await expect(storageContext(contextOptions())).rejects.toBeInstanceOf(TRPCError);
  });

  it("does not leak unexpected authentication or database error details", async () => {
    const configurationContext = createContextFactory(async () => {
      throw new AuthServiceUnavailableError("configuration");
    });
    const sensitiveStorageError = "mysql://user:password@host/db";
    const databaseContext = createContextFactory(async () => {
      throw new Error(sensitiveStorageError);
    });

    await expect(configurationContext(contextOptions())).rejects.toMatchObject({
      message: "Authentication is not configured. Check MANUS_PROJECT_ID, MANUS_OAUTH_API_URL, and MANUS_JWT_SECRET.",
    });
    await expect(databaseContext(contextOptions())).rejects.toMatchObject({
      message: "Unable to verify this session. Try signing in again.",
    });
    await expect(databaseContext(contextOptions())).rejects.not.toHaveProperty("message", sensitiveStorageError);
  });
});
