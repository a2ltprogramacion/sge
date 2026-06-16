// TypeScript declarations for SGE Frontend
/// <reference types="astro/client" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PUBLIC_API_URL: string;
  readonly PUBLIC_VAPID_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface CloudflareEnv {
  DB: D1Database;
  BUCKET_COMPROBANTES: R2Bucket;
  ASSETS: Fetcher;
  JWT_SECRET: string;
  VAPID_SUBJECT: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  ENVIRONMENT: string;
  PUBLIC_API_URL: string;
}