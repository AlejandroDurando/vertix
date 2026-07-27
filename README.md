# Vertix — Web

Sitio web de Vertix, financiera privada argentina: simulador de descuento de cheques/echeq/FCE y de
préstamos, precalificación de solicitudes, y alta de cuentas comitentes (AdCap / Sailing).

Next.js 14 (App Router) + TypeScript + Tailwind, con UI y API en el mismo proyecto (no es un
backend headless: `app/*/page.tsx` son las páginas públicas, `app/api/*/route.ts` sus endpoints).

Para convenciones de código, decisiones de arquitectura y estado detallado de cada integración, ver
[`CLAUDE.md`](CLAUDE.md).

---

## Stack

- **Next.js 14** (App Router, Route Handlers) · **React 18** · **TypeScript 5.5** · **Tailwind 3.4**
- **zod** — validación de formularios
- **googleapis** — tasas y CRM en Google Sheets
- **resend** — emails transaccionales
- **vitest** — tests de las funciones puras (cuit, fechas, simulador, tasas)
- BCRA Central de Deudores (API pública, sin key) para chequear situación crediticia

## Estructura

```
app/
  page.tsx                    # home
  simulador/page.tsx          # cotización orientativa de cheques y préstamos
  precalificacion/page.tsx    # solicitud de precalificación (cheques o préstamos)
  alta/page.tsx                # alta de cuenta comitente AdCap / Sailing (PF y PJ)
  contacto/page.tsx
  api/
    simulador/route.ts
    precalificacion/route.ts
    alta/route.ts              # multipart/form-data, lleva adjuntos
    contacto/route.ts
components/
  forms/                       # un form client component por página
  ui/                          # Input, Select, Textarea, FileInput, Button, Alert, Tabs
lib/
  simulador.ts                 # cálculo de cheques (descuento simple) y préstamos (sistema francés)
  tasas.ts                     # lectura de la hoja "tasas" + cache 1h + fallback
  validations.ts                # schemas zod + parseo manual (parseSimulador, parseAlta)
  sheets-crm.ts                # alta de filas en el Google Sheets de CRM
  email.ts                     # notificación interna + confirmación al solicitante
  bcra.ts                      # Central de Deudores, fail-open
  cuit.ts                      # validación de CUIT (módulo 11)
  fechas.ts                    # "hoy" en horario Argentina, días hábiles, feriados
  uploads.ts                   # parseo de FormData con archivos
  nota-epyme.ts                # genera la Nota de Adhesión EPYME pre-llenada para el alta
  rate-limit.ts                # in-memory por IP
  hubspot.ts                   # stub, inactivo
types/index.ts
tests/
```

## Setup

### 1. Instalar dependencias

```bash
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env.local
```

Completá `.env.local` (ver comentarios en [`.env.example`](.env.example)):

- **Resend** (`RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_TO`) — emails de notificación interna y
  confirmación al solicitante. Los emails a destinatarios externos requieren el dominio
  `vertix.com.ar` verificado en Resend (DNS); mientras tanto solo llegan a la casilla del sandbox.
- **Google Sheets — tasas** (`GOOGLE_SHEETS_ID`): pestaña `tasas` con TNA anual en % por fila
  (`cheques_directo`, `cheques_comitente`, `arancel_cheques`, `prestamos_ph`, `prestamos_pj`).
  Se cachean 1h en memoria; si la hoja falla o los valores están fuera de 5–300%, se usa un
  fallback hardcodeado (ver `lib/tasas.ts`).
- **Google Sheets — CRM** (`GOOGLE_SHEETS_CRM_ID`): pestañas `Contacto`, `Precalificacion`,
  `AltasPF`, `AltasPJ`. Acá la service account necesita permiso de **Editor** (en la hoja de tasas
  alcanza con Lector).
- **`GOOGLE_SERVICE_ACCOUNT_EMAIL`** / **`GOOGLE_SERVICE_ACCOUNT_KEY`**: del JSON de la service
  account (Google Cloud Console → Service Account → API de Sheets habilitada). Compartir ambas
  spreadsheets con ese email.
- **`HUBSPOT_API_KEY`**: dejar vacío — integración preparada pero inactiva (`lib/hubspot.ts`).
- **`BCRA_CHECK_ENABLED`**: `true` por defecto; consulta pública sin key, con fail-open si el
  servicio no responde.

Verificar que las credenciales de Sheets funcionan y las tasas se leen bien:

```bash
npm run check:sheets
```

### 3. Levantar el dev server

```bash
npm run dev   # http://localhost:3000
```

Sin `.env.local` configurado, los formularios devuelven **503** al enviarlos (comportamiento
esperado: si Sheets y el email interno fallan los dos, no se responde éxito con los datos
perdidos — ver `CLAUDE.md`).

---

## Comandos

```bash
npm run dev          # desarrollo
npm run build        # build de producción
npm run start         # start tras build
npm run typecheck     # tsc --noEmit
npm run lint          # next lint
npm test              # vitest run
npm run check:sheets  # verifica credenciales + tasas leídas de la hoja
```

Antes de commitear: `npm test && npm run typecheck && npm run lint && npm run build`.

## Deploy

Push a `master` → Vercel despliega automáticamente.
