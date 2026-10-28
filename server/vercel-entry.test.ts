import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("Vercel Express entrypoint", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("initializes without OAuth or database configuration and serves public routes", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DATABASE_CA_CERT", "");
    vi.stubEnv("MANUS_PROJECT_ID", "");
    vi.stubEnv("MANUS_OAUTH_API_URL", "");
    vi.stubEnv("MANUS_OAUTH_PORTAL_URL", "");
    vi.stubEnv("MANUS_JWT_SECRET", "");

    const { default: app } = await import("../app.js");
    const server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const health = await fetch(`${baseUrl}/api/health`);
      const config = await fetch(`${baseUrl}/api/platform/config.js`);

      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok" });
      expect(config.status).toBe(200);
      expect(await config.text()).toContain('"projectId":""');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve())
      );
    }
  });
});
