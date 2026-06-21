import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { verifyToken } from "../utils/jwt";

/**
 * Middleware para autenticar peticiones mediante la cabecera Authorization Bearer.
 * Además, verifica de forma dura el estado "activo = 1" del usuario en la base de datos D1 para operaciones de escritura.
 */
export function authMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header("Authorization");
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new HTTPException(401, {
        res: new Response(
          JSON.stringify({
            title: "Unauthorized",
            status: 401,
            detail: "Falta el token de autorización o el formato es incorrecto (Debe ser Bearer <token>)."
          }),
          { status: 401, headers: { "Content-Type": "application/problem+json" } }
        )
      });
    }

    const token = authHeader.split(" ")[1];
    const jwtSecret = c.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new HTTPException(500, {
        res: new Response(
          JSON.stringify({
            title: "Internal Server Error",
            status: 500,
            detail: "La variable de entorno JWT_SECRET no está configurada."
          }),
          { status: 500, headers: { "Content-Type": "application/problem+json" } }
        )
      });
    }

    try {
      // 1. Validar firma y expiración del JWT
      const payload = await verifyToken(token, jwtSecret);
      c.set("jwtPayload", payload);

      // 2. Control de estado activo para operaciones de escritura (POST, PUT, DELETE, PATCH)
      const method = c.req.method;
      if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
        const db = c.env.DB;
        if (!db) {
          throw new Error("Base de datos D1 no disponible.");
        }

        const query = "SELECT activo FROM usuarios WHERE id = ? LIMIT 1;";
        const userStatus = await db.prepare(query).bind(payload.sub).first<{ activo: number }>();

        if (!userStatus || userStatus.activo !== 1) {
          throw new HTTPException(403, {
            res: new Response(
              JSON.stringify({
                title: "Forbidden",
                status: 403,
                detail: "La cuenta de usuario ha sido desactivada o suspendida por la administración."
              }),
              { status: 403, headers: { "Content-Type": "application/problem+json" } }
            )
          });
        }
      }

      await next();
    } catch (err) {
      if (err instanceof HTTPException) {
        throw err;
      }
      
      throw new HTTPException(401, {
        res: new Response(
          JSON.stringify({
            title: "Unauthorized",
            status: 401,
            detail: "El token provisto es inválido, ha expirado o está corrupto."
          }),
          { status: 401, headers: { "Content-Type": "application/problem+json" } }
        )
      });
    }
  };
}