-- SGE Database Schema - Consolidated View
-- This file is for reference only. Actual migrations are in migrations/ folder.

-- 1. CONFIGURACIÓN DE LA INSTITUCIÓN (Único Registro)
CREATE TABLE institucion_config (
    id TEXT PRIMARY KEY CHECK(length(id) = 36),
    nombre TEXT NOT NULL,
    rif TEXT NOT NULL UNIQUE,
    direccion TEXT NOT NULL,
    telefono TEXT NOT NULL,
    sistema_evaluacion_por_defecto TEXT CHECK(sistema_evaluacion_por_defecto IN ('NUMERICO_20', 'NUMERICO_10', 'CUALITATIVO_AE')) NOT NULL,
    porcentaje_inasistencia_reprobacion REAL NOT NULL DEFAULT 25.0,
    notificar_inasistencia_automatica INTEGER CHECK(notificar_inasistencia_automatica IN (0, 1)) NOT NULL DEFAULT 1,
    moneda_base TEXT CHECK(moneda_base IN ('USD', 'VES')) NOT NULL DEFAULT 'USD',
    vapid_public_key TEXT NOT NULL,
    vapid_private_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. USUARIOS Y ROLES (Control de Acceso)
CREATE TABLE usuarios (
    id TEXT PRIMARY KEY CHECK(length(id) = 36),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    rol TEXT CHECK(rol IN ('ADMINISTRADOR', 'DOCENTE', 'REPRESENTANTE')) NOT NULL,
    nombres TEXT NOT NULL,
    apellidos TEXT NOT NULL,
    telefono TEXT,
    activo INTEGER CHECK(activo IN (0, 1)) NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3. DOCENTES
CREATE TABLE docentes (
    id TEXT PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    cedula TEXT NOT NULL UNIQUE,
    especialidad TEXT
);

-- 4. REPRESENTANTES
CREATE TABLE representantes (
    id TEXT PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    cedula TEXT NOT NULL UNIQUE,
    direccion TEXT NOT NULL
);

-- 5. ESTUDIANTES
CREATE TABLE estudiantes (
    id TEXT PRIMARY KEY CHECK(length(id) = 36),
    cedula_escolar TEXT NOT NULL UNIQUE,
    nombres TEXT NOT NULL,
    apellidos TEXT NOT NULL,
    fecha_nacimiento TEXT NOT NULL,
    representante_id TEXT NOT NULL REFERENCES representantes(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 6. PERIODOS ACADÉMICOS
CREATE TABLE periodos_academicos (
    id TEXT PRIMARY KEY CHECK(length(id) = 36),
    nombre TEXT NOT NULL,
    activo INTEGER CHECK(activo IN (0, 1)) NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 7. GRADOS Y SECCIONES
CREATE TABLE secciones (
    id TEXT PRIMARY KEY CHECK(length(id) = 36),
    periodo_id TEXT NOT NULL REFERENCES periodos_academicos(id) ON DELETE CASCADE,
    nivel TEXT CHECK(nivel IN ('PREESCOLAR_3', 'PRIMARIA_1', 'PRIMARIA_2', 'PRIMARIA_3', 'PRIMARIA_4', 'PRIMARIA_5', 'PRIMARIA_6', 'BACHILLERATO_1', 'BACHILLERATO_2', 'BACHILLERATO_3', 'BACHILLERATO_4', 'BACHILLERATO_5')) NOT NULL,
    seccion TEXT NOT NULL,
    docente_guia_id TEXT REFERENCES docentes(id) ON DELETE SET NULL,
    UNIQUE(periodo_id, nivel, seccion)
);

-- 8. MATRÍCULAS (Asociación Estudiante - Sección en un Periodo)
CREATE TABLE matriculas (
    id TEXT PRIMARY KEY CHECK(length(id) = 36),
    estudiante_id TEXT NOT NULL REFERENCES estudiantes(id) ON DELETE RESTRICT,
    seccion_id TEXT NOT NULL REFERENCES secciones(id) ON DELETE RESTRICT,
    estado TEXT CHECK(estado IN ('ACTIVO', 'RETIRADO', 'SUSPENDIDO')) NOT NULL DEFAULT 'ACTIVO',
    status_pago TEXT CHECK(status_pago IN ('SOLVENTE', 'CON_DEUDA', 'EXENTO')) NOT NULL DEFAULT 'CON_DEUDA',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(estudiante_id, seccion_id)
);

-- 9. ASIGNATURAS
CREATE TABLE asignaturas (
    id TEXT PRIMARY KEY CHECK(length(id) = 36),
    nombre TEXT NOT NULL,
    nivel TEXT NOT NULL,
    UNIQUE(nombre, nivel)
);

-- 10. PLANES DE EVALUACIÓN (Un plan por asignatura/sección/lapso)
CREATE TABLE planes_evaluacion (
    id TEXT PRIMARY KEY CHECK(length(id) = 36),
    seccion_id TEXT NOT NULL REFERENCES secciones(id) ON DELETE CASCADE,
    asignatura_id TEXT NOT NULL REFERENCES asignaturas(id) ON DELETE CASCADE,
    docente_id TEXT NOT NULL REFERENCES docentes(id) ON DELETE RESTRICT,
    lapso INTEGER CHECK(lapso IN (1, 2, 3)) NOT NULL,
    fecha_aprobacion TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(seccion_id, asignatura_id, lapso)
);

-- 11. ITEMS DE EVALUACIÓN (Hasta 100% acumulado por lapso)
CREATE TABLE evaluaciones_items (
    id TEXT PRIMARY KEY CHECK(length(id) = 36),
    plan_id TEXT NOT NULL REFERENCES planes_evaluacion(id) ON DELETE CASCADE,
    descripcion TEXT NOT NULL,
    ponderacion_porcentaje REAL NOT NULL CHECK(ponderacion_porcentaje > 0.0 AND ponderacion_porcentaje <= 100.0),
    fecha_aplicacion TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 12. CALIFICACIONES
CREATE TABLE calificaciones (
    id TEXT PRIMARY KEY CHECK(length(id) = 36),
    evaluacion_item_id TEXT NOT NULL REFERENCES evaluaciones_items(id) ON DELETE CASCADE,
    matricula_id TEXT NOT NULL REFERENCES matriculas(id) ON DELETE CASCADE,
    valor_nota REAL,
    observacion TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(evaluacion_item_id, matricula_id)
);

-- 13. ASISTENCIA GRANULAR
CREATE TABLE asistencia (
    id TEXT PRIMARY KEY CHECK(length(id) = 36),
    matricula_id TEXT NOT NULL REFERENCES matriculas(id) ON DELETE CASCADE,
    fecha TEXT NOT NULL,
    plan_id TEXT REFERENCES planes_evaluacion(id) ON DELETE SET NULL,
    estado TEXT CHECK(estado IN ('PRESENTE', 'AUSENTE', 'JUSTIFICADO')) NOT NULL,
    observacion TEXT,
    docente_id TEXT NOT NULL REFERENCES docentes(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(matricula_id, fecha, plan_id)
);

-- 14. CONTROL DE PAGOS
CREATE TABLE pagos (
    id TEXT PRIMARY KEY CHECK(length(id) = 36),
    matricula_id TEXT NOT NULL REFERENCES matriculas(id) ON DELETE RESTRICT,
    mes_correspondiente TEXT CHECK(mes_correspondiente IN ('INSCRIPCION', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO')) NOT NULL,
    monto_dolares REAL NOT NULL CHECK(monto_dolares >= 0.0),
    monto_bolivares REAL NOT NULL CHECK(monto_bolivares >= 0.0),
    tasa_cambio REAL NOT NULL,
    referencia_bancaria TEXT NOT NULL,
    banco_origen TEXT NOT NULL,
    banco_destino TEXT NOT NULL,
    fecha_pago TEXT NOT NULL,
    status_conciliacion TEXT CHECK(status_conciliacion IN ('PENDIENTE', 'APROBADO', 'RECHAZADO')) NOT NULL DEFAULT 'PENDIENTE',
    comentario_auditoria TEXT,
    thumbnail_auditoria TEXT,
    r2_file_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 15. SUSCRIPCIONES PUSH (Para envío de notificaciones Web Push)
CREATE TABLE suscripciones_push (
    id TEXT PRIMARY KEY CHECK(length(id) = 36),
    usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Índices críticos para optimización de consultas en base de datos distribuida
CREATE INDEX idx_calificaciones_matricula ON calificaciones(matricula_id);
CREATE INDEX idx_asistencia_estudiante_fecha ON asistencia(matricula_id, fecha);
CREATE INDEX idx_pagos_matricula_status ON pagos(matricula_id, status_conciliacion);
CREATE INDEX idx_planes_seccion_asignatura ON planes_evaluacion(seccion_id, asignatura_id);
CREATE INDEX idx_evaluaciones_items_plan ON evaluaciones_items(plan_id);
CREATE INDEX idx_matriculas_estudiante ON matriculas(estudiante_id);
CREATE INDEX idx_matriculas_seccion ON matriculas(seccion_id);
CREATE INDEX idx_estudiantes_representante ON estudiantes(representante_id);
CREATE INDEX idx_secciones_periodo ON secciones(periodo_id);
CREATE INDEX idx_suscripciones_usuario ON suscripciones_push(usuario_id);