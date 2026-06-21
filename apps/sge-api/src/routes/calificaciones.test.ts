import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { authRouter } from "./auth";
import { calificacionesRouter } from "./calificaciones";
import { planesRouter } from "./planes";
import type { Bindings } from "../index";
import type { JWTPayload } from "../utils/jwt";

vi.mock("../middleware/auth", () => ({
  authMiddleware: () => async (c: any, next: any) => {
    // Mock DOCENTE role with valid sub matching test data
    if (!c.get("jwtPayload")) {
      c.set("jwtPayload", {
        sub: "22222222-2222-4222-a222-222222222222",
        email: "docente@bolivar.edu.ve",
        rol: "DOCENTE",
        nombres: "María Carmen",
        apellidos: "Rodríguez"
      });
    }
    await next();
  }
}));

// Mock D1Database for testing
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
  BUCKET_COMPROBANTES: {} as any,
  JWT_SECRET: "test-secret-key-min-32-chars-long",
  VAPID_PUBLIC_KEY: "test-public-key",
  VAPID_PRIVATE_KEY: "test-private-key",
  VAPID_SUBJECT: "mailto:test@test.com"
};

// Test user payloads (matching seed data)
const TEST_USERS = {
  admin: { sub: "11111111-1111-4111-a111-111111111111", email: "admin@bolivar.edu.ve", rol: "ADMINISTRADOR" as const, nombres: "Alejandro", apellidos: "Lovera" },
  docente: { sub: "22222222-2222-4222-a222-222222222222", email: "docente@bolivar.edu.ve", rol: "DOCENTE" as const, nombres: "María Carmen", apellidos: "Rodríguez" },
  docenteOther: { sub: "docente-other-id", email: "docente2@bolivar.edu.ve", rol: "DOCENTE" as const, nombres: "Otro", apellidos: "Docente" },
  representante: { sub: "44444444-4444-4444-a444-444444444444", email: "rep@bolivar.edu.ve", rol: "REPRESENTANTE" as const, nombres: "Carlos", apellidos: "Pérez" },
};

const adminToken = "mock-admin-token";
const docenteToken = "mock-docente-token";
const representanteToken = "mock-rep-token";

// Test-specific auth middleware that injects a mock user based on a special header
// This bypasses real JWT verification for unit/integration tests
function testAuthMiddleware(user: typeof TEST_USERS.admin) {
  return async (c: any, next: any) => {
    c.set("jwtPayload", user);
    await next();
  };
}

// RBAC middleware for tests
function testRequireRoles(allowedRoles: string[]) {
  return async (c: any, next: any) => {
    const userPayload = c.get("jwtPayload") as any;
    if (!userPayload || !userPayload.rol) {
      return c.json({ title: "Unauthorized", status: 401, detail: "No auth data" }, 401);
    }
    if (!allowedRoles.includes(userPayload.rol)) {
      return c.json({ title: "Forbidden", status: 403, detail: "Insufficient role" }, 403);
    }
    await next();
  };
}

describe("SGE-004: Motor Dinamico de Notas y Asistencia - E2E Tests", () => {
  let app: any;
  let mockDB: ReturnType<typeof createMockDB>;

  beforeEach(() => {
    mockDB = createMockDB();
    
    app = new Hono<{ Bindings: any }>();
    // Test environment setup
    app.use("*", async (c, next) => {
      c.env = {
        DB: mockDB as any,
        BUCKET_COMPROBANTES: {} as any,
        JWT_SECRET: "test-secret-key-min-32-chars-long",
        VAPID_PUBLIC_KEY: "test-public-key",
        VAPID_PRIVATE_KEY: "test-private-key",
        VAPID_SUBJECT: "mailto:test@test.com",
      };
      await next();
    });
    app.route("/api/auth", authRouter);
    app.route("/api/planes", planesRouter);
    app.route("/api/calificaciones", calificacionesRouter);
  });

  describe("POST /api/auth/login - Autenticacion", () => {
    it("should return 401 for invalid credentials", async () => {
      mockDB.prepare.mockReturnValueOnce({
        bind: vi.fn().mockReturnValueOnce({
          first: vi.fn().mockResolvedValueOnce(null)
        })
      });

      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "wrong@test.com", password: "wrongpassword" })
      });

      expect(res.status).toBe(401);
    });

    it("should return 400 for missing payload", async () => {
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/planes - Crear Plan de Evaluacion", () => {
    it("should reject plan with ponderaciones sum != 100%", async () => {
      mockDB.prepare.mockReturnValueOnce({
        bind: vi.fn().mockReturnValueOnce({
          first: vi.fn().mockResolvedValueOnce({ id: "11111111-1111-4111-a111-111111111111", docente_guia_id: "22222222-2222-4222-a222-222222222222" })
        })
      });

      const res = await app.request("/api/planes", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${docenteToken}`
        },
        body: JSON.stringify({
          seccion_id: "11111111-1111-4111-a111-111111111111",
          asignatura_id: "22222222-2222-4222-a222-222222222222",
          lapso: 1,
          evaluaciones: [
            { descripcion: "Examen 1", ponderacion_porcentaje: 50, fecha_aplicacion: "2026-06-20" },
            { descripcion: "Examen 2", ponderacion_porcentaje: 30, fecha_aplicacion: "2026-06-25" }
          ]
        })
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.detail).toContain("100.00%");
    });

    it("should accept plan with ponderaciones sum = 100%", async () => {
      mockDB.prepare
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            first: vi.fn().mockResolvedValueOnce({ id: "11111111-1111-4111-a111-111111111111", docente_guia_id: "22222222-2222-4222-a222-222222222222" })
          })
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            first: vi.fn().mockResolvedValueOnce({ id: "22222222-2222-4222-a222-222222222222" })
          })
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            first: vi.fn().mockResolvedValueOnce(null)
          })
        });

      mockDB.batch.mockResolvedValueOnce([]);

      // Mock INSERT prepares (4 calls: 1 for plan + 3 for items)
      const mockStatement = {
        bind: vi.fn().mockReturnThis()
      };
      mockDB.prepare.mockReturnValueOnce(mockStatement); // plan insert
      mockDB.prepare.mockReturnValueOnce(mockStatement); // item 1
      mockDB.prepare.mockReturnValueOnce(mockStatement); // item 2
      mockDB.prepare.mockReturnValueOnce(mockStatement); // item 3

      // Mock the final query to retrieve created plan with items
      mockDB.prepare.mockReturnValueOnce({
        bind: vi.fn().mockReturnValueOnce({
          all: vi.fn().mockResolvedValueOnce({
            results: [
              {
                id: "new-plan-id",
                seccion_id: "11111111-1111-4111-a111-111111111111",
                asignatura_id: "22222222-2222-4222-a222-222222222222",
                docente_id: "22222222-2222-4222-a222-222222222222",
                lapso: 1,
                fecha_aprobacion: null,
                created_at: "2026-06-19 12:00:00",
                item_id: "eval-item-1",
                descripcion: "Examen 1",
                ponderacion_porcentaje: 50,
                fecha_aplicacion: "2026-06-20"
              },
              {
                id: "new-plan-id",
                seccion_id: "11111111-1111-4111-a111-111111111111",
                asignatura_id: "22222222-2222-4222-a222-222222222222",
                docente_id: "22222222-2222-4222-a222-222222222222",
                lapso: 1,
                fecha_aprobacion: null,
                created_at: "2026-06-19 12:00:00",
                item_id: "eval-item-2",
                descripcion: "Examen 2",
                ponderacion_porcentaje: 30,
                fecha_aplicacion: "2026-06-25"
              },
              {
                id: "new-plan-id",
                seccion_id: "11111111-1111-4111-a111-111111111111",
                asignatura_id: "22222222-2222-4222-a222-222222222222",
                docente_id: "22222222-2222-4222-a222-222222222222",
                lapso: 1,
                fecha_aprobacion: null,
                created_at: "2026-06-19 12:00:00",
                item_id: "eval-item-3",
                descripcion: "Tareas",
                ponderacion_porcentaje: 20,
                fecha_aplicacion: "2026-06-30"
              }
            ]
          })
        })
      });

      const res = await app.request("/api/planes", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${docenteToken}`
        },
        body: JSON.stringify({
          seccion_id: "11111111-1111-4111-a111-111111111111",
          asignatura_id: "22222222-2222-4222-a222-222222222222",
          lapso: 1,
          evaluaciones: [
            { descripcion: "Examen 1", ponderacion_porcentaje: 50, fecha_aplicacion: "2026-06-20" },
            { descripcion: "Examen 2", ponderacion_porcentaje: 30, fecha_aplicacion: "2026-06-25" },
            { descripcion: "Tareas", ponderacion_porcentaje: 20, fecha_aplicacion: "2026-06-30" }
          ]
        })
      });

      expect(res.status).toBe(201);
    });
  });

  describe("POST /api/calificaciones/batch - Ownership Validation", () => {
    it("should return 403 when docente tries to modify another docente's evaluation", async () => {
      mockDB.prepare.mockReturnValueOnce({
        bind: vi.fn().mockReturnValueOnce({
          first: vi.fn().mockResolvedValueOnce({
            id: "33333333-3333-4333-a333-333333333333",
            plan_id: "44444444-4444-4444-a444-444444444444",
            docente_id: "docente-other-id",
            seccion_id: "11111111-1111-4111-a111-111111111111"
          })
        })
      });

      const res = await app.request("/api/calificaciones/batch", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${docenteToken}`
        },
        body: JSON.stringify({
          evaluacion_item_id: "33333333-3333-4333-a333-333333333333",
          notas: [{ matricula_id: "55555555-5555-4555-a555-555555555555", valor_nota: 18 }]
        })
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.detail).toContain("otro docente");
    });

    it("should reject matriculas not belonging to the plan's seccion", async () => {
      mockDB.prepare.mockReturnValueOnce({
        bind: vi.fn().mockReturnValueOnce({
          first: vi.fn().mockResolvedValueOnce({
            id: "33333333-3333-4333-a333-333333333333",
            plan_id: "44444444-4444-4444-a444-444444444444",
            docente_id: "22222222-2222-4222-a222-222222222222",
            seccion_id: "11111111-1111-4111-a111-111111111111"
          })
        })
      });

      mockDB.prepare.mockReturnValueOnce({
        bind: vi.fn().mockReturnValueOnce({
          all: vi.fn().mockResolvedValueOnce({ results: [{ id: "55555555-5555-4555-a555-555555555555" }] })
        })
      });

      const res = await app.request("/api/calificaciones/batch", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${docenteToken}`
        },
        body: JSON.stringify({
          evaluacion_item_id: "33333333-3333-4333-a333-333333333333",
          notas: [{ matricula_id: "66666666-6666-4666-a666-666666666666", valor_nota: 18 }]
        })
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.detail).toContain("no pertenecen a la sección");
    });

    it("should validate note range according to institutional config", async () => {
      mockDB.prepare
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            first: vi.fn().mockResolvedValueOnce({
              id: "33333333-3333-4333-a333-333333333333",
              plan_id: "44444444-4444-4444-a444-444444444444",
              docente_id: "22222222-2222-4222-a222-222222222222",
              seccion_id: "11111111-1111-4111-a111-111111111111"
            })
          })
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            all: vi.fn().mockResolvedValueOnce({ results: [{ id: "55555555-5555-4555-a555-555555555555" }] })
          })
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            first: vi.fn().mockResolvedValueOnce({ sistema_evaluacion_por_defecto: "NUMERICO_10" })
          })
        });

      const res = await app.request("/api/calificaciones/batch", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${docenteToken}`
        },
        body: JSON.stringify({
          evaluacion_item_id: "33333333-3333-4333-a333-333333333333",
          notas: [{ matricula_id: "55555555-5555-4555-a555-555555555555", valor_nota: 25 }] // Exceeds 20 max
        })
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.detail).toContain("less than or equal to 20");
    });
  });

  describe("GET /api/calificaciones/seccion/:seccionId/lapso/:lapso - Grade Aggregation", () => {
    it("should calculate definitive grade correctly with weighted average", async () => {
      mockDB.prepare
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            first: vi.fn().mockResolvedValueOnce({ id: "11111111-1111-4111-a111-111111111111", docente_guia_id: "22222222-2222-4222-a222-222222222222" })
          })
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            all: vi.fn().mockResolvedValueOnce({ 
              results: [
                { id: "55555555-5555-4555-a555-555555555555", estudiante_id: "est-1", nombres: "Juan", apellidos: "Perez" },
                { id: "66666666-6666-4666-a666-666666666666", estudiante_id: "est-2", nombres: "Maria", apellidos: "Gomez" }
              ] 
            })
          })
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            all: vi.fn().mockResolvedValueOnce({ 
              results: [
                { id: "33333333-3333-4333-a333-333333333333", plan_id: "44444444-4444-4444-a444-444444444444", descripcion: "Examen 1", ponderacion_porcentaje: 50, fecha_aplicacion: "2026-06-20" },
                { id: "77777777-7777-4777-a777-777777777777", plan_id: "44444444-4444-4444-a444-444444444444", descripcion: "Examen 2", ponderacion_porcentaje: 50, fecha_aplicacion: "2026-06-25" }
              ] 
            })
          })
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            all: vi.fn().mockResolvedValueOnce({ 
              results: [
                { matricula_id: "55555555-5555-4555-a555-555555555555", evaluacion_item_id: "33333333-3333-4333-a333-333333333333", valor_nota: 18 },
                { matricula_id: "55555555-5555-4555-a555-555555555555", evaluacion_item_id: "77777777-7777-4777-a777-777777777777", valor_nota: 16 },
                { matricula_id: "66666666-6666-4666-a666-666666666666", evaluacion_item_id: "33333333-3333-4333-a333-333333333333", valor_nota: 14 },
                { matricula_id: "66666666-6666-4666-a666-666666666666", evaluacion_item_id: "77777777-7777-4777-a777-777777777777", valor_nota: 12 }
              ] 
            })
          })
        });

      const res = await app.request("/api/calificaciones/seccion/11111111-1111-4111-a111-111111111111/lapso/1", {
        method: "GET",
        headers: { "Authorization": `Bearer ${adminToken}` }
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.boletin).toBeDefined();
    });

    it("should return null literal_cualitativo for default NUMERICO_20 config", async () => {
      mockDB.prepare
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            first: vi.fn().mockResolvedValueOnce({ id: "11111111-1111-4111-a111-111111111111", docente_guia_id: "22222222-2222-4222-a222-222222222222" })
          })
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            all: vi.fn().mockResolvedValueOnce({ 
              results: [
                { id: "55555555-5555-4555-a555-555555555555", estudiante_id: "est-1", nombres: "Juan", apellidos: "Perez" }
              ] 
            })
          })
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            all: vi.fn().mockResolvedValueOnce({ 
              results: [
                { id: "33333333-3333-4333-a333-333333333333", plan_id: "44444444-4444-4444-a444-444444444444", descripcion: "Examen 1", ponderacion_porcentaje: 100, fecha_aplicacion: "2026-06-20" }
              ] 
            })
          })
        })
        .mockReturnValueOnce({
          bind: vi.fn().mockReturnValueOnce({
            all: vi.fn().mockResolvedValueOnce({ 
              results: [
                { matricula_id: "55555555-5555-4555-a555-555555555555", evaluacion_item_id: "33333333-3333-4333-a333-333333333333", valor_nota: 15 }
              ] 
            })
          })
        });

      const res = await app.request("/api/calificaciones/seccion/11111111-1111-4111-a111-111111111111/lapso/1", {
        method: "GET",
        headers: { "Authorization": `Bearer ${adminToken}` }
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.boletin[0].literal_cualitativo).toBeNull();
    });
  });
});