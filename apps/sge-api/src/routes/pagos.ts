import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";

const pagosRouter = new Hono<{
  Bindings: {
    DB: D1Database;
    JWT_SECRET: string;
    BUCKET_COMPROBANTES: R2Bucket;
  };
}>();

const MESES_VALIDOS = [
  "INSCRIPCION", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO"
] as const;

const registrarPagoSchema = z.object({
  matricula_id: z.string().uuid({ message: "ID de matrícula inválido" }),
  mes_correspondiente: z.enum(MESES_VALIDOS, { message: "Mes inválido" }),
  monto_dolares: z.number().min(0.01, { message: "Monto USD debe ser mayor a 0" }),
  monto_bolivares: z.number().min(0.01, { message: "Monto VES debe ser mayor a 0" }),
  tasa_cambio: z.number().min(0.01, { message: "Tasa de cambio inválida" }),
  referencia_bancaria: z.string().min(4).max(30, { message: "Referencia bancaria inválida (4-30 caracteres)" }),
  banco_origen: z.string().min(3).max(50, { message: "Banco de origen inválido" }),
  banco_destino: z.string().min(3).max(50, { message: "Banco de destino inválido" }),
  fecha_pago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Fecha debe ser YYYY-MM-DD" }),
  imagen_b64: z.string({ message: "Comprobante requerido (Base64 WebP ≤100KB)" })
});

const conciliarPagoSchema = z.object({
  pago_id: z.string().uuid({ message: "ID de pago inválido" }),
  accion: z.enum(["APROBAR", "RECHAZAR"], { message: "Acción debe ser APROBAR o RECHAZAR" }),
  comentario_auditoria: z.string().max(500).optional(),
  thumbnail_auditoria_b64: z.string().max(15360).optional()
});

function rfc7807(title: string, status: number, detail: string): HTTPException {
  return new HTTPException(status, {
    res: new Response(
      JSON.stringify({ title, status, detail }),
      { status, headers: { "Content-Type": "application/problem+json" } }
    )
  });
}

// ============================================================================
// RUTA: POST /api/pagos/registrar - Registrar Pago con Comprobante R2
// ============================================================================
pagosRouter.post("/registrar", authMiddleware(), requireRoles(["ADMINISTRADOR", "REPRESENTANTE"]), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = registrarPagoSchema.safeParse(body);
  if (!parsed.success) {
    const errors = parsed.error.issues.map(i => i.message).join(", ");
    throw rfc7807("Bad Request", 400, "Error de validación: " + errors);
  }
  const pagoData = parsed.data;

  const db = c.env.DB;
  const bucket = c.env.BUCKET_COMPROBANTES;
  const jwtPayload = c.get("jwtPayload");
  const userId = jwtPayload.sub;
  const userRole = jwtPayload.rol;

  if (!db) {
    throw rfc7807("Internal Server Error", 500, "La base de datos D1 no está disponible.");
  }

  // Validar y decodificar imagen Base64
  let binary: Buffer;
  try {
    binary = Buffer.from(pagoData.imagen_b64, "base64");
  } catch {
    throw rfc7807("Bad Request", 400, "Comprobante inválido: Base64 mal formado.");
  }

  // Validar peso: ≤ 100 KB (102,400 bytes)
  if (binary.length > 102400) {
    throw rfc7807("Bad Request", 400, `Comprobante excede 100KB (tamaño: ${(binary.length / 1024).toFixed(1)}KB).`);
  }

  // Validar MIME WebP via magic bytes (RIFF header + WEBP)
  const isWebP = binary.length >= 12 &&
    binary[0] === 0x52 && binary[1] === 0x49 && binary[2] === 0x46 && binary[3] === 0x46 && // "RIFF"
    binary[8] === 0x57 && binary[9] === 0x45 && binary[10] === 0x42 && binary[11] === 0x50; // "WEBP"
  if (!isWebP) {
    throw rfc7807("Bad Request", 400, "Formato no permitido: debe ser WebP (verificar compresión en cliente).");
  }

  if (!db) {
    throw rfc7807("Internal Server Error", 500, "La base de datos D1 no está disponible.");
  }

  // 1. Verificar matrícula
  const matricula = await db.prepare(`
    SELECT m.id, m.estudiante_id, m.estado, m.status_pago, m.seccion_id,
           e.nombres, e.apellidos, e.representante_id
    FROM matriculas m
    JOIN estudiantes e ON m.estudiante_id = e.id
    WHERE m.id = ? LIMIT 1
  `).bind(pagoData.matricula_id).first<{
    id: string;
    estudiante_id: string;
    estado: string;
    status_pago: string;
    seccion_id: string;
    nombres: string;
    apellidos: string;
    representante_id: string;
  }>();

  if (!matricula) {
    throw rfc7807("Not Found", 404, "Matrícula no encontrada.");
  }

  // 2. OWNERSHIP: REPRESENTANTE solo puede pagar por sus representados
  if (userRole === "REPRESENTANTE" && matricula.representante_id !== userId) {
    throw rfc7807("Forbidden", 403, "No tienes permisos para registrar pagos de este estudiante. No es tu representado.");
  }

  // 3. Verificar que no exista pago PENDIENTE o APROBADO para el mismo mes
  const pagoDuplicado = await db.prepare(`
    SELECT id, status_conciliacion FROM pagos
    WHERE matricula_id = ? AND mes_correspondiente = ?
    AND status_conciliacion IN ('PENDIENTE', 'APROBADO')
    LIMIT 1
  `).bind(pagoData.matricula_id, pagoData.mes_correspondiente).first<{ id: string; status_conciliacion: string }>();

  if (pagoDuplicado) {
    throw rfc7807("Conflict", 409, `Ya existe un pago con estado ${pagoDuplicado.status_conciliacion} para el mes ${pagoData.mes_correspondiente}. Pago ID: ${pagoDuplicado.id}`);
  }

  // 4. Consistencia financiera: monto_dolares ≈ monto_bolivares / tasa_cambio (tolerancia 5%)
  const montoCalculado = pagoData.monto_bolivares / pagoData.tasa_cambio;
  const desviacion = Math.abs(montoCalculado - pagoData.monto_dolares) / pagoData.monto_dolares;
  if (desviacion > 0.05) {
    throw rfc7807("Bad Request", 400, `Inconsistencia financiera: USD calculado (${montoCalculado.toFixed(2)}) difiere más del 5% del declarado (${pagoData.monto_dolares}). Verifique monto_bolivares y tasa_cambio.`);
  }

  // 5. Generar ID y R2 key (formato: comprobantes/{matricula_id}/{fecha_pago}_{referencia}.webp)
  const pagoId = crypto.randomUUID();
  const r2Key = `comprobantes/${pagoData.matricula_id}/${pagoData.fecha_pago}_${pagoData.referencia_bancaria}.webp`;

  // 6. Upload a R2
  try {
    await bucket.put(r2Key, binary, {
      httpMetadata: { contentType: "image/webp" },
      customMetadata: {
        pago_id: pagoId,
        matricula_id: pagoData.matricula_id,
        mes: pagoData.mes_correspondiente,
        referencia: pagoData.referencia_bancaria,
        uploaded_by: userId
      }
    });
  } catch (err) {
    throw rfc7807("Internal Server Error", 500, "Error al subir comprobante a R2: " + (err instanceof Error ? err.message : String(err)));
  }

  // 7. INSERT en D1
  try {
    await db.prepare(`
      INSERT INTO pagos (
        id, matricula_id, mes_correspondiente,
        monto_dolares, monto_bolivares, tasa_cambio,
        referencia_bancaria, banco_origen, banco_destino,
        fecha_pago, status_conciliacion, r2_file_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, datetime('now'))
    `).bind(
      pagoId, pagoData.matricula_id, pagoData.mes_correspondiente,
      pagoData.monto_dolares, pagoData.monto_bolivares, pagoData.tasa_cambio,
      pagoData.referencia_bancaria, pagoData.banco_origen, pagoData.banco_destino,
      pagoData.fecha_pago, r2Key
    ).run();

    return c.json({
      pago: {
        id: pagoId,
        matricula_id: pagoData.matricula_id,
        estudiante: `${matricula.apellidos}, ${matricula.nombres}`,
        mes_correspondiente: pagoData.mes_correspondiente,
        monto_dolares: pagoData.monto_dolares,
        monto_bolivares: pagoData.monto_bolivares,
        tasa_cambio: pagoData.tasa_cambio,
        referencia_bancaria: pagoData.referencia_bancaria,
        banco_origen: pagoData.banco_origen,
        banco_destino: pagoData.banco_destino,
        fecha_pago: pagoData.fecha_pago,
        status_conciliacion: "PENDIENTE",
        r2_comprobante: r2Key ? `/api/pagos/${pagoId}/comprobante` : null,
        created_at: new Date().toISOString()
      }
    }, 201);

  } catch (err) {
    if (err instanceof HTTPException) throw err;

    if (r2Key && bucket) {
      try { await bucket.delete(r2Key); } catch (_) {}
    }

    throw rfc7807("Internal Server Error", 500, "Error al registrar el pago: " + (err instanceof Error ? err.message : String(err)));
  }
});

// ============================================================================
// RUTA: POST /api/pagos/conciliar - Conciliación Atómica (Aprobación/Rechazo)
// ============================================================================
pagosRouter.post("/conciliar", authMiddleware(), requireRoles(["ADMINISTRADOR"]), async (c) => {
  const body = await c.req.json().catch(() => ({}));

  const validation = conciliarPagoSchema.safeParse(body);
  if (!validation.success) {
    const errors = validation.error.issues.map(i => i.message).join(", ");
    throw rfc7807("Bad Request", 400, "Error de validación: " + errors);
  }

  const { pago_id, accion, comentario_auditoria, thumbnail_auditoria_b64 } = validation.data;
  const db = c.env.DB;
  const bucket = c.env.BUCKET_COMPROBANTES;
  const jwtPayload = c.get("jwtPayload");
  const auditorId = jwtPayload.sub;

  if (!db) {
    throw rfc7807("Internal Server Error", 500, "La base de datos D1 no está disponible.");
  }

  // 1. Obtener pago actual
  const pago = await db.prepare(`
    SELECT p.id, p.matricula_id, p.mes_correspondiente, p.status_conciliacion,
           p.r2_file_key, p.referencia_bancaria, p.monto_dolares, p.monto_bolivares,
           m.status_pago as matricula_status_pago
    FROM pagos p
    JOIN matriculas m ON p.matricula_id = m.id
    WHERE p.id = ? LIMIT 1
  `).bind(pago_id).first<{
    id: string;
    matricula_id: string;
    mes_correspondiente: string;
    status_conciliacion: string;
    r2_file_key: string | null;
    referencia_bancaria: string;
    monto_dolares: number;
    monto_bolivares: number;
    matricula_status_pago: string;
  }>();

  if (!pago) {
    throw rfc7807("Not Found", 404, "Pago no encontrado.");
  }

  // 2. Solo se puede conciliar pagos PENDIENTES
  if (pago.status_conciliacion !== "PENDIENTE") {
    throw rfc7807("Conflict", 409, `El pago ya fue conciliado con estado: ${pago.status_conciliacion}. No se puede modificar.`);
  }

  // Mapear acción del cliente (APROBAR/RECHAZAR) a estado BD (APROBADO/RECHAZADO)
  const statusNuevo = accion === "APROBAR" ? "APROBADO" : "RECHAZADO";

  // 3. Lógica R2 invertida:
  // APROBAR -> Borrar R2 + guardar thumbnail (auditoría)
  // RECHAZAR -> Preservar R2 para re-evaluación
  let r2Purged = false;
  let thumbnailValue: string | null = null;

  if (accion === "APROBAR") {
    // APROBAR: borrar archivo original de R2 y guardar thumbnail extremo (≤15KB)
    if (pago.r2_file_key && bucket) {
      try {
        await bucket.delete(pago.r2_file_key);
        r2Purged = true;
      } catch (r2Err) {
        console.error("Error al purgar comprobante de R2:", r2Err);
      }
    }
    // Guardar thumbnail comprimido (enviado por cliente, max 15KB)
    thumbnailValue = thumbnail_auditoria_b64 || null;
  } else {
    // RECHAZAR: NO borrar R2 (preservar para re-evaluación), thumbnail = null
    thumbnailValue = null;
  }

  // 4.// 4. TRANSACCIÓN ATÓMICA: Actualizar pago + actualizar matrícula
  try {
    const newMatriculaStatus = statusNuevo === "APROBADO" ? "SOLVENTE" : pago.matricula_status_pago;

    const statements: D1PreparedStatement[] = [
      db.prepare(`
        UPDATE pagos SET
          status_conciliacion = ?,
          comentario_auditoria = ?,
          thumbnail_auditoria = ?,
          r2_file_key = CASE WHEN ? = 'APROBAR' THEN NULL ELSE r2_file_key END
        WHERE id = ?
      `).bind(statusNuevo, comentario_auditoria || null, thumbnailValue, accion, pago_id)
    ];

    if (statusNuevo === "APROBADO") {
      statements.push(
        db.prepare(`
          UPDATE matriculas SET status_pago = 'SOLVENTE'
          WHERE id = ? AND status_pago != 'EXENTO'
        `).bind(pago.matricula_id)
      );
    }

    await db.batch(statements);

    return c.json({
      conciliacion: {
        pago_id: pago.id,
        status_anterior: pago.status_conciliacion,
        status_nuevo: statusNuevo,
        matricula_id: pago.matricula_id,
        matricula_status_nuevo: newMatriculaStatus,
        comprobante_purgado: r2Purged,
        auditor: auditorId,
        comentario: comentario_auditoria || null,
        procesado_en: new Date().toISOString()
      }
    });

  } catch (err) {
    if (err instanceof HTTPException) throw err;

    throw rfc7807("Internal Server Error", 500, "Error en conciliación atómica: " + (err instanceof Error ? err.message : String(err)));
  }
});

// ============================================================================
// RUTA: GET /api/pagos - Listar Pagos (con filtros)
// ============================================================================
pagosRouter.get("/", authMiddleware(), async (c) => {
  const db = c.env.DB;
  const jwtPayload = c.get("jwtPayload");
  const { matricula_id, status, mes, fecha_desde, fecha_hasta } = c.req.query();

  if (!db) {
    throw rfc7807("Internal Server Error", 500, "La base de datos D1 no está disponible.");
  }

  let query = `
    SELECT
      p.id, p.matricula_id, p.mes_correspondiente,
      p.monto_dolares, p.monto_bolivares, p.tasa_cambio,
      p.referencia_bancaria, p.banco_origen, p.banco_destino,
      p.fecha_pago, p.status_conciliacion, p.comentario_auditoria,
      p.thumbnail_auditoria, p.r2_file_key, p.created_at,
      e.nombres as estudiante_nombres, e.apellidos as estudiante_apellidos,
      e.cedula_escolar,
      m.status_pago as matricula_status_pago
    FROM pagos p
    JOIN matriculas m ON p.matricula_id = m.id
    JOIN estudiantes e ON m.estudiante_id = e.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (jwtPayload.rol === "REPRESENTANTE") {
    query += ` AND e.representante_id = ?`;
    params.push(jwtPayload.sub);
  }

  if (matricula_id) { query += " AND p.matricula_id = ?"; params.push(matricula_id); }
  if (status) { query += " AND p.status_conciliacion = ?"; params.push(status); }
  if (mes) { query += " AND p.mes_correspondiente = ?"; params.push(mes); }
  if (fecha_desde) { query += " AND p.fecha_pago >= ?"; params.push(fecha_desde); }
  if (fecha_hasta) { query += " AND p.fecha_pago <= ?"; params.push(fecha_hasta); }

  query += " ORDER BY p.created_at DESC LIMIT 100";

  try {
    const resultado = await db.prepare(query).bind(...params).all();

    return c.json({
      pagos: resultado.results.map((r: any) => ({
        id: r.id,
        matricula_id: r.matricula_id,
        estudiante: `${r.estudiante_apellidos}, ${r.estudiante_nombres}`,
        cedula_escolar: r.cedula_escolar,
        mes_correspondiente: r.mes_correspondiente,
        monto_dolares: r.monto_dolares,
        monto_bolivares: r.monto_bolivares,
        tasa_cambio: r.tasa_cambio,
        referencia_bancaria: r.referencia_bancaria,
        banco_origen: r.banco_origen,
        banco_destino: r.banco_destino,
        fecha_pago: r.fecha_pago,
        status_conciliacion: r.status_conciliacion,
        matricula_status_pago: r.matricula_status_pago,
        comprobante_url: r.r2_file_key ? `/api/pagos/${r.id}/comprobante` : null,
        comentario_auditoria: r.comentario_auditoria,
        auditor: r.thumbnail_auditoria,
        created_at: r.created_at
      }))
    });
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    throw rfc7807("Internal Server Error", 500, "Error al listar pagos: " + (err instanceof Error ? err.message : String(err)));
  }
});

// ============================================================================
// RUTA: GET /api/pagos/:id - Detalle de Pago
// ============================================================================
pagosRouter.get("/:id", authMiddleware(), async (c) => {
  const pagoId = c.req.param("id");
  const db = c.env.DB;
  const jwtPayload = c.get("jwtPayload");

  if (!db) {
    throw rfc7807("Internal Server Error", 500, "La base de datos D1 no está disponible.");
  }

  if (!z.string().uuid().safeParse(pagoId).success) {
    throw rfc7807("Bad Request", 400, "ID de pago inválido.");
  }

  const pago = await db.prepare(`
    SELECT
      p.*,
      e.nombres as estudiante_nombres, e.apellidos as estudiante_apellidos,
      e.cedula_escolar, e.representante_id,
      m.status_pago as matricula_status_pago, m.seccion_id,
      s.nivel, s.seccion as seccion_letra
    FROM pagos p
    JOIN matriculas m ON p.matricula_id = m.id
    JOIN estudiantes e ON m.estudiante_id = e.id
    LEFT JOIN secciones s ON m.seccion_id = s.id
    WHERE p.id = ? LIMIT 1
  `).bind(pagoId).first<any>();

  if (!pago) {
    throw rfc7807("Not Found", 404, "Pago no encontrado.");
  }

  if (jwtPayload.rol === "REPRESENTANTE" && pago.representante_id !== jwtPayload.sub) {
    throw rfc7807("Forbidden", 403, "No tienes permisos para ver este pago.");
  }

  return c.json({
    pago: {
      id: pago.id,
      matricula_id: pago.matricula_id,
      estudiante: {
        nombres: pago.estudiante_nombres,
        apellidos: pago.estudiante_apellidos,
        cedula_escolar: pago.cedula_escolar
      },
      seccion: pago.nivel ? `${pago.nivel}-${pago.seccion_letra}` : null,
      mes_correspondiente: pago.mes_correspondiente,
      monto_dolares: pago.monto_dolares,
      monto_bolivares: pago.monto_bolivares,
      tasa_cambio: pago.tasa_cambio,
      referencia_bancaria: pago.referencia_bancaria,
      banco_origen: pago.banco_origen,
      banco_destino: pago.banco_destino,
      fecha_pago: pago.fecha_pago,
      status_conciliacion: pago.status_conciliacion,
      matricula_status_pago: pago.matricula_status_pago,
      comprobante_url: pago.r2_file_key ? `/api/pagos/${pagoId}/comprobante` : null,
      comentario_auditoria: pago.comentario_auditoria,
      auditor: pago.thumbnail_auditoria,
      created_at: pago.created_at
    }
  });
});

// ============================================================================
// RUTA: GET /api/pagos/:id/comprobante - Descargar comprobante de R2
// ============================================================================
pagosRouter.get("/:id/comprobante", authMiddleware(), async (c) => {
  const pagoId = c.req.param("id");
  const db = c.env.DB;
  const bucket = c.env.BUCKET_COMPROBANTES;
  const jwtPayload = c.get("jwtPayload");

  if (!db || !bucket) {
    throw rfc7807("Internal Server Error", 500, "Servicio de almacenamiento no disponible.");
  }

  const pago = await db.prepare(`
    SELECT p.id, p.r2_file_key, e.representante_id
    FROM pagos p
    JOIN matriculas m ON p.matricula_id = m.id
    JOIN estudiantes e ON m.estudiante_id = e.id
    WHERE p.id = ? LIMIT 1
  `).bind(pagoId).first<{ id: string; r2_file_key: string | null; representante_id: string }>();

  if (!pago) {
    throw rfc7807("Not Found", 404, "Pago no encontrado.");
  }

  if (!pago.r2_file_key) {
    throw rfc7807("Not Found", 404, "Este pago no tiene comprobante adjunto.");
  }

  if (jwtPayload.rol === "REPRESENTANTE" && pago.representante_id !== jwtPayload.sub) {
    throw rfc7807("Forbidden", 403, "No tienes permisos para ver este comprobante.");
  }

  const r2Object = await bucket.get(pago.r2_file_key);
  if (!r2Object) {
    throw rfc7807("Not Found", 404, "Comprobante no encontrado en almacenamiento R2.");
  }

  const headers = new Headers();
  r2Object.writeHttpMetadata(headers);
  headers.set("etag", r2Object.httpEtag);
  headers.set("Content-Disposition", `inline; filename="comprobante-${pagoId}"`);

  return new Response(r2Object.body, { headers });
});

// ============================================================================
// RUTA: GET /api/pagos/resumen/representante - Resumen de Pagos del Representante
// ============================================================================
pagosRouter.get("/resumen/representante", authMiddleware(), requireRoles(["ADMINISTRADOR", "REPRESENTANTE"]), async (c) => {
  const db = c.env.DB;
  const jwtPayload = c.get("jwtPayload");

  if (!db) {
    throw rfc7807("Internal Server Error", 500, "La base de datos D1 no está disponible.");
  }

  const representanteId = jwtPayload.rol === "REPRESENTANTE"
    ? jwtPayload.sub
    : c.req.query("representante_id") || jwtPayload.sub;

  try {
    const resultado = await db.prepare(`
      SELECT
        e.id as estudiante_id, e.nombres, e.apellidos, e.cedula_escolar,
        m.id as matricula_id, m.status_pago,
        COUNT(p.id) as total_pagos,
        SUM(CASE WHEN p.status_conciliacion = 'PENDIENTE' THEN 1 ELSE 0 END) as pendientes,
        SUM(CASE WHEN p.status_conciliacion = 'APROBADO' THEN 1 ELSE 0 END) as aprobados,
        SUM(CASE WHEN p.status_conciliacion = 'RECHAZADO' THEN 1 ELSE 0 END) as rechazados,
        COALESCE(SUM(CASE WHEN p.status_conciliacion = 'APROBADO' THEN p.monto_dolares ELSE 0 END), 0) as total_usd_aprobados
      FROM estudiantes e
      JOIN matriculas m ON e.id = m.estudiante_id
      LEFT JOIN pagos p ON m.id = p.matricula_id
      WHERE e.representante_id = ?
      GROUP BY e.id, m.id
      ORDER BY e.apellidos, e.nombres
    `).bind(representanteId).all();

    return c.json({
      representante_id: representanteId,
      estudiantes: resultado.results.map((r: any) => ({
        estudiante_id: r.estudiante_id,
        nombres: r.nombres,
        apellidos: r.apellidos,
        cedula_escolar: r.cedula_escolar,
        matricula_id: r.matricula_id,
        status_pago: r.status_pago,
        resumen_pagos: {
          total: r.total_pagos,
          pendientes: r.pendientes,
          aprobados: r.aprobados,
          rechazados: r.rechazados,
          total_usd_aprobados: r.total_usd_aprobados
        }
      }))
    });
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    throw rfc7807("Internal Server Error", 500, "Error al generar resumen: " + (err instanceof Error ? err.message : String(err)));
  }
});

export { pagosRouter };
