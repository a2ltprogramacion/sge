import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { sendPushNotification } from "../services/push";

const asistenciaRouter = new Hono<{ Bindings: { DB: D1Database; JWT_SECRET: string; VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; VAPID_SUBJECT: string } }>();

// ============================================================================
// ESQUEMAS ZOD DE VALIDACIÓN
// ============================================================================

const asistenciaItemSchema = z.object({
  matricula_id: z.string().uuid({ message: "ID de matrícula inválido" }),
  estado: z.enum(["PRESENTE", "AUSENTE", "JUSTIFICADO"]),
  observacion: z.string().max(150).optional()
});

const batchAsistenciaSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Fecha debe ser YYYY-MM-DD" }),
  plan_id: z.string().uuid().nullable(), // NULL para Primaria, ID de plan para Bachillerato
  seccion_id: z.string().uuid({ message: "ID de sección inválido" }),
  registros: z.array(asistenciaItemSchema).min(1, { message: "El lote de asistencia no puede estar vacío" })
});

// ============================================================================
// RUTA: POST /api/asistencia/batch - Registro de Asistencia por Lote
// ============================================================================
asistenciaRouter.post("/batch", authMiddleware(), requireRoles(["ADMINISTRADOR", "DOCENTE"]), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  
  // 1. Validar formato del payload
  const validation = batchAsistenciaSchema.safeParse(body);
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

  const { fecha, plan_id, seccion_id, registros } = validation.data;
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

  // 2. Verificar que la sección existe
  const seccion = await db.prepare(`
    SELECT id, nivel, seccion as seccion_letra, docente_guia_id
    FROM secciones WHERE id = ? LIMIT 1
  `).bind(seccion_id).first<{
    id: string;
    nivel: string;
    seccion_letra: string;
    docente_guia_id: string | null;
  }>();

  if (!seccion) {
    throw new HTTPException(404, {
      res: new Response(
        JSON.stringify({
          title: "Not Found",
          status: 404,
          detail: "La sección especificada no existe."
        }),
        { status: 404, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  // 3. Si se proporciona plan_id, verificar que existe y pertenece a la sección
  let planInfo: { docente_id: string; asignatura_id: string } | null = null;
  if (plan_id) {
    const plan = await db.prepare(`
      SELECT docente_id, asignatura_id FROM planes_evaluacion WHERE id = ? AND seccion_id = ? LIMIT 1
    `).bind(plan_id, seccion_id).first<{ docente_id: string; asignatura_id: string }>();

    if (!plan) {
      throw new HTTPException(404, {
        res: new Response(
          JSON.stringify({
            title: "Not Found",
            status: 404,
            detail: "El plan de evaluación no existe o no pertenece a esta sección."
          }),
          { status: 404, headers: { "Content-Type": "application/problem+json" } }
        )
      });
    }
    planInfo = plan;
  }

  // 4. VALIDACIÓN DE OWNERSHIP
  if (userRole === "DOCENTE") {
    // Para Primaria (plan_id = NULL): verificar que es docente guía
    // Para Bachillerato (plan_id != NULL): verificar que es docente del plan
    if (plan_id) {
      if (planInfo?.docente_id !== userId) {
        throw new HTTPException(403, {
          res: new Response(
            JSON.stringify({
              title: "Forbidden",
              status: 403,
              detail: "No tienes permisos para registrar asistencia en este plan. Pertenece a otro docente."
            }),
            { status: 403, headers: { "Content-Type": "application/problem+json" } }
          )
        });
      }
    } else {
      // Control diario general (Primaria): debe ser docente guía
      if (seccion.docente_guia_id !== userId) {
        throw new HTTPException(403, {
          res: new Response(
            JSON.stringify({
              title: "Forbidden",
              status: 403,
              detail: "No eres el docente guía de esta sección para el control diario."
            }),
            { status: 403, headers: { "Content-Type": "application/problem+json" } }
          )
        });
      }
    }
  }

  // 5. Obtener matrículas válidas de la sección
  const matriculasValidas = await db.prepare(`
    SELECT id, estudiante_id FROM matriculas WHERE seccion_id = ? AND estado = 'ACTIVO'
  `).bind(seccion_id).all();

  const matriculasValidasMap = new Map<string, string>(); // matricula_id -> estudiante_id
  for (const m of matriculasValidas.results) {
    matriculasValidasMap.set(m.id, m.estudiante_id);
  }

  // 6. Validar que todas las matrículas del payload son de la sección
  const matriculasInvalidas = registros
    .filter(r => !matriculasValidasMap.has(r.matricula_id))
    .map(r => r.matricula_id);

  if (matriculasInvalidas.length > 0) {
    throw new HTTPException(400, {
      res: new Response(
        JSON.stringify({
          title: "Bad Request",
          status: 400,
          detail: `Las siguientes matrículas no pertenecen a esta sección: ${matriculasInvalidas.join(", ")}`
        }),
        { status: 400, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  // 7. TRANSACCIÓN ATÓMICA: Insertar asistencia por lote
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const insertStatements = registros.map(r => {
    const asistenciaId = crypto.randomUUID();
    return db.prepare(`
      INSERT INTO asistencia (id, matricula_id, fecha, plan_id, estado, observacion, docente_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(matricula_id, fecha, plan_id) DO UPDATE SET
        estado = excluded.estado,
        observacion = excluded.observacion,
        docente_id = excluded.docente_id,
        created_at = datetime('now');
    `).bind(asistenciaId, r.matricula_id, fecha, plan_id, r.estado, r.observacion || null, userId);
  });

  try {
    await db.batch(insertStatements);

    // 8. Identificar ausencias para notificaciones Push (ASYNC - no bloqueante)
    const ausencias = registros.filter(r => r.estado === "AUSENTE");
    let alertasPushDisparadas = 0;

    if (ausencias.length > 0 && c.executionCtx) {
      // PROCESAMIENTO ASÍNCRONO NO BLOQUEANTE
      c.executionCtx.waitUntil(
        procesarNotificacionesAusencias(ausencias, matriculasValidasMap, db, c.env)
          .then(count => { alertasPushDisparadas = count; })
          .catch(err => console.error("Error en notificaciones Push:", err))
      );
    }

    // 9. Respuesta inmediata al docente
    return c.json({
      fecha,
      seccion: `${seccion.nivel}-${seccion.seccion_letra}`,
      procesados: registros.length,
      alertas_push_disparadas: alertasPushDisparadas,
      mensaje: "Asistencia registrada correctamente. Las notificaciones se envían en segundo plano."
    });

  } catch (err) {
    if (err instanceof HTTPException) throw err;
    
    throw new HTTPException(500, {
      res: new Response(
        JSON.stringify({
          title: "Internal Server Error",
          status: 500,
          detail: "Error al procesar el lote de asistencia: " + (err instanceof Error ? err.message : String(err))
        }),
        { status: 500, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }
});

// ============================================================================
// FUNCIÓN ASÍNCRONA: Procesar Notificaciones Push para Ausencias
// ============================================================================
async function procesarNotificacionesAusencias(
  ausencias: Array<{ matricula_id: string; observacion?: string }>,
  matriculasValidasMap: Map<string, string>,
  db: D1Database,
  env: { VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; VAPID_SUBJECT: string }
): Promise<number> {
  let notificacionesEnviadas = 0;

  for (const ausencia of ausencias) {
    const estudianteId = matriculasValidasMap.get(ausencia.matricula_id);
    if (!estudianteId) continue;

    // Obtener representante del estudiante y sus suscripciones push
    const suscripciones = await db.prepare(`
      SELECT sp.endpoint, sp.p256dh, sp.auth
      FROM suscripciones_push sp
      JOIN representantes r ON sp.usuario_id = r.id
      JOIN estudiantes e ON e.representante_id = r.id
      WHERE e.id = ?
    `).bind(estudianteId).all();

    for (const sub of suscripciones.results) {
      try {
        await sendPushNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          },
          {
            title: "Alerta de Asistencia",
            body: `Se ha registrado la AUSENCIA de su representado(a) el ${new Date().toLocaleDateString('es-VE')}.`,
            icon: "/assets/icon-192.png",
            badge: "/assets/badge-72.png",
            data: {
              url: "/representante/asistencia",
              matricula_id: ausencia.matricula_id
            }
          },
          env
        );
        notificacionesEnviadas++;
      } catch (pushErr) {
        console.error("Error enviando Push:", pushErr);
        // Continuar con las demás suscripciones
      }
    }
  }

  return notificacionesEnviadas;
}

// ============================================================================
// RUTA: GET /api/asistencia/seccion/:seccionId/fecha/:fecha - Reporte Diario
// ============================================================================
asistenciaRouter.get("/seccion/:seccionId/fecha/:fecha", authMiddleware(), async (c) => {
  const seccionId = c.req.param("seccionId");
  const fecha = c.req.param("fecha");
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

  // Verificar formato de fecha
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new HTTPException(400, {
      res: new Response(
        JSON.stringify({
          title: "Bad Request",
          status: 400,
          detail: "Formato de fecha inválido. Use YYYY-MM-DD."
        }),
        { status: 400, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  const resultado = await db.prepare(`
    SELECT 
      a.id, a.matricula_id, a.fecha, a.plan_id, a.estado, a.observacion, a.created_at,
      m.estudiante_id,
      e.cedula_escolar, e.nombres, e.apellidos
    FROM asistencia a
    JOIN matriculas m ON a.matricula_id = m.id
    JOIN estudiantes e ON m.estudiante_id = e.id
    WHERE a.fecha = ? AND m.seccion_id = ?
    ORDER BY e.apellidos, e.nombres
  `).bind(fecha, seccionId).all();

  // Agrupar por estado para resumen
  const resumen = resultado.results.reduce((acc: any, row: any) => {
    acc[row.estado] = (acc[row.estado] || 0) + 1;
    return acc;
  }, { PRESENTE: 0, AUSENTE: 0, JUSTIFICADO: 0 });

  return c.json({
    fecha,
    seccion_id: seccionId,
    resumen,
    registros: resultado.results.map((r: any) => ({
      asistencia_id: r.id,
      matricula_id: r.matricula_id,
      cedula_escolar: r.cedula_escolar,
      estudiante: `${r.apellidos}, ${r.nombres}`,
      estado: r.estado,
      observacion: r.observacion,
      plan_id: r.plan_id,
      registrado_en: r.created_at
    }))
  });
});

// ============================================================================
// RUTA: GET /api/asistencia/estudiante/:matriculaId - Historial de Asistencia
// ============================================================================
asistenciaRouter.get("/estudiante/:matriculaId", authMiddleware(), async (c) => {
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

  // Verificar matrícula
  const matricula = await db.prepare(`
    SELECT m.id, m.estudiante_id, m.seccion_id, e.nombres, e.apellidos, e.cedula_escolar
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

  // REPRESENTANTE: solo sus representados
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
            detail: "No tienes permisos para ver la asistencia de este estudiante."
          }),
          { status: 403, headers: { "Content-Type": "application/problem+json" } }
        )
      });
    }
  }

  const resultado = await db.prepare(`
    SELECT 
      a.id, a.fecha, a.plan_id, a.estado, a.observacion, a.created_at,
      pe.asignatura_id, a2.nombre as asignatura_nombre,
      pe.lapso
    FROM asistencia a
    LEFT JOIN planes_evaluacion pe ON a.plan_id = pe.id
    LEFT JOIN asignaturas a2 ON pe.asignatura_id = a2.id
    WHERE a.matricula_id = ?
    ORDER BY a.fecha DESC
  `).bind(matriculaId).all();

  // Calcular estadísticas
  const stats = resultado.results.reduce((acc: any, r: any) => {
    acc.total++;
    if (r.estado === "AUSENTE") acc.ausencias++;
    else if (r.estado === "JUSTIFICADO") acc.justificados++;
    else acc.presentes++;
    return acc;
  }, { total: 0, presentes: 0, ausencias: 0, justificados: 0 });

  return c.json({
    estudiante: {
      matricula_id: matricula.id,
      cedula_escolar: matricula.cedula_escolar,
      nombres: matricula.nombres,
      apellidos: matricula.apellidos
    },
    estadisticas: stats,
    registros: resultado.results.map((r: any) => ({
      asistencia_id: r.id,
      fecha: r.fecha,
      estado: r.estado,
      observacion: r.observacion,
      asignatura: r.asignatura_nombre || "Control Diario",
      lapso: r.lapso,
      registrado_en: r.created_at
    }))
  });
});

// ============================================================================
// RUTA: PATCH /api/asistencia/:asistenciaId/justificar - Justificar Ausencia
// ============================================================================
asistenciaRouter.patch("/:asistenciaId/justificar", authMiddleware(), async (c) => {
  const asistenciaId = c.req.param("asistenciaId");
  const db = c.env.DB;
  const jwtPayload = c.get("jwtPayload");

  if (!db) {
    throw new HTTPException(500, {
      res: new Response(
        JSON.stringify({ title: "Internal Server Error", status: 500, detail: "Base de datos no disponible." }),
        { status: 500, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  const body = await c.req.json().catch(() => ({}));
  const observacion = (body.observacion || "").trim();
  if (!observacion) {
    throw new HTTPException(400, {
      res: new Response(
        JSON.stringify({ title: "Bad Request", status: 400, detail: "Observación requerida para justificar." }),
        { status: 400, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  const registro = await db.prepare(
    `SELECT a.id, a.matricula_id, a.estado, m.estudiante_id, e.representante_id
     FROM asistencia a
     JOIN matriculas m ON a.matricula_id = m.id
     JOIN estudiantes e ON m.estudiante_id = e.id
     WHERE a.id = ? LIMIT 1`
  ).bind(asistenciaId).first<any>();

  if (!registro) {
    throw new HTTPException(404, {
      res: new Response(
        JSON.stringify({ title: "Not Found", status: 404, detail: "Registro de asistencia no encontrado." }),
        { status: 404, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  if (registro.estado !== "AUSENTE") {
    throw new HTTPException(409, {
      res: new Response(
        JSON.stringify({ title: "Conflict", status: 409, detail: "Solo se pueden justificar ausencias." }),
        { status: 409, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  if (jwtPayload.rol === "REPRESENTANTE" && registro.representante_id !== jwtPayload.sub) {
    throw new HTTPException(403, {
      res: new Response(
        JSON.stringify({ title: "Forbidden", status: 403, detail: "No tienes permisos para justificar esta ausencia." }),
        { status: 403, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  await db.prepare(
    `UPDATE asistencia SET estado = 'JUSTIFICADO', observacion = ? WHERE id = ?`
  ).bind(observacion, asistenciaId).run();

  return c.json({ success: true, message: "Ausencia justificada correctamente." });
});

export { asistenciaRouter };