# Plan técnico — Cotización de cheques en lote con lectura automática

Estado: **pasos 1 a 6 implementados** el 21/08/2026. Queda el paso 7, que necesita archivos
reales del cliente. Escrito el 21/08/2026.

## 1. El problema

Hoy el simulador cotiza **un cheque por vez**. Cuando un cliente manda diez, el equipo los carga
uno por uno en su Excel copiando a mano desde un PDF, una captura de home banking o —peor— una foto
de un cheque físico. Copiar importes a ojo produce errores, y los errores en el importe cuestan
plata.

Lo que se pide: arrastrar los archivos, que el sistema lea los cheques, los pase a una tabla
editable, cotice todo junto y dé un total.

## 2. Alcance

**Entra**

- Página interna con carga de archivos por arrastre o selector, y tabla de cheques.
- Lectura automática de PDF (texto), PDF escaneado e imágenes (fotos y capturas).
- Tabla editable: se corrige cualquier campo antes de cotizar.
- Cotización del lote reusando el cálculo actual, con totales al pie.
- Exportar a Excel (copiar al portapapeles / CSV).

**No entra por ahora**

- Escribir directo en la planilla de Google del cliente. Se evalúa después, cuando confíen en la
  lectura; sacarle el paso de revisión ahora anula el beneficio de la función.
- Guardar los archivos leídos. Se leen y se descartan: no son un legajo, y no guardarlos reduce la
  exposición de datos personales.
- Versión pública. Es una herramienta operativa del equipo.

## 3. Dónde vive

- Página: **`app/lote/page.tsx`** → ruta `/lote`.
- `noindex`, sin enlace en el menú, misma postura que `/legajos`. Cuando se le ponga contraseña a
  `/legajos`, esta va en el mismo lote (expone datos de clientes).
- Endpoints nuevos:
  - `POST /api/lote/leer` — recibe **un archivo** y devuelve los cheques que encontró.
  - `POST /api/lote/cotizar` — recibe las filas ya revisadas y devuelve la cotización + totales.

Se manda **un archivo por request** para no acercarse nunca al límite de 4,5MB de Vercel; el
navegador los envía en secuencia y va mostrando las filas a medida que llegan. Las imágenes se
comprimen antes con `comprimirImagen()` de `lib/adjuntos-client.ts`, que ya existe y está probado.

## 4. Pipeline de lectura

Tres caminos, del más barato y exacto al más caro e incierto. Cada archivo entra por el primero que
le corresponde:

| Entrada | Cómo se lee | Costo | Datos a terceros |
|---|---|---|---|
| **CSV / Excel del banco** | parseo directo | 0 | no |
| **PDF con capa de texto** | extracción de texto en el servidor + patrones | 0 | no |
| **Imagen o PDF escaneado** | modelo multimodal (Gemini) | tier gratuito | **sí** |

La detección es automática: se intenta extraer texto del PDF y, si viene vacío o con basura, se cae
al modelo. El usuario no elige nada.

### Interfaz común

Todo el pipeline queda detrás de una sola función, en **`lib/lector-cheques.ts`**:

```ts
export type ChequeLeido = {
  nominal: number | null;
  fecha_pago: string | null;      // YYYY-MM-DD
  cuit_librador: string | null;
  banco: string | null;
  numero: string | null;          // número de cheque, para detectar repetidos
  // Lo que el modelo leyó del importe en letras, ya convertido a número, para
  // cotejarlo contra el de los dígitos. null si el documento no lo tiene.
  nominal_en_letras: number | null;
  origen: string;                 // nombre del archivo, para ubicar la fila
};

export async function leerCheques(archivo: ArchivoEntrada): Promise<ChequeLeido[]>;
```

Cambiar de proveedor (Gemini gratis → pago → otro) es tocar **este archivo y ninguno más**. La UI
nunca sabe de dónde salieron los datos.

### Sobre Gemini

- Variable `GEMINI_API_KEY`. **Si falta, `/api/lote/leer` devuelve 503** y la tabla sigue
  funcionando con carga manual — mismo patrón que el bucket de adjuntos.
- Modelo de la familia *flash* (rápido y barato; la tarea es lectura, no razonamiento).
- Se le pide **JSON estructurado** con los campos de `ChequeLeido`, y que devuelva `null` en lo que
  no pueda leer en vez de inventar. Un campo vacío es corregible; uno inventado es un error
  silencioso.
- Un cheque físico es un documento estandarizado: importe en números, importe en letras, fecha de
  pago, CUIT del librador, banco y número. El prompt describe esa estructura.

## 5. Confianza por fila

El objetivo no es "revisá las diez filas por las dudas" —eso nadie lo hace— sino **señalar las filas
que probablemente estén mal**. Cuatro chequeos, todos con código que ya existe:

1. **CUIT**: dígito verificador con `esCuitValido()` de `lib/cuit.ts`. Atrapa casi cualquier dígito
   mal leído.
2. **Importe en letras contra importe en números**: si difieren, la fila se marca. Es la ventaja del
   cheque físico, que trae el dato dos veces. (Si el modelo lee mal los dos de la misma forma, no se
   detecta; es el límite del método.)
3. **Fecha de pago**: tiene que ser futura y razonable (no más de ~360 días).
4. **Repetidos**: misma combinación de banco + número (o de CUIT + importe + fecha) en dos filas →
   se avisa, por si arrastró dos veces el mismo archivo.

Cada fila queda en uno de tres estados: **leída y verificada**, **leída, revisar** (con el campo
sospechoso resaltado) o **incompleta** (falta un dato obligatorio). No se puede cotizar con filas
incompletas.

⚠️ El CUIT del librador **puede no venir** en una captura de home banking, que a veces muestra sólo
la razón social. Esa fila queda incompleta y sin consulta al BCRA hasta que se complete a mano.

## 6. Cotización del lote

Reusa lo que ya está, sin lógica nueva de negocio: `simularCheques()` corre una vez por fila.

**Datos del lote** (una sola vez, arriba de la tabla): modalidad, instrumento, condición del vendedor
frente al IVA, fecha de concertación y CUIT del endosatario. El vendedor es uno solo para todo el
lote.

**Datos de la fila**: nominal, fecha de pago, CUIT del librador, banco.

**Totales al pie**, replicando la planilla *compra CPD PESOS*, que ya tiene esta forma exacta
(filas 7 a 12 más la fila TOTAL):

- Total capital negociado (suma de nominales)
- Total a cobrar el cliente (suma de netos del vendedor)
- Total a pagar el comprador (sólo en cuenta comitente)
- Descuento total y costo total en %

**BCRA**: se consulta una vez por CUIT distinto, no una vez por fila (diez cheques del mismo
librador = una consulta). **Una situación mala no bloquea el lote**: marca esa fila en rojo y el
resto se cotiza igual. Bloquear diez cheques por uno sería absurdo, y hoy el simulador bloquea
porque cotiza de a uno.

**Archivos**:

- `lib/lote.ts` — arma la cotización del lote y los totales. Función pura, testeable.
- `app/api/lote/cotizar/route.ts` — lee tasas una sola vez, dedupe de BCRA, devuelve filas + totales.

## 7. Pasos de implementación

Cada paso deja algo que funciona y se puede probar solo.

### Paso 1 — Cálculo del lote ✅

- `types/index.ts`: `FilaLote`, `LoteInput`, `LoteOutput` (filas cotizadas + totales).
- `lib/lote.ts`: `cotizarLote(input, tasas, ahora)` — corre `simularCheques()` por fila y suma.
- `tests/lote.test.ts`: reproducir las **tres filas de la planilla compra CPD PESOS** y verificar que
  los totales dan los de la fila TOTAL. Ese es el criterio de aceptación del paso.

### Paso 2 — Endpoint de cotización ✅

- `app/api/lote/cotizar/route.ts`: valida con zod (máximo 50 filas), lee tasas, consulta BCRA por
  CUIT único, devuelve `LoteOutput`. Rate limit propio.
- `lib/validations.ts`: esquema del lote, reusando el del simulador para cada fila.

### Paso 3 — Página con tabla manual ✅

- `app/lote/page.tsx` + `components/forms/LoteForm.tsx`: encabezado con los datos del lote, tabla
  editable, agregar/eliminar filas, totales al pie, botón de copiar para Excel.
- Sin lectura todavía: se tipea. Sirve para dejar probado el cálculo y la UI antes de sumar la parte
  incierta.

### Paso 4 — Lectura de PDF y planillas (sin IA) ✅

- `lib/lector-cheques.ts` con los caminos determinísticos: CSV/Excel y PDF con capa de texto.
- `app/api/lote/leer/route.ts`: recibe el archivo, devuelve `ChequeLeido[]`.
- En la UI: zona de arrastre, envío secuencial, las filas aparecen a medida que llegan.

### Paso 5 — Lectura de imágenes con Gemini ✅

- Se agrega el camino del modelo dentro de `lib/lector-cheques.ts`, detrás de la misma función.
- `GEMINI_API_KEY` en `.env.local`, `.env.example` y Vercel. Sin la clave, 503 y carga manual.
- Prompt con la estructura del cheque y JSON estricto.

### Paso 6 — Confianza y revisión ✅

- Los cuatro chequeos del punto 5, el resaltado por fila y el bloqueo de cotización con filas
  incompletas.

### Paso 7 — Ajuste contra archivos reales ⏳ pendiente

- Probar con los ejemplos que mande el cliente (PDF, captura y foto de cheque físico sacada como la
  sacan de verdad).
- Medir cuántos campos salen bien sobre esos archivos y ajustar el prompt. **Si la lectura sobre sus
  propios documentos es pobre, se dice y se decide ahí**, no después de dos semanas.

## 8. Decisiones que hay que confirmar con el cliente

1. **El arancel mínimo de $500, ¿es por cheque o por boleto?** Con un cheque no se nota; con diez
   chicos son $4.500 de diferencia. La planilla lo calcula por fila.
2. **¿Algún cliente puede exportar el listado de echeq en Excel o CSV desde el banco?** Si existe,
   es lectura exacta y gratis, y vuelve innecesaria la parte de IA para ese cliente.
3. **Mandar imágenes de cheques a un servicio de IA externo**: es documentación de sus clientes.
   Tiene que estar aprobado explícitamente. Los archivos no se guardan, pero pasan por el proveedor.

## 9. Riesgos

- **Un importe mal leído es el error que cuesta plata.** Mitigado con el cruce números/letras y el
  resaltado, no eliminado. La revisión humana no es opcional.
- **Formatos impredecibles**: cada banco muestra los echeq distinto. Por eso el paso 7 va contra
  archivos reales y no contra ejemplos inventados.
- **Dependencia de un tercero**: si Gemini cambia condiciones o límites, se cambia de proveedor
  tocando `lib/lector-cheques.ts`. Los caminos sin IA siguen funcionando igual.
