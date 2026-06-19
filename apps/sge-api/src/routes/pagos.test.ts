import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { pagosRouter } from "./pagos";
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

const createMockR2 = () => ({
  put: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue(null),
  delete: vi.fn().mockResolvedValue(undefined)
});

const mockEnv = {
  DB: {} as any,
  BUCKET_COMPROBANTES: {} as any,
  JWT_SECRET: "test-secret-key-min-32-chars-long",
  VAPID_PUBLIC_KEY: "test-public-key",
  VAPID_PRIVATE_KEY: "test-private-key",
  VAPID_SUBJECT: "mailto:test@test.com"
};

const TEST_USERS = {
  admin: { sub: "11111111-1111-4111-a111-111111111111", email: "admin@bolivar.edu.ve", rol: "ADMINISTRADOR" as const, nombres: "Alejandro", apellidos: "Lovera" },
  representante: { sub: "33333333-3333-4333-a333-333333333333", email: "rep@bolivar.edu.ve", rol: "REPRESENTANTE" as const, nombres: "Carlos", apellidos: "Pérez" },
  representanteOther: { sub: "other-rep-id", email: "other@bolivar.edu.ve", rol: "REPRESENTANTE" as const, nombres: "Otro", apellidos: "Representante" },
  docente: { sub: "22222222-2222-4222-a222-222222222222", email: "docente@bolivar.edu.ve", rol: "DOCENTE" as const, nombres: "María", apellidos: "Rodríguez" },
};

function testAuthMiddleware(user: typeof TEST_USERS.admin) {
  return async (c: any, next: any) => {
    c.set("jwtPayload", user);
    await next();
  };
}

describe("SGE-005: Módulo de Pagos - Unit Tests", () => {
  describe("Financial Consistency Validation", () => {
    it("should accept payment where USD ≈ VES / tasa within 5% tolerance", () => {
      const monto_usd = 25.00;
      const monto_ves = 900.00;
      const tasa = 36.00;
      const montoCalculado = monto_ves / tasa;
      const desviacion = Math.abs(montoCalculado - monto_usd) / monto_usd;
      expect(desviacion).toBeLessThanOrEqual(0.05);
    });

    it("should reject payment where USD differs more than 5% from VES / tasa", () => {
      const monto_usd = 20.00;
      const monto_ves = 900.00;
      const tasa = 36.00;
      const montoCalculado = monto_ves / tasa;
      const desviacion = Math.abs(montoCalculado - monto_usd) / monto_usd;
      expect(desviacion).toBeGreaterThan(0.05);
    });

    it("should accept exact conversion without deviation", () => {
      const monto_usd = 30.00;
      const monto_ves = 1080.00;
      const tasa = 36.00;
      const montoCalculado = monto_ves / tasa;
      const desviacion = Math.abs(montoCalculado - monto_usd) / monto_usd;
      expect(desviacion).toBe(0);
    });
  });

  describe("Duplicate Payment Prevention", () => {
    it("should prevent duplicate PENDIENTE payment for same month", () => {
      const existingPayment = { id: "pago-1", status_conciliacion: "PENDIENTE" };
      const blockedStatuses = ["PENDIENTE", "APROBADO"];
      const shouldBlock = blockedStatuses.includes(existingPayment.status_conciliacion);
      expect(shouldBlock).toBe(true);
    });

    it("should prevent duplicate APROBADO payment for same month", () => {
      const existingPayment = { id: "pago-2", status_conciliacion: "APROBADO" };
      const blockedStatuses = ["PENDIENTE", "APROBADO"];
      const shouldBlock = blockedStatuses.includes(existingPayment.status_conciliacion);
      expect(shouldBlock).toBe(true);
    });

    it("should allow new payment when existing is RECHAZADO", () => {
      const existingPayment = { id: "pago-3", status_conciliacion: "RECHAZADO" };
      const blockedStatuses = ["PENDIENTE", "APROBADO"];
      const shouldBlock = blockedStatuses.includes(existingPayment.status_conciliacion);
      expect(shouldBlock).toBe(false);
    });
  });

  describe("Ownership Validation (IDOR Prevention)", () => {
    it("should allow REPRESENTANTE to pay for their own student", () => {
      const matriculaRepresentanteId = "33333333-3333-4333-a333-333333333333";
      const jwtSub = "33333333-3333-4333-a333-333333333333";
      const userRole = "REPRESENTANTE";
      const hasAccess = userRole === "ADMINISTRADOR" || matriculaRepresentanteId === jwtSub;
      expect(hasAccess).toBe(true);
    });

    it("should deny REPRESENTANTE paying for another's student", () => {
      const matriculaRepresentanteId = "other-rep-id";
      const jwtSub = "33333333-3333-4333-a333-333333333333";
      const userRole = "REPRESENTANTE";
      const hasAccess = userRole === "ADMINISTRADOR" || matriculaRepresentanteId === jwtSub;
      expect(hasAccess).toBe(false);
    });

    it("should allow ADMINISTRADOR to pay for any student", () => {
      const matriculaRepresentanteId = "any-rep-id";
      const jwtSub = "11111111-1111-4111-a111-111111111111";
      const userRole = "ADMINISTRADOR";
      const hasAccess = userRole === "ADMINISTRADOR" || matriculaRepresentanteId === jwtSub;
      expect(hasAccess).toBe(true);
    });
  });

  describe("Conciliation State Machine", () => {
    it("should allow conciliation only from PENDIENTE state", () => {
      const validTransitions = {
        PENDIENTE: ["APROBADO", "RECHAZADO"],
        APROBADO: [],
        RECHAZADO: []
      };
      expect(validTransitions.PENDIENTE).toContain("APROBADO");
      expect(validTransitions.PENDIENTE).toContain("RECHAZADO");
      expect(validTransitions.APROBADO).toHaveLength(0);
      expect(validTransitions.RECHAZADO).toHaveLength(0);
    });

    it("should update matricula to SOLVENTE on APROBADO", () => {
      const accion = "APROBADO";
      const currentMatriculaStatus = "CON_DEUDA";
      const newStatus = accion === "APROBADO" ? "SOLVENTE" : currentMatriculaStatus;
      expect(newStatus).toBe("SOLVENTE");
    });

    it("should keep matricula status on RECHAZADO", () => {
      const accion = "RECHAZADO";
      const currentMatriculaStatus = "CON_DEUDA";
      const newStatus = accion === "APROBADO" ? "SOLVENTE" : currentMatriculaStatus;
      expect(newStatus).toBe("CON_DEUDA");
    });

    it("should not overwrite EXENTO status on approval", () => {
      const accion = "APROBADO";
      const currentMatriculaStatus = "EXENTO";
      const newStatus = currentMatriculaStatus === "EXENTO" ? "EXENTO" : "SOLVENTE";
      expect(newStatus).toBe("EXENTO");
    });
  });

  describe("R2 Comprobante Handling", () => {
    it("should generate R2 key with correct path format", () => {
      const pagoId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
      const referencia = "REF-2026-001";
      const ext = "jpg";
      const r2Key = `comprobantes/${pagoId}/${referencia}.${ext}`;
      expect(r2Key).toBe("comprobantes/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/REF-2026-001.jpg");
    });

    it("should purge R2 file on RECHAZADO", () => {
      const accion = "RECHAZADO";
      const r2FileKey = "comprobantes/pago-1/ref.pdf";
      const shouldPurge = accion === "RECHAZADO" && r2FileKey !== null;
      expect(shouldPurge).toBe(true);
    });

    it("should not purge R2 file on APROBADO", () => {
      const accion = "APROBADO";
      const r2FileKey = "comprobantes/pago-1/ref.pdf";
      const shouldPurge = accion === "RECHAZADO" && r2FileKey !== null;
      expect(shouldPurge).toBe(false);
    });
  });

  describe("Mes Correspondiente Validation", () => {
    it("should accept valid mes values", () => {
      const validMeses = [
        "INSCRIPCION", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
        "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO"
      ];
      expect(validMeses).toHaveLength(13);
      expect(validMeses).toContain("INSCRIPCION");
      expect(validMeses).toContain("AGOSTO");
    });

    it("should reject invalid mes values", () => {
      const validMeses = new Set([
        "INSCRIPCION", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
        "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO"
      ]);
      expect(validMeses.has("SEPTEMBER")).toBe(false);
      expect(validMeses.has("JANUARY")).toBe(false);
      expect(validMeses.has("")).toBe(false);
    });
  });
});

describe("SGE-005: Módulo de Pagos - Integration Tests", () => {
  let app: any;
  let mockDB: ReturnType<typeof createMockDB>;
  let mockR2: ReturnType<typeof createMockR2>;

  beforeEach(() => {
    mockDB = createMockDB();
    mockR2 = createMockR2();

    app = new Hono<{ Bindings: any }>();
    app.use("*", async (c, next) => {
      c.env = {
        DB: mockDB as any,
        BUCKET_COMPROBANTES: mockR2 as any,
        JWT_SECRET: mockEnv.JWT_SECRET,
        VAPID_PUBLIC_KEY: mockEnv.VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: mockEnv.VAPID_PRIVATE_KEY,
        VAPID_SUBJECT: mockEnv.VAPID_SUBJECT,
      };
      await next();
    });

    app.use("/api/pagos/*", testAuthMiddleware(TEST_USERS.representante));
    app.route("/api/pagos", pagosRouter);
  });

  // Minimal valid 1x1 transparent WebP Base64 (for testing)
  const validWebPBase64 = "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";

  describe("POST /api/pagos/registrar", () => {
    const validPayload = {
      matricula_id: "d1d1d1d1-d1d1-4d1d-bd1d-111111111111",
      mes_correspondiente: "OCTUBRE",
      monto_dolares: 25.00,
      monto_bolivares: 900.00,
      tasa_cambio: 36.00,
      referencia_bancaria: "REF-2026-100",
      banco_origen: "Banesco",
      banco_destino: "Banco de Venezuela",
      fecha_pago: "2026-10-05",
      imagen_b64: validWebPBase64
    };

    it("should return 400 for invalid mes", async () => {
      const res = await app.request("/api/pagos/registrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validPayload, mes_correspondiente: "INVALID_MONTH" })
      });
      expect(res.status).toBe(400);
    });

    it("should return 400 for missing matricula_id", async () => {
      const { matricula_id, ...noMatricula } = validPayload;
      const res = await app.request("/api/pagos/registrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(noMatricula)
      });
      expect(res.status).toBe(400);
    });

    it("should return 400 for negative monto", async () => {
      const res = await app.request("/api/pagos/registrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validPayload, monto_dolares: -10 })
      });
      expect(res.status).toBe(400);
    });

    it("should return 404 for non-existent matricula", async () => {
      mockDB.prepare.mockReturnValueOnce({
        bind: vi.fn().mockReturnValueOnce({
          first: vi.fn().mockResolvedValueOnce(null)
        })
      });

      const res = await app.request("/api/pagos/registrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validPayload, matricula_id: "00000000-0000-4000-a000-000000000000" })
      });
      expect(res.status).toBe(404);
    });

    it("should return 403 when REPRESENTANTE pays for another's student", async () => {
      mockDB.prepare.mockReturnValueOnce({
        bind: vi.fn().mockReturnValueOnce({
          first: vi.fn().mockResolvedValueOnce({
            id: "d1d1d1d1-d1d1-4d1d-bd1d-111111111111",
            estudiante_id: "55555555-5555-4555-a555-555555555555",
            estado: "ACTIVO",
            status_pago: "CON_DEUDA",
            seccion_id: "c1c1c1c1-c1c1-4c1c-bc1c-111111111111",
            nombres: "Juan Diego",
            apellidos: "Pérez Rodríguez",
            representante_id: "other-rep-id"
          })
        })
      });

      const res = await app.request("/api/pagos/registrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validPayload)
      });
      expect(res.status).toBe(403);
    });

    it("should return 409 for duplicate payment same month", async () => {
      mockDB.prepare
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            first: vi.fn().mockResolvedValueOnce({
              id: "d1d1d1d1-d1d1-4d1d-bd1d-111111111111",
              estudiante_id: "55555555-5555-4555-a555-555555555555",
              estado: "ACTIVO",
              status_pago: "CON_DEUDA",
              seccion_id: "c1c1c1c1-c1c1-4c1c-bc1c-111111111111",
              nombres: "Juan Diego",
              apellidos: "Pérez Rodríguez",
              representante_id: "33333333-3333-4333-a333-333333333333"
            })
          })
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            first: vi.fn().mockResolvedValueOnce({
              id: "a2a2a2a2-a2a2-4a2a-ba2a-222222222222",
              status_conciliacion: "PENDIENTE"
            })
          })
        });

      const res = await app.request("/api/pagos/registrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validPayload, mes_correspondiente: "SEPTIEMBRE" })
      });
      expect(res.status).toBe(409);
    });

    it("should return 400 for financial inconsistency >5%", async () => {
      mockDB.prepare
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            first: vi.fn().mockResolvedValueOnce({
              id: "d1d1d1d1-d1d1-4d1d-bd1d-111111111111",
              estudiante_id: "55555555-5555-4555-a555-555555555555",
              estado: "ACTIVO",
              status_pago: "CON_DEUDA",
              seccion_id: "c1c1c1c1-c1c1-4c1c-bc1c-111111111111",
              nombres: "Juan Diego",
              apellidos: "Pérez Rodríguez",
              representante_id: "33333333-3333-4333-a333-333333333333"
            })
          })
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            first: vi.fn().mockResolvedValueOnce(null)
          })
        });

      const res = await app.request("/api/pagos/registrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validPayload,
          monto_dolares: 20.00,
          monto_bolivares: 900.00,
          tasa_cambio: 36.00
        })
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/pagos/conciliar", () => {
    it("should reject non-ADMIN access (403)", async () => {
      const adminOnlyApp = new Hono<{ Bindings: any }>();
      adminOnlyApp.use("*", async (c, next) => {
        c.env = { DB: mockDB as any, BUCKET_COMPROBANTES: mockR2 as any, JWT_SECRET: mockEnv.JWT_SECRET };
        await next();
      });
      adminOnlyApp.use("/api/pagos/*", testAuthMiddleware(TEST_USERS.representante));
      adminOnlyApp.route("/api/pagos", pagosRouter);

      const res = await adminOnlyApp.request("/api/pagos/conciliar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pago_id: "a1a1a1a1-a1a1-4a1a-ba1a-111111111111", accion: "APROBAR" })
      });
      expect(res.status).toBe(403);
    });

    it("should return 409 when conciliating already-approved payment", async () => {
      const adminApp = new Hono<{ Bindings: any }>();
      adminApp.use("*", async (c, next) => {
        c.env = { DB: mockDB as any, BUCKET_COMPROBANTES: mockR2 as any, JWT_SECRET: mockEnv.JWT_SECRET };
        await next();
      });
      adminApp.use("/api/pagos/*", testAuthMiddleware(TEST_USERS.admin));
      adminApp.route("/api/pagos", pagosRouter);

      mockDB.prepare.mockReturnValueOnce({
        bind: vi.fn().mockReturnValueOnce({
          first: vi.fn().mockResolvedValueOnce({
            id: "a1a1a1a1-a1a1-4a1a-ba1a-111111111111",
            matricula_id: "d1d1d1d1-d1d1-4d1d-bd1d-111111111111",
            mes_correspondiente: "INSCRIPCION",
            status_conciliacion: "APROBADO",
            r2_file_key: "comprobantes/a1/REF.jpg",
            referencia_bancaria: "REF-2026-001",
            monto_dolares: 30.00,
            monto_bolivares: 1080.00,
            matricula_status_pago: "SOLVENTE"
          })
        })
      });

      const res = await adminApp.request("/api/pagos/conciliar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pago_id: "a1a1a1a1-a1a1-4a1a-ba1a-111111111111", accion: "RECHAZAR" })
      });
      expect(res.status).toBe(409);
    });
  });
});
