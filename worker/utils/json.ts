import type { Context } from 'hono';

export async function readJsonBody<T extends object>(c: Context): Promise<Partial<T>> {
  try {
    const data = await c.req.json<Partial<T>>();
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}
