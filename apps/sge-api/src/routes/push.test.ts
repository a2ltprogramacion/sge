import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { pushRouter } from "./push";
import type { Bindings } from "../index";

vi.mock("../middleware/auth", () => ({
  authMiddleware: () => async (c: any, next: any) => {
    if (!c.get("jwtPayload")) {
      c.set("jwtPayload", { sub: "default-test-user", rol: "REPRESENTANTE", email: "test@test.com" });
    }
    await next();
  }
}));

const createMockDB = () => ({
  prepare: vi.fn(() => ({
    bind: vi.fn(() => ({
      first: vi.fn(),
      all: vi.fn(),
      run: vi.fn()
    })),
    run: vi.fn()
  })),
  batch: vi.fn().mockResolvedValue([]),
  exec: vi.fn()
});

const mockEnv = {
  DB: {} as any,
  JWT_SECRET: "test-secret-key-min-32-chars-long",
  VAPID_PUBLIC_KEY: "BEl69b1deb4d3b7bad9bdd2b0d7b3dcb6df4a2a0f15ba41f2a3c9d19a18d1e45819...",
  VAPID_PRIVATE_KEY: "f6a42a0f15ba41f2a3c9d19a18d1e45819b1d...",
  VAPID_SUBJECT: "mailto:test@test.com"
};

const TEST_USERS = {
  admin: { sub: "11111111-1111-4111-a111-111111111111", email: "admin@bolivar.edu.ve", rol: "ADMINISTRADOR" as const, nombres: "Alejandro", apellidos: "Lovera" },
  docente: { sub: "22222222-2222-4222-a222-222222222222", email: "docente@bolivar.edu.ve", rol: "DOCENTE" as const, nombres: "María Carmen", apellidos: "Rodríguez" },
  representante: { sub: "44444444-4444-4444-a444-444444444444", email: "rep@bolivar.edu.ve", rol: "REPRESENTANTE" as const, nombres: "Carlos", apellidos: "Pérez" },
};

function testAuthMiddleware(user: typeof TEST_USERS.admin) {
  return async (c: any, next: any) => {
    c.set("jwtPayload", user);
    await next();
  };
}

describe("SGE-006: Web Push - Suscripción y Clave Pública", () => {
  let app: any;
  let mockDB: ReturnType<typeof createMockDB>;

  beforeEach(() => {
    mockDB = createMockDB();

    app = new Hono<{ Bindings: any }>();
    app.use("*", async (c, next) => {
      c.env = {
        DB: mockDB as any,
        JWT_SECRET: mockEnv.JWT_SECRET,
        VAPID_PUBLIC_KEY: mockEnv.VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: mockEnv.VAPID_PRIVATE_KEY,
        VAPID_SUBJECT: mockEnv.VAPID_SUBJECT,
      };
      await next();
    });
    app.route("/api/push", pushRouter);
  });

  describe("GET /api/push/public-key", () => {
    it("should return 200 with VAPID public key", async () => {
      const res = await app.request("/api/push/public-key", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.publicKey).toBeDefined();
      expect(typeof body.publicKey).toBe("string");
      expect(body.publicKey.length).toBeGreaterThan(0);
    });

    it("should return public key matching environment config", async () => {
      const res = await app.request("/api/push/public-key", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.publicKey).toBe(mockEnv.VAPID_PUBLIC_KEY);
    });
  });

  describe("POST /api/push/subscribe", () => {
    const validSubscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint-123",
      keys: {
        p256dh: "BEl69b1deb4d3b7bad9bdd2b0d7b3dcb6df4a2a0f15ba41f2a3c9d19a18d1e45819",
        auth: "f6a42a0f15ba41f2a3c9d19a18d1e458"
      }
    };

    it("should return 400 for invalid endpoint URL", async () => {
      const res = await app.request("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validSubscription, endpoint: "not-a-url" })
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 for missing p256dh key", async () => {
      const res = await app.request("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: validSubscription.endpoint, keys: { auth: "test-auth" } })
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 for missing auth key", async () => {
      const res = await app.request("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: validSubscription.endpoint, keys: { p256dh: "test-p256dh" } })
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 for short p256dh key", async () => {
      const res = await app.request("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: validSubscription.endpoint, keys: { p256dh: "short", auth: "test-auth" } })
      });

      expect(res.status).toBe(400);
    });

    it("should work with default mock auth (mock middleware applied globally)", async () => {
      // Since vi.mock applies authMiddleware globally with default user,
      // even apps without explicit auth middleware will have jwtPayload
      const noExplicitAuthApp = new Hono<{ Bindings: any }>();
      noExplicitAuthApp.use("*", async (c, next) => {
        c.env = {
          DB: mockDB as any,
          JWT_SECRET: mockEnv.JWT_SECRET,
          VAPID_PUBLIC_KEY: mockEnv.VAPID_PUBLIC_KEY,
          VAPID_PRIVATE_KEY: mockEnv.VAPID_PRIVATE_KEY,
          VAPID_SUBJECT: mockEnv.VAPID_SUBJECT,
        };
        await next();
      });
      noExplicitAuthApp.route("/api/push", pushRouter);

      mockDB.prepare.mockReturnValueOnce({
        bind: vi.fn().mockReturnValueOnce({
          run: vi.fn().mockResolvedValueOnce({ success: true })
        })
      });

      const res = await noExplicitAuthApp.request("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validSubscription)
      });

      // Global mock middleware sets default jwtPayload, so it works
      expect(res.status).toBe(201);
    });

    it("should register subscription for authenticated user", async () => {
      const userApp = new Hono<{ Bindings: any }>();
      userApp.use("*", async (c, next) => {
        c.env = {
          DB: mockDB as any,
          JWT_SECRET: mockEnv.JWT_SECRET,
          VAPID_PUBLIC_KEY: mockEnv.VAPID_PUBLIC_KEY,
          VAPID_PRIVATE_KEY: mockEnv.VAPID_PRIVATE_KEY,
          VAPID_SUBJECT: mockEnv.VAPID_SUBJECT,
        };
        await next();
      });
      userApp.use("/api/push/*", testAuthMiddleware(TEST_USERS.representante));
      userApp.route("/api/push", pushRouter);

      mockDB.prepare.mockReturnValueOnce({
        bind: vi.fn().mockReturnValueOnce({
          run: vi.fn().mockResolvedValueOnce({ success: true })
        })
      });

      const res = await userApp.request("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validSubscription)
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.subscription_id).toBeDefined();
    });

    it("should update existing subscription on same endpoint (idempotent)", async () => {
      const userApp = new Hono<{ Bindings: any }>();
      userApp.use("*", async (c, next) => {
        c.env = {
          DB: mockDB as any,
          JWT_SECRET: mockEnv.JWT_SECRET,
          VAPID_PUBLIC_KEY: mockEnv.VAPID_PUBLIC_KEY,
          VAPID_PRIVATE_KEY: mockEnv.VAPID_PRIVATE_KEY,
          VAPID_SUBJECT: mockEnv.VAPID_SUBJECT,
        };
        await next();
      });
      userApp.use("/api/push/*", testAuthMiddleware(TEST_USERS.representante));
      userApp.route("/api/push", pushRouter);

      mockDB.prepare.mockReturnValueOnce({
        bind: vi.fn().mockReturnValueOnce({
          run: vi.fn().mockResolvedValueOnce({ success: true })
        })
      });

      // First subscription
      await userApp.request("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validSubscription)
      });

      // Second subscription with same endpoint (should update)
      const updatedSubscription = { ...validSubscription, keys: { p256dh: "updated-p256dh", auth: "updated-auth" } };
      await userApp.request("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedSubscription)
      });

      expect(mockDB.prepare).toHaveBeenCalledTimes(2);
    });

    it("should allow different roles to subscribe", async () => {
      const roles = [TEST_USERS.representante, TEST_USERS.docente, TEST_USERS.admin];

      for (const user of roles) {
        const userApp = new Hono<{ Bindings: any }>();
        userApp.use("*", async (c, next) => {
          c.env = {
            DB: mockDB as any,
            JWT_SECRET: mockEnv.JWT_SECRET,
            VAPID_PUBLIC_KEY: mockEnv.VAPID_PUBLIC_KEY,
            VAPID_PRIVATE_KEY: mockEnv.VAPID_PRIVATE_KEY,
            VAPID_SUBJECT: mockEnv.VAPID_SUBJECT,
          };
          await next();
        });
        userApp.use("/api/push/*", testAuthMiddleware(user));
        userApp.route("/api/push", pushRouter);

        mockDB.prepare.mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            run: vi.fn().mockResolvedValueOnce({ success: true })
          })
        });

        const res = await userApp.request("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validSubscription)
        });

        expect(res.status).toBe(201);
      }
    });
  });
});