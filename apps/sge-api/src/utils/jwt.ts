import { sign, verify } from "hono/jwt";
import type { UserRole } from "../middleware/rbac";

export interface JWTPayload {
  sub: string;       // ID de usuario (UUID)
  email: string;     // Correo electrónico
  rol: UserRole;     // Rol asignado
  nombres: string;   // Nombres públicos
  apellidos: string; // Apellidos públicos
  exp: number;       // Timestamp de expiración (Unix)
}

/**
 * Genera un token JWT firmado con HS256.
 * @param payload Datos del usuario que se inyectarán en los claims.
 * @param secret Clave secreta de firma (procedente del entorno).
 * @returns Promesa que resuelve al token firmado.
 */
export async function generateToken(payload: Omit<JWTPayload, "exp">, secret: string): Promise<string> {
  const expirationTime = Math.floor(Date.now() / 1000) + (8 * 60 * 60); // Expiración en 8 horas exactas
  const fullPayload: JWTPayload = {
    ...payload,
    exp: expirationTime
  };
  return sign(fullPayload, secret);
}

/**
 * Verifica y decodifica un token JWT.
 * @param token Token JWT recibido en la cabecera Bearer.
 * @param secret Clave secreta de verificación.
 * @returns El payload decodificado si es válido, o lanza un error.
 */
export async function verifyToken(token: string, secret: string): Promise<JWTPayload> {
  return verify(token, secret, "HS256") as unknown as Promise<JWTPayload>;
}