import { Hono } from 'hono';
import type { AppContextEnv, Env } from './env';
import { attachAuthMiddleware } from './auth/middleware';
import { ensureSeeded } from './db/seed';
import { ensureTasksForDate } from './db/tasks';
import { authRoutes } from './routes/auth';
import { dashboardRoutes } from './routes/dashboard';
import { familyRoutes } from './routes/family';
import { requestRoutes } from './routes/requests';
import { taskRoutes } from './routes/tasks';
import { templateRoutes } from './routes/templates';
import { getTodayInTimezone } from './utils/date';

export function createApp(): Hono<AppContextEnv> {
  const app = new Hono<AppContextEnv>();

  app.get('/api/health', (c) => {
    return c.json({
      ok: true,
      env: c.env.APP_ENV ?? 'development',
      today: getTodayInTimezone(c.env.FAMILY_TIMEZONE),
    });
  });

  app.use('/api/*', attachAuthMiddleware);

  app.route('/api/auth', authRoutes);
  app.route('/api/dashboard', dashboardRoutes);
  app.route('/api/tasks', taskRoutes);
  app.route('/api/templates', templateRoutes);
  app.route('/api/requests', requestRoutes);
  app.route('/api/family', familyRoutes);

  app.notFound(async (c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json({ error: 'API route not found', code: 'NOT_FOUND' }, 404);
    }
    if (c.env.ASSETS) {
      return c.env.ASSETS.fetch(c.req.raw);
    }
    return c.text('Not Found', 404);
  });

  app.onError((err, c) => {
    console.error('[worker error]', err);
    return c.json(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      },
      500,
    );
  });

  return app;
}

const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await ensureSeeded(env.DB, env.FAMILY_TIMEZONE, env.INITIAL_ADMIN_EMAIL);
    const today = getTodayInTimezone(env.FAMILY_TIMEZONE);
    const count = await ensureTasksForDate(env.DB, today);
    console.log(`[cron] materialized ${count} recurring templates for ${today}`);
  },
};
