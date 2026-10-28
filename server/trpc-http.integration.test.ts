import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { describe, expect, it, vi } from "vitest";
import type { AppRouter } from "./routers";
import { createAppRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { WarehouseRepository } from "./warehouse-repository";

describe("Express tRPC HTTP integration", () => {
  it("serves the configured endpoint, rejects anonymous protected calls, and scopes authenticated calls", async () => {
    const now = new Date("2026-10-28T00:00:00Z");
    const user = {
      id: 27,
      openId: "http-test-user",
      email: null,
      name: "HTTP test user",
      loginMethod: null,
      role: "user" as const,
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    };
    const ownedWarehouses: Array<{ id: number; name: string; createdAt: Date; updatedAt: Date; archivedAt: null }> = [];
    const repository: WarehouseRepository = {
      createWarehouse: vi.fn(async (ownerUserId, name) => {
        if (ownerUserId !== user.id) throw new Error("Unexpected user scope");
        const warehouse = { id: 81, name, createdAt: now, updatedAt: now, archivedAt: null };
        ownedWarehouses.push(warehouse);
        return warehouse;
      }),
      listWarehouses: vi.fn(async (ownerUserId) => ownerUserId === user.id ? [...ownedWarehouses] : []),
      getWarehouse: vi.fn(async () => null),
      importBundle: vi.fn(),
      listVersions: vi.fn(async () => null),
      getVersion: vi.fn(async () => null),
    };

    const app = express();
    app.use("/api/trpc", createExpressMiddleware({
      router: createAppRouter(repository),
      createContext: ({ req, res }): TrpcContext => ({
        req,
        res,
        user: req.headers.authorization === "Bearer local-http-test" ? user : null,
      }),
    }));

    const server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${address.port}/api/trpc`;
      const makeClient = (authenticated: boolean) => createTRPCClient<AppRouter>({
        links: [httpBatchLink({
          url,
          transformer: superjson,
          headers: authenticated ? { authorization: "Bearer local-http-test" } : {},
        })],
      });

      await expect(makeClient(false).warehouses.list.query())
        .rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });

      const client = makeClient(true);
      const created = await client.warehouses.create.mutate({ name: "  HTTP Warehouse  " });
      const listed = await client.warehouses.list.query();

      expect(created).toMatchObject({ id: 81, name: "HTTP Warehouse" });
      expect(created.createdAt).toBeInstanceOf(Date);
      expect(listed).toEqual([created]);
      expect(repository.createWarehouse).toHaveBeenCalledWith(user.id, "HTTP Warehouse");
      expect(repository.listWarehouses).toHaveBeenCalledWith(user.id);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
