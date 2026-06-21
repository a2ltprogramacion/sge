import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { verifyPassword } from "../utils/crypto";
import { generateToken } from "../utils/jwt";
import type { UserRole } from "../middleware/rbac";

const authRouter = new Hono<{ Bindings: { DB: D1Database; JWT_SECRET: string } }>();

// Esquema Zod para validar el payload de inicio de sesión
const loginSchema = z.object({
  email: z.string().email({ message: "Formato de correo inválido" }),
  password: z.string().min(8, { message: "La contraseña debe tener mínimo 8 caracteres" })
});

/**
 * POST /api/auth/login
 * Procesa las credenciales de los usuarios y retorna el token JWT firmado en caso de éxito.
 */
authRouter.post("/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  
  // 1. Validar el formato del payload
  const validation = loginSchema.safeParse(body);
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

  const { email, password } = validation.data;
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

  // 2. Buscar usuario activo en base de datos D1
  const query = "SELECT id, email, password_hash, rol, nombres, apellidos, activo FROM usuarios WHERE email = ? LIMIT 1;";
  const user = await db.prepare(query).bind(email).first<{
    id: string;
    email: string;
    password_hash: string;
    rol: string;
    nombres: string;
    apellidos: string;
    activo: number;
  }>();

  // 3. Validar existencia del usuario y estado activo
  if (!user || user.activo !== 1) {
    throw new HTTPException(401, {
      res: new Response(
        JSON.stringify({
          title: "Unauthorized",
          status: 401,
          detail: "Credenciales de acceso inválidas o usuario inactivo."
        }),
        { status: 401, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  // 4. Verificar contraseña con Web Crypto PBKDF2
  const isPasswordValid = await verifyPassword(password, user.id, user.password_hash);
  if (!isPasswordValid) {
    throw new HTTPException(401, {
      res: new Response(
        JSON.stringify({
          title: "Unauthorized",
          status: 401,
          detail: "Credenciales de acceso inválidas."
        }),
        { status: 401, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  // 5. Generar token de sesión JWT
  const jwtSecret = c.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new HTTPException(500, {
      res: new Response(
        JSON.stringify({
          title: "Internal Server Error",
          status: 500,
          detail: "Falta configuración de firma de tokens."
        }),
        { status: 500, headers: { "Content-Type": "application/problem+json" } }
      )
    });
  }

  const token = await generateToken({
    sub: user.id,
    email: user.email,
    rol: user.rol as UserRole,
    nombres: user.nombres,
    apellidos: user.apellidos
  }, jwtSecret);

  // 6. Retornar payload exitoso
  return c.json({
    token: token,
    rol: user.rol,
    nombres: user.nombres,
    apellidos: user.apellidos
  });
});

export { authRouter };