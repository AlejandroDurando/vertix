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
npm test             # vitest run — 85 tests
npm run check:sheets # verifica credenciales + tasas leídas de la hoja
```

**Deploy**: push a `master` → Vercel despliega solo. Plan a futuro: hosting propio de la empresa
con dominio `www.vertix.com.ar` (sin fecha definida).

**Antes de commitear**: `npm test && npm run typecheck && npm run lint && npm run build`.

## Arquitectura

Cuatro flujos independientes, mismo patrón de punta a punta: `app/<ruta>/page.tsx` renderiza un
form client component de `components/forms/`, que arma un `FormData`/JSON y lo postea con
`postJson`/`postForm` (`lib/api-client.ts`) al route handler en `app/api/<ruta>/route.ts`. El
handler valida con `lib/validations.ts`, corre la lógica de negocio y devuelve el sobre
`ApiResponse` (`types/index.ts`).

- **`/simulador`** → `POST /api/simulador`: no persiste nada. Lee tasas (`lib/tasas.ts`, cache 1h
  con fallback hardcodeado) y calcula con `lib/simulador.ts` (sistema francés para préstamos,
  descuento simple para cheques). Para cheques consulta BCRA (`lib/bcra.ts`, fail-open) y arma el
  desglose tasa + arancel de `types/index.ts` (`SimuladorChequesOutput`).
- **`/contacto` y `/precalificacion`** → JSON body. Validan con `parseSimulador`/schemas de
  `lib/validations.ts`, escriben la fila en el CRM (`lib/sheets-crm.ts`, pestañas `Contacto` /
  `Precalificacion`) y mandan el email interno (`lib/email.ts`) en paralelo con `Promise.all`.
- **`/alta`** (AdCap/Sailing) → `multipart/form-data` porque lleva adjuntos. `lib/uploads.ts`
  separa campos de archivos (valida tipo/tamaño, decodifica a base64) de los demás; `parseAlta`
  determina campos obligatorios según `tipo` (física/jurídica) y condiciones (casado, adhesión al
  Régimen Simplificado de Ganancias en PF — que pide la constancia de adhesión **y** la DDJJ de
  actividad lícita firmada; sólo en PF, para PJ no fue solicitada). En PJ el campo `tiene_eecc` decide qué respaldo contable
  se exige: el balance certificado por el CPCE o las DDJJ de IVA de los últimos 6 meses.
  `lib/nota-epyme.ts` genera la Nota de Adhesión EPYME **en .docx** (vía `POST /api/nota-epyme`),
  pre-llenada, que el usuario descarga, **imprime, firma a mano** y vuelve a subir escaneada o
  fotografiada. AdCap no acepta la firma insertada en el Word (confirmado el 06/08/2026), así que
  **ningún adjunto acepta Word**: `tiposPermitidos()` en `lib/validations.ts` es PDF/imagen para
  todos. Persiste en
  `sheets-crm.ts` (pestañas `AltasPF`/`AltasPJ`) + `email.ts` (adjuntos van en el email, no se
  guardan — ver pendiente #1 abajo) en paralelo.

**Adjuntos**: si el bucket está configurado, los forms piden una URL firmada a `/api/adjuntos/firmar`,
suben cada archivo **directo al bucket** (así el request nunca toca el límite de 4,5MB de Vercel) y
mandan sólo `<campo>__clave` + `<campo>__nombre`. `lib/uploads.ts` los devuelve en `subidos`, y para
los chequeos de obligatorios un documento cuenta igual venga por `files` o por `subidos`. Antes de
subir, `lib/adjuntos-client.ts` comprime las imágenes en el navegador.

**El legajo es la carpeta.** Todos los documentos de un envío comparten el `tramiteId` que genera el
navegador, así que la clave queda `tramite/fecha/<id>/campo-nombre` y la carpeta se puede listar
entera. En el CRM va **un solo enlace por fila** (`enlaceLegajo`) a `/legajo`, que muestra los
documentos con las fotos previsualizadas y un botón para bajar todo en un zip
(`/api/adjuntos/zip`). Se probó poner un enlace por documento en la misma celda y es impracticable:
Sheets no los hace clicables por separado. La página no tiene login: el acceso depende del token de
la carpeta, igual que los documentos sueltos.

Todas las rutas comparten `lib/rate-limit.ts` (in-memory por IP, ver pendiente #5) y `lib/logger.ts`
(logger JSON que redacta PII). `lib/hubspot.ts` se llama desde contacto/precalificación pero es un
stub inactivo (ver tabla de integraciones).

## Convenciones establecidas

- **Rutas API**: `export const runtime = "nodejs"` + `dynamic = "force-dynamic"`. Devuelven siempre
  el sobre `ApiResponse` de `types/index.ts` vía los helpers `ok()` / `fail(mensaje, status, campo)`.
  El `campo` permite al frontend resaltar el input con error.
- **Validación**: todo body pasa por zod en `lib/validations.ts`. Cuando un esquema necesita
  `superRefine`, no se puede usar `discriminatedUnion`: hay helpers de parseo manual
  (`parseSimulador`, `parseAlta`) que discriminan por campo y devuelven `{success, message, field}`.
- **Formularios**: client components con `FormData` + `postJson` / `postForm` de `lib/api-client.ts`.
  Patrón `fe(name)` para mapear el error del server al input. Campos condicionales con estado local.
- **UI**: componentes genéricos en `components/ui/` (`Input`, `NumberInput`, `Select`, `FileInput`,
  `Textarea`, `Button`, `Alert`, `Tabs`). No escribir inputs a mano. CUIT, DNI y CBU van **siempre**
  con `NumberInput` (`maxDigits` 11 / 8 / 22): filtra todo lo que no sea dígito al tipear y al pegar,
  así no entran guiones ni puntos.
- **Contacto**: el teléfono y el WhatsApp de Martín salen de `lib/contacto.ts`, nunca hardcodeados.
  `whatsappCon(mensaje)` arma el enlace con el texto ya escrito.
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

**Tasa de cheques = tasa de descuento + gastos, por modalidad y por tramo de plazo** (confirmado el
31/07/2026). Directo con Vertix: ≤45 días 48% + 2%, ≥46 días 72% + 3,5%. Comitente: ≤30 días 40%,
31–60 43%, ≥61 45%, siempre + 2,5% de arancel. La FCE en comitente no tiene tramos (su tasa depende
del pagador de la factura) y **cotiza 40% todo incluido, sin arancel** (corregido el 06/08/2026):
tiene su propia fila `gastos_comitente_fce`, la única **opcional** de la hoja — si falta se toman 0
gastos en vez de invalidar la lectura entera, y con gastos en 0 el simulador no muestra esa línea.
Cada tramo son **dos filas en la hoja**
(tasa y gastos) para poder ajustar una sin la otra; `tramoParaOperacion()` en `lib/tasas.ts` elige
cuál aplica. **El plazo que define el tramo es el mismo que se usa para el descuento**: días hasta
la acreditación del comprador. El resultado desglosa tasa, gastos, total y el tramo aplicado.

**Préstamos cotizan un rango, no un valor.** La tasa depende del solicitante y del mercado
(cauciones, bancos), no del tipo de persona — dar una cuota exacta sería precisión falsa. Se cotiza
entre `prestamos_ph` y `prestamos_pj` como extremos (el código los ordena solo). Por eso el
simulador ya **no** pide tipo de persona; la precalificación sí lo pide, como dato del lead.

**Los textos de cara al usuario nombran la modalidad por la cuenta comitente**, sin aclaraciones
entre paréntesis: "Sin cuenta comitente en el mercado de capitales" / "Con cuenta comitente en el
mercado de capitales" (pedido del cliente, 06/08/2026). "Directo con Vertix" queda sólo en
comentarios del código y en los nombres internos (`modalidad: "directo"`).

**Sólo el librador bloquea el presupuesto por BCRA, con fail-open.** Se consulta la Central de
Deudores (API pública sin credenciales) para librador y endosatario, pero **únicamente la situación
≥3 del librador impide emitir el presupuesto**: es quien termina pagando el cheque. La del
endosatario se informa siempre como "requiere análisis previo" (`infoBcra(..., { soloInformativo:
true })`) y nunca traba la cotización. Situación 2 o cheques rechazados advierte; si el BCRA no
responde se permite continuar (no frenar a un cliente legítimo por una caída del servicio).

**El mínimo de 5 días hábiles de vencimiento sólo rige en el mercado de capitales.** Por fuera se
pueden comprar valores con menor plazo, así que la regla depende de la modalidad: bloquea sólo
`comitente`. **Simulador y precalificación piden la modalidad** (la precalificación desde el
06/08/2026) y comparten las mismas reglas: `modalidadRequiereMinDias` para el piso de días, e
`instrumentoSoloDirecto` / `instrumentoSoloComitente` para las combinaciones imposibles (el cheque
físico no entra al mercado, la FCE sólo se negocia ahí). Viven en `lib/validations.ts` y los reusan
los forms para el `min` del input date y para achicar el select, así front y back nunca se
desincronizan. Las etiquetas salen de `MODALIDAD_OPCIONES`, también compartidas.

**El descuento corre hasta la fecha estimada de acreditación** (+2 días hábiles si la fecha de pago
es hábil, +3 si cae finde/feriado), no hasta la fecha de pago, porque es cuando el vendedor cobra
de verdad. ⚠️ Da un descuento levemente mayor — **pendiente de confirmación del cliente**; revertir
son dos líneas en `lib/simulador.ts`.

**No se descuentan cheques propios**: si el CUIT del librador y el del endosatario coinciden, se
rechaza en simulador y precalificación.

## Estado de las integraciones

| Integración | Estado |
|---|---|
| **Google Sheets — tasas** | Activo. `GOOGLE_SHEETS_ID`, pestaña `tasas`. La service account **ya es Editor** acá (lo era sólo Lector hasta el 06/08/2026): se puede escribir por API pidiendo el scope `spreadsheets` en vez de `spreadsheets.readonly`. La app igual lee con el scope de sólo lectura. |
| **Google Sheets — CRM** | Activo. `GOOGLE_SHEETS_CRM_ID`, pestañas `Contacto`, `Precalificacion`, `AltasPF`, `AltasPJ`. Acá la service account **sí es Editor**. Las columnas nuevas se agregan **al final** para no correr las filas ya cargadas: `Precalificacion!Q` = instrumento, `Precalificacion!R` = modalidad, `AltasPF!Y` = régimen simplificado, `AltasPJ!AB` = tiene_eecc. Todos los encabezados están escritos y coinciden con el orden de `sheets-crm.ts` (verificado el 06/08/2026); al agregar una columna, escribir también su encabezado. |
| **Resend (email)** | Activo para la casilla interna. Los emails de confirmación al solicitante **no llegan a externos** hasta verificar el dominio `vertix.com.ar` en Resend (DNS). La API devuelve `confirmacion_enviada` para chequearlo. |
| **BCRA Central de Deudores** | Activo, API pública sin key ni costo (`lib/bcra.ts`). Dos endpoints: deudas (situación 1–5 por entidad, se toma la máxima) y cheques rechazados. Toggle `BCRA_CHECK_ENABLED=false`. |
| **Validación de CUIT** | Local, sin servicio externo (`lib/cuit.ts`): verifica los 11 dígitos y el dígito verificador por módulo 11. Normaliza la entrada (acepta guiones y espacios) antes de validar y de consultar el BCRA. |
| **Almacenamiento de adjuntos (S3/R2)** | **Activo** — bucket `vertix-legajos` en Cloudflare R2 (verificado el 06/08/2026: 6 legajos guardados). `lib/storage.ts` + `/api/adjuntos/firmar` (URL de subida) + `/api/adjuntos` (descarga con token). Necesita `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION=auto`, `ADJUNTOS_SECRET` y `APP_URL`. Si faltaran, `firmar` devuelve 503 y los forms vuelven a mandar los archivos dentro del multipart (con el techo de 4,5MB de Vercel). |
| **HubSpot** | **Inactivo.** `lib/hubspot.ts` es un stub: la lógica real está comentada y espera `HUBSPOT_API_KEY`. Se llama desde contacto y precalificación pero devuelve `disabled`. |

⚠️ El CRM tiene filas de prueba que empiezan con **`EJEMPLO`** en las 4 pestañas (carga de
verificación). Borrarlas cuando ya no sirvan.

## Decidido pero NO reflejado en el código

- **DDJJ del Régimen Simplificado en PJ**: en persona física ya se pide la firmada como adjunto
  (`ddjj_actividad_licita`, obligatoria si adhiere). Para personas jurídicas el cliente **no la
  pidió**, así que no se exige; si algún día la piden, es agregar el campo en `JuridicaFields` y en
  el `required` de `app/api/alta/route.ts`.
- **Requisitos de Sailing**: implementados a partir de dos imágenes (selfie con DNI, foto aleatoria,
  servicio si el domicilio del DNI no es el actual, ingresos opcionales) y de la regla "Sailing solo
  personas físicas, las jurídicas van a AdCap". El cliente dijo que pasaría el detalle formal
  "en breve" — **todavía no llegó**. Sin confirmar: si Sailing también exige constancia de CBU y
  Nota EPYME (hoy se piden igual que en AdCap) y si hace falta contemplar **co-titularidad**.

## Pendientes técnicos

1. ~~**Adjuntos sin almacenamiento durable**~~ — **resuelto**: el bucket R2 `vertix-legajos` está
   creado y funcionando (ver tabla de integraciones). Falta confirmar que las variables `S3_*` estén
   cargadas también en **Vercel**, no sólo en `.env.local`: si en producción faltaran, los envíos
   reales volverían a viajar por email sin dejar copia.
   ⚠️ **Google Drive no sirve como destino**: la service account tiene quota 0 y `files.create` falla
   con "Service Accounts do not have storage quota"; requeriría unidad compartida (sólo con Google
   Workspace — el MX de `vertix.com.ar` apunta a Hostmar, así que hoy no lo tienen) o delegación OAuth.
2. **Límite de body de 4.5MB de Vercel**. Mitigado, no resuelto: `lib/adjuntos-client.ts` comprime
   las imágenes en el navegador (2000px de lado largo, JPEG 0.82) y bloquea el envío antes de
   mandarlo si el total supera 4MB, con un mensaje que nombra los archivos pesados; `lib/api-client.ts`
   traduce el 413 y cualquier respuesta no-JSON a un error entendible. Un envío de PDFs pesados
   sigue sin poder completarse: eso se resuelve recién con el punto 1.
3. **Verificar dominio en Resend** para que los comprobantes lleguen a clientes reales. ⚠️ El SPF de
   `vertix.com.ar` **ya existe** y termina en `-all` (rechazo estricto):
   `v=spf1 include:spf.hostmar.com include:_spf.google.com include:spf.protection.outlook.com -all`.
   Hay que **editar ese registro** agregando el include de Resend, nunca crear un TXT nuevo: dos
   registros SPF en el mismo dominio invalidan la verificación y hacen rebotar todo el correo.
4. **Feriados hardcodeados** en `lib/fechas.ts`: 2026 completo, 2027 parcial. Mantenimiento anual.
5. **Rate limiting en memoria**: por instancia de lambda, se resetea en cold start. Best-effort, no
   es protección real. La IP de `x-forwarded-for` es spoofeable.
6. **MIME de archivos** según lo declara el cliente, sin verificar magic bytes (aceptable hoy).

## Falta información / a confirmar

- Sailing: ¿CBU y Nota EPYME obligatorios? ¿Co-titularidad?
- ¿La DDJJ de actividad lícita también se pide a personas jurídicas? (en PF ya se pide como adjunto)
