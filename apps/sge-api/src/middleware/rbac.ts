import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { JWTPayload } from "../utils/jwt";

export type UserRole = "ADMINISTRADOR" | "DOCENTE" | "REPRESENTANTE";

/**
 * Middleware para restringir accesos según una lista de roles permitidos.
 * Exige la previa ejecución de authMiddleware() para que 'jwtPayload' esté disponible.
 */
export function requireRoles(allowedRoles: UserRole[]): MiddlewareHandler {
  return async (c, next) => {
    const userPayload = c.get("jwtPayload") as JWTPayload | undefined;
    
    if (!userPayload || !userPayload.rol) {
      throw new HTTPException(401, {
        res: new Response(
          JSON.stringify({
            title: "Unauthorized",
            status: 401,
            detail: "La petición no contiene datos válidos de autenticación en el contexto."
          }),
          { status: 401, headers: { "Content-Type": "application/problem+json" } }
        )
      });
    }

    if (!allowedRoles.includes(userPayload.rol)) {
      throw new HTTPException(403, {
        res: new Response(
          JSON.stringify({
            title: "Forbidden",
            status: 403,
            detail: "Tu rol actual (" + userPayload.rol + ") no cuenta con permisos suficientes para este recurso."
          }),
          { status: 403, headers: { "Content-Type": "application/problem+json" } }
        )
      });
    }

    await next();
  };
}