import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";

const reportesRouter = new Hono<{
  Bindings: {
    DB: D1Database;
    JWT_SECRET: string;
  };
}>();

function rfc7807(title: string, status: number, detail: string): HTTPException {
  return new HTTPException(status, {
    res: new Response(
      JSON.stringify({ title, status, detail }),
      { status, headers: { "Content-Type": "application/problem+json" } }
    )
  });
}

function calculateLiteral(nota: number, sistema: string): string | null {
  if (sistema !== "CUALITATIVO_AE" || nota === null || nota === undefined) return null;
  if (nota >= 19) return "A";
  if (nota >= 15) return "B";
  if (nota >= 11) return "C";
  if (nota >= 10) return "D";
  return "E";
}

// ============================================================================
// GET /api/reportes/boleta-data/:matricula_id - Datos Boletín en Caliente
// ============================================================================
reportesRouter.get("/boleta-data/:matricula_id", authMiddleware(), async (c) => {
  const matriculaId = c.req.param("matricula_id");
  const db = c.env.DB;
  const jwtPayload = c.get("jwtPayload");
  const userId = jwtPayload.sub;
  const userRole = jwtPayload.rol;

  if (!db) {
    throw rfc7807("Internal Server Error", 500, "La base de datos D1 no está disponible.");
  }

  // Validar matrícula existe
  const matricula = await db.prepare(
    `SELECT m.id, m.estudiante_id, m.seccion_id, e.nombres, e.apellidos, e.cedula_escolar, e.representante_id,
            s.nivel, s.seccion as seccion_letra
     FROM matriculas m
     JOIN estudiantes e ON m.estudiante_id = e.id
     JOIN secciones s ON m.seccion_id = s.id
     WHERE m.id = ? LIMIT 1`
  ).bind(matriculaId).first<any>();

  if (!matricula) {
    throw rfc7807("Not Found", 404, "Matrícula no encontrada.");
  }

  // Validación de Propiedad (Ownership)
  if (userRole === "REPRESENTANTE" && matricula.representante_id !== userId) {
    throw rfc7807("Forbidden", 403, "No tienes permisos para ver el boletín de este estudiante.");
  }

  if (userRole === "DOCENTE") {
    // Verificar que el docente tenga acceso a esta matrícula (sea docente guía o tenga plan en la sección)
    const tieneAcceso = await db.prepare(
      `SELECT 1 FROM secciones WHERE id = ? AND docente_guia_id = ? LIMIT 1`
    ).bind(matricula.seccion_id, userId).first();

    if (!tieneAcceso) {
      // Verificar si tiene plan de evaluación en la sección
      const tienePlan = await db.prepare(
        `SELECT 1 FROM planes_evaluacion WHERE seccion_id = ? AND docente_id = ? LIMIT 1`
      ).bind(matricula.seccion_id, userId).first();

      if (!tienePlan) {
        throw rfc7807("Forbidden", 403, "No tienes permisos para ver el boletín de este estudiante.");
      }
    }
  }

  // Obtener configuración institucional
  const config = await db.prepare(
    `SELECT sistema_evaluacion_por_defecto FROM institucion_config LIMIT 1`
  ).bind().first<{ sistema_evaluacion_por_defecto: string }>();

  const sistemaEvaluacion = config?.sistema_evaluacion_por_defecto || "NUMERICO_20";

  // Obtener calificaciones agrupadas por asignatura y lapso
  const calificaciones = await db.prepare(
    `SELECT 
        a.nombre as asignatura,
        pe.lapso,
        c.valor_nota,
        ei.ponderacion_porcentaje
     FROM calificaciones c
     JOIN evaluaciones_items ei ON c.evaluacion_item_id = ei.id
     JOIN planes_evaluacion pe ON ei.plan_id = pe.id
     JOIN asignaturas a ON pe.asignatura_id = a.id
     WHERE c.matricula_id = ? AND c.valor_nota IS NOT NULL
     ORDER BY a.nombre, pe.lapso`
  ).bind(matriculaId).all();

  // Procesar calificaciones por asignatura y lapso
  const asignaturasMap = new Map<string, { lapso_1: number | null; lapso_2: number | null; lapso_3: number | null; ponderaciones: number[] }>();

  for (const row of calificaciones?.results || []) {
    const key = row.asignatura;
    if (!asignaturasMap.has(key)) {
      asignaturasMap.set(key, { lapso_1: null, lapso_2: null, lapso_3: null, ponderaciones: [] });
    }
    const item = asignaturasMap.get(key)!;
    const lapsoKey = `lapso_${row.lapso}` as keyof typeof item;
    if (lapsoKey in item && item[lapsoKey] === null) {
      item[lapsoKey] = row.valor_nota;
    }
    item.ponderaciones.push(row.ponderacion_porcentaje);
  }

  // Calcular nota definitiva anual por asignatura
  const calificacionesLapsos = Array.from(asignaturasMap.entries()).map(([asignatura, data]) => {
    const notasValidas = [data.lapso_1, data.lapso_2, data.lapso_3].filter(n => n !== null) as number[];
    const notaDefinitivaAnual = notasValidas.length > 0 
      ? Math.round(notasValidas.reduce((a, b) => a + b, 0) / notasValidas.length * 10) / 10
      : null;
    return {
      asignatura,
      lapso_1: data.lapso_1,
      lapso_2: data.lapso_2,
      lapso_3: data.lapso_3,
      nota_definitiva_anual: notaDefinitivaAnual,
      literal_cualitativo: notaDefinitivaAnual !== null ? calculateLiteral(notaDefinitivaAnual, sistemaEvaluacion) : null
    };
  });

  // Obtener resumen de asistencia
  const asistencia = await db.prepare(
    `SELECT 
        COUNT(CASE WHEN a.estado = 'PRESENTE' THEN 1 END) as asistencias,
        COUNT(CASE WHEN a.estado = 'AUSENTE' THEN 1 END) as inasistencias,
        COUNT(CASE WHEN a.estado = 'JUSTIFICADO' THEN 1 END) as justificadas,
        COUNT(*) as total_clases
     FROM asistencia a
     WHERE a.matricula_id = ?`
  ).bind(matriculaId).first<any>();

  const totalClases = asistencia?.total_clases || 0;
  const inasistencias = asistencia?.inasistencias || 0;
  const porcentajeInasistencia = totalClases > 0 
    ? Math.round((inasistencias * 100.0 / totalClases) * 10) / 10 
    : 0;

  // Obtener info de periodo/ano escolar
  const seccion = await db.prepare(
    `SELECT s.nivel, s.seccion, p.nombre as periodo_nombre
     FROM secciones s
     JOIN periodos_academicos p ON s.periodo_id = p.id
     WHERE s.id = ?`
  ).bind(matricula.seccion_id).first<any>();

  return c.json({
    estudiante: {
      nombres: matricula.nombres,
      apellidos: matricula.apellidos,
      cedula_escolar: matricula.cedula_escolar,
      grado_seccion: `${matricula.nivel}-${matricula.seccion_letra}`,
      ano_escolar: seccion?.periodo_nombre || "Año Escolar 2025-2026"
    },
    periodo_config: {
      sistema_evaluacion: sistemaEvaluacion,
      nombre_periodo: seccion?.periodo_nombre || "Año Escolar 2025-2026"
    },
    calificaciones_lapsos: calificacionesLapsos,
    asistencia_resumen: {
      clases_totales: totalClases,
      asistencias: asistencia?.asistencias || 0,
      inasistencias: inasistencias,
      justificadas: asistencia?.justificadas || 0,
      porcentaje_inasistencia: porcentajeInasistencia
    }
  }, 200);
});

export { reportesRouter };