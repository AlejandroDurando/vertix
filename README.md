# Vertix — Backend

Backend del sitio web de Vertix (financiera privada argentina). Stack: Next.js 14 (App Router) + TypeScript + Tailwind CSS.

Esta primera fase contiene **solo la API y la estructura del proyecto**: endpoints de formularios, simulador de cuotas, integración con Google Sheets para tasas y cliente de n8n. El diseño visual y la UI final llegan en una etapa posterior.

---

## Stack y dependencias

- **Next.js 14** (App Router, Route Handlers para los endpoints).
- **TypeScript** estricto.
- **Tailwind CSS** (configurado, sin estilos finales todavía).
- **Zod** para validación de formularios.
- **googleapis** para leer tasas desde Google Sheets.
- **Rate limiting** in-memory (10 req/min por IP en formularios, 30 req/min en simulador).

---

## Estructura de carpetas

```
app/
  api/
    contacto/route.ts         # POST /api/contacto
    precalificacion/route.ts  # POST /api/precalificacion
    simulador/route.ts        # POST /api/simulador
  layout.tsx
  page.tsx
  globals.css
components/                   # componentes reutilizables (vacío por ahora)
lib/
  api-response.ts             # helpers ok() / fail()
  hubspot.ts                  # integración HubSpot (preparada, inactiva)
  logger.ts                   # logger JSON con redacción de PII
  n8n.ts                      # cliente para webhooks de n8n
  rate-limit.ts               # rate limiter in-memory por IP
  simulador.ts                # cálculo de cheques y préstamos (sistema francés)
  tasas.ts                    # lectura de Google Sheets + cache 1h
  validations.ts              # schemas Zod
types/
  index.ts
.env.example
```

---

## Setup paso a paso

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env.local
```

Luego editá `.env.local` con los valores reales.

### 3. Google Sheets — preparar la hoja de tasas

1. Crear una Google Spreadsheet. Anotá el `GOOGLE_SHEETS_ID` (lo ves en la URL).
2. La primera hoja debe llamarse **`tasas`** y tener este formato:

   | servicio       | tasa | actualizado_el |
   |----------------|------|----------------|
   | cheques        | 0.15 | 2024-01-15     |
   | prestamos_ph   | 0.08 | 2024-01-15     |
   | prestamos_pj   | 0.10 | 2024-01-15     |

   - `cheques`: tasa **diaria** en porcentaje (0.15 = 0.15% por día).
   - `prestamos_ph` / `prestamos_pj`: tasa **mensual** en decimal (0.08 = 8% mensual).

3. En [Google Cloud Console](https://console.cloud.google.com) crear un **Service Account** y bajarse la key JSON.
4. Habilitar la **Google Sheets API** en el proyecto.
5. Compartir la spreadsheet con el email del service account (permiso de lectura es suficiente).
6. Copiar al `.env.local`:
   - `GOOGLE_SHEETS_ID` (de la URL).
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` (del JSON, campo `client_email`).
   - `GOOGLE_SERVICE_ACCOUNT_KEY` (campo `private_key` del JSON; los `\n` se preservan tal cual).

> Las tasas se cachean en memoria por **1 hora**. Reiniciá el server para forzar refetch, o editá la hoja y esperá hasta una hora.

### 4. n8n — webhooks

Para desarrollo local, exponé tu n8n con [ngrok](https://ngrok.com):

```bash
ngrok http 5678
```

Y configurá en `.env.local`:

```
N8N_WEBHOOK_CONTACTO=https://<tu-subdominio>.ngrok-free.app/webhook/contacto
N8N_WEBHOOK_PRECALIFICACION=https://<tu-subdominio>.ngrok-free.app/webhook/precalificacion
```

Cada webhook recibe un POST con el siguiente payload:

```json
{
  "endpoint": "contacto",
  "sent_at": "2024-01-15T12:34:56.000Z",
  "payload": { /* datos validados del formulario */ }
}
```

> Si `N8N_WEBHOOK_*` está vacío, el endpoint igualmente devuelve `success: true` (modo dev). El error solo se reporta al usuario si el webhook está configurado y la llamada falla.

### 5. HubSpot — preparado pero inactivo

La integración vive en [`lib/hubspot.ts`](lib/hubspot.ts) con la lógica comentada (`TODO`). Cuando la cuenta esté lista:

1. Crear una **Private App** en HubSpot con scopes `crm.objects.contacts.read` y `crm.objects.contacts.write`.
2. Pegar el token en `HUBSPOT_API_KEY`.
3. En `lib/hubspot.ts`: descomentar el bloque `TODO` y crear las propiedades custom necesarias en HubSpot (ej. `servicio_solicitado`, `monto_cheque`, etc.).

Mientras `HUBSPOT_API_KEY` esté vacío, todas las llamadas son no-op (loguea info y retorna `{ ok: false, reason: "disabled" }`), no rompe el flujo.

### 6. Levantar el dev server

```bash
npm run dev
```

Por defecto en `http://localhost:3000`.

---

## Endpoints

Todas las respuestas siguen el formato:

```ts
// éxito
{ "success": true, "data": { ... } }

// error
{ "success": false, "error": "mensaje", "field"?: "campo" }
```

### `POST /api/contacto`

Body JSON:

```json
{
  "nombre": "Juan Pérez",
  "email": "juan@example.com",
  "telefono": "+54 11 5555-5555",
  "empresa": "Acme SA",
  "asunto": "Consulta general",
  "mensaje": "Hola, me interesa..."
}
```

`empresa` es opcional. Validaciones con Zod (email válido, teléfono >= 6 caracteres, mensaje >= 5 caracteres).

### `POST /api/precalificacion`

Acepta **JSON** (sin archivo) o **multipart/form-data** (con archivo).

**Variante cheques** (JSON):

```json
{
  "servicio": "cheques",
  "nombre": "Juan Pérez",
  "email": "juan@example.com",
  "telefono": "+54 11 5555-5555",
  "empresa": "Acme SA",
  "monto_cheque": 1500000,
  "fecha_vencimiento": "2024-06-15",
  "banco_emisor": "Galicia",
  "tipo_cheque": "propio"
}
```

**Variante préstamos** (multipart/form-data, archivo requerido):

```
servicio=prestamos
nombre=Juan Pérez
email=juan@example.com
telefono=+54 11 5555-5555
tipo_persona=humana
monto_solicitado=2000000
plazo_meses=24
tipo_ingreso=relacion_dependencia
archivo=<File>          # PDF, JPG, PNG o WebP — máx 5MB
```

El archivo viaja a n8n encodeado en base64 dentro del JSON del payload.

### `POST /api/simulador`

**Cheques:**

```json
{ "tipo": "cheques", "monto": 1500000, "dias_vencimiento": 30 }
```

Respuesta:

```json
{
  "success": true,
  "data": {
    "monto_a_recibir": 1432500,
    "descuento_total": 67500,
    "tasa_aplicada": 0.15,
    "disclaimer": "Cotización orientativa. La tasa final depende..."
  }
}
```

**Préstamos:**

```json
{ "tipo": "prestamos", "monto": 2000000, "plazo_meses": 24, "tipo_persona": "humana" }
```

Respuesta:

```json
{
  "success": true,
  "data": {
    "cuota_mensual": 187500.34,
    "total_a_pagar": 4500008.16,
    "total_intereses": 2500008.16,
    "tasa_aplicada": 0.08,
    "disclaimer": "Cotización orientativa..."
  }
}
```

> Convenciones:
> - **Cheques**: `tasa` en la hoja es porcentaje diario. El cálculo es `descuento = monto * (tasa/100) * dias`.
> - **Préstamos**: `tasa` en la hoja es decimal mensual (0.08 = 8% mensual). Se usa sistema francés.

---

## Pruebas rápidas con curl

```bash
# Contacto
curl -X POST http://localhost:3000/api/contacto \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Test","email":"test@test.com","telefono":"+541155555555","asunto":"Consulta","mensaje":"Hola, esto es una prueba"}'

# Simulador cheques
curl -X POST http://localhost:3000/api/simulador \
  -H "Content-Type: application/json" \
  -d '{"tipo":"cheques","monto":1500000,"dias_vencimiento":30}'

# Simulador préstamos
curl -X POST http://localhost:3000/api/simulador \
  -H "Content-Type: application/json" \
  -d '{"tipo":"prestamos","monto":2000000,"plazo_meses":24,"tipo_persona":"humana"}'

# Precalificación cheques
curl -X POST http://localhost:3000/api/precalificacion \
  -H "Content-Type: application/json" \
  -d '{"servicio":"cheques","nombre":"Test","email":"t@t.com","telefono":"+541155555555","empresa":"Acme","monto_cheque":1000000,"fecha_vencimiento":"2024-12-15","banco_emisor":"Galicia","tipo_cheque":"propio"}'

# Precalificación préstamos (con archivo)
curl -X POST http://localhost:3000/api/precalificacion \
  -F "servicio=prestamos" \
  -F "nombre=Test" \
  -F "email=t@t.com" \
  -F "telefono=+541155555555" \
  -F "tipo_persona=humana" \
  -F "monto_solicitado=2000000" \
  -F "plazo_meses=24" \
  -F "tipo_ingreso=relacion_dependencia" \
  -F "archivo=@./recibo.pdf"
```

---

## Rate limiting

In-memory por IP, sin dependencias externas (suficiente para una sola instancia).

| Endpoint            | Límite        |
|---------------------|---------------|
| /api/contacto       | 10 req / min  |
| /api/precalificacion| 10 req / min  |
| /api/simulador      | 30 req / min  |

En múltiples instancias (Vercel multi-region) conviene migrar a `@upstash/ratelimit` con Redis. Está documentado como TODO.

---

## Logging

Logger JSON estructurado en [`lib/logger.ts`](lib/logger.ts). Redacta automáticamente campos sensibles (email, teléfono, nombre, tokens). En producción, los logs se pueden ingestar tal cual a cualquier servicio (Vercel, Datadog, Logtail).

---

## Comandos

```bash
npm run dev        # dev server
npm run build      # build de producción
npm run start      # start tras build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```

---

## Lo que falta (próximas fases)

- UI / diseño visual final.
- Autenticación (no aplica por ahora — sitio público).
- Activar HubSpot cuando la cuenta exista.
- Migrar rate limiter a Redis si se deploya multi-instancia.
- Deploy a Vercel.
