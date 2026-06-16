-- SGE Seed Data - Development Only
-- Run after migrations: wrangler d1 execute sge-db-prod --local --file=packages/database/seeds/seed-all.sql

-- Insert institucion_config (single row)
INSERT OR IGNORE INTO institucion_config (id, nombre, rif, direccion, telefono, sistema_evaluacion_por_defecto, porcentaje_inasistencia_reprobacion, notificar_inasistencia_automatica, moneda_base, vapid_public_key, vapid_private_key)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Unidad Educativa Ejemplo',
    'J-12345678-9',
    'Av. Principal, Urbanización Ejemplo, Caracas, Venezuela',
    '0212-555-1234',
    'NUMERICO_20',
    25.0,
    1,
    'USD',
    'BEl62iUYgU8B65KT3LZ5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5',
    'Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5'
);

-- Insert periodos_academicos
INSERT OR IGNORE INTO periodos_academicos (id, nombre, activo)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'Año Escolar 2024-2025', 1),
    ('22222222-2222-2222-2222-222222222222', 'Año Escolar 2025-2026', 0);

-- Insert asignaturas base (niveles: PREESCOLAR_3, PRIMARIA_1-6, BACHILLERATO_1-5)
INSERT OR IGNORE INTO asignaturas (id, nombre, nivel) VALUES
    -- Preescolar
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Desarrollo Integral', 'PREESCOLAR_3'),
    -- Primaria
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'Lenguaje y Comunicación', 'PRIMARIA_1'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'Matemáticas', 'PRIMARIA_1'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'Ciencias Naturales', 'PRIMARIA_1'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', 'Estudios Sociales', 'PRIMARIA_1'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6', 'Educación Física', 'PRIMARIA_1'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7', 'Artes', 'PRIMARIA_1'),
    -- Repetir para otros niveles primarios y bachillerato...
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'Castellano y Literatura', 'BACHILLERATO_1'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'Matemáticas', 'BACHILLERATO_1'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', 'Biología', 'BACHILLERATO_1'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4', 'Química', 'BACHILLERATO_1'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5', 'Física', 'BACHILLERATO_1'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb6', 'Historia', 'BACHILLERATO_1'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb7', 'Geografía', 'BACHILLERATO_1'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb8', 'Educación Física', 'BACHILLERATO_1'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb9', 'Inglés', 'BACHILLERATO_1');