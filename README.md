# Сімейний штаб · Family Dashboard

A full-stack TypeScript PWA + Cloudflare Workers + Cloudflare D1 app for managing family daily checklists, parent verification, and screen-time readiness — running for **\$0/month** on Cloudflare's free tier.

## Features (Phase 1 — Core MVP)

* **Ukrainian (`uk`) primary interface** with instant one-tap **English (`en`)** switching.
* **Responsive Desktop Dashboard + Installable Mobile PWA:** 4-column family board on laptops/monitors + thumb-friendly bottom navigation and member filters on smartphones.
* **Strict Role-Based Access (2 Parents Admin + 2 Children End Users):**
  * **Children** report their own tasks as **Done (`Виконано`)** or **Partly Done (`Частково`, % + note)** and submit **Change Requests (`Запити`)**.
  * **Parents (Admin)** confirm full/partial completion, reject with feedback, manage daily & recurring routines, and approve/decline child requests (auto-rescheduling tasks or creating approved quests).
* **Screen-Time Readiness Gate:** Visual progress bar per child tracking mandatory tasks confirmed by parents vs. waiting for check.
* **Daily Recurring Routines + Cron:** Supports `daily`, `weekdays`, `weekends`, `custom_days`, and `every_n_days` (e.g., hamster cage every 3 days), materialized automatically at 03:00 UTC (05:00/06:00 Kyiv) and on-demand.
* **Google OAuth Allowlist + Family Link Device Code Fallback:** Sign in with your 4 family Google Accounts, or link a child's supervised phone with a parent-issued 6-character one-time code.
* **Pre-wired for Next Phases:**
  * **Phase 3 (Next):** Telegram Bot notifications (`notification_events` + `telegram_chat_id`) and external integrations (`external_accounts` for Chess.com, Duolingo, school cabinet).
  * **Phase 2 (After):** Gamification (XP, levels, titles, badges, screen-time bank, weekly/monthly bonuses & analytics).

## Local Development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev:all
```

* Frontend (Vite): `http://localhost:5173`
* Worker API (Wrangler): `http://localhost:8787`
* Tests: `npm test`

## \$0 Cloudflare Deployment (Staging + Production)

1. **Create D1 Databases** (one for staging, one for production):
   ```bash
   npx wrangler login
   npx wrangler d1 create family_dashboard_db_staging
   npx wrangler d1 create family_dashboard_db
   ```
   Paste the returned `database_id` values into `wrangler.jsonc`.

2. **Set Secrets** (repeat with `--env staging` for staging):
   ```bash
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put INITIAL_ADMIN_EMAIL
   ```
   In **Google Cloud Console → APIs & Services → Credentials**, create an OAuth 2.0 Web Client and add your authorized redirect URIs:
   * `https://family-dashboard-staging.<your-subdomain>.workers.dev/api/auth/google/callback`
   * `https://family-dashboard.<your-subdomain>.workers.dev/api/auth/google/callback`

3. **Apply Migrations & Deploy**:
   ```bash
   # Staging
   npm run db:migrate:staging
   npm run deploy:staging

   # Production (after staging review)
   npm run db:migrate:prod
   npm run deploy:prod
   ```

4. **Optional Automated GitHub Deploys:** Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in GitHub Repository Secrets — pushes to `staging` deploy staging, and merges to `main` deploy production.
