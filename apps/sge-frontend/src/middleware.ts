import { defineMiddleware } from "astro:middleware";

/**
 * Decodifica el payload del JWT sin validar la firma (solo lectura de claims).
 * En producción se debería validar la firma contra JWT_SECRET si es crítico.
 */
function decodeJWT(token: string): { sub: string; email: string; rol: string; nombres: string; apellidos: string; exp: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payloadBase64 = parts[1];
    // Agregar padding si es necesario para base64url
    const padded = payloadBase64 + "=".repeat((4 - (payloadBase64.length % 4)) % 4);
    const payloadJson = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadJson);

    // Verificar campos requeridos
    if (!payload.sub || !payload.rol || !payload.exp) return null;

    return {
      sub: payload.sub,
      email: payload.email,
      rol: payload.rol,
      nombres: payload.nombres,
      apellidos: payload.apellidos,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

// Mapeo estricto de accesos por directorio según roles de la BD (ADMINISTRADOR, DOCENTE, REPRESENTANTE)
const ROUTE_GUARDS = [
  { prefix: "/admin", allowed: ["ADMINISTRADOR"] },
  { prefix: "/docente", allowed: ["DOCENTE", "ADMINISTRADOR"] },
  { prefix: "/representante", allowed: ["REPRESENTANTE", "ADMINISTRADOR"] },
];

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // 1. Omitir verificación para rutas públicas
  const publicPaths = [
    "/",
    "/login",
    "/logout",
    "/manifest.json",
    "/sw.js",
    "/favicon.svg",
    "/apple-touch-icon.png",
    "/favicon.ico",
  ];

  // Rutas estáticas (assets, imágenes, fuentes)
  if (pathname.startsWith("/assets/") ||
      pathname.startsWith("/_astro/") ||
      pathname.startsWith("/fonts/") ||
      pathname.startsWith("/icons/") ||
      pathname.endsWith(".css") ||
      pathname.endsWith(".js") ||
      pathname.endsWith(".png") ||
      pathname.endsWith(".svg") ||
      pathname.endsWith(".ico") ||
      pathname.endsWith(".woff") ||
      pathname.endsWith(".woff2")) {
    return next();
  }

  // Rutas públicas específicas
  if (pathname === "/" || pathname === "/login" || pathname === "/logout" ||
      pathname === "/manifest.json" || pathname === "/sw.js" ||
      pathname === "/favicon.svg" || pathname === "/apple-touch-icon.png" ||
      pathname === "/favicon.ico") {
    return next();
  }

  // Rutas estáticas (assets, imágenes, fuentes)
  if (pathname.startsWith("/assets/") ||
      pathname.startsWith("/_astro/") ||
      pathname.startsWith("/fonts/") ||
      pathname.startsWith("/icons/") ||
      pathname.endsWith(".css") ||
      pathname.endsWith(".js") ||
      pathname.endsWith(".png") ||
      pathname.endsWith(".svg") ||
      pathname.endsWith(".ico") ||
      pathname.endsWith(".woff") ||
      pathname.endsWith(".woff2")) {
    return next();
  }

  // 2. Extraer el token de las cookies
  const token = context.cookies.get("sge_token")?.value;

  if (!token) {
    return context.redirect("/login?error=session_expired");
  }

  try {
    // 3. Decodificar el JWT (lectura de claims, sin validar firma en middleware)
    const payload = decodeJWT(token);

    if (!payload) {
      context.cookies.delete("sge_token", { path: "/" });
      return context.redirect("/login?error=invalid_token");
    }

    // Validar expiración (exp está en segundos Unix)
    if (payload.exp < Date.now() / 1000) {
      context.cookies.delete("sge_token", { path: "/" });
      return context.redirect("/login?error=session_expired");
    }

    // 4. Evaluar Guardias de Ruta (RBAC)
    const guard = ROUTE_GUARDS.find(g => pathname.startsWith(g.prefix));
    if (guard) {
      if (!guard.allowed.includes(payload.rol)) {
        return context.redirect("/login?error=unauthorized");
      }
    }

    // Compartir el perfil del usuario autenticado con las vistas de Astro
    context.locals.user = {
      id: payload.sub,
      email: payload.email,
      rol: payload.rol,
      nombres: payload.nombres,
      apellidos: payload.apellidos,
    };

  } catch (err) {
    console.error("[Middleware] Error processing auth:", err);
    context.cookies.delete("sge_token", { path: "/" });
    return context.redirect("/login?error=invalid_token");
  }

  return next();
});