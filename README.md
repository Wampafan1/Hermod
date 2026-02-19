# Hermod

> Norse god of report delivery. Open-source SQL report builder with Excel formatting and scheduled email delivery.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

<!-- TODO: Add screenshot -->

## Features

- **Multi-database support** — Connect to PostgreSQL, SQL Server, MySQL, and BigQuery
- **Monaco SQL editor** — Full syntax highlighting with Ctrl+Enter to run queries
- **Spreadsheet results grid** — AG Grid with resizable columns, sorting, filtering
- **Excel-style formatting** — Bold, colors, number formats, alignment — applied to email attachments
- **Visual schedule builder** — No cron expressions. Pick frequency, days, time, timezone visually
- **Automated email delivery** — Formatted `.xlsx` attachments sent on schedule via SMTP
- **Run history** — Track every report execution with status, row counts, and error details
- **Dark theme** — Consistent dark UI throughout
- **Docker ready** — Single `docker-compose up` to run everything

## Quick Start (Docker)

```bash
git clone https://github.com/yourname/hermod.git
cd hermod
cp .env.example .env
# Edit .env with your Google OAuth, SMTP, and encryption key
docker-compose up -d
```

The app will be available at `http://localhost:3000`.

## Manual Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 14+

### Installation

```bash
# Install dependencies
npm install

# Generate encryption key
openssl rand -base64 32
# Add to .env as ENCRYPTION_KEY

# Copy and configure environment
cp .env.example .env
# Edit .env with your settings

# Set up the database
npx prisma db push

# Start the app
npm run dev

# In a separate terminal, start the worker
npm run worker
```

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project (or select existing)
3. Go to **APIs & Services > Credentials**
4. Click **Create Credentials > OAuth client ID**
5. Select **Web application**
6. Add authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
7. Copy the Client ID and Client Secret to your `.env` file

## SMTP Configuration

### Gmail

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your.email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM="Hermod <your.email@gmail.com>"
```

> Use an [App Password](https://myaccount.google.com/apppasswords), not your regular password.

### Outlook/Microsoft 365

```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=your.email@outlook.com
SMTP_PASSWORD=your-password
SMTP_FROM="Hermod <your.email@outlook.com>"
```

### SendGrid

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=your-sendgrid-api-key
SMTP_FROM="Hermod <reports@yourdomain.com>"
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXTAUTH_URL` | Yes | App URL (`http://localhost:3000`) |
| `NEXTAUTH_SECRET` | Yes | Random secret (`openssl rand -base64 32`) |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `SMTP_HOST` | Yes | SMTP server host |
| `SMTP_PORT` | Yes | SMTP server port (587 or 465) |
| `SMTP_USER` | Yes | SMTP username |
| `SMTP_PASSWORD` | Yes | SMTP password |
| `SMTP_FROM` | Yes | From address for emails |
| `ENCRYPTION_KEY` | Yes | 32-byte base64 key for password encryption |

## Architecture

```
┌──────────────────────────┐     ┌──────────────────┐
│  Next.js App             │     │  Worker Process   │
│  (App Router + API)      │     │  (pg-boss)        │
│                          │     │                   │
│  Pages: Dashboard,       │     │  60s polling loop  │
│  Connections, Reports,   │     │  → enqueue jobs    │
│  Schedules, History      │     │  → run reports     │
│                          │     │  → generate Excel  │
│  API: CRUD + query exec  │     │  → send email      │
└──────────┬───────────────┘     └────────┬──────────┘
           │                              │
           ├──────────────────────────────┤
           │                              │
    ┌──────┴──────┐              ┌───────┴──────┐
    │  PostgreSQL  │              │  User DBs    │
    │  (Prisma +   │              │  (pg/mssql/  │
    │   pg-boss)   │              │   mysql/bq)  │
    └─────────────┘              └──────────────┘
```

- **Next.js App**: Handles UI rendering and API routes. All data filtered by authenticated user.
- **Worker**: Separate process that polls for due schedules, executes queries, generates Excel files, and sends emails.
- **pg-boss**: Postgres-based job queue — no Redis required.
- **Connection passwords**: Encrypted at rest with AES-256-GCM.

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run worker` | Start background worker |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:push` | Push schema to database |
| `npm run test` | Run unit tests (Vitest) |

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

MIT
