# BACKLOG — SGE (Sistema de Gestión Escolar)

> **Proyecto:** SGE v0.1.0 | **Cliente:** U.E.N. Simón Bolívar | **Operador:** A2LT Soluciones

---

## ✅ FASE 1: Saneamiento y Estabilización

| ID | Tarea | Estado |
|---|---|---|
| BUG-01 | Eliminar `is:inline` de scripts Astro | ✅ |
| BUG-02 | Migrar Tailwind CSS v3 → v4 | ✅ |
| BUG-03 | Corregir logout `/login` → `/logout` | ✅ |
| BUG-04 | Duplicado `filename` en pdf-generator.ts | ✅ |
| BUG-05 | `onclick` global → `addEventListener` | ✅ |

## ✅ FASE 2: Flujo Completo del Representante (SGE-011)

### TICKET-011-A: Boletín con Datos Reales
| # | Tarea | Estado |
|---|---|---|
| 1 | Datos dinámicos vía `apiGet` | ✅ |
| 2 | Endpoint `GET /api/representante/mis-estudiantes` | ✅ |
| 3 | Selector de estudiantes | ✅ |
| 4 | Tabla calificaciones + resumen asistencia | ✅ |
| 5 | Generación PDF con datos reales | ✅ |

### TICKET-011-B: Pagos (`/representante/pagos`)
| # | Tarea | Estado |
|---|---|---|
| 1 | Formulario de reporte de pago | ✅ |
| 2 | Compresión Canvas → WebP ≤100 KB | ✅ |
| 3 | Consumir `POST /api/pagos/registrar` | ✅ |
| 4 | Historial de pagos realizados | ✅ |

### TICKET-011-C: Inasistencias (`/representante/asistencia`)
| # | Tarea | Estado |
|---|---|---|
| 1 | Tabla de inasistencias con filtro por estudiante | ✅ |
| 2 | Botón de justificar falta (modal + `PATCH`) | ✅ |
| 3 | Endpoint `PATCH /api/asistencia/:id/justificar` | ✅ |

## ✅ FASE 3: Portal Administrativo (SGE-012)

### TICKET-012-A: Panel Directivo (`/admin/dashboard`)
| # | Tarea | Estado |
|---|---|---|
| 1 | Cards métricas globales | ✅ |
| 2 | Alertas docentes + riesgo abandono | ✅ |
| 3 | Salud financiera por sección | ✅ |
| 4 | Consumir `GET /api/dashboard/salud` | ✅ |

### TICKET-012-B: Consola de Usuarios (`/admin/usuarios`)
| # | Tarea | Estado |
|---|---|---|
| 1 | Listado de usuarios con filtro por rol | ✅ |
| 2 | Modal creación + suspensión/activación | ✅ |
| 3 | Endpoints CRUD (`GET`, `PATCH`, `POST`) | ✅ |

### TICKET-012-C: Configuración (`/admin/configuracion`)
| # | Tarea | Estado |
|---|---|---|
| 1 | Formulario nombre, eval, contacto, dirección | ✅ |
| 2 | Endpoints `GET/PATCH /api/admin/configuracion` | ✅ |
| 3 | Endpoint `GET /api/admin/periodos` | ✅ |

---

## 📊 Leyenda
- ✅ Completada | ⬜ Pendiente | 🔄 En progreso | ❌ Bloqueada

---

## 🌐 Resumen de Páginas del Sistema (12 páginas)

| Ruta | Archivo | Estado |
|---|---|---|
| `/` | `index.astro` | ✅ |
| `/login` | `login.astro` | ✅ |
| `/logout` | `logout.astro` | ✅ |
| `/docente/dashboard` | `docente/dashboard.astro` | ✅ |
| `/docente/planes` | `docente/planes.astro` | ✅ |
| `/docente/asistencia` | `docente/asistencia.astro` | ✅ |
| `/docente/calificaciones` | `docente/calificaciones.astro` | ✅ |
| `/representante/boletin` | `representante/boletin.astro` | ✅ |
| `/representante/pagos` | `representante/pagos.astro` | ✅ |
| `/representante/asistencia` | `representante/asistencia.astro` | ✅ |
| `/admin/dashboard` | `admin/dashboard.astro` | ✅ |
| `/admin/usuarios` | `admin/usuarios.astro` | ✅ |
| `/admin/configuracion` | `admin/configuracion.astro` | ✅ |

## 🗄️ API Endpoints (16 routers)

| Router | Endpoints |
|---|---|
| `auth` | `POST /api/auth/login` |
| `planes` | CRUD planes de evaluación |
| `calificaciones` | CRUD calificaciones + historial |
| `asistencia` | CRUD asistencia + historial + justificar |
| `pagos` | Registrar, conciliar, resumen |
| `push` | Web Push subscriptions |
| `dashboard` | `GET /api/dashboard/salud` |
| `reportes` | `GET /api/reportes/boleta-data/:id` |
| `representante` | `GET /api/representante/mis-estudiantes` |
| `admin` | CRUD usuarios + config + periodos |
