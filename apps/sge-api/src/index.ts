// SGE API Entry Point - Hono Worker
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

const app = new Hono<{ Bindings: CloudflareEnv }>();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: ['http://localhost:4321', 'https://sge.pages.dev'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// API routes will be mounted here
// app.route('/api/auth', authRoutes);
// app.route('/api/calificaciones', calificacionesRoutes);
// app.route('/api/asistencia', asistenciaRoutes);
// app.route('/api/pagos', pagosRoutes);
// app.route('/api/dashboard', dashboardRoutes);
// app.route('/api/push', pushRoutes);

// 404
app.notFound((c) => c.json({ error: 'Not Found' }, 404));

// Error handler
app.onError((err, c) => {
  console.error('Error:', err);
  return c.json(
    {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: err.message,
    },
    500
  );
});

export default app;