/**
 * Cliente API unificado con inyección automática de JWT.
 * Compatible con Astro SSR (window check) y llamadas cliente.
 */
const API_URL = import.meta.env.PUBLIC_API_URL || "http://127.0.0.1:8787";

/**
 * Obtiene el token JWT del localStorage (solo en cliente).
 */
function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("sge_token");
}

/**
 * Cliente API unificado con inyección automática de JWT.
 * Maneja errores RFC 7807 del backend.
 */
export async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();

  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorDetail = "Ha ocurrido un error en la solicitud.";
    try {
      const errorJson = await response.json();
      errorDetail = errorJson.detail || errorJson.message || errorJson.title || "Error en la solicitud";
    } catch {
      errorDetail = response.statusText || "Error en la solicitud";
    }
    throw new Error(errorDetail);
  }

  return response.json() as Promise<T>;
}

/**
 * Helper para peticiones GET.
 */
export async function apiGet<T>(endpoint: string): Promise<T> {
  return apiFetch<T>(endpoint, { method: "GET" });
}

/**
 * Helper para peticiones POST.
 */
export async function apiPost<T>(endpoint: string, body: unknown): Promise<T> {
  return apiFetch<T>(endpoint, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Helper para peticiones PUT.
 */
export async function apiPut<T>(endpoint: string, body: unknown): Promise<T> {
  return apiFetch<T>(endpoint, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/**
 * Helper para peticiones DELETE.
 */
export async function apiDelete<T>(endpoint: string): Promise<T> {
  return apiFetch<T>(endpoint, { method: "DELETE" });
}

/**
 * Tipos de respuesta de autenticación.
 */
export interface LoginResponse {
  token: string;
  rol: "ADMINISTRADOR" | "DOCENTE" | "REPRESENTANTE";
  nombres: string;
  apellidos: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

/**
 * Función de login que gestiona token, cookie y redirección.
 */
export async function login(credentials: LoginCredentials): Promise<LoginResponse> {
  const response = await apiPost<LoginResponse>("/api/auth/login", credentials);
  
  // Guardar token en localStorage
  localStorage.setItem("sge_token", response.token);
  
  // Escribir cookie para SSR (Astro middleware la leerá)
  // Cookie con 8 horas de expiración, Secure, SameSite=Strict
  document.cookie = `sge_token=${response.token}; path=/; max-age=28800; SameSite=Strict; Secure`;
  
  return response;
}

/**
 * Cierra sesión: limpia localStorage y cookie.
 */
export function logout(): void {
  localStorage.removeItem("sge_token");
  document.cookie = "sge_token=; path=/; max-age=0; SameSite=Strict; Secure";
}

/**
 * Obtiene el token actual (útil para verificación).
 */
export function getCurrentToken(): string | null {
  return getToken();
}

/**
 * Verifica si hay una sesión activa (token presente y no expirado).
 */
export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token) return false;
  
  try {
    const payloadBase64 = token.split(".")[1];
    const payload = JSON.parse(atob(payloadBase64));
    // Verificar expiración (exp está en segundos Unix)
    return payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

/**
 * Obtiene el rol del usuario actual decodificando el JWT (sin validar firma).
 */
export function getUserRole(): "ADMINISTRADOR" | "DOCENTE" | "REPRESENTANTE" | null {
  const token = getToken();
  if (!token) return null;
  
  try {
    const payloadBase64 = token.split(".")[1];
    const payload = JSON.parse(atob(payloadBase64));
    return payload.rol as "ADMINISTRADOR" | "DOCENTE" | "REPRESENTANTE" || null;
  } catch {
    return null;
  }
}

/**
 * Obtiene el ID del usuario actual (sub claim).
 */
export function getUserId(): string | null {
  const token = getToken();
  if (!token) return null;
  
  try {
    const payloadBase64 = token.split(".")[1];
    const payload = JSON.parse(atob(payloadBase64));
    return payload.sub || null;
  } catch {
    return null;
  }
}