# Restaurant Reporter – CLAUDE.md

## Projektöversikt
Automatiserat månatligt rapporteringssystem för ett marknadsföringsbolag som hanterar 30–50 restaurangkunder. Hämtar data från Metricool, Google Business Profile och Plausible Analytics, genererar AI-insikter via Claude, renderar branded PDF-rapporter och skickar dem via mail den 1:a varje månad.

## Tech Stack
- **Runtime:** Node.js 18+ (ESM modules, `"type": "module"`)
- **Scheduler:** `node-cron` (cron: `0 8 1 * *`, Europe/Stockholm)
- **HTTP:** `axios` med exponential backoff retry (max 3 försök)
- **PDF:** `Puppeteer` (HTML → PDF via Chromium headless)
- **Mail:** `nodemailer` + SendGrid SMTP
- **AI:** `@anthropic-ai/sdk` (model: `claude-sonnet-4-6`)
- **Loggning:** `winston` (console + `logs/YYYY-MM.log`)
- **Config:** `dotenv`

## Projektstruktur
```
restaurant-reporter/
├── src/
│   ├── index.js          # Entry point & cron scheduler
│   ├── reportRunner.js   # Orchestrerar hela flödet per kund
│   ├── metricool.js      # Metricool REST API-klient
│   ├── googleBusiness.js # Google Business Profile API-klient
│   ├── plausible.js      # Plausible Analytics API-klient
│   ├── aiSummary.js      # Claude API – genererar AI-insikter
│   ├── pdfGenerator.js   # Puppeteer HTML→PDF + template-injektion
│   ├── mailer.js         # SendGrid mailutskick
│   ├── logger.js         # Winston-factory: createLogger(module, customerId)
│   └── retry.js          # withRetry() – exponential backoff helper
├── templates/
│   └── report.html       # HTML-mall med {{PLACEHOLDER}} tokens + {{#IF_X}}/{{#ELSE_X}} blocks
├── data/
│   └── customers.json    # Kundregister (filtrera på active: true)
├── logs/                 # delivered-YYYY-MM.json, failed-YYYY-MM.json, YYYY-MM.log
├── output/               # Temporära PDFs (raderas efter mailutskick)
├── config/               # Google service account JSON (gitignored)
├── .env                  # Hemligheter (gitignored)
├── .env.example
└── package.json
```

## NPM Scripts
```bash
npm start                              # Starta scheduler (väntar på 1:a varje månad)
npm run test-customer -- --id=kund_001 # Dry run för EN kund (sparar PDF, skickar ej mail)
npm run generate-all                   # Kör alla aktiva kunder omedelbart
npm run test-mail                      # Verifiera SendGrid SMTP-konfiguration
node src/index.js --now                # Kör månadsrapport direkt (utan att vänta på cron)
```

## Köra i produktion (VPS / Railway / Render)
```bash
cp .env.example .env       # Fyll i alla API-nycklar
npm install
npm start                  # Kör som process med t.ex. PM2
```

## Rapportflöde per kund
1. Kontrollera `logs/delivered-YYYY-MM.json` – hoppa över om redan levererad
2. Hämta Metricool-data (sociala medier + Meta Ads)
3. Hämta Google Business Profile-data
4. Hämta Plausible Analytics-data
5. Generera AI-insikter via Claude (svenska, professionell ton)
6. Rendera HTML-mall → PDF via Puppeteer
7. Skicka PDF via mail (Nodemailer + SendGrid)
8. Logga leverans i `logs/delivered-YYYY-MM.json`
9. Radera temporär PDF från `output/`

## Felhantering
- Varje datakälla fångas individuellt – fel loggas, `null` returneras, sektionen i PDFen visar "Data ej tillgänglig denna månad"
- Mailfel → loggas i `logs/failed-YYYY-MM.json` för manuell retry
- API-anrop använder `withRetry()` med max 3 försök och exponential backoff (1s, 2s, 4s)

## customers.json Schema
```json
[
  {
    "id": "kund_001",
    "name": "Restaurang Lyktan",
    "contact_email": "info@lyktan.se",
    "active": true,
    "metricool": { "brand_id": "12345" },
    "google": { "location_id": "locations/123456789" },
    "website": { "platform": "vercel", "plausible_domain": "lyktan.se" }
  }
]
```

## Template-syntax (templates/report.html)
- `{{TOKEN}}` – ersätts med data
- `{{#IF_X}} ... {{/IF_X}}` – visas om data finns
- `{{#ELSE_X}} ... {{/ELSE_X}}` – visas om data saknas

## Viktiga konventioner
- Alltid `async/await`, aldrig callbacks
- Alla API-nycklar enbart via `.env`
- Logga alltid med `createLogger(module, customerId)` för spårbarhet
- Filtrera alltid `customers.json` på `active: true`
- `withRetry()` för alla externa API-anrop
