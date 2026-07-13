# Drava International – Planer

Web aplikacija za planiranje proizvodnje: raspored smjena, raspored strojeva, praćenje napretka i gantogram.

Application for production planning: shift scheduling, machine scheduling, progress monitoring, and a Gantt chart.

Zadani jezik je hrvatski, s mogućnošću prebacivanja na engleski (gornji desni kut). / Default language is Croatian, with English available as an option (top-right corner).

## Pokretanje / Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Backend (Supabase)

Users, the company logo, and scheduling data (jobs/work orders) are stored in
[Supabase](https://supabase.com) so they're shared across every device, not just
the browser that created them.

1. Create a free Supabase project.
2. In the SQL Editor, run `supabase/schema.sql` once — it creates the
   `app_users`, `app_settings`, and `jobs` tables and seeds the default
   `dturk` / `1234` account.
3. Copy `.env.local.example` to `.env.local` and fill in your project's
   URL and anon public key (Project Settings → API) for local development.
4. For the deployed GitHub Pages site, add the same two values as repository
   secrets (Settings → Secrets and variables → Actions):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`

   The deploy workflow (`.github/workflows/deploy.yml`) passes these through
   as `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` at build time.

If no Supabase credentials are configured, the app still runs using
in-memory fallback data (useful for quick local previews), but nothing
persists or syncs across devices in that mode.

## Značajke / Features

- **Raspored smjena / Shift Schedule** – čarobnjak za generiranje tjednog rasporeda smjena s ispisom u A4 formatu (logotip, popisi radnika, rotacija smjena).
- **Raspored strojeva / Machine Scheduling** – planiranje zauzetosti strojeva po radnim nalozima, operaterima i vremenskim terminima.
- **Praćenje napretka / Progress Monitoring** – pregled statusa zadataka (planirano, u tijeku, završeno, kašnjenje) s postotkom napretka.
- **Gantogram / Gantt Chart** – vremenski prikaz svih zadataka s linijom "danas".
