# SGE - Sistema de Gestión Escolar

Sistema de gestión escolar mono-instituto construido sobre infraestructura serverless de Cloudflare (Astro SSR + D1 + R2 + Workers).

## 🏗️ Arquitectura

```
SGE/
├── apps/
│   ├── sge-frontend/     # Astro SSR (Cloudflare Pages)
│   └── sge-api/          # Hono Worker (Cloudflare Workers)
├── packages/
│   ├── tsconfig/         # Configuración TypeScript compartida
│   └── database/         # Migraciones D1 y seeds
```

## 🚀 Inicio Rápido

### Prerrequisitos
- Node.js 22 LTS
- npm 10+
- Wrangler CLI (`npm install -g wrangler`)

### Instalación

```bash
# Clonar repositorio
git clone <repo-url>
cd SGE

# Instalar dependencias
npm install

# Configurar variables de entorno (desarrollo)
cp apps/sge-api/.dev.vars.example apps/sge-api/.dev.vars
# Editar .dev.vars con valores reales

# Ejecutar migraciones D1 (local)
npm run db:migrate

# Ejecutar seeds
npm run db:seed

# Iniciar desarrollo (frontend + API concurrentemente)
npm run dev
```

### URLs de Desarrollo
- **Frontend (Astro):** http://localhost:4321
- **API (Hono Worker):** http://localhost:8787
- **Health Check:** http://localhost:8787/health

## 📦 Scripts Disponibles

```bash
# Desarrollo
npm run dev              # Inicia frontend + API concurrentemente

# Build
npm run build            # Build de producción para ambas apps

# Testing
npm run test             # Ejecuta tests (Vitest)
npm run test:watch       # Tests en modo watch

# Linting & Formatting
npm run lint             # ESLint en ambas apps
npm run format           # Prettier en todo el monorepo

# Base de Datos
npm run db:migrate       # Aplica migraciones D1 (local)
npm run db:migrate:remote # Aplica migraciones D1 (producción)
npm run db:seed          # Ejecuta seeds (local)
npm run db:seed:remote   # Ejecuta seeds (producción)
```

## 🔧 Configuración

### Variables de Entorno (`.dev.vars` en `apps/sge-api/`)

```env
JWT_SECRET=your-64-char-hex-secret
VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
VAPID_SUBJECT=mailto:admin@localhost
ENVIRONMENT=development
```

### Generar Claves VAPID
```bash
npx web-push generate-vapid-keys
```

### Generar JWT Secret
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 🗄️ Base de Datos (D1)

### Estructura (15 tablas)
1. `institucion_config` - Configuración única del instituto
2. `usuarios` - Usuarios base con roles
3. `docentes` - Extensión de usuarios docentes
4. `representantes` - Extensión de usuarios representantes
5. `estudiantes` - Estudiantes matriculados
6. `periodos_academicos` - Años/escolares
7. `secciones` - Grados y secciones por periodo
8. `matriculas` - Asociación estudiante-sección
9. `asignaturas` - Materias por nivel
10. `planes_evaluacion` - Planes de evaluación por asignatura/sección/lapso
11. `evaluaciones_items` - Ítems de evaluación con ponderaciones
12. `calificaciones` - Notas de estudiantes
13. `asistencia` - Registro granular de asistencia
14. `pagos` - Control de pagos con R2
15. `suscripciones_push` - Web Push subscriptions

### Migraciones
Las migraciones están en `packages/database/migrations/` (0001-0015).

```bash
# Crear nueva migración
npm run db:generate -- --name=nombre_migracion

# Aplicar migraciones local
npm run db:migrate

# Aplicar migraciones remoto
npm run db:migrate:remote
```

## 📁 Almacenamiento (R2)

Bucket: `sge-comprobantes-dev` (desarrollo) / `sge-comprobantes-prod` (producción)

Estructura de archivos:
```
comprobantes/
  {matricula_id}/
    {fecha_pago}_{referencia_bancaria}.webp
```

## 🔔 Web Push Notifications

Configurado con VAPID para notificaciones de:
- Ausencias de estudiantes (docente → representante)
- Alertas de pagos
- Comunicaciones administrativas

## 🧪 Testing

```bash
# Unit/Integration tests
npm run test

# E2E tests (Playwright) - configurar por separado
npx playwright test
```

## 🚀 Despliegue

### Cloudflare Pages (Frontend + Functions)
1. Conectar repositorio GitHub a Cloudflare Pages
2. Build command: `npm run build`
3. Build output directory: `apps/sge-frontend/dist`
4. Configurar variables de entorno en dashboard

### Cloudflare Workers (API)
El API se despliega automáticamente como Functions de Pages.

### Variables de Producción (Dashboard Cloudflare)
- `JWT_SECRET` (Secret)
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (Secrets)
- `VAPID_SUBJECT`
- `ENVIRONMENT=production`

## 📚 Documentación API

Ver `docs/api.md` para contratos completos de:
- `POST /api/auth/login`
- `POST /api/calificaciones/batch`
- `POST /api/asistencia/batch`
- `POST /api/pagos/registrar`
- `POST /api/pagos/conciliar`
- `GET /api/dashboard/salud`

## 🤝 Contribución

1. Fork del repositorio
2. Crear feature branch (`git checkout -b feature/nueva-funcionalidad`)
3. Commit cambios (`git commit -m 'feat: agregar nueva funcionalidad'`)
4. Push al branch (`git push origin feature/nueva-funcionalidad`)
5. Crear Pull Request

## 📄 Licencia

Proprietary - A2LT Soluciones