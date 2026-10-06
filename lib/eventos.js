// Eventos del dominio.
//
// Cada hecho relevante del negocio se emite UNA vez, desde donde ocurra (pantalla, WhatsApp,
// importación, API) y queda registrado en la tabla `evento`. Los handlers reaccionan:
//
//   embarcacion.publicada     → matching contra búsquedas activas + aviso al operador
//   embarcacion.precio_bajado → re-matching: nuevos que ahora entran + aviso de baja a los ya ofrecidos
//   busqueda.creada/reabierta → qué barcos del stock ya le sirven
//
// Por qué así: antes el matching vivía dentro de la ruta POST /api/embarcaciones. Un barco
// cargado por WhatsApp, o un precio que bajaba, no disparaba nada. Ahora la regla es una sola.
//
// Los handlers son idempotentes (generarPropuestas no duplica), así que reprocesar un evento
// que quedó a medias al reiniciar es seguro: ver reprocesarPendientes().
const { db, uid, now } = require('../db');

const handlers = new Map(); // tipo → [{ nombre, fn }]

function on(tipo, nombre, fn) {
  if (!handlers.has(tipo)) handlers.set(tipo, []);
  handlers.get(tipo).push({ nombre, fn });
}

function procesar(evento) {
  const resultado = {};
  const errores = [];
  for (const { nombre, fn } of handlers.get(evento.tipo) || []) {
    try {
      // cada handler ve lo que hicieron los anteriores (el aviso usa lo que creó el matching)
      resultado[nombre] = fn({ ...evento, datos: evento.datos ? JSON.parse(evento.datos) : {} }, resultado) ?? null;
    } catch (e) {
      errores.push(`${nombre}: ${e.message}`);
      console.error(`[eventos] ${evento.tipo} → ${nombre} falló:`, e);
    }
  }
  db.prepare('UPDATE evento SET procesado_en = ?, resultado = ?, error = ? WHERE id = ?')
    .run(now(), JSON.stringify(resultado), errores.length ? errores.join(' · ') : null, evento.id);
  return { resultado, errores };
}

/**
 * Registra el hecho y lo procesa en el momento (los handlers son operaciones de base locales).
 * @returns {{ id, resultado, errores }}
 */
function emitir(tipo, entidadId, datos = {}) {
  const id = uid();
  db.prepare('INSERT INTO evento (id, tipo, entidad_id, datos, creado_en) VALUES (?,?,?,?,?)')
    .run(id, tipo, entidadId, JSON.stringify(datos), now());
  const ev = db.prepare('SELECT * FROM evento WHERE id = ?').get(id);
  return { id, ...procesar(ev) };
}

/** Al arrancar: procesa lo que haya quedado sin procesar (p. ej. el server se cayó a mitad). */
function reprocesarPendientes() {
  const pendientes = db.prepare('SELECT * FROM evento WHERE procesado_en IS NULL ORDER BY creado_en').all();
  for (const ev of pendientes) procesar(ev);
  return pendientes.length;
}

function recientes(limite = 20) {
  return db.prepare('SELECT * FROM evento ORDER BY creado_en DESC LIMIT ?').all(limite)
    .map(e => ({ ...e, datos: JSON.parse(e.datos || '{}'), resultado: JSON.parse(e.resultado || '{}') }));
}

module.exports = { on, emitir, reprocesarPendientes, recientes };
