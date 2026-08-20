# CRM Náutico — demo

Demo pre-venta del CRM para **Leandro Ramos Broker Náutico** (San Fernando, Buenos Aires).
Compra-venta de embarcaciones usadas en el Delta/Tigre.

## Correr en local

```bash
npm install
node seed.js      # datos de demo (se puede repetir para dejar todo como nuevo)
node server.js    # http://localhost:3411
```

El tasador público está en `/tasador`.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `ANTHROPIC_API_KEY` | Extracción de búsquedas desde texto libre con IA. Sin key la demo funciona igual, con un parser básico. |
| `PORT` | Puerto del servidor (default 3411). |

## Qué hay adentro

- **Búsquedas** — la demanda ordenada por presupuesto, con las lanchas del stock que le encajan a cada persona y cuáles ya se le ofrecieron.
- **Inventario** — stock con días en stock y consultas por barco.
- **Hoy · Agenda** — escalera náutica (ex-clientes por dar el salto), matchings pendientes de aprobación, seguimientos y la agenda sincronizada con Google Calendar.
- **Personas** — ficha con línea de tiempo de sus embarcaciones (qué compró, cuándo, a cuánto), ciclo propio de recambio e historial de conversaciones de todos los canales.
- **Radar ML/FB** — avisos de MercadoLibre y Marketplace, con alerta cuando alguien baja el precio (oportunidad de captación).
- **Tasador** — valuación pública que captura el lead y deja el WhatsApp redactado.

## Estado

Demo para la reunión de venta. Las integraciones con Prometheo y Google Calendar están detrás de
adaptadores (`lib/prometheo.js`, `lib/gcal.js`): hoy son mocks y en producción se reemplaza el archivo.
Los datos son ficticios; las embarcaciones del inventario y los avisos del radar usan fotos y links
reales del mercado.
