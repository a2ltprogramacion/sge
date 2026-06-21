/**
 * Utilidades criptográficas de alto rendimiento para el Edge (Cloudflare Workers).
 * Implementa PBKDF2-SHA256 con sal única y comparación de hashes en tiempo constante.
 */

/**
 * Deriva una clave PBKDF2-SHA256 a partir de una contraseña plana y un UUID como sal.
 * @param password Contraseña plana provista por el usuario.
 * @param userId UUID v4 del usuario que actuará como sal única para evitar colisiones.
 * @returns Hash hexadecimal de 64 caracteres.
 */
export async function hashPassword(password: string, userId: string): Promise<string> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  const saltBuffer = encoder.encode(userId);

  // Importar la contraseña plana como clave cruda de derivación
  const baseKey = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  // Derivar 256 bits (32 bytes) usando PBKDF2 con 100,000 iteraciones y SHA-256
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: 100000,
      hash: "SHA-256"
    },
    baseKey,
    256
  );

  // Convertir el buffer de bytes resultante a una cadena hexadecimal estricta
  const hashArray = Array.from(new Uint8Array(derivedBits));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compara de forma segura (tiempo constante) una contraseña plana contra un hash guardado.
 * Mitiga ataques de canal lateral (Timing Attacks) que analizan tiempos de respuesta.
 * @param password Contraseña plana provista en la solicitud de login.
 * @param userId UUID del usuario, utilizado como sal.
 * @param storedHash Hash hexadecimal guardado en la base de datos.
 * @returns Promesa que resuelve a booleano indicando si la contraseña es válida.
 */
export async function verifyPassword(password: string, userId: string, storedHash: string): Promise<boolean> {
  const computedHash = await hashPassword(password, userId);
  
  if (computedHash.length !== storedHash.length) {
    return false;
  }

  // Comparación por operación binaria XOR para evitar cortocircuitos de evaluación
  let result = 0;
  for (let i = 0; i < computedHash.length; i++) {
    result |= computedHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }

  return result === 0;
}