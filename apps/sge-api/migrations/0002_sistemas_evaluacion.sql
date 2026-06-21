-- Migration number: 0002 	 2026-06-21T16:00:00.000Z
-- Sistemas de Evaluación Personalizados
-- Permite a las instituciones crear sus propios sistemas de evaluación.

CREATE TABLE IF NOT EXISTS sistemas_evaluacion (
    id TEXT PRIMARY KEY CHECK(length(id) = 36),
    codigo TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    tipo TEXT CHECK( tipo IN ('NUMERICO', 'CUALITATIVO') ) NOT NULL DEFAULT 'NUMERICO',
    configuracion TEXT NOT NULL DEFAULT '{}',
    activo INTEGER CHECK(activo IN (0, 1)) NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed default systems (matching built-in values)
INSERT OR IGNORE INTO sistemas_evaluacion (id, codigo, nombre, tipo, configuracion) VALUES
('00000000-0000-4000-a000-000000000001', 'NUMERICO_20', 'Numérico (0–20)', 'NUMERICO', '{"maximo": 20, "minimo": 0, "aprobatorio": 10}'),
('00000000-0000-4000-a000-000000000002', 'CUALITATIVO_AE', 'Cualitativo (A–E)', 'CUALITATIVO', '{"escala": [{"letra": "A", "min": 19, "descripcion": "Excelente"}, {"letra": "B", "min": 15, "descripcion": "Bueno"}, {"letra": "C", "min": 11, "descripcion": "Regular"}, {"letra": "D", "min": 10, "descripcion": "Deficiente"}, {"letra": "E", "min": 0, "descripcion": "Reprobado"}]}');
