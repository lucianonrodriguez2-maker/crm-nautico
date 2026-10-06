# Arquitectura — motor de coincidencias y carga por WhatsApp

Cómo se conectan las piezas que hacen que **un barco nuevo encuentre solo a sus compradores**,
y cómo Leandro carga unidades desde el celular sin entrar al CRM.

## El flujo completo

```mermaid
flowchart LR
  subgraph Entradas
    WA[WhatsApp del equipo<br/>Cloud API de Meta]
    SIM[Simulador del CRM]
    FORM[Formulario del CRM]
    PREC[Cambio de precio<br/>pantalla o WhatsApp]
    BUS[Alta de búsqueda]
  end
  WA --> N[Núcleo de carga<br/>lib/intake/nucleo.js]
  SIM --> N
  N -->|LISTO| PUB[(embarcacion)]
  FORM --> PUB
  PUB --> E1{{evento<br/>embarcacion.publicada}}
  PREC --> E2{{evento<br/>embarcacion.precio_bajado}}
  BUS --> E3{{evento<br/>busqueda.creada}}
  E1 & E2 & E3 --> M[Motor de coincidencias<br/>lib/matching.js · evaluar]
  M --> P[(propuesta<br/>pendiente)]
  P --> AV[Aviso al operador<br/>"le sirve a 1) 2) 3)"]
  AV -->|"responde 1 3"| AP[Aprobación<br/>lib/propuestas.js]
  P -->|botón en el CRM| AP
  AP --> ENV[Envío al cliente<br/>Prometheo · ventana 24 hs]
```

**La regla de oro se mantiene:** ningún mensaje a un cliente sale sin que una persona lo apruebe.
Lo nuevo es que esa aprobación también se puede dar respondiendo con números por WhatsApp.

## Piezas

| Archivo | Qué hace |
|---|---|
| `lib/matching.js` | **Una sola función `evaluar(búsqueda, barco)`** usada en los dos sentidos (barco→compradores y búsqueda→barcos). Filtros duros, puntaje con desglose (`factores`), "casi" por precio y umbrales para negociar. |
| `lib/eventos.js` | Eventos del dominio con registro en la tabla `evento`. Cada hecho se emite una vez, venga de donde venga, y los handlers reaccionan. Lo que quede sin procesar se reprocesa al arrancar. |
| `lib/automatizaciones.js` | Qué pasa ante cada evento: matching + aviso al operador. |
| `lib/propuestas.js` | Aprobar / descartar / ventana de 24 hs. Lo usan la pantalla y WhatsApp por igual. |
| `lib/intake/nucleo.js` | La conversación de carga: borrador → completar → LISTO → publicar; cambios de precio; ventas; respuestas con números. No sabe por qué canal llegó el mensaje. |
| `lib/intake/extraccion-embarcacion.js` | Texto (y fotos) → ficha estructurada. Claude con visión si hay `ANTHROPIC_API_KEY`; parser determinístico si no. No completa datos "típicos": lo que no se dijo, se pregunta. |
| `lib/intake/whatsapp-cloud.js` | Adaptador de Meta: verificación del webhook, firma `X-Hub-Signature-256`, descarga de fotos, envío. Sin credenciales corre en DRY-RUN. |
| `lib/intake/canales.js` · `avisos.js` · `fotos.js` | Registro de mensajes por canal, avisos "le sirve a N" con contexto para responder con números, guardado de fotos. |

## Reglas del motor (ajustables en la tabla `config`, sin tocar código)

| Clave | Valor | Para qué |
|---|---|---|
| `matching.tolerancia_precio` | 0.15 | Se acepta hasta 15 % sobre el presupuesto (la gente estira por el barco correcto). |
| `matching.tolerancia_casi` | 0.30 | Entre 15 % y 30 % arriba: "casi entra" → aparece en el bloque para negociar con el dueño. |
| `matching.piso_presupuesto` | 0.60 | Muy por debajo del presupuesto mínimo = otra categoría de barco. |
| `matching.puntaje_minimo` | 25 | Piso para proponer barcos desde una búsqueda nueva. |

Decisiones que no se pierden de vista:
- **Idempotente**: nunca duplica una propuesta pendiente ni vuelve a proponer lo que Leandro descartó.
- **Baja de precio veraz**: distingue quién *entra gracias a la baja*, a quién *ya se le ofreció* (le llega el aviso de baja) y quién *ya calificaba y nunca se le ofreció*.
- **El precio mínimo del dueño es privado**: nunca aparece en un mensaje; si un precio nuevo queda por debajo, avisa (no lo cambia solo).
- **El borrador está protegido**: si con una carga en curso llega una novedad de *otra* lancha, se procesa aparte y no pisa los datos.

## Carga por WhatsApp — qué entiende

| Leandro escribe | Pasa |
|---|---|
| Fotos + "Quicksilver 1800 del 2017, Mercury 115, 400 hs, con trailer, pide 23.500, acepta 22. Dueño Juan Pérez 11…" | Borrador con todo eso; pide lo que falta (tipo, año…). |
| "es open" / "no, el precio es 24.000" / más fotos | Completa o corrige el borrador y avisa qué cambió. |
| `LISTO` | Publica, dispara el matching y contesta a quién le sirve. |
| `1 3` · `TODOS` · `NINGUNO` | Aprueba/descarta esas propuestas y se envían. |
| "la Klase A 2400 bajó a 52 lucas" | Nuevo precio + re-matching + aviso a los ya ofrecidos. |
| "se vendió la Prinz 630" | Sale del inventario y se retiran las propuestas sin enviar. |
| Un audio | Pide que lo mande escrito (Meta entrega el archivo, no la transcripción). |
| Cualquier número no habilitado | Se ignora. |

## Qué falta para usarlo con el WhatsApp real

Todo el código está hecho y probado (`npm test`). Lo único que no se puede hacer sin el cliente:

1. **Un número de WhatsApp para el equipo**, distinto del de atención al público (ese lo maneja Prometheo, y en la Cloud API cada número manda su webhook a un solo destino).
2. **App en Meta for Developers** con ese número → variables `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN` y registrar el webhook `https://<dominio>/webhooks/whatsapp`.
3. **`OPERADORES_WHATSAPP`** con los celulares habilitados para cargar (ej. `+549…:Leandro`).
4. **`ANTHROPIC_API_KEY`** en el hosting, para que la IA lea mensajes libres y fotos (sin ella anda el parser, más limitado).
5. Para producción: guardar las fotos en un bucket (hoy van al disco del servidor) y una plantilla de Meta para los avisos que salen cuando el operador no escribió en las últimas 24 hs.

## Tests

`npm test` — 23 casos: reglas del motor, idempotencia, bajas de precio, umbrales, privacidad del mínimo,
la conversación completa de carga, protección del borrador, firma y parseo del webhook de Meta.
