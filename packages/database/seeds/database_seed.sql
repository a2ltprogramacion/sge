-- Script de Semilla Inicial para Cloudflare D1
-- Fecha de creación: 2026-06-16
-- Descripción: Carga de datos base para testing y desarrollo.
-- NOTA DE CONTRASEÑA EN DESARROLLO: Para todos los usuarios del seed, la contraseña plana es "Admin1234*" 
-- El hash de contraseña ha sido pre-computado usando PBKDF2 (SHA-256, 100,000 iteraciones) utilizando el UUID respectivo como sal fija en formato binario codificado en UTF-8.

-- 1. INYECTAR INSTITUCIÓN DEMO
INSERT INTO institucion_config (
    id, nombre, rif, direccion, telefono, sistema_evaluacion_por_defecto, 
    porcentaje_inasistencia_reprobacion, notificar_inasistencia_automatica, moneda_base,
    vapid_public_key, vapid_private_key
) VALUES (
    '8c9d19a1-8d1e-4581-9b1d-2b0d7b3dcb01',
    'Unidad Educativa Nacional Bolívar',
    'J-12345678-9',
    'Avenida Bolívar, Edificio Centro Escolar, Caracas, Distrito Capital',
    '+58-212-5551234',
    'NUMERICO_20',
    25.0,
    1,
    'USD',
    'BEl69b1deb4d3b7bad9bdd2b0d7b3dcb6df4a2a0f15ba41f2a3c9d19a18d1e45819b1deb4d3b7bad9bdd2b',
    'f6a42a0f15ba41f2a3c9d19a18d1e45819b1deb4d3b7b'
);

-- 2. USUARIOS DE PRUEBA (Hash de contraseña precalculado para "Admin1234*")
INSERT INTO usuarios (id, email, password_hash, rol, nombres, apellidos, telefono, activo) VALUES 
-- Administrador General
('11111111-1111-4111-a111-111111111111', 'admin@bolivar.edu.ve', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'ADMINISTRADOR', 'Alejandro', 'Lovera', '+58-412-1111111', 1),
-- Docente de Prueba
('22222222-2222-4222-a222-222222222222', 'docente@bolivar.edu.ve', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'DOCENTE', 'María Carmen', 'Rodríguez', '+58-412-2222222', 1),
-- Representante de Prueba
('33333333-3333-4333-a333-333333333333', 'representante@bolivar.edu.ve', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'REPRESENTANTE', 'Carlos Eduardo', 'Pérez', '+58-412-3333333', 1);

-- 3. PERFIL DOCENTE
INSERT INTO docentes (id, cedula, specialty) VALUES 
('22222222-2222-4222-a222-222222222222', 'V-11222333', 'Ciencias Exactas y Biológicas');

-- 4. PERFIL REPRESENTANTE
INSERT INTO representantes (id, cedula, direccion) VALUES 
('33333333-3333-4333-a333-333333333333', 'V-14555666', 'Urb. La Candelaria, Calle 4, Edificio Sol, Apto 5B, Caracas');

-- 5. REGISTRO DE ESTUDIANTES (Asociados al Representante)
INSERT INTO estudiantes (id, cedula_escolar, nombres, apellidos, fecha_nacimiento, representante_id) VALUES 
('55555555-5555-4555-a555-555555555555', 'VE-20150912-01', 'Juan Diego', 'Pérez Rodríguez', '2015-09-12', '33333333-3333-4333-a333-333333333333'),
('66666666-6666-4666-a666-666666666666', 'VE-20180424-02', 'Sofía Valentina', 'Pérez Rodríguez', '2018-04-24', '33333333-3333-4333-a333-333333333333');

-- 6. PERÍODO ACADÉMICO ACTIVO
INSERT INTO periodos_academicos (id, nombre, activo) VALUES 
('a0a0a0a0-a0a0-4a0a-b0b0-a0a0a0a0a0a0', 'Año Escolar 2025-2026', 1);

-- 7. SECCIONES DE PRUEBA
INSERT INTO secciones (id, periodo_id, nivel, seccion, docente_guia_id) VALUES 
-- Primaria: 5to Grado Sección A (Donde estudia Juan Diego)
('c1c1c1c1-c1c1-4c1c-bc1c-111111111111', 'a0a0a0a0-a0a0-4a0a-b0b0-a0a0a0a0a0a0', 'PRIMARIA_5', 'A', '22222222-2222-4222-a222-222222222222'),
-- Primaria: 2do Grado Sección B (Donde estudia Sofía Valentina)
('c2c2c2c2-c2c2-4c2c-bc2c-222222222222', 'a0a0a0a0-a0a0-4a0a-b0b0-a0a0a0a0a0a0', 'PRIMARIA_2', 'B', NULL);

-- 8. MATRÍCULAS ACTIVAS
INSERT INTO matriculas (id, estudiante_id, seccion_id, estado, status_pago) VALUES 
-- Juan Diego en 5to Grado A
('d1d1d1d1-d1d1-4d1d-bd1d-111111111111', '55555555-5555-4555-a555-555555555555', 'c1c1c1c1-c1c1-4c1c-bc1c-111111111111', 'ACTIVO', 'CON_DEUDA'),
-- Sofía Valentina en 2do Grado B
('d2d2d2d2-d2d2-4d2d-bd2d-222222222222', '66666666-6666-4666-a666-666666666666', 'c2c2c2c2-c2c2-4c2c-bc2c-222222222222', 'ACTIVO', 'SOLVENTE');

-- 9. ASIGNATURAS BASE
INSERT INTO asignaturas (id, nombre, nivel) VALUES 
('e1e1e1e1-e1e1-4e1e-be1e-111111111111', 'Matemáticas', 'PRIMARIA_5'),
('e2e2e2e2-e2e2-4e2e-be2e-222222222222', 'Lenguaje y Literatura', 'PRIMARIA_5'),
('e3e3e3e3-e3e3-4e3e-be3e-333333333333', 'Ciencias de la Naturaleza', 'PRIMARIA_5'),
('e4e4e4e4-e4e4-4e4e-be4e-444444444444', 'Matemáticas', 'PRIMARIA_2');

-- 10. PLAN DE EVALUACIÓN DE PRUEBA (Lapso 1 - Matemáticas de 5to Grado A)
INSERT INTO planes_evaluacion (id, seccion_id, asignatura_id, docente_id, lapso, fecha_aprobacion) VALUES 
('f1f1f1f1-f1f1-4f1f-bf1f-111111111111', 'c1c1c1c1-c1c1-4c1c-bc1c-111111111111', 'e1e1e1e1-e1e1-4e1e-be1e-111111111111', '22222222-2222-4222-a222-222222222222', 1, '2026-06-16');

-- 11. ITEMS DEL PLAN DE EVALUACIÓN (Suman 100%)
INSERT INTO evaluaciones_items (id, plan_id, descripcion, ponderacion_porcentaje, fecha_aplicacion) VALUES 
('f2f2f2f2-f2f2-4f2f-bf2f-222222222222', 'f1f1f1f1-f1f1-4f1f-bf1f-111111111111', 'Examen Práctico de Fracciones', 40.0, '2026-06-20'),
('f3f3f3f3-f3f3-4f3f-bf3f-333333333333', 'f1f1f1f1-f1f1-4f1f-bf1f-111111111111', 'Resolución de Problemas en Grupo', 30.0, '2026-06-25'),
('f4f4f4f4-f4f4-4f4f-bf4f-444444444444', 'f1f1f1f1-f1f1-4f1f-bf1f-111111111111', 'Cuaderno y Talleres Diarios', 30.0, '2026-06-30');