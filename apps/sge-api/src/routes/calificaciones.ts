import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";

const calificacionesRouter = new Hono<{ Bindings: { DB: D1Database; JWT_SECRET: string } }>();

// ============================================================================
// ESQUEMAS ZOD DE VALIDACIÓN
// ============================================================================

const notaItemSchema = z.object({
  matricula_id: z.string().uuid({ message: "ID de matrícula inválido" }),
  valor_nota: z.number().min(0).max(20).nullable(), // NULL permitido para limpiar nota
  observacion: z.string().max(200).optional()
});

const batchCalificacionesSchema = z.object({
  evaluacion_item_id: z.string().uuid({ message: "ID de evaluación inválido" }),
  notas: z.array(notaItemSchema).min(1, { message: "El lote de notas no puede estar vacío" })
});

// ============================================================================
// RUTA: POST /api/calificaciones/batch - Carga Masiva de Calificaciones
// ============================================================================
calificacionesRouter.post("/batch", authMiddleware(), requireRoles(["ADMINISTRADOR", "DOCENTE"]), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  
  // 1. Validar formato del payload
  const validation = batchCalificacionesSchema.safeParse(body);
  if (!validation.success) {
    const errors = validation.error.issues.map(i => i.message).join(", ");
    throw new HTTPException(400, {
      res: new Response(
        JSON.stringify({
          title: "Bad Request",
          status: 400,
          detail: "Error de validación: " + errors
        }),
        { status: 400, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  const { evaluacion_item_id, notas } = validation.data;
  const db = c.env.DB;
  const jwtPayload = c.get("jwtPayload");
  const userId = jwtPayload.sub;
  const userRole = jwtPayload.rol;

  if (!db) {
    throw new HTTPException(500, {
      res: new Response(
        JSON.stringify({
          title: "Internal Server Error",
          status: 500,
          detail: "La base de datos D1 no está disponible."
        }),
        { status: 500, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  // 2. VALIDACIÓN DE PROPIEDAD (OWNERSHIP) - CRÍTICO
  // Verificar que el item de evaluación existe y pertenece al docente (si es DOCENTE)
  const itemEvaluacion = await db.prepare(`
    SELECT 
      ei.id, ei.plan_id, ei.descripcion, ei.ponderacion_porcentaje,
      pe.docente_id, pe.seccion_id, pe.asignatura_id, pe.lapso,
      a.nombre as asignatura_nombre,
      s.nivel, s.seccion as seccion_letra
    FROM evaluaciones_items ei
    JOIN planes_evaluacion pe ON ei.plan_id = pe.id
    JOIN secciones s ON pe.seccion_id = s.id
    LEFT JOIN asignaturas a ON pe.asignatura_id = a.id
    WHERE ei.id = ?
    LIMIT 1;
  `).bind(evaluacion_item_id).first<{
    id: string;
    plan_id: string;
    descripcion: string;
    ponderacion_porcentaje: number;
    docente_id: string;
    seccion_id: string;
    asignatura_id: string;
    lapso: number;
    asignatura_nombre: string | null;
    nivel: string | null;
    seccion_letra: string | null;
  }>();

  if (!itemEvaluacion) {
    throw new HTTPException(404, {
      res: new Response(
        JSON.stringify({
          title: "Not Found",
          status: 404,
          detail: "El ítem de evaluación especificado no existe."
        }),
        { status: 404, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  // 3. VALIDACIÓN DE OWNERSHIP: DOCENTE solo puede modificar sus propias evaluaciones
  if (userRole === "DOCENTE" && itemEvaluacion.docente_id !== userId) {
    throw new HTTPException(403, {
      res: new Response(
        JSON.stringify({
          title: "Forbidden",
          status: 403,
          detail: "No tienes permisos para modificar calificaciones de esta evaluación. Pertenece a otro docente."
        }),
        { status: 403, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  // 4. Obtener todas las matrículas válidas de la sección del plan
  const matriculasValidas = await db.prepare(`
    SELECT id FROM matriculas 
    WHERE seccion_id = ? AND estado = 'ACTIVO'
  `).bind(itemEvaluacion.seccion_id).all();

  const matriculasValidasSet = new Set(matriculasValidas.results.map((m: any) => m.id));

  // 5. Validar que todas las matrículas del payload pertenecen a la sección
  const matriculasInvalidas = notas
    .filter(n => !matriculasValidasSet.has(n.matricula_id))
    .map(n => n.matricula_id);

  if (matriculasInvalidas.length > 0) {
    throw new HTTPException(400, {
      res: new Response(
        JSON.stringify({
          title: "Bad Request",
          status: 400,
          detail: `Las siguientes matrículas no pertenecen a la sección de este plan: ${matriculasInvalidas.join(", ")}`
        }),
        { status: 400, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  // 6. VALIDAR RANGO DE NOTA SEGÚN CONFIGURACIÓN INSTITUCIONAL
  // Obtener configuración de la institución
  const config = await db.prepare(`
    SELECT sistema_evaluacion_por_defecto FROM institucion_config LIMIT 1
  `).first<{ sistema_evaluacion_por_defecto: string }>();

  const maxNota = config?.sistema_evaluacion_por_defecto === "NUMERICO_10" ? 10 : 20;

  for (const nota of notas) {
    if (nota.valor_nota !== null && nota.valor_nota > maxNota) {
      throw new HTTPException(400, {
        res: new Response(
          JSON.stringify({
            title: "Bad Request",
            status: 400,
            detail: `La nota ${nota.valor_nota} excede el máximo permitido (${maxNota}) para el sistema ${config?.sistema_evaluacion_por_defecto}.`
          }),
          { status: 400, headers: { "Content-Type": "application/problem+json" } }
        )
      });
    }
  }

  // 7. TRANSACCIÓN ATÓMICA CON db.batch()
  // Usar INSERT OR REPLACE (ON CONFLICT) para upsert atómico
  const updateStatements = notas.map(n => {
    return db.prepare(`
      INSERT INTO calificaciones (id, evaluacion_item_id, matricula_id, valor_nota, observacion, updated_at)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(evaluacion_item_id, matricula_id) DO UPDATE SET
        valor_nota = excluded.valor_nota,
        observacion = excluded.observacion,
        updated_at = datetime('now');
    `).bind(evaluacion_item_id, n.matricula_id, n.valor_nota, n.observacion || null);
  });

  try {
    // Ejecutar batch atómico
    const results = await db.batch(updateStatements);
    
    // Contar registros afectados (cada statement devuelve info de cambios)
    let totalProcesados = 0;
    for (const result of results) {
      if (result.changes > 0) totalProcesados += result.changes;
    }

    // 8. Generar ID de transacción
    const transaccionId = crypto.randomUUID();

    return c.json({
      transaccion_id: transaccionId,
      registros_procesados: notas.length,
      status: "COMPLETED",
      detalle: {
        evaluacion_item_id,
        seccion: `${itemEvaluacion.nivel}-${itemEvaluacion.seccion_letra}`,
        asignatura: itemEvaluacion.asignatura_nombre,
        lapso: itemEvaluacion.lapso
      }
    });

  } catch (err) {
    if (err instanceof HTTPException) throw err;
    
    throw new HTTPException(500, {
      res: new Response(
        JSON.stringify({
          title: "Internal Server Error",
          status: 500,
          detail: "Error al procesar el lote de calificaciones: " + (err instanceof Error ? err.message : String(err))
        }),
        { status: 500, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }
});

// ============================================================================
// RUTA: GET /api/calificaciones/seccion/:seccionId/lapso/:lapso - Notas Definitivas
// ============================================================================
calificacionesRouter.get("/seccion/:seccionId/lapso/:lapso", authMiddleware(), async (c) => {
  const seccionId = c.req.param("seccionId");
  const lapso = parseInt(c.req.param("lapso"));
  const db = c.env.DB;
  const jwtPayload = c.get("jwtPayload");

  if (!db || isNaN(lapso)) {
    throw new HTTPException(400, {
      res: new Response(
        JSON.stringify({
          title: "Bad Request",
          status: 400,
          detail: "Parámetros inválidos."
        }),
        { status: 400, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  // Verificar permisos
  if (jwtPayload.rol === "DOCENTE") {
    // Verificar que el docente tenga planes en esa sección
    const tieneAcceso = await db.prepare(`
      SELECT 1 FROM planes_evaluacion 
      WHERE seccion_id = ? AND docente_id = ? AND lapso = ?
      LIMIT 1
    `).bind(seccionId, jwtPayload.sub, lapso).first();

    if (!tieneAcceso) {
      throw new HTTPException(403, {
        res: new Response(
          JSON.stringify({
            title: "Forbidden",
            status: 403,
            detail: "No tienes planes de evaluación en esta sección y lapso."
          }),
          { status: 403, headers: { "Content-Type": "application/problem+json" } }
        )
      });
    }
  }

  // Consulta de agregación: nota definitiva por estudiante
  // Fórmula: SUM(nota * ponderacion / 100)
  const resultado = await db.prepare(`
    SELECT 
      m.id as matricula_id,
      e.cedula_escolar,
      e.nombres,
      e.apellidos,
      pe.asignatura_id,
      a.nombre as asignatura_nombre,
      ei.id as evaluacion_item_id,
      ei.descripcion as evaluacion_descripcion,
      ei.ponderacion_porcentaje,
      c.valor_nota,
      c.observacion
    FROM matriculas m
    JOIN estudiantes e ON m.estudiante_id = e.id
    JOIN planes_evaluacion pe ON pe.seccion_id = m.seccion_id AND pe.lapso = ?
    LEFT JOIN evaluaciones_items ei ON ei.plan_id = pe.id
    LEFT JOIN calificaciones c ON c.evaluacion_item_id = ei.id AND c.matricula_id = m.id
    LEFT JOIN asignaturas a ON pe.asignatura_id = a.id
    WHERE m.seccion_id = ? AND m.estado = 'ACTIVO'
    ORDER BY e.apellidos, e.nombres, a.nombre, ei.fecha_aplicacion
  `).bind(lapso, seccionId).all();

  // Procesar resultados para agrupar por estudiante y asignatura
  const estudiantesMap = new Map<string, any>();

  for (const row of resultado.results) {
    const r = row as any;
    const key = `${r.matricula_id}-${r.asignatura_id}`;
    
    if (!estudiantesMap.has(key)) {
      estudiantesMap.set(key, {
        matricula_id: r.matricula_id,
        cedula_escolar: r.cedula_escolar,
        nombres: r.nombres,
        apellidos: r.apellidos,
        asignatura_id: r.asignatura_id,
        asignatura_nombre: r.asignatura_nombre,
        evaluaciones: []
      });
    }

    if (r.evaluacion_item_id) {
      estudiantesMap.get(key).evaluaciones.push({
        evaluacion_item_id: r.evaluacion_item_id,
        descripcion: r.evaluacion_descripcion,
        ponderacion_porcentaje: r.ponderacion_porcentaje,
        valor_nota: r.valor_nota,
        observacion: r.observacion
      });
    }
  }

  // Calcular nota definitiva por estudiante/asignatura
  const boletin = Array.from(estudiantesMap.values()).map(est => {
    let notaDefinitiva = 0;
    let ponderacionTotal = 0;

    for (const ev of est.evaluaciones) {
      if (ev.valor_nota !== null) {
        notaDefinitiva += ev.valor_nota * (ev.ponderacion_porcentaje / 100);
        ponderacionTotal += ev.ponderacion_porcentaje;
      }
    }

    // Obtener configuración para conversión cualitativa
    const sistemaEvaluacion = "NUMERICO_20";
    let literal: string | null = null;
    if (sistemaEvaluacion === "CUALITATIVO_AE") {
      if (notaDefinitiva >= 19) literal = "A";
      else if (notaDefinitiva >= 15) literal = "B";
      else if (notaDefinitiva >= 11) literal = "C";
      else if (notaDefinitiva >= 10) literal = "D";
      else literal = "E";
    }

    return {
      ...est,
      nota_definitiva: Math.round(notaDefinitiva * 100) / 100, // 2 decimales
      ponderacion_aplicada: ponderacionTotal,
      literal_cualitativo: literal
    };
  });

  return c.json({ boletin });
});

// ============================================================================
// RUTA: GET /api/calificaciones/estudiante/:matriculaId - Historial de Notas
// ============================================================================
calificacionesRouter.get("/estudiante/:matriculaId", authMiddleware(), async (c) => {
  const matriculaId = c.req.param("matriculaId");
  const db = c.env.DB;
  const jwtPayload = c.get("jwtPayload");

  if (!db) {
    throw new HTTPException(500, {
      res: new Response(
        JSON.stringify({
          title: "Internal Server Error",
          status: 500,
          detail: "La base de datos D1 no está disponible."
        }),
        { status: 500, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  // Verificar que la matrícula existe
  const matricula = await db.prepare(`
    SELECT m.id, m.estudiante_id, m.seccion_id, e.nombres, e.apellidos
    FROM matriculas m
    JOIN estudiantes e ON m.estudiante_id = e.id
    WHERE m.id = ? LIMIT 1
  `).bind(matriculaId).first();

  if (!matricula) {
    throw new HTTPException(404, {
      res: new Response(
        JSON.stringify({
          title: "Not Found",
          status: 404,
          detail: "Matrícula no encontrada."
        }),
        { status: 404, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  // REPRESENTANTE: solo puede ver a sus representados
  if (jwtPayload.rol === "REPRESENTANTE") {
    const esRepresentante = await db.prepare(`
      SELECT 1 FROM estudiantes WHERE id = ? AND representante_id = ? LIMIT 1
    `).bind(matricula.estudiante_id, jwtPayload.sub).first();

    if (!esRepresentante) {
      throw new HTTPException(403, {
        res: new Response(
          JSON.stringify({
            title: "Forbidden",
            status: 403,
            detail: "No tienes permisos para ver las calificaciones de este estudiante."
          }),
          { status: 403, headers: { "Content-Type": "application/problem+json" } }
        )
      });
    }
  }

  // Obtener todas las calificaciones del estudiante
  const resultado = await db.prepare(`
    SELECT 
      c.id, c.evaluacion_item_id, c.matricula_id, c.valor_nota, c.observacion, c.updated_at,
      ei.descripcion, ei.ponderacion_porcentaje, ei.fecha_aplicacion,
      pe.id as plan_id, pe.seccion_id, pe.asignatura_id, pe.lapso,
      a.nombre as asignatura_nombre,
      s.nivel, s.seccion as seccion_letra
    FROM calificaciones c
    JOIN evaluaciones_items ei ON c.evaluacion_item_id = ei.id
    JOIN planes_evaluacion pe ON ei.plan_id = pe.id
    LEFT JOIN asignaturas a ON pe.asignatura_id = a.id
    LEFT JOIN secciones s ON pe.seccion_id = s.id
    WHERE c.matricula_id = ?
    ORDER BY pe.lapso, a.nombre, ei.fecha_aplicacion
  `).bind(matriculaId).all();

  // Agrupar por lapso y asignatura
  const historial = resultado.results.reduce((acc: any, row: any) => {
    const lapsoKey = `Lapso ${row.lapso}`;
    if (!acc[lapsoKey]) acc[lapsoKey] = {};
    if (!acc[lapsoKey][row.asignatura_nombre]) acc[lapsoKey][row.asignatura_nombre] = [];
    
    acc[lapsoKey][row.asignatura_nombre].push({
      evaluacion_item_id: row.evaluacion_item_id,
      descripcion: row.descripcion,
      ponderacion_porcentaje: row.ponderacion_porcentaje,
      fecha_aplicacion: row.fecha_aplicacion,
      valor_nota: row.valor_nota,
      observacion: row.observacion,
      updated_at: row.updated_at
    });
    return acc;
  }, {});

  return c.json({
    estudiante: {
      matricula_id: matricula.id,
      nombres: matricula.nombres,
      apellidos: matricula.apellidos
    },
    historial
  });
});

export { calificacionesRouter };