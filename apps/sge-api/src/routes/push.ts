import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";

const pushRouter = new Hono<{ Bindings: { DB: D1Database; JWT_SECRET: string; VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; VAPID_SUBJECT: string } }>();

// ============================================================================
// ESQUEMAS ZOD DE VALIDACIÓN
// ============================================================================

const subscribePushSchema = z.object({
  endpoint: z.string().url({ message: "Endpoint URL inválido" }),
  keys: z.object({
    p256dh: z.string().min(10, { message: "Clave p256dh inválida" }),
    auth: z.string().min(10, { message: "Clave auth inválida" })
  })
});

// ============================================================================
// RUTA: GET /api/push/public-key - Obtener Clave Pública VAPID
// ============================================================================
pushRouter.get("/public-key", async (c) => {
  const vapidPublicKey = c.env.VAPID_PUBLIC_KEY;

  if (!vapidPublicKey) {
    throw new HTTPException(500, {
      res: new Response(
        JSON.stringify({
          title: "Internal Server Error",
          status: 500,
          detail: "Clave pública VAPID no configurada."
        }),
        { status: 500, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  return c.json({
    publicKey: vapidPublicKey
  });
});

// ============================================================================
// RUTA: POST /api/push/subscribe - Suscribir Dispositivo a Notificaciones
// ============================================================================
pushRouter.post("/subscribe", authMiddleware(), async (c) => {
  const body = await c.req.json().catch(() => ({}));

  const validation = subscribePushSchema.safeParse(body);
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

  const { endpoint, keys } = validation.data;
  const jwtPayload = c.get("jwtPayload");
  const userId = jwtPayload.sub;

  const db = c.env.DB;

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

  // Insertar o actualizar suscripción (upsert por endpoint único)
  try {
    const subscriptionId = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO suscripciones_push (id, usuario_id, endpoint, p256dh, auth, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(endpoint) DO UPDATE SET
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        usuario_id = excluded.usuario_id,
        created_at = datetime('now')
    `).bind(subscriptionId, userId, endpoint, keys.p256dh, keys.auth).run();

    return c.json({
      success: true,
      message: "Suscripción registrada correctamente.",
      subscription_id: subscriptionId
    }, 201);
  } catch (err) {
    throw new HTTPException(500, {
      res: new Response(
        JSON.stringify({
          title: "Internal Server Error",
          status: 500,
          detail: "Error al registrar suscripción: " + (err instanceof Error ? err.message : String(err))
        }),
        { status: 500, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }
});

export { pushRouter };