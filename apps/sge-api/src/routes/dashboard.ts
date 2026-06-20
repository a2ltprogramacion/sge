import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";

const dashboardRouter = new Hono<{
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

// ============================================================================
// GET /api/dashboard/salud - Salud Institucional (Solo ADMINISTRADOR)
// ============================================================================
dashboardRouter.get("/salud", authMiddleware(), requireRoles(["ADMINISTRADOR"]), async (c) => {
  const db = c.env.DB;

  if (!db) {
    throw rfc7807("Internal Server Error", 500, "La base de datos D1 no está disponible.");
  }

  try {
    // Query A: Métricas Globales
    const globalMetrics = await db.prepare(
      `SELECT 
        (SELECT COUNT(id) FROM matriculas WHERE estado = 'ACTIVO') as total_estudiantes,
        (SELECT COUNT(id) FROM usuarios WHERE rol = 'DOCENTE' AND activo = 1) as total_docentes,
        (SELECT AVG(valor_nota) FROM calificaciones c JOIN evaluaciones_items ei ON c.evaluacion_item_id = ei.id WHERE c.valor_nota IS NOT NULL) as promedio_general,
        (SELECT COUNT(CASE WHEN m.status_pago = 'CON_DEUDA' THEN 1 END) * 100.0 / COUNT(*) FROM matriculas m WHERE m.estado = 'ACTIVO') as porcentaje_morosidad`
    ).bind().first();

    // Query B: Alertas Docentes Atípicos (Desviación > 2 - Docentes con alta reprobación)
    const docenteAlerts = await db.prepare(
      `SELECT 
        u.id as docente_id,
        u.nombres || ' ' || u.apellidos as docente_nombre,
        a.nombre as asignatura_nombre,
        s.nivel || '-' || s.seccion as seccion,
        ROUND(AVG(c.valor_nota), 1) as promedio_notas,
        ROUND(
          (COUNT(CASE WHEN c.valor_nota IS NOT NULL AND c.valor_nota < 10 THEN 1 END) * 100.0) / 
          NULLIF(COUNT(c.id), 0), 1
        ) as porcentaje_reprobacion
      FROM calificaciones c
      JOIN evaluaciones_items ei ON c.evaluacion_item_id = ei.id
      JOIN planes_evaluacion pe ON ei.plan_id = pe.id
      JOIN asignaturas a ON pe.asignatura_id = a.id
      JOIN secciones s ON pe.seccion_id = s.id
      JOIN docentes d ON pe.docente_id = d.id
      JOIN usuarios u ON d.id = u.id
      WHERE c.valor_nota IS NOT NULL
      GROUP BY u.id, u.nombres, u.apellidos, a.nombre, s.nivel, s.seccion
      HAVING porcentaje_reprobacion > 50.0
      ORDER BY porcentaje_reprobacion DESC`
    ).bind().all();

    // Query C: Alertas Riesgo Abandono (Inasistencia >= 25%)
    const abandonoAlerts = await db.prepare(
      `SELECT 
        e.cedula_escolar,
        e.nombres || ' ' || e.apellidos as estudiante_nombre,
        s.nivel || '-' || s.seccion as seccion,
        COUNT(CASE WHEN a.estado = 'AUSENTE' THEN 1 END) as total_ausencias,
        COUNT(a.id) as total_clases,
        ROUND(COUNT(CASE WHEN a.estado = 'AUSENTE' THEN 1 END) * 100.0 / COUNT(a.id), 1) as tasa_inasistencia
      FROM asistencia a
      JOIN matriculas m ON a.matricula_id = m.id
      JOIN estudiantes e ON m.estudiante_id = e.id
      JOIN secciones s ON m.seccion_id = s.id
      WHERE m.estado = 'ACTIVO'
      GROUP BY e.id, e.cedula_escolar, e.nombres, e.apellidos, s.nivel, s.seccion
      HAVING tasa_inasistencia >= 25.0
      ORDER BY tasa_inasistencia DESC`
    ).bind().all();

    // Query D: Ratios de Solvencia Financiera por Sección
    const solvenciaData = await db.prepare(
      `SELECT 
        s.nivel || '-' || s.seccion as seccion,
        COUNT(m.id) as total_alumnos,
        COUNT(CASE WHEN m.status_pago = 'CON_DEUDA' THEN 1 END) as alumnos_morosos,
        COUNT(CASE WHEN m.status_pago = 'SOLVENTE' THEN 1 END) as alumnos_solventes,
        ROUND(COUNT(CASE WHEN m.status_pago = 'SOLVENTE' THEN 1 END) * 100.0 / COUNT(m.id), 1) as porcentaje_solvencia
      FROM matriculas m
      JOIN secciones s ON m.seccion_id = s.id
      WHERE m.estado = 'ACTIVO'
      GROUP BY s.id
      ORDER BY porcentaje_solvencia ASC`
    ).bind().all();

    return c.json({
      metricas_globales: {
        total_estudiantes_activos: globalMetrics?.total_estudiantes || 0,
        total_docentes: globalMetrics?.total_docentes || 0,
        promedio_general_instituto: Math.round((globalMetrics?.promedio_general || 0) * 10) / 10,
        porcentaje_morosidad_global: Math.round((globalMetrics?.porcentaje_morosidad || 0) * 10) / 10
      },
      alertas_docentes_atipicos: docenteAlerts?.results?.map((r: any) => ({
        docente_id: r.docente_id,
        docente_nombre: r.docente_nombre,
        asignatura_nombre: r.asignatura_nombre,
        seccion: r.seccion,
        promedio_notas: r.promedio_notas,
        porcentaje_reprobacion: r.porcentaje_reprobacion
      })) || [],
      alertas_riesgo_abandono: abandonoAlerts?.results?.map((r: any) => ({
        cedula_escolar: r.cedula_escolar,
        estudiante_nombre: r.estudiante_nombre,
        seccion: r.seccion,
        total_ausencias: r.total_ausencias,
        total_clases: r.total_clases,
        tasa_inasistencia: r.tasa_inasistencia
      })) || [],
      salud_financiera_secciones: solvenciaData?.results?.map((r: any) => ({
        seccion: r.seccion,
        total_alumnos: r.total_alumnos,
        alumnos_morosos: r.alumnos_morosos,
        alumnos_solventes: r.alumnos_solventes,
        porcentaje_solvencia: r.porcentaje_solvencia
      })) || []
    }, 200);

  } catch (err: any) {
    throw rfc7807("Internal Server Error", 500, "Error al calcular métricas: " + err.message);
  }
});

export { dashboardRouter };