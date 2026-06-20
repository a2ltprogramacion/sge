import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authRouter } from "./routes/auth";
import { planesRouter } from "./routes/planes";
import { calificacionesRouter } from "./routes/calificaciones";
import { asistenciaRouter } from "./routes/asistencia";
import { pagosRouter } from "./routes/pagos";
import { pushRouter } from "./routes/push";
import { authMiddleware } from "./middleware/auth";
import { requireRoles } from "./middleware/rbac";

// Definición de tipos para las variables del entorno (Cloudflare Bindings)
export type Bindings = {
  DB: D1Database;
  BUCKET_COMPROBANTES: R2Bucket;
  JWT_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Middlewares globales de procesamiento
app.use("*", logger());
app.use("*", cors({
  origin: "*", // Cambiar por dominios específicos en producción
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  exposeHeaders: ["Content-Length"],
  maxAge: 600,
}));

// Manejo centralizado de errores del Servidor bajo estándar RFC 7807
app.onError((err, c) => {
  console.error("Internal API Error:", err);
  
  return c.json(
    {
      title: "Internal Server Error",
      status: 500,
      detail: err.message || "Ha ocurrido un error inesperado en la infraestructura."
    },
    500,
    { "Content-Type": "application/problem+json" }
  );
});

// Manejo de recursos no encontrados (404) bajo estándar RFC 7807
app.notFound((c) => {
  return c.json(
    {
      title: "Not Found",
      status: 404,
      detail: "El recurso solicitado no se encuentra en esta URL."
    },
    404,
    { "Content-Type": "application/problem+json" }
  );
});

// 1. Rutas Públicas (Autenticación)
app.route("/api/auth", authRouter);

// 2. Rutas de Planificación (Docentes + Admin)
app.route("/api/planes", planesRouter);

// 3. Rutas de Calificaciones (Docentes + Admin)
app.route("/api/calificaciones", calificacionesRouter);

// 4. Rutas de Asistencia (Docentes + Admin + Web Push)
app.route("/api/asistencia", asistenciaRouter);

// 5. Rutas de Pagos (Representantes + Admin + R2)
app.route("/api/pagos", pagosRouter);

// 6. Rutas de Web Push (Suscripciones + Clave Pública VAPID)
app.route("/api/push", pushRouter);

// 6. Dashboard Institucional (Solo Admin)
app.get("/api/dashboard/salud", authMiddleware(), requireRoles(["ADMINISTRADOR"]), (c) => {
  return c.json({
    status: "OK",
    detalle: "Dashboard institucional de salud académica operativo.",
    timestamp: new Date().toISOString()
  });
});

export default app;