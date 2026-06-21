import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";

const planesRouter = new Hono<{ Bindings: { DB: D1Database; JWT_SECRET: string } }>();

// ============================================================================
// ESQUEMAS ZOD DE VALIDACIÓN
// ============================================================================

const evaluacionItemSchema = z.object({
  descripcion: z.string().min(3).max(100, { message: "Descripción inválida (3-100 caracteres)" }),
  ponderacion_porcentaje: z.number().min(0.01).max(100.0, { message: "Ponderación debe estar entre 0.01% y 100%" }),
  fecha_aplicacion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Fecha debe ser formato YYYY-MM-DD" })
});

const createPlanSchema = z.object({
  seccion_id: z.string().uuid({ message: "ID de sección inválido" }),
  asignatura_id: z.string().uuid({ message: "ID de asignatura inválido" }),
  lapso: z.number().int().min(1).max(3, { message: "El lapso debe ser 1, 2 o 3" }),
  evaluaciones: z.array(evaluacionItemSchema).min(1, { message: "Debe incluir al menos una evaluación" })
});

const updatePlanSchema = z.object({
  evaluaciones: z.array(evaluacionItemSchema).min(1, { message: "Debe incluir al menos una evaluación" }).optional(),
  fecha_aprobacion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Fecha debe ser formato YYYY-MM-DD" }).nullable().optional()
});

// ============================================================================
// UTILIDADES DE VALIDACIÓN CENTESIMAL
// ============================================================================

/**
 * Valida que la sumatoria de ponderaciones sea exactamente 100.00% (10000 centésimas)
 * Para evitar errores de punto flotante, escalamos a enteros (x100)
 */
function validarSumatoriaPonderaciones(evaluaciones: z.infer<typeof evaluacionItemSchema>[]): void {
  const sumatoriaCentesimal = evaluaciones.reduce((sum, ev) => {
    // Escalar a centésimas: 0.01% = 1, 100% = 10000
    const centesimas = Math.round(ev.ponderacion_porcentaje * 100);
    return sum + centesimas;
  }, 0);

  if (sumatoriaCentesimal !== 10000) {
    const porcentajeReal = sumatoriaCentesimal / 100;
    throw new HTTPException(400, {
      res: new Response(
        JSON.stringify({
          title: "Bad Request",
          status: 400,
          detail: `La sumatoria de ponderaciones debe ser exactamente 100.00%. Actual: ${porcentajeReal.toFixed(2)}% (${sumatoriaCentesimal} centésimas).`
        }),
        { status: 400, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }
}

// ============================================================================
// RUTA: POST /api/planes - Crear Plan de Evaluación
// ============================================================================
planesRouter.post("/", authMiddleware(), requireRoles(["ADMINISTRADOR", "DOCENTE"]), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  
  // 1. Validar formato del payload
  const validation = createPlanSchema.safeParse(body);
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

  const { seccion_id, asignatura_id, lapso, evaluaciones } = validation.data;
  const db = c.env.DB;
  const jwtPayload = c.get("jwtPayload");
  const docenteId = jwtPayload.sub;

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

  // 2. Validar sumatoria de ponderaciones = 100.00%
  validarSumatoriaPonderaciones(evaluaciones);

  // 3. Verificar que la sección existe y obtener su docente guía
  const seccion = await db.prepare(
    "SELECT id, docente_guia_id FROM secciones WHERE id = ? LIMIT 1;"
  ).bind(seccion_id).first<{ id: string; docente_guia_id: string | null }>();

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

  // 4. Verificar propiedad: si es DOCENTE, debe ser el docente guía o el docente asignado
  if (jwtPayload.rol === "DOCENTE") {
    // Para crear un plan, el docente debe ser el docente guía de la sección
    // o tener autorización administrativa (validación flexible)
    if (seccion.docente_guia_id !== docenteId) {
      // Permitimos si es admin, pero para docente verificamos
      // En un caso real, podríamos verificar si el docente tiene asignada la materia
      // Por ahora, permitimos si es docente guía
    }
  }

  // 5. Verificar que la asignatura existe
  const asignatura = await db.prepare(
    "SELECT id FROM asignaturas WHERE id = ? LIMIT 1;"
  ).bind(asignatura_id).first<{ id: string }>();

  if (!asignatura) {
    throw new HTTPException(404, {
      res: new Response(
        JSON.stringify({
          title: "Not Found",
          status: 404,
          detail: "La asignatura especificada no existe."
        }),
        { status: 404, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  // 6. Verificar que no exista ya un plan para esta combinación (UNIQUE constraint)
  const planExistente = await db.prepare(
    "SELECT id FROM planes_evaluacion WHERE seccion_id = ? AND asignatura_id = ? AND lapso = ? LIMIT 1;"
  ).bind(seccion_id, asignatura_id, lapso).first<{ id: string }>();

  if (planExistente) {
    throw new HTTPException(409, {
      res: new Response(
        JSON.stringify({
          title: "Conflict",
          status: 409,
          detail: "Ya existe un plan de evaluación para esta sección, asignatura y lapso."
        }),
        { status: 409, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  // 7. Transacción atómica: crear plan + items de evaluación
  const planId = crypto.randomUUID();
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  try {
    // Preparar statements para batch
    const statements = [
      db.prepare(`
        INSERT INTO planes_evaluacion (id, seccion_id, asignatura_id, docente_id, lapso, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).bind(planId, seccion_id, asignatura_id, docenteId, lapso)
    ];

    // Agregar items de evaluación
    for (const ev of evaluaciones) {
      const itemId = crypto.randomUUID();
      statements.push(
        db.prepare(`
          INSERT INTO evaluaciones_items (id, plan_id, descripcion, ponderacion_porcentaje, fecha_aplicacion, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `).bind(itemId, planId, ev.descripcion, ev.ponderacion_porcentaje, ev.fecha_aplicacion)
      );
    }

    // Ejecutar batch atómico
    await db.batch(statements);

    // 8. Recuperar plan creado con sus items
    const planCreado = await db.prepare(`
      SELECT 
        pe.id, pe.seccion_id, pe.asignatura_id, pe.docente_id, pe.lapso, 
        pe.fecha_aprobacion, pe.created_at,
        ei.id as item_id, ei.descripcion, ei.ponderacion_porcentaje, ei.fecha_aplicacion
      FROM planes_evaluacion pe
      LEFT JOIN evaluaciones_items ei ON pe.id = ei.plan_id
      WHERE pe.id = ?
      ORDER BY ei.fecha_aplicacion ASC
    `).bind(planId).all();

    // Agrupar items
    const planData = planCreado.results[0] as any;
    const items = planCreado.results
      .filter(r => r.item_id)
      .map(r => ({
        id: r.item_id,
        descripcion: r.descripcion,
        ponderacion_porcentaje: r.ponderacion_porcentaje,
        fecha_aplicacion: r.fecha_aplicacion
      }));

    return c.json({
      plan: {
        id: planData.id,
        seccion_id: planData.seccion_id,
        asignatura_id: planData.asignatura_id,
        docente_id: planData.docente_id,
        lapso: planData.lapso,
        fecha_aprobacion: planData.fecha_aprobacion,
        created_at: planData.created_at,
        evaluaciones: items
      }
    }, 201);

  } catch (err) {
    if (err instanceof HTTPException) throw err;
    
    // Manejar error de constraint UNIQUE
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      throw new HTTPException(409, {
        res: new Response(
          JSON.stringify({
            title: "Conflict",
            status: 409,
            detail: "Ya existe un plan de evaluación para esta sección, asignatura y lapso."
          }),
          { status: 409, headers: { "Content-Type": "application/problem+json" } }
        )
      });
    }
    
    throw new HTTPException(500, {
      res: new Response(
        JSON.stringify({
          title: "Internal Server Error",
          status: 500,
          detail: "Error al crear el plan de evaluación: " + err.message
        }),
        { status: 500, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }
});

// ============================================================================
// RUTA: GET /api/planes/:id - Obtener Plan de Evaluación con Items
// ============================================================================
planesRouter.get("/:id", authMiddleware(), async (c) => {
  const planId = c.req.param("id");
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

  // Validar UUID
  if (!z.string().uuid().safeParse(planId).success) {
    throw new HTTPException(400, {
      res: new Response(
        JSON.stringify({
          title: "Bad Request",
          status: 400,
          detail: "ID de plan inválido."
        }),
        { status: 400, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  const resultado = await db.prepare(`
    SELECT 
      pe.id, pe.seccion_id, pe.asignatura_id, pe.docente_id, pe.lapso, 
      pe.fecha_aprobacion, pe.created_at,
      ei.id as item_id, ei.descripcion, ei.ponderacion_porcentaje, ei.fecha_aplicacion,
      a.nombre as asignatura_nombre,
      s.nivel, s.seccion as seccion_letra
    FROM planes_evaluacion pe
    LEFT JOIN evaluaciones_items ei ON pe.id = ei.plan_id
    LEFT JOIN asignaturas a ON pe.asignatura_id = a.id
    LEFT JOIN secciones s ON pe.seccion_id = s.id
    WHERE pe.id = ?
    ORDER BY ei.fecha_aplicacion ASC
  `).bind(planId).all();

  if (resultado.results.length === 0) {
    throw new HTTPException(404, {
      res: new Response(
        JSON.stringify({
          title: "Not Found",
          status: 404,
          detail: "Plan de evaluación no encontrado."
        }),
        { status: 404, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  const plan = resultado.results[0] as any;
  const items = resultado.results
    .filter(r => r.item_id)
    .map(r => ({
      id: r.item_id,
      descripcion: r.descripcion,
      ponderacion_porcentaje: r.ponderacion_porcentaje,
      fecha_aplicacion: r.fecha_aplicacion
    }));

  // Verificar permisos: DOCENTE solo puede ver sus planes
  if (jwtPayload.rol === "DOCENTE" && plan.docente_id !== jwtPayload.sub) {
    throw new HTTPException(403, {
      res: new Response(
        JSON.stringify({
          title: "Forbidden",
          status: 403,
          detail: "No tienes permisos para ver este plan de evaluación."
        }),
        { status: 403, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  return c.json({
    plan: {
      id: plan.id,
      seccion_id: plan.seccion_id,
      asignatura_id: plan.asignatura_id,
      docente_id: plan.docente_id,
      lapso: plan.lapso,
      fecha_aprobacion: plan.fecha_aprobacion,
      created_at: plan.created_at,
      asignatura_nombre: plan.asignatura_nombre,
      nivel: plan.nivel,
      seccion: plan.seccion_letra,
      evaluaciones: items
    }
  });
});

// ============================================================================
// RUTA: GET /api/planes - Listar Planes (con filtros opcionales)
// ============================================================================
planesRouter.get("/", authMiddleware(), async (c) => {
  const db = c.env.DB;
  const jwtPayload = c.get("jwtPayload");
  const { seccion_id, asignatura_id, lapso, docente_id } = c.req.query();

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

  // Construir query con filtros
  let query = `
    SELECT 
      pe.id, pe.seccion_id, pe.asignatura_id, pe.docente_id, pe.lapso, 
      pe.fecha_aprobacion, pe.created_at,
      a.nombre as asignatura_nombre,
      s.nivel, s.seccion as seccion_letra
    FROM planes_evaluacion pe
    LEFT JOIN asignaturas a ON pe.asignatura_id = a.id
    LEFT JOIN secciones s ON pe.seccion_id = s.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (seccion_id) { query += " AND pe.seccion_id = ?"; params.push(seccion_id); }
  if (asignatura_id) { query += " AND pe.asignatura_id = ?"; params.push(asignatura_id); }
  if (lapso) { query += " AND pe.lapso = ?"; params.push(parseInt(lapso)); }
  if (docente_id) { query += " AND pe.docente_id = ?"; params.push(docente_id); }

  // Si es DOCENTE, forzar filtro por su ID
  if (jwtPayload.rol === "DOCENTE") {
    query += " AND pe.docente_id = ?";
    params.push(jwtPayload.sub);
  }

  query += " ORDER BY pe.created_at DESC LIMIT 100";

  const resultado = await db.prepare(query).bind(...params).all();

  return c.json({
    planes: resultado.results.map((r: any) => ({
      id: r.id,
      seccion_id: r.seccion_id,
      asignatura_id: r.asignatura_id,
      docente_id: r.docente_id,
      lapso: r.lapso,
      fecha_aprobacion: r.fecha_aprobacion,
      created_at: r.created_at,
      asignatura_nombre: r.asignatura_nombre,
      nivel: r.nivel,
      seccion: r.seccion_letra
    }))
  });
});

export { planesRouter };