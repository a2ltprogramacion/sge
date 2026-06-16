// JWT utilities using jose library

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  // In production, this comes from env.JWT_SECRET
  'dev-secret-change-in-production-min-64-chars-hex-dev-secret-change-in-production'
);
const JWT_ISSUER = 'sge-api';
const JWT_AUDIENCE = 'sge-frontend';
const JWT_EXPIRY = '8h';

export interface SGEJWTPayload extends JWTPayload {
  sub: string;
  email: string;
  rol: 'ADMINISTRADOR' | 'DOCENTE' | 'REPRESENTANTE';
  nombres: string;
  apellidos: string;
}

export async function signJWT(payload: Omit<SGEJWTPayload, keyof JWTPayload>): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET);
}

export async function verifyJWT(token: string): Promise<SGEJWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return payload as SGEJWTPayload;
  } catch {
    return null;
  }
}