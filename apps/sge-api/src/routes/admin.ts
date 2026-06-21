import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";

const adminRouter = new Hono<{
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

const crearUsuarioSchema = z.object({
  nombres: z.string().min(2),
  apellidos: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  rol: z.enum(["ADMINISTRADOR", "DOCENTE", "REPRESENTANTE"]),
  cedula_escolar: z.string().optional(),
  telefono: z.string().optional(),
});

// GET /api/admin/usuarios - Listar usuarios
adminRouter.get("/usuarios", authMiddleware(), requireRoles(["ADMINISTRADOR"]), async (c) => {
  try {
    const db = c.env.DB;
    if (!db) throw rfc7807("Internal Server Error", 500, "Base de datos no disponible.");

    const { results } = await db.prepare(
      `SELECT u.id, u.email, u.rol, u.activo, u.created_at,
              u.nombres, u.apellidos,
              e.cedula_escolar
       FROM usuarios u
       LEFT JOIN estudiantes e ON u.id = e.id
       ORDER BY u.created_at DESC`
    ).all();

    return c.json({ usuarios: results || [] });
  } catch (err: any) {
    console.error("Error en GET /usuarios:", err);
    throw rfc7807("Internal Server Error", 500, "Error al cargar usuarios: " + (err.message || err));
  }
});

// PATCH /api/admin/usuarios/:id/toggle-activo - Suspender/activar usuario
adminRouter.patch("/usuarios/:id/toggle-activo", authMiddleware(), requireRoles(["ADMINISTRADOR"]), async (c) => {
  const db = c.env.DB;
  const userId = c.req.param("id");
  if (!db) throw rfc7807("Internal Server Error", 500, "Base de datos no disponible.");

  const usuario = await db.prepare("SELECT id, activo FROM usuarios WHERE id = ? LIMIT 1").bind(userId).first<any>();
  if (!usuario) throw rfc7807("Not Found", 404, "Usuario no encontrado.");

  const nuevoEstado = usuario.activo ? 0 : 1;
  await db.prepare("UPDATE usuarios SET activo = ? WHERE id = ?").bind(nuevoEstado, userId).run();

  return c.json({ success: true, activo: !!nuevoEstado });
});

// POST /api/admin/usuarios/crear - Crear usuario
adminRouter.post("/usuarios/crear", authMiddleware(), requireRoles(["ADMINISTRADOR"]), async (c) => {
  const db = c.env.DB;
  if (!db) throw rfc7807("Internal Server Error", 500, "Base de datos no disponible.");

  const body = await c.req.json().catch(() => ({}));
  const parsed = crearUsuarioSchema.safeParse(body);
  if (!parsed.success) {
    throw rfc7807("Bad Request", 400, parsed.error.issues.map(i => i.message).join(", "));
  }

  const { nombres, apellidos, email, password, rol, cedula_escolar, telefono } = parsed.data;

  const existente = await db.prepare("SELECT id FROM usuarios WHERE email = ? LIMIT 1").bind(email).first();
  if (existente) throw rfc7807("Conflict", 409, "Ya existe un usuario con ese email.");

  const { hashPassword } = await import("../utils/crypto");
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password, id);

  await db.prepare(
    `INSERT INTO usuarios (id, email, password_hash, rol, nombres, apellidos, activo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))`
  ).bind(id, email, passwordHash, rol, nombres, apellidos).run();

  if (rol === "DOCENTE") {
    await db.prepare("INSERT INTO docentes (id, telefono) VALUES (?, ?)").bind(id, telefono || null).run();
  } else if (rol === "REPRESENTANTE") {
    await db.prepare("INSERT INTO representantes (id, telefono) VALUES (?, ?)").bind(id, telefono || null).run();
  } else if (rol === "ESTUDIANTE") {
    await db.prepare(
      "INSERT INTO estudiantes (id, cedula_escolar, nombres, apellidos) VALUES (?, ?, ?, ?)"
    ).bind(id, cedula_escolar || null, nombres, apellidos).run();
  }

  return c.json({ success: true, usuario: { id, email, rol, nombres, apellidos } }, 201);
});

// GET /api/admin/configuracion - Obtener configuracion del plantel
adminRouter.get("/configuracion", authMiddleware(), requireRoles(["ADMINISTRADOR"]), async (c) => {
  try {
    const db = c.env.DB;
    if (!db) throw rfc7807("Internal Server Error", 500, "Base de datos no disponible.");

    const config = await db.prepare(
      `SELECT nombre as nombre_plantel, sistema_evaluacion_por_defecto, telefono as telefono_contacto, direccion
       FROM institucion_config LIMIT 1`
    ).bind().first<any>();

    return c.json(config || {});
  } catch (err: any) {
    console.error("Error en GET /configuracion:", err);
    throw rfc7807("Internal Server Error", 500, "Error al cargar configuracion: " + (err.message || err));
  }
});

// PATCH /api/admin/configuracion - Actualizar configuracion
adminRouter.patch("/configuracion", authMiddleware(), requireRoles(["ADMINISTRADOR"]), async (c) => {
  const db = c.env.DB;
  if (!db) throw rfc7807("Internal Server Error", 500, "Base de datos no disponible.");

  const body = await c.req.json().catch(() => ({}));
  const campos: string[] = [];
  const valores: any[] = [];

  const colMap: Record<string, string> = { nombre_plantel: "nombre", telefono_contacto: "telefono" };
  for (const key of ["nombre_plantel", "sistema_evaluacion_por_defecto", "telefono_contacto", "direccion"]) {
    const col = colMap[key] || key;
    if (body[key] !== undefined) {
      campos.push(`${col} = ?`);
      valores.push(body[key]);
    }
  }

  if (campos.length === 0) {
    throw rfc7807("Bad Request", 400, "No hay campos para actualizar.");
  }

  await db.prepare(
    `UPDATE institucion_config SET ${campos.join(", ")} WHERE rowid IN (SELECT rowid FROM institucion_config LIMIT 1)`
  ).bind(...valores).run();

  return c.json({ success: true, message: "Configuracion actualizada." });
});

// GET /api/admin/periodos - Listar periodos academicos
adminRouter.get("/periodos", authMiddleware(), requireRoles(["ADMINISTRADOR"]), async (c) => {
  try {
    const db = c.env.DB;
    if (!db) throw rfc7807("Internal Server Error", 500, "Base de datos no disponible.");

    const { results } = await db.prepare(
      "SELECT id, nombre, activo, created_at as fecha_inicio, created_at as fecha_fin FROM periodos_academicos ORDER BY created_at DESC"
    ).all();

    return c.json({ periodos: results || [] });
  } catch (err: any) {
    console.error("Error en GET /periodos:", err);
    throw rfc7807("Internal Server Error", 500, "Error al cargar periodos: " + (err.message || err));
  }
});

// GET /api/admin/sistemas-evaluacion - Listar sistemas de evaluación
adminRouter.get("/sistemas-evaluacion", authMiddleware(), requireRoles(["ADMINISTRADOR"]), async (c) => {
  try {
    const db = c.env.DB;
    if (!db) throw rfc7807("Internal Server Error", 500, "Base de datos no disponible.");

    const { results } = await db.prepare(
      "SELECT id, codigo, nombre, descripcion, tipo, configuracion, activo FROM sistemas_evaluacion ORDER BY nombre ASC"
    ).all();

    return c.json({ sistemas: results || [] });
  } catch (err: any) {
    console.error("Error en GET /sistemas-evaluacion:", err);
    throw rfc7807("Internal Server Error", 500, "Error al cargar sistemas: " + (err.message || err));
  }
});

// POST /api/admin/sistemas-evaluacion - Crear sistema personalizado
adminRouter.post("/sistemas-evaluacion", authMiddleware(), requireRoles(["ADMINISTRADOR"]), async (c) => {
  try {
    const db = c.env.DB;
    if (!db) throw rfc7807("Internal Server Error", 500, "Base de datos no disponible.");

    const body = await c.req.json().catch(() => ({}));
    if (!body.nombre || !body.tipo) {
      throw rfc7807("Bad Request", 400, "nombre y tipo son obligatorios.");
    }

    const id = crypto.randomUUID();
    const codigo = `CUSTOM_${id.substring(0, 8).toUpperCase()}`;
    await db.prepare(
      `INSERT INTO sistemas_evaluacion (id, codigo, nombre, descripcion, tipo, configuracion)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, codigo, body.nombre, body.descripcion || null, body.tipo, JSON.stringify(body.configuracion || {})).run();

    return c.json({ success: true, id, codigo }, 201);
  } catch (err: any) {
    console.error("Error en POST /sistemas-evaluacion:", err);
    throw rfc7807("Internal Server Error", 500, "Error al crear sistema: " + (err.message || err));
  }
});

// DELETE /api/admin/sistemas-evaluacion/:id - Eliminar sistema personalizado
adminRouter.delete("/sistemas-evaluacion/:id", authMiddleware(), requireRoles(["ADMINISTRADOR"]), async (c) => {
  try {
    const db = c.env.DB;
    if (!db) throw rfc7807("Internal Server Error", 500, "Base de datos no disponible.");

    const sistemaId = c.req.param("id");
    const sistema = await db.prepare("SELECT id, codigo FROM sistemas_evaluacion WHERE id = ? LIMIT 1").bind(sistemaId).first<any>();
    if (!sistema) throw rfc7807("Not Found", 404, "Sistema no encontrado.");
    if (sistema.codigo.startsWith("NUMERICO_20") || sistema.codigo.startsWith("CUALITATIVO_AE")) {
      throw rfc7807("Forbidden", 403, "No se puede eliminar un sistema por defecto.");
    }

    await db.prepare("DELETE FROM sistemas_evaluacion WHERE id = ?").bind(sistemaId).run();
    return c.json({ success: true });
  } catch (err: any) {
    if (err instanceof HTTPException) throw err;
    throw rfc7807("Internal Server Error", 500, "Error al eliminar sistema: " + (err.message || err));
  }
});

// PATCH /api/admin/sistemas-evaluacion/:id - Actualizar sistema
adminRouter.patch("/sistemas-evaluacion/:id", authMiddleware(), requireRoles(["ADMINISTRADOR"]), async (c) => {
  try {
    const db = c.env.DB;
    if (!db) throw rfc7807("Internal Server Error", 500, "Base de datos no disponible.");

    const sistemaId = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));

    const updates: string[] = [];
    const values: any[] = [];
    for (const key of ["nombre", "descripcion", "tipo", "configuracion", "activo"]) {
      if (body[key] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(typeof body[key] === "object" ? JSON.stringify(body[key]) : body[key]);
      }
    }
    if (updates.length === 0) throw rfc7807("Bad Request", 400, "No hay campos para actualizar.");

    await db.prepare(
      `UPDATE sistemas_evaluacion SET ${updates.join(", ")} WHERE id = ?`
    ).bind(...values, sistemaId).run();

    return c.json({ success: true });
  } catch (err: any) {
    if (err instanceof HTTPException) throw err;
    throw rfc7807("Internal Server Error", 500, "Error al actualizar sistema: " + (err.message || err));
  }
});

export { adminRouter };
