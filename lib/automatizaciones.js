// Reacciones a los eventos del dominio. Se registran una vez al arrancar el server.
//
//   embarcacion.publicada     → propuestas (matching) → aviso al operador
//   embarcacion.precio_bajado → re-matching (nuevos + "bajó de precio" a los ya ofrecidos) → aviso
//   busqueda.creada/reabierta → propuestas con lo que ya hay en stock
//
// Si el evento vino de la carga por WhatsApp (datos.respondeIntake), el aviso lo arma el
// núcleo dentro de su propia respuesta, para que llegue DESPUÉS del "✅ publicada".
// Si vino de la pantalla u otra vía, el aviso sale acá, al operador principal.
const { db } = require('../db');
const eventos = require('./eventos');
const { generarPropuestas, generarPropuestasParaBusqueda, analizarEmbarcacion } = require('./matching');
const avisos = require('./intake/avisos');
const canales = require('./intake/canales');

/** A quién se avisa cuando no hay un operador en la conversación: el primero activo con WhatsApp real, si no el simulador. */
function operadorPrincipal() {
  const real = db.prepare(`SELECT telefono FROM operador WHERE activo = 1 AND telefono NOT LIKE 'sim:%' ORDER BY creado_en LIMIT 1`).get();
  return real ? real.telefono : 'sim:leandro';
}

function avisar(ev, creadas, motivoEvento) {
  if (ev.datos.respondeIntake) return;
  const e = db.prepare('SELECT * FROM embarcacion WHERE id = ?').get(ev.entidad_id);
  if (!e) return;
  const tel = ev.datos.operador_tel || operadorPrincipal();
  const etiqueta = `${e.marca} ${e.modelo} ${e.anio || ''}`.trim();
  const { umbrales } = analizarEmbarcacion(e.id);
  const texto = avisos.avisoPropuestas({ operadorTel: tel, embarcacionId: e.id, etiqueta, creadas, umbrales, motivoEvento });
  const encabezado = motivoEvento === 'alta' ? `📥 Entró al inventario: ${etiqueta} — USD ${Number(e.precio_pedido).toLocaleString('es-AR')}.\n` : '';
  canales.responder({ operadorTel: tel, canal: canales.canalPreferido(tel), textos: [encabezado + texto] })
    .catch(err => console.error('[automatizaciones] no se pudo avisar:', err.message));
}

function registrar() {
  eventos.on('embarcacion.publicada', 'matching', (ev) => generarPropuestas(ev.entidad_id, { origen: 'alta' }));
  eventos.on('embarcacion.publicada', 'aviso', (ev, previo) => {
    avisar(ev, previo.matching || [], 'alta');
    return { avisado: !ev.datos.respondeIntake };
  });

  eventos.on('embarcacion.precio_bajado', 'matching', (ev) =>
    generarPropuestas(ev.entidad_id, { origen: 'precio_bajado', precioAnterior: ev.datos.precio_anterior }));
  eventos.on('embarcacion.precio_bajado', 'aviso', (ev, previo) => {
    avisar(ev, previo.matching || [], 'precio_bajado');
    return { avisado: !ev.datos.respondeIntake };
  });

  for (const tipo of ['busqueda.creada', 'busqueda.reabierta']) {
    eventos.on(tipo, 'matching', (ev) => generarPropuestasParaBusqueda(ev.entidad_id));
  }

  const n = eventos.reprocesarPendientes();
  if (n) console.log(`[eventos] reprocesados ${n} eventos pendientes`);
}

module.exports = { registrar, operadorPrincipal };
