# Vertix — guía del proyecto

Web de una financiera argentina: simulador de descuento de cheques/echeq/FCE y de préstamos,
precalificación de solicitudes y alta de cuentas comitentes (AdCap / Sailing).
Español en toda la UI, mensajes de error, comentarios y nombres de dominio (`tasas`, `librador`).

## Stack y comandos

- Next.js 14.2 (App Router) · React 18 · TypeScript 5.5 · Tailwind 3.4
- zod 3.23 (validación) · googleapis 144 (Sheets) · resend 6.12 (email) · vitest 4 (tests)

```bash
npm run dev          # desarrollo (localhost:3000)
npm run build        # build de producción
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
npm test             # vitest run — 34 tests
npm run check:sheets # verifica credenciales + tasas leídas de la hoja
```

**Deploy**: push a `master` → Vercel despliega solo. Plan a futuro: hosting propio de la empresa
con dominio `www.vertix.com.ar` (sin fecha definida).

**Antes de commitear**: `npm test && npm run typecheck && npm run lint && npm run build`.

## Convenciones establecidas

- **Rutas API**: `export const runtime = "nodejs"` + `dynamic = "force-dynamic"`. Devuelven siempre
  el sobre `ApiResponse` de `types/index.ts` vía los helpers `ok()` / `fail(mensaje, status, campo)`.
  El `campo` permite al frontend resaltar el input con error.
- **Validación**: todo body pasa por zod en `lib/validations.ts`. Cuando un esquema necesita
  `superRefine`, no se puede usar `discriminatedUnion`: hay helpers de parseo manual
  (`parseSimulador`, `parseAlta`) que discriminan por campo y devuelven `{success, message, field}`.
- **Formularios**: client components con `FormData` + `postJson` / `postForm` de `lib/api-client.ts`.
  Patrón `fe(name)` para mapear el error del server al input. Campos condicionales con estado local.
- **UI**: componentes genéricos en `components/ui/` (`Input`, `Select`, `FileInput`, `Textarea`,
  `Button`, `Alert`, `Tabs`). No escribir inputs a mano.
- **Tasas**: siempre **TNA anual en porcentaje** (`48` = 48% anual), nunca fracciones ni tasas
  diarias/mensuales. Convención heredada del formato viejo (`0.15`) que ya no se acepta.
- **Fechas**: usar `hoy()` de `lib/fechas.ts`, nunca `new Date()` para "el día de hoy" — el servidor
  corre en UTC y a partir de las 21:00 ART el día calendario ya cambió.
- **Emails**: escapar siempre el contenido del usuario con `esc()` antes de interpolar en HTML.
- **Tests**: funciones puras en `tests/` (cuit, fechas, simulador, tasas). Las funciones de cálculo
  aceptan la fecha actual por parámetro (`simularCheques(input, tasas, ahora)`) para ser testeables.
- **Notas internas** (`CAMBIOS.md`, `pendientes.md`, `AUDITORIA.md`, `RESPUESTAS.md`) y los `.docx`
  del cliente están en `.gitignore`: son material de trabajo, no van al repo.

## Decisiones de arquitectura

**Todo se `await`ea antes de responder.** En serverless la lambda se congela al devolver la
respuesta, así que los `fire-and-forget` (emails, HubSpot) nunca se ejecutaban. Sheets + email van
en `Promise.all`, el resto awaited después.

**Si Sheets y el email interno fallan los dos, se devuelve 503.** Antes se respondía
`recibido: true` con los datos perdidos. Consecuencia esperada: en local sin `.env.local`
configurado, los formularios devuelven 503 — es correcto, no es un bug.

**Tasas en Google Sheets, no en código.** Los dueños las ajustan sin deploy. Cache de 1 hora en
memoria (un cambio en la hoja tarda hasta 1h en verse), fallback hardcodeado si la hoja falla, y se
ignoran valores fuera del rango 5–300% (protege contra el formato viejo y errores de tipeo).

**Tasa de cheques = tasa de descuento + arancel.** Filas separadas en la hoja (`cheques_directo` /
`cheques_comitente` + `arancel_cheques`) porque la tasa varía y el arancel de la empresa (2,5%) no.
El resultado muestra los tres números desglosados.

**Préstamos cotizan un rango, no un valor.** La tasa depende del solicitante y del mercado
(cauciones, bancos), no del tipo de persona — dar una cuota exacta sería precisión falsa. Se cotiza
entre `prestamos_ph` y `prestamos_pj` como extremos (el código los ordena solo). Por eso el
simulador ya **no** pide tipo de persona; la precalificación sí lo pide, como dato del lead.

**BCRA bloquea el presupuesto, con fail-open.** Se consulta la Central de Deudores (API pública sin
credenciales) para librador y endosatario: situación ≥3 bloquea, situación 2 o cheques rechazados
advierte, y si el BCRA no responde se permite continuar (no frenar a un cliente legítimo por una
caída del servicio). El resultado se muestra siempre, aunque esté limpio.

**El descuento corre hasta la fecha estimada de acreditación** (+2 días hábiles si la fecha de pago
es hábil, +3 si cae finde/feriado), no hasta la fecha de pago, porque es cuando el vendedor cobra
de verdad. ⚠️ Da un descuento levemente mayor — **pendiente de confirmación del cliente**; revertir
son dos líneas en `lib/simulador.ts`.

**No se descuentan cheques propios**: si el CUIT del librador y el del endosatario coinciden, se
rechaza en simulador y precalificación.

## Estado de las integraciones

| Integración | Estado |
|---|---|
| **Google Sheets — tasas** | Activo. `GOOGLE_SHEETS_ID`, pestaña `tasas`. La service account tiene **solo Lector** acá: no se puede escribir por API. |
| **Google Sheets — CRM** | Activo. `GOOGLE_SHEETS_CRM_ID`, pestañas `Contacto`, `Precalificacion`, `AltasPF`, `AltasPJ`. Acá la service account **sí es Editor**. |
| **Resend (email)** | Activo para la casilla interna. Los emails de confirmación al solicitante **no llegan a externos** hasta verificar el dominio `vertix.com.ar` en Resend (DNS). La API devuelve `confirmacion_enviada` para chequearlo. |
| **BCRA Central de Deudores** | Activo, API pública sin key. Toggle `BCRA_CHECK_ENABLED=false` para desactivar. |
| **HubSpot** | **Inactivo.** `lib/hubspot.ts` es un stub: la lógica real está comentada y espera `HUBSPOT_API_KEY`. Se llama desde contacto y precalificación pero devuelve `disabled`. |
| **n8n** | ❓ **No existe en el código.** Aparece solo como idea en un documento del cliente ("Destino: n8n → Google Sheets"). No sé si sigue en pie — **confirmar antes de asumir que hay que integrarlo**. |
| **WhatsApp** | ❓ **No existe en el código ni fue pedido.** Solo aparece un número de WhatsApp en material institucional de Sailing. **Falta info** sobre si se planea alguna integración. |

⚠️ El CRM tiene filas de prueba que empiezan con **`EJEMPLO`** en las 4 pestañas (carga de
verificación). Borrarlas cuando ya no sirvan.

## Decidido pero NO reflejado en el código

- **Tasas por instrumento**: el cliente confirmó que echeq, FCE y cheque físico tienen tasas
  distintas (el físico más alta). Hoy el campo `instrumento` se valida y se pide, pero **no afecta
  el cálculo** — las tres cotizan igual. Falta que Martín (Vertix) pase las tasas concretas; cuando
  lleguen hay que reestructurar la hoja con una fila por instrumento.
- **Teléfono de contacto**: la leyenda de cheques con vencimiento <5 días hábiles debe invitar a
  llamar. Hoy linkea a `/contacto` porque **no definieron el número** (ni si es llamada o WhatsApp).
- **Tasa de cheques 48%**: el código y el fallback ya usan 48 + 2,5 de arancel, pero **la hoja
  todavía dice 43 y no tiene la fila `arancel_cheques`** (no pude escribirla, ver permisos arriba).
  Hasta que se corrija a mano, producción cotiza 45,5% en vez de 50,5%.
- **Requisitos de Sailing**: implementados a partir de dos imágenes (selfie con DNI, foto aleatoria,
  servicio si el domicilio del DNI no es el actual, ingresos opcionales) y de la regla "Sailing solo
  personas físicas, las jurídicas van a AdCap". El cliente dijo que pasaría el detalle formal
  "en breve" — **todavía no llegó**. Sin confirmar: si Sailing también exige constancia de CBU y
  Nota EPYME (hoy se piden igual que en AdCap) y si hace falta contemplar **co-titularidad**.

## Pendientes técnicos

1. **Adjuntos sin almacenamiento durable** (riesgo alto). Los archivos viajan solo por email; en
   Sheets se guardan únicamente los nombres de campo. Si Resend falla o los adjuntos superan ~18MB,
   los documentos se pierden. Solución prevista: subirlos a Google Drive (ya hay service account) o
   a un bucket, y guardar los links en la fila. **Pospuesto por decisión del dueño** hasta confirmar
   que todo lo demás funciona.
2. **Límite de body de 4.5MB de Vercel**. El alta PJ exige ~6 adjuntos y una foto de DNI pesa 3–8MB:
   el request va a dar 413, que el frontend no maneja. **Pospuesto**: se resolvería al migrar al
   hosting propio, o antes con compresión client-side.
3. **Verificar dominio en Resend** para que los comprobantes lleguen a clientes reales.
4. **Feriados hardcodeados** en `lib/fechas.ts`: 2026 completo, 2027 parcial. Mantenimiento anual.
5. **Rate limiting en memoria**: por instancia de lambda, se resetea en cold start. Best-effort, no
   es protección real. La IP de `x-forwarded-for` es spoofeable.
6. **MIME de archivos** según lo declara el cliente, sin verificar magic bytes (aceptable hoy).

## Falta información / a confirmar

- ¿n8n y WhatsApp entran en el alcance? Hoy no existen en el repo (ver tabla).
- Tasas por instrumento (echeq / FCE / cheque físico) — las debe Martín.
- Teléfono de contacto para la leyenda de <5 días hábiles.
- ¿El descuento se calcula hasta la acreditación (como está) o hasta la fecha de pago?
- Sailing: ¿CBU y Nota EPYME obligatorios? ¿Co-titularidad?
- Valor real de la tasa para modalidad comitente (hoy 35% es un supuesto mío, no confirmado).
