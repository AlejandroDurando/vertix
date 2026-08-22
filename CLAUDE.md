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
npm test             # vitest run — 147 tests
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

- **`/simulador`** → `POST /api/simulador`: no persiste nada. Lee tasas (`lib/tasas.ts`, cache de 1
  minuto con fallback hardcodeado) y calcula con `lib/simulador.ts` (sistema francés para préstamos;
  para cheques, descuento racional en el mercado y simple fuera de él — ver la tabla de más abajo).
  Para cheques consulta BCRA (`lib/bcra.ts`, fail-open) y arma el desglose de `types/index.ts`
  (`SimuladorChequesOutput`).
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

**El legajo es la carpeta, y las carpetas se agrupan por cliente.** La clave es
`tramite/<cuit-nombre>/<fecha>-<tramiteId>/campo-nombre`: el `tramiteId` lo genera el navegador y
lo comparten todos los documentos de un envío, y el nivel del cliente hace que sus envíos queden
juntos (`identidadCliente()` en `lib/adjuntos-client.ts` lo arma con lo que ya cargó en el
formulario; el CUIT es la parte confiable). Los legajos anteriores al 07/08/2026 tienen la fecha en
ese nivel y aparecen "sin identificar": `partesCarpeta()` entiende las dos formas.

En el CRM va **un solo enlace por fila** (`enlaceLegajo`) a `/legajo`, que muestra los documentos
con las fotos previsualizadas y un botón para bajar todo en un zip (`/api/adjuntos/zip`). Se probó
poner un enlace por documento en la misma celda y es impracticable: Sheets no los hace clicables
por separado. **`/legajos`** (plural) lista los envíos agrupados por trámite, para no entrar fila
por fila al CRM.

**Sólo cuenta como legajo la carpeta con `_legajo.json`.** Los archivos se suben *antes* de enviar
el formulario, así que un intento abandonado —o uno que el server rechazó, se corrigió y se
reenvió— deja una carpeta huérfana con documentos. Las rutas escriben ese marcador
(`marcarLegajoCompleto`) recién cuando la solicitud quedó registrada, con el nombre y CUIT ya
validados; `/legajos` lista sólo esas y cuenta las demás al pie. El marcador no se muestra como
documento ni entra al zip. Ninguna de las dos tiene login — decisión del cliente del 07/08/2026, con el
bucket todavía en pruebas; van marcadas `noindex`. Cuando entren legajos reales hay que ponerle
contraseña a `/legajos`, que expone en un solo lugar los datos de todos los clientes.

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
del pagador de la factura) y su 40% se descompone en **28% de tasa + 12% de arancel anual**
(verificado contra el boleto 348.884 de AdCap el 07/08/2026). Cada tramo son **dos filas en la
hoja** (tasa y gastos) para poder ajustar una sin la otra; `tramoParaOperacion()` en `lib/tasas.ts`
elige cuál aplica. Los costos del vendedor (`iva` 21, `iva_directo` 21, `derechos_mercado` 0,06,
`derechos_comprador` 0,03, `arancel_comprador` 0, `ingresos_brutos` 9, `impuesto_cheque` 1,2,
`arancel_minimo` 500) son ocho filas más, **opcionales**: si faltan se usan
esos mismos valores por defecto. `gastos_comitente_fce` también es opcional. **El cache de la hoja
es de 1 minuto** (era de 1 hora hasta el 07/08/2026): los dueños ajustan tasas varias veces por
semana y necesitan verlo enseguida. **El plazo que define el tramo es el mismo que se usa para el descuento**: días hasta
la acreditación del comprador. El resultado desglosa tasa, gastos, total y el tramo aplicado.

**Préstamos cotizan un rango, no un valor.** La tasa depende del solicitante y del mercado
(cauciones, bancos), no del tipo de persona — dar una cuota exacta sería precisión falsa. Se cotiza
entre `prestamos_ph` y `prestamos_pj` como extremos (el código los ordena solo). Por eso el
simulador ya **no** pide tipo de persona; la precalificación sí lo pide, como dato del lead.

**El préstamo se arma por sistema francés pero se cobra en cuotas iguales.** Se recorre el cuadro
de marcha francés para sumar los intereses de todo el plazo, se le agrega el **IVA del 21% sobre los
intereses**, y ese total —capital + intereses + IVA— se reparte en **cuotas todas iguales**
(`totalesSistemaFrances()` en `lib/simulador.ts`). La cuota francesa, que va bajando, no es lo que
se paga: queda sólo como paso intermedio. Verificado al centavo contra la planilla de una prenda
real de julio de 2026 ("Cuadro Cálculo Cuota Ramirez", cliente 19/08/2026): capital $7.500.000 a 12
meses con TNA 82% → interés $3.730.741,12, IVA $783.455,64, total $12.014.196,76 y **cuota fija
$1.001.183,06** (la francesa daba $935.895,09). Hay un test que reproduce esas cinco cifras.

⚠️ El IVA sobre los intereses **no se cobraba antes**: el simulador devolvía la cuota francesa pelada,
que en el ejemplo quedaba $783.455 por debajo del total real (un 7%, y $65.288 por mes en la cuota).

**El plazo de un préstamo se elige de una lista: 6, 12, 18 o 24 meses** (cliente, 19 y 20/08/2026:
"más que eso no tomamos" y "debería ser un desplegable"). `PLAZOS_MESES` en `lib/validations.ts`
manda: arma el desplegable de los dos formularios (`PLAZO_OPCIONES`) y valida el body, así que un
plazo que no esté en la lista se rechaza. Antes era un campo libre de 1 a 120.

**Los seguros, los gastos de otorgamiento y la grilla de tasa por plazo quedan afuera, confirmado**
(21/08/2026): los seguros y los gastos "no se vienen cobrando, quizás en un futuro se empiecen a
cobrar nuevamente"; sobre la grilla mensual del Excel, "no, dejalo como lo pusiste" — sigue rigiendo
el rango `prestamos_ph`–`prestamos_pj`. El plazo de 6 meses "cotiza con esa tasa por el momento",
o sea con el mismo rango que los demás.

En la planilla del cliente hay tres cosas cargadas que **no** entran en la cuota y por eso no se
implementaron: el seguro de vida (0,1% para persona física) y el seguro del bien están en cero y sin
fórmula en el cuadro, el "premio anual del seguro del bien a prendar" ($81.861) no lo referencia
ninguna celda, y los gastos de otorgamiento van en cero. También trae una grilla de tasa mensual por
plazo (12 → 5%, 18 → 5,5%, 24 → 6%) que **no** es la que usó la operación (usó 6,83% mensual = TNA
82): las tasas se siguen leyendo de la hoja, con `prestamos_ph`/`prestamos_pj` como extremos del
rango.

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

**Los 5 días hábiles del mínimo se cuentan incluyendo el día de la operación** (cliente,
19/08/2026: "si hoy vendiéramos un cheque el vencimiento mínimo debería ser 25/8, son 5 días hábiles
contemplando hoy" — dicho un miércoles 19). Antes se contaban desde el día siguiente y el simulador
exigía un día de más, rechazando operaciones que sí se pueden hacer. `fechaPagoMinima()` en
`lib/validations.ts` devuelve ese vencimiento más cercano y lo usan tanto la validación del server
como el `min` del input date; si el día de la operación no es hábil, no cuenta y los 5 salen enteros
de los días siguientes.

**El mínimo de 5 días hábiles de vencimiento sólo rige en el mercado de capitales.** Por fuera se
pueden comprar valores con menor plazo, así que la regla depende de la modalidad: bloquea sólo
`comitente`. **Simulador y precalificación piden la modalidad** (la precalificación desde el
06/08/2026) y comparten las mismas reglas: `modalidadRequiereMinDias` para el piso de días, e
`instrumentoSoloDirecto` / `instrumentoSoloComitente` para las combinaciones imposibles (el cheque
físico no entra al mercado, la FCE sólo se negocia ahí). Viven en `lib/validations.ts` y los reusan
los forms para el `min` del input date y para achicar el select, así front y back nunca se
desincronizan. Las etiquetas salen de `MODALIDAD_OPCIONES`, también compartidas.

**El descuento corre hasta la fecha estimada de acreditación**, no hasta la fecha de pago, porque
es cuando el vendedor cobra de verdad. El plazo depende del instrumento:

| | desde | hasta |
|---|---|---|
| cheque / echeq **en el mercado** | el día de la operación | fecha de pago **+2 días hábiles** (+3 si cae finde/feriado) |
| cheque / echeq **fuera del mercado** | el día de la operación | fecha de pago **+3 días corridos**, corridos al siguiente hábil si caen en finde/feriado |
| FCE | la **liquidación**, a 1 día hábil | fecha de pago **+1 día hábil** (+2 si cae finde/feriado) |

Lo del mercado está confirmado contra la planilla *compra CPD PESOS* (sus tres filas usan esas
fechas); lo de la FCE, contra el boleto 348.884 de AdCap: concertación 10/08, liquidación 11/08,
vencimiento 14/09 (lunes), cobro 15/09 = **35 días**.

**Que el cheque cuente desde el día de la operación y no desde la liquidación está confirmado**
(14/08/2026: "los cheques tomalos como en la planilla, replicá eso porque así da bien el boleto") y
re-confirmado el 19/08/2026 ("es así tal cual como decís"). La liquidación a 24hs es sólo de la FCE.

**Fuera del mercado son 3 días corridos, no días hábiles** (14/08/2026): "que sea +3 siempre y
cuando el pago no caiga feriado o fin de semana, sino se corre al siguiente hábil". Su ejemplo: un
cheque que vence el viernes 14/08 cobra el martes 18/08, porque el +3 cae en el feriado del lunes
17. Da los mismos 42 días de la planilla directa (vencimiento el viernes 17/07 → lunes 20/07), que
antes se calculaban con +2 hábiles y daban 43: se cotizaba un día de más.

**El interés es un descuento racional, no simple** (alineado con la planilla el 07/08/2026):
`V − V/(1 + i·d/365)`, no `V·i·d/365`. El arancel de Vertix, en cambio, **sí** se calcula sobre el
nominal y prorrateado por días, y ya no se suma a la tasa: es una línea aparte del desglose. El
`tna_aplicada` (tasa + gastos) se sigue informando como referencia, pero no es lo que se cobra.

**Dentro y fuera del mercado se calcula distinto, no sólo con otras tasas.** Son dos esquemas
separados en `lib/simulador.ts` (`calcularCostos` y `costosDirecto`), cada uno verificado al peso
contra una cotización real del cliente:

| | mercado de capitales | fuera del mercado |
|---|---|---|
| Interés | **descuento racional** `V − V/(1+i·d/365)` | **descuento simple** `V·i·d/360` (4% mensual sobre meses de 30) |
| Arancel / gastos | % **anual** prorrateado por días, sobre el nominal | % **fijo del capital**, sin prorratear |
| IVA | sobre el arancel y sobre los derechos (`iva`) | sobre interés + gastos + IIBB (`iva_directo`) |
| Ingresos Brutos | no | **sí**, `ingresos_brutos` (9%) sobre el interés |
| Derechos de mercado | sí, 0,06% prorrateado a 90 días sobre el valor presente | no |
| Percepción de IVA | sí, 21% del interés, si el comprador es RI | no |
| Impuesto al cheque | no | sí, 1,2% del nominal si faltan <10 días hábiles |

⚠️ **El 2% / 3,5% de los tramos directos es una comisión fija**, no una tasa anual: interpretarlo
como anual subestimaba el costo casi diez veces (en la planilla, $719.802 contra $82.826). Los
**dos** tramos son fijos: el 3,5% del tramo largo tampoco se prorratea (confirmado el 14/08/2026).

**La FCE es la excepción dentro del mercado**: paga interés, arancel y derechos, pero **no tributa
IVA ni percepción en ningún concepto** (confirmado por AdCap el 07/08/2026 y verificado contra el
boleto 348.884).

El **`arancel_minimo`** (500) es un piso en pesos que cobra la ALyC si el cálculo da menos; sólo
aplica en el mercado, donde el arancel se prorratea ("es por sistema", cliente 13/08/2026: el
arancel de Vertix fuera del mercado no tiene piso). Re-confirmado el 21/08/2026 ("si es menor a 500
piso de 500"): la regla de la planilla de cobrar 0 cuando el cálculo no llega a $100 **no** es la
que rige.

**El esquema de afuera del mercado lo confirmó Martín** (13/08/2026) y la planilla lo reproduce al
peso: "los gastos bancarios se calculan sobre el valor nominal del cheque, el descuento también,
ingresos brutos sobre el descuento, y el IVA sobre todo eso"; sin derechos de mercado ("no lo
estamos haciendo por el MAV") ni percepción ("no somos agentes de percepción"). O sea que
`iva_directo` queda en **21** y deja de estar pendiente. Re-confirmado el 14/08/2026 ("se calcula
como indicás, IVA sobre todos los gastos e int."), junto con Ingresos Brutos al 9% ("fijo por
ahora"), que ya es una fila editable de la hoja. La pestaña **`ejemplo cheque`** de la hoja de tasas
repite esa misma planilla, con valores fijos y sin fórmulas vivas. El **impuesto al cheque** no aparece en esa
descripción porque sólo se cobra cuando faltan menos de 10 días hábiles y el ejemplo es a 42 días:
se mantiene como estaba (1,2% del nominal, aparte y fuera de la base del IVA), pendiente de que lo
desmientan.

**En la FCE se negocia el valor aceptado, no el total facturado.** Simulador y precalificación piden
los dos importes (`monto` / `monto_cheque` = total de la factura, `monto_aceptado` = lo que aceptó
el comprador) y se cotiza sobre el aceptado, que es lo que figura como nominal en el boleto.
`monto_negociado` en la respuesta dice cuál se usó. **El aceptado se precarga con el 80%**
(`PORCENTAJE_ACEPTADO_FCE` en `lib/validations.ts`) porque es lo habitual, pero se puede corregir:
en cuanto se toca el campo deja de recalcularse solo. La leyenda no nombra al comprador, que en ese
momento todavía no existe (pedido del cliente, 19/08/2026). La precalificación lo pide desde el
13/08/2026 para que el lead llegue con el dato de la operación real.

**Hacia afuera se informa una sola tasa: la global.** En el mercado el resultado muestra
`tna_aplicada` (tasa + arancel: el 40% de la FCE), no el reparto entre los dos, porque ese reparto
cambia de operación en operación y confundía (pedido del cliente, 13/08/2026). Por dentro se sigue
calculando separado, y el simulador interno muestra el desglose a partir de `tna_interes` y
`arancel`. Fuera del mercado no hay tasa global: el arancel es una comisión fija sobre el capital,
así que se informa sólo la tasa de descuento y los gastos van en el detalle, en pesos.

**La percepción de IVA se le cobra al vendedor y depende de SU condición frente al IVA**
(cliente, 21/08/2026: "se la cobran al vendedor"; la planilla la descuenta del vendedor con la nota
"si es mono, no paga"). Antes el código la ataba a la condición del **comprador**, que era una
suposición. Como el vendedor es justamente quien está simulando, el campo `condicion_vendedor` se
pregunta en el simulador **público**, no sólo en el interno: es un dato que la persona conoce. Por
defecto se cotiza "ri", el peor caso.

**El simulador interno muestra también lo que paga el comprador.** La planilla *compra CPD PESOS*
tiene dos bloques rotulados COMPRADOR y VENDEDOR; hasta ahora sólo se calculaba el del vendedor. El
del comprador es el valor presente más **sus** derechos de mercado —que son **0,03%, la mitad que los
del vendedor** (`derechos_comprador`)— y el arancel de la ALyC (`arancel_comprador`, hoy en 0
porque **hay un acuerdo con los compradores habituales**; el cliente avisó el 21/08/2026 que al
sumar compradores nuevos va a empezar a cobrarse, con su IVA — por eso es una fila editable de la
hoja y no un cero hardcodeado), cada uno con su IVA. Sirve para decirle a un inversor externo
cuánto tiene que poner, y para saber cuánto pone Vertix cuando compra con fondos propios (pedido del
cliente, 19/08/2026). `costosComprador()` en `lib/simulador.ts`; se devuelve en `comprador` y el
simulador lo muestra sólo con `?interno=1`. **Sólo existe en el mercado de capitales**: fuera de él
no hay derechos ni ALyC y el comprador paga exactamente lo que cobra el vendedor. Verificado contra
la fila 7 de la planilla: el comprador pone $4.308.654,32, el vendedor cobra $4.272.141,66 y la
diferencia son $36.512,66 de aranceles, derechos e impuestos.

**El simulador interno también puede concertar mañana.** Muchos clientes deciden vender al día
siguiente y hay que reprogramar la liquidación (pedido del cliente, 13/08/2026), así que con
`?interno=1` aparece un selector *hoy / mañana* que mueve el día desde el que se cotiza: cambian los
días de descuento, el tramo de tasa que aplica y el piso de 5 días hábiles. "Mañana" es el **próximo
día hábil** (`fechaConcertacion()` en `lib/validations.ts`): ni el mercado ni el banco liquidan un
sábado. El simulador público siempre cotiza desde hoy.

**La precalificación de préstamos consulta el BCRA y anuncia la pre-aprobación.** Se mira el
`cuit_solicitante` con las mismas reglas que los cheques (pedido del cliente, 20/08/2026) y, si el
BCRA respondió y no hay observaciones, la respuesta trae `pre_aprobado: true` y el formulario muestra
un cartel **PRE APROBADO**, aclarando que queda sujeto a la documentación y al análisis final. En el
CRM el resumen de la columna O termina en `· PRE APROBADO`.

⚠️ **Nunca bloquea**: una precalificación es un lead y una situación mala en un banco no descarta la
operación. Y si el BCRA no responde no se anuncia nada, porque no se promete lo que no se verificó.
La pre-aprobación es sólo de préstamos: en cheques quien se consulta es el librador, que no es quien
pide.

**No se descuentan cheques propios**: si el CUIT del librador y el del endosatario coinciden, se
rechaza en simulador y precalificación.

## Estado de las integraciones

| Integración | Estado |
|---|---|
| **Google Sheets — tasas** | Activo. `GOOGLE_SHEETS_ID`, pestaña `tasas`. La service account **ya es Editor** acá (lo era sólo Lector hasta el 06/08/2026): se puede escribir por API pidiendo el scope `spreadsheets` en vez de `spreadsheets.readonly`. La app igual lee con el scope de sólo lectura. |
| **Google Sheets — CRM** | Activo. `GOOGLE_SHEETS_CRM_ID`, pestañas `Contacto`, `Precalificacion`, `AltasPF`, `AltasPJ`. Acá la service account **sí es Editor**. Las columnas nuevas se agregan **al final** para no correr las filas ya cargadas: `Precalificacion!Q` = instrumento, `Precalificacion!R` = modalidad, `Precalificacion!S` = monto_aceptado (FCE), `AltasPF!Y` = régimen simplificado, `AltasPJ!AB` = tiene_eecc. Todos los encabezados están escritos y coinciden con el orden de `sheets-crm.ts` (verificado el 06/08/2026); al agregar una columna, escribir también su encabezado. El encabezado de `Precalificacion!S1` (`monto_aceptado`) ya está escrito (19/08/2026). |
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
4. **Feriados hardcodeados** en `lib/fechas.ts`: 2026 y 2027 completos, con los trasladables ya
   corridos según la Ley 27.399. Faltan los **días no laborables con fines turísticos** de 2027
   (se decretan año a año y todavía no salieron) y todo 2028. Mantenimiento anual.
5. **Rate limiting en memoria**: por instancia de lambda, se resetea en cold start. Best-effort, no
   es protección real. La IP de `x-forwarded-for` es spoofeable.
6. **MIME de archivos** según lo declara el cliente, sin verificar magic bytes (aceptable hoy).

## Falta información / a confirmar

Las seis preguntas del cuadro de cheques y de la prenda quedaron **respondidas el 21/08/2026** y
están reflejadas arriba, cada una en su sección.

**De Sailing** (pendiente desde el 31/07/2026, el cliente dijo que pasaría el detalle "en breve"):
1. ¿CBU y Nota EPYME obligatorios? ¿Co-titularidad?
2. ¿La DDJJ de actividad lícita también se pide a personas jurídicas? (en PF ya se pide como adjunto)
