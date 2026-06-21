import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";

const representanteRouter = new Hono<{
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

// GET /api/representante/mis-estudiantes - Estudiantes del representante
representanteRouter.get("/mis-estudiantes", authMiddleware(), requireRoles(["REPRESENTANTE"]), async (c) => {
  const db = c.env.DB;
  const jwtPayload = c.get("jwtPayload");
  const userId = jwtPayload.sub;

  if (!db) {
    throw rfc7807("Internal Server Error", 500, "Base de datos no disponible.");
  }

  const estudiantes = await db.prepare(
    `SELECT m.id as matricula_id, e.id as estudiante_id, e.nombres, e.apellidos,
            e.cedula_escolar, s.nivel, s.seccion
     FROM estudiantes e
     JOIN matriculas m ON m.estudiante_id = e.id
     JOIN secciones s ON m.seccion_id = s.id
     WHERE e.representante_id = ?
     ORDER BY e.nombres`
  ).bind(userId).all();

  return c.json({ estudiantes: estudiantes.results || [] });
});

export { representanteRouter };
