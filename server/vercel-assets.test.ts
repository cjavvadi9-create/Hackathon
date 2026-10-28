import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("Vercel static asset and SPA routing", () => {
  let temporaryPublicDir: string | undefined;

  afterEach(() => {
    if (temporaryPublicDir) rmSync(temporaryPublicDir, { recursive: true, force: true });
    temporaryPublicDir = undefined;
  });

  it("serves built assets with their MIME types, 404s missing assets, and falls back for app routes", async () => {
    temporaryPublicDir = mkdtempSync(path.join(os.tmpdir(), "optistore-public-"));
    mkdirSync(path.join(temporaryPublicDir, "assets"));
    writeFileSync(path.join(temporaryPublicDir, "index.html"), "<!doctype html><title>OptiStore SPA</title>");
    writeFileSync(path.join(temporaryPublicDir, "assets", "app.js"), "export const loaded = true;");
    writeFileSync(path.join(temporaryPublicDir, "assets", "app.css"), "body { color: navy; }");

    const { createVercelApplication } = await import("../app.js");
    const server = createServer(createVercelApplication(temporaryPublicDir));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const js = await fetch(`${baseUrl}/assets/app.js`);
      const css = await fetch(`${baseUrl}/assets/app.css`);
      const missing = await fetch(`${baseUrl}/assets/missing.js`);
      const route = await fetch(`${baseUrl}/workspace/demo`);
      const health = await fetch(`${baseUrl}/api/health`);
      const unknownApi = await fetch(`${baseUrl}/api/missing`);

      expect(js.status).toBe(200);
      expect(js.headers.get("content-type")).toMatch(/javascript/);
      expect(await js.text()).toBe("export const loaded = true;");
      expect(css.status).toBe(200);
      expect(css.headers.get("content-type")).toMatch(/text\/css/);
      expect(await css.text()).toBe("body { color: navy; }");
      expect(missing.status).toBe(404);
      expect(await missing.text()).not.toContain("OptiStore SPA");
      expect(route.status).toBe(200);
      expect(await route.text()).toContain("OptiStore SPA");
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok" });
      expect(unknownApi.status).toBe(404);
      expect(await unknownApi.json()).toEqual({ error: "API route not found" });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve())
      );
    }
  });
});
