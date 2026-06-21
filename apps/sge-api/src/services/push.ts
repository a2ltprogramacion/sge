/**
 * Servicio de Notificaciones Web Push para Cloudflare Workers.
 * Implementa cifrado VAPID y envío de payloads cifrados con Web Crypto API.
 */

interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: Record<string, any>;
}

interface VAPIDKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * Convierte una cadena base64url a ArrayBuffer
 */
function base64UrlToBuffer(base64url: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) {
    view[i] = raw.charCodeAt(i);
  }
  return buffer;
}

/**
 * Convierte ArrayBuffer a base64url
 */
function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Genera un par de claves ECDH para el cifrado de push
 */
async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true,
    ["deriveKey"]
  );
}

/**
 * Deriva una clave de cifrado usando ECDH
 */
async function deriveEncryptionKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  authSecret: ArrayBuffer
): Promise<CryptoKey> {
  // Derivar secreto compartido
  const sharedSecret = await crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: publicKey
    },
    privateKey,
    256
  );

  // HKDF para derivar claves de cifrado
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    "HKDF",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: authSecret,
      info: new TextEncoder().encode("Content-Encoding: aes128gcm")
    },
    hkdfKey,
    { name: "AES-GCM", length: 128 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Cifra el payload para Web Push usando AES128GCM
 */
async function encryptPayload(
  payload: string,
  subscription: PushSubscription,
  vapidKeys: VAPIDKeys
): Promise<{ body: ArrayBuffer; headers: Record<string, string> }> {
  // Convertir claves de suscripción
  const receiverPublicKey = await crypto.subtle.importKey(
    "raw",
    base64UrlToBuffer(subscription.keys.p256dh),
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );

  const authSecret = base64UrlToBuffer(subscription.keys.auth);

  // Generar par de claves efímeras
  const senderKeyPair = await generateECDHKeyPair();

  // Derivar clave de cifrado
  const encryptionKey = await deriveEncryptionKey(
    senderKeyPair.privateKey,
    receiverPublicKey,
    authSecret
  );

  // Exportar clave pública del sender
  const senderPublicKeyRaw = await crypto.subtle.exportKey("raw", senderKeyPair.publicKey);

  // Preparar datos para cifrar
  const payloadData = new TextEncoder().encode(payload);
  const recordSize = 4096;
  const paddingLength = recordSize - (payloadData.length % recordSize) - 2;
  const paddedData = new Uint8Array(payloadData.length + 2 + paddingLength);
  paddedData[0] = (payloadData.length >> 8) & 0xFF;
  paddedData[1] = payloadData.length & 0xFF;
  paddedData.set(payloadData, 2);
  // El resto queda en 0 (padding)

  // Generar IV (12 bytes para AES-GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Cifrar
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    encryptionKey,
    paddedData
  );

  // Construir body: senderPublicKey (65 bytes) + iv (12 bytes) + ciphertext
  const body = new Uint8Array(65 + 12 + encrypted.byteLength);
  body.set(new Uint8Array(senderPublicKeyRaw), 0);
  body.set(iv, 65);
  body.set(new Uint8Array(encrypted), 77);

  // Generar headers VAPID
  const vapidHeaders = await generateVAPIDHeaders(subscription.endpoint, vapidKeys);

  return {
    body: body.buffer,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "Authorization": vapidHeaders.Authorization,
      "Crypto-Key": vapidHeaders["Crypto-Key"],
      "TTL": "86400"
    }
  };
}

/**
 * Genera headers VAPID para autenticación
 */
async function generateVAPIDHeaders(
  endpoint: string,
  vapidKeys: VAPIDKeys
): Promise<Record<string, string>> {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;

  // Crear JWT VAPID
  const header = { typ: "JWT", alg: "ES256" };
  const claims = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 43200, // 12 horas
    sub: vapidKeys.subject
  };

  // Importar clave privada VAPID
  const privateKeyBuffer = base64UrlToBuffer(vapidKeys.privateKey);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"]
  );

  // Firmar JWT
  const encodedHeader = bufferToBase64Url(new TextEncoder().encode(JSON.stringify(header)).buffer);
  const encodedClaims = bufferToBase64Url(new TextEncoder().encode(JSON.stringify(claims)).buffer);
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput)
  );

  const encodedSignature = bufferToBase64Url(signature);
  const vapidToken = `${signingInput}.${encodedSignature}`;

  // Public key en formato uncompressed (04 + x + y)
  const publicKeyBuffer = base64UrlToBuffer(vapidKeys.publicKey);
  const publicKeyRaw = new Uint8Array(publicKeyBuffer);
  // Si ya tiene el prefijo 04, usarlo tal cual
  const publicKeyBase64Url = bufferToBase64Url(publicKeyRaw.buffer);

  return {
    Authorization: `vapid t=${vapidToken}, k=${publicKeyBase64Url}`,
    "Crypto-Key": `p256ecdsa=${publicKeyBase64Url}`
  };
}

/**
 * Función principal para enviar notificación Push
 */
export async function sendPushNotification(
  subscription: PushSubscription,
  payload: PushPayload,
  env: { VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; VAPID_SUBJECT: string }
): Promise<Response> {
  const vapidKeys: VAPIDKeys = {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT
  };

  const { body, headers } = await encryptPayload(
    JSON.stringify(payload),
    subscription,
    vapidKeys
  );

  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers,
    body
  });

  if (!response.ok) {
    // Manejar códigos de error específicos
    if (response.status === 410 || response.status === 404) {
      // Suscripción expirada o inválida - debería eliminarse de la BD
      throw new Error(`Push subscription expired: ${response.status}`);
    }
    throw new Error(`Push failed: ${response.status} ${response.statusText}`);
  }

  return response;
}

/**
 * Genera par de claves VAPID para configuración inicial
 * Útil para desarrollo: npm run generate-vapid
 */
export async function generateVAPIDKeys(): Promise<VAPIDKeys> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const publicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const privateKeyRaw = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

  return {
    publicKey: bufferToBase64Url(publicKeyRaw),
    privateKey: bufferToBase64Url(privateKeyRaw),
    subject: "mailto:admin@localhost"
  };
}