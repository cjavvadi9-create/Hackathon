import { describe, expect, it } from "vitest";
import { mysqlConnectionSettings } from "./mysql-config";

describe("MySQL connection configuration", () => {
  it("translates ssl-mode URLs into strict mysql2 TLS options", () => {
    const settings = mysqlConnectionSettings(
      "mysql://app_user:not-real%40password@db.example:24813/optistore?ssl-mode=REQUIRED&connectTimeout=5000",
    );

    expect(settings.uri).not.toContain("ssl-mode");
    expect(settings.uri).toContain("connectTimeout=5000");
   expect(settings.ssl).toMatchObject({
  rejectUnauthorized: true,
  verifyIdentity: true,
});

expect(settings.ssl.ca).toBeTruthy();
  });

  it("normalizes an optional CA certificate from environment-style PEM text", () => {
    const settings = mysqlConnectionSettings("mysql://app_user:placeholder@db.example/optistore", "line one\\nline two");

    expect(settings.ssl).toEqual({
      rejectUnauthorized: true,
      verifyIdentity: true,
      ca: "line one\nline two",
    });
  });

  it("rejects malformed connection URLs without echoing their contents", () => {
    const error = (() => {
      try {
        mysqlConnectionSettings("mysql://app_user:placeholder@[");
      } catch (caught) {
        return caught;
      }
      return null;
    })();

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("DATABASE_URL must be a valid MySQL connection URL");
    expect((error as Error).message).not.toContain("placeholder");
  });
});
