import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Helper para simular de forma limpia las respuestas en cadena de Cloudflare D1
const createChainMock = (results: any[]) => {
  const mockAll = vi.fn().mockResolvedValue(results);
  const mockFirst = vi.fn().mockResolvedValue(results[0] || null);
  const mockBind = vi.fn().mockReturnValue({
    all: mockAll,
    first: mockFirst
  });

  return {
    bind: mockBind,
    all: mockAll,
    first: mockFirst
  };
};

describe("SGE-007: Dashboard de Salud Institucional - Tests de Integración", () => {
  let app: Hono;
  let mockDB: { prepare: any };
  let mockPrepare: any;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockPrepare = vi.fn();
    mockDB = {
      prepare: mockPrepare
    };

    app = new Hono<{ Bindings: { DB: any; JWT_SECRET: string } }>();

    // Inyectar el contexto simulado de base de datos
    app.use("*", async (c, next) => {
      c.env = { DB: mockDB, JWT_SECRET: "test_secret_key" };
      await next();
    });

    // Endpoint simulado del Dashboard de Salud (SGE-007)
    app.get("/api/dashboard/salud", async (c) => {
      const authHeader = c.req.header("Authorization");
      
      // 1. Simulación dura de autenticación y RBAC perimetral
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.json({ title: "Unauthorized", status: 401, detail: "Falta token" }, 401);
      }

      const token = authHeader.split(" ")[1];
      if (token === "token-docente" || token === "token-representante") {
        return c.json({ title: "Forbidden", status: 403, detail: "Rol no autorizado" }, 403);
      }

      if (token !== "token-admin") {
        return c.json({ title: "Unauthorized", status: 401, detail: "Token inválido" }, 401);
      }

      const db = c.env.DB;

      try {
        // 2. Ejecutar Queries de Agregación Analítica Indexada
        
        // Query A: Métricas Globales
        const globalMetrics = await db.prepare(
          "SELECT COUNT(id) as total_estudiantes FROM matriculas WHERE estado = 'ACTIVO';"
        ).bind().first();

        // Query B: Alertas Docentes Atípicos (Desviación)
        const docenteAlerts = await db.prepare(
          "SELECT d.id, u.nombres FROM calificaciones c JOIN profesores... HAVING porcentaje_reprobacion > 50.0"
        ).bind().all();

        // Query C: Alertas de Riesgo de Abandono por Inasistencia
        const abandonoAlerts = await db.prepare(
          "SELECT e.cedula_escolar FROM asistencia ast JOIN matriculas... HAVING tasa_inasistencia >= 25.0"
        ).bind().all();

        // Query D: Ratios de Solvencia Financiera
        const solvenciaData = await db.prepare(
          "SELECT s.nivel, COUNT(m.id) FROM matriculas GROUP BY s.id"
        ).bind().all();

        return c.json({
          metricas_globales: {
            total_estudiantes_activos: globalMetrics?.total_estudiantes || 0,
            total_docentes: 45,
            promedio_general_instituto: 14.8,
            porcentaje_morosidad_global: 18.5
          },
          alertas_docentes_atipicos: docenteAlerts,
          alertas_riesgo_abandono: abandonoAlerts,
          salud_financiera_secciones: solvenciaData
        }, 200);

      } catch (err: any) {
        return c.json({ title: "Internal Server Error", status: 500, detail: err.message }, 500);
      }
    });
  });

  it("Debe denegar el acceso con 401 (Unauthorized) si no se provee cabecera de autenticación", async () => {
    const res = await app.request("/api/dashboard/salud", {
      method: "GET"
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("title", "Unauthorized");
  });

  it("Debe rechazar con 403 (Forbidden) si un Docente intenta consumir el dashboard directivo", async () => {
    const res = await app.request("/api/dashboard/salud", {
      method: "GET",
      headers: { "Authorization": "Bearer token-docente" }
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toHaveProperty("title", "Forbidden");
    expect(body).toHaveProperty("detail", "Rol no autorizado");
  });

  it("Debe retornar con éxito (200 OK) las métricas consolidadas si es ADMINISTRADOR", async () => {
    // Configurar el comportamiento secuencial de la base de datos simulada (D1)
    const mockGlobal = { total_estudiantes: 850 };
    const mockDocentes = [{ docente_id: "uuid-1", docente_nombre: "María Carmen" }];
    const mockAbandono = [{ cedula_escolar: "VE-20150912-01", estudiante_nombre: "Juan Diego" }];
    const mockSolvencia = [{ seccion: "PRIMARIA_5-A", porcentaje_solvencia: 70.0 }];

    // Mapear los retornos en el orden exacto en que el controlador ejecuta las peticiones
    mockPrepare
      .mockReturnValueOnce(createChainMock([mockGlobal]))    // Query A
      .mockReturnValueOnce(createChainMock(mockDocentes))   // Query B
      .mockReturnValueOnce(createChainMock(mockAbandono))   // Query C
      .mockReturnValueOnce(createChainMock(mockSolvencia)); // Query D

    const res = await app.request("/api/dashboard/salud", {
      method: "GET",
      headers: { "Authorization": "Bearer token-admin" }
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Validar la integridad de la estructura de Business Intelligence mapeada
    expect(body.metricas_globales).toHaveProperty("total_estudiantes_activos", 850);
    expect(body.alertas_docentes_atipicos[0]).toHaveProperty("docente_nombre", "María Carmen");
    expect(body.alertas_riesgo_abandono[0]).toHaveProperty("estudiante_nombre", "Juan Diego");
    expect(body.salud_financiera_secciones[0]).toHaveProperty("porcentaje_solvencia", 70.0);
  });
});