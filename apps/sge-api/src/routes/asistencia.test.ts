import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { asistenciaRouter } from './asistencia';
import type { Bindings } from '../index';

vi.mock('../middleware/auth', () => ({
  authMiddleware: () => async (c, next) => {
    if (!c.get('jwtPayload')) {
      c.set('jwtPayload', { sub: '22222222-2222-4222-a222-222222222222', rol: 'DOCENTE', email: 'docente@bolivar.edu.ve' });
    }
    return next();
  }
}));

vi.mock('../services/push', () => ({
  sendPushNotification: vi.fn().mockResolvedValue(new Response(null, { status: 201 }))
}));

function createMockDB() {
  const prepareMock = vi.fn(() => ({
    bind: vi.fn(() => ({
      first: vi.fn(),
      all: vi.fn(),
      run: vi.fn()
    })),
    run: vi.fn()
  }));
  return {
    prepare: prepareMock,
    batch: vi.fn().mockResolvedValue([]),
    exec: vi.fn(),
    _prepareMock: prepareMock
  };
}

const mockEnv = {
  DB: {} as any,
  JWT_SECRET: 'test-secret-key-min-32-chars-long',
  VAPID_PUBLIC_KEY: 'BEl69b1deb4d3b7bad9bdd2b0d7b3dcb6df4a2a0f15ba41f2a3c9d19a18d1e45819...',
  VAPID_PRIVATE_KEY: 'f6a42a0f15ba41f2a3c9d19a18d1e45819b1d...',
  VAPID_SUBJECT: 'mailto:test@test.com'
};

const TEST_USERS = {
  admin: { sub: '11111111-1111-4111-a111-111111111111', email: 'admin@bolivar.edu.ve', rol: 'ADMINISTRADOR' as const, nombres: 'Alejandro', apellidos: 'Lovera' },
  docente: { sub: '22222222-2222-4222-a222-222222222222', email: 'docente@bolivar.edu.ve', rol: 'DOCENTE' as const, nombres: 'María Carmen', apellidos: 'Rodríguez' },
  docenteOther: { sub: 'docente-other-id', email: 'docente2@bolivar.edu.ve', rol: 'DOCENTE' as const, nombres: 'Otro', apellidos: 'Docente' },
  representante: { sub: '44444444-4444-4444-a444-444444444444', email: 'rep@bolivar.edu.ve', rol: 'REPRESENTANTE' as const, nombres: 'Carlos', apellidos: 'Pérez' },
};

function testAuthMiddleware(user) {
  return (c, next) => {
    c.set('jwtPayload', user);
    return next();
  };
}

describe('SGE-006: Control de Asistencia Diaria - Batch y Web Push', () => {
  let mockDB;

  beforeEach(() => {
    mockDB = createMockDB();
    vi.clearAllMocks();
  });

  const validBatchPayload = {
    fecha: '2026-06-20',
    plan_id: null,
    seccion_id: '11111111-1111-4111-a111-111111111111',
    registros: [
      { matricula_id: '55555555-5555-4555-a555-555555555555', estado: 'PRESENTE', observacion: 'OK' },
      { matricula_id: '66666666-6666-4666-a666-666666666666', estado: 'AUSENTE', observacion: 'Enfermedad' }
    ]
  };

  const baseSeccion = {
    id: '11111111-1111-4111-a111-111111111111',
    nivel: 'PRIMARIA_3',
    seccion_letra: 'A',
    docente_guia_id: '22222222-2222-4222-a222-222222222222'
  };

  const baseMatriculas = {
    results: [
      { id: '55555555-5555-4555-a555-555555555555', estudiante_id: 'est-1' },
      { id: '66666666-6666-4666-a666-666666666666', estudiante_id: 'est-2' }
    ]
  };

  const planInfo = {
    docente_id: '22222222-2222-4222-a222-222222222222',
    asignatura_id: 'asig-1'
  };

  function setupSeccionMock(seccion = baseSeccion) {
    mockDB.prepare.mockReturnValueOnce({
      bind: vi.fn().mockReturnValueOnce({
        first: vi.fn().mockResolvedValueOnce(seccion)
      })
    });
  }

  function setupMatriculasMock(matriculas = baseMatriculas) {
    mockDB.prepare.mockReturnValueOnce({
      bind: vi.fn().mockReturnValueOnce({
        all: vi.fn().mockResolvedValueOnce(matriculas)
      })
    });
  }

  function setupPlanMock(plan = planInfo) {
    mockDB.prepare.mockReturnValueOnce({
      bind: vi.fn().mockReturnValueOnce({
        first: vi.fn().mockResolvedValueOnce(plan)
      })
    });
  }

  function setupBatchSuccess() {
    mockDB.batch.mockResolvedValueOnce([]);
  }

  function makeRequest(app, payload) {
    return app.request('/api/asistencia/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  function createTestApp(mockDB, user = { sub: '22222222-2222-4222-a222-222222222222', rol: 'DOCENTE', email: 'docente@bolivar.edu.ve' }) {
    const app = new Hono();
    app.use('*', (c, next) => {
      c.env = {
        DB: mockDB,
        JWT_SECRET: 'test-secret-key-min-32-chars-long',
        VAPID_PUBLIC_KEY: 'BEl69b1deb4d3b7bad9bdd2b0d7b3dcb6df4a2a0f15ba41f2a3c9d19a18d1e45819...',
        VAPID_PRIVATE_KEY: 'f6a42a0f15ba41f2a3c9d19a18d1e45819b1d...',
        VAPID_SUBJECT: 'mailto:test@test.com',
      };
      return next();
    });
    app.use('/api/asistencia/*', (c, next) => {
      c.set('jwtPayload', { sub: '22222222-2222-4222-a222-222222222222', rol: 'DOCENTE', email: 'docente@bolivar.edu.ve' });
      return next();
    });
    app.route('/api/asistencia', asistenciaRouter);
    return app;
  }

  describe('POST /api/asistencia/batch - Validación de Entrada', () => {
    it('should return 400 for invalid fecha format', async () => {
      const mockDB = createMockDB();
      const app = new Hono();
      app.use('*', (c, next) => { c.env = { DB: mockDB }; return next(); });
      app.route('/api/asistencia', asistenciaRouter);
      const res = await app.request('/api/asistencia/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBatchPayload, fecha: '20-06-2026' })
      });
      expect(res.status).toBe(400);
    });

    it('should return 400 for empty registros array', async () => {
      const mockDB = createMockDB();
      const app = new Hono();
      app.use('*', (c, next) => { c.env = { DB: mockDB }; return next(); });
      app.route('/api/asistencia', asistenciaRouter);
      const res = await app.request('/api/asistencia/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBatchPayload, registros: [] })
      });
      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid estado value', async () => {
      const mockDB = createMockDB();
      const app = new Hono();
      app.use('*', (c, next) => { c.env = { DB: mockDB }; return next(); });
      app.route('/api/asistencia', asistenciaRouter);
      const res = await app.request('/api/asistencia/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBatchPayload, registros: [{ matricula_id: '55555555-5555-4555-a555-555555555555', estado: 'INVALIDO' }] })
      });
      expect(res.status).toBe(400);
    });

    it('should return 400 for missing matricula_id', async () => {
      const mockDB = createMockDB();
      const app = new Hono();
      app.use('*', (c, next) => { c.env = { DB: mockDB }; return next(); });
      app.route('/api/asistencia', asistenciaRouter);
      const res = await app.request('/api/asistencia/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBatchPayload, registros: [{ estado: 'PRESENTE' }] })
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/asistencia/batch - Validación de Sección', () => {
    it('should return 404 for non-existent seccion', async () => {
      const mockDB = createMockDB();
      const app = new Hono();
      app.use('*', (c, next) => { c.env = { DB: mockDB }; return next(); });
      app.route('/api/asistencia', asistenciaRouter);
      mockDB.prepare.mockReturnValueOnce({ bind: () => ({ first: vi.fn().mockResolvedValue(null) }) });
      const res = await app.request('/api/asistencia/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...validBatchPayload, seccion_id: '00000000-0000-4000-a000-000000000000' }) });
      expect(res.status).toBe(404);
    });
  });
});
