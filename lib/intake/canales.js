// Canales por los que el operador carga unidades y recibe respuestas.
//   simulador — el chat de prueba dentro del CRM (no envía nada: el CRM lee intake_mensaje)
//   whatsapp  — Cloud API de Meta (lib/intake/whatsapp-cloud.js se registra acá al arrancar)
//   web       — formulario rápido del CRM
// El núcleo no sabe por dónde viaja un mensaje: llama a responder() y el canal se ocupa.
const { db, uid, now } = require('../../db');

const enviadores = new Map(); // canal → async (telefono, texto) => void

function registrarCanal(canal, enviar) { enviadores.set(canal, enviar); }

/** Registra lo que entró. Devuelve false si el proveedor ya lo había mandado (reintento). */
function registrarEntrante({ operadorTel, canal, texto, medios = [], externoId = null, borradorId = null }) {
  try {
    db.prepare(`INSERT INTO intake_mensaje (id, operador_tel, canal, direccion, texto, medios, borrador_id, timestamp, externo_id)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(uid(), operadorTel, canal, 'entrante', texto || null,
      JSON.stringify(medios.map(m => ({ tipo: m.tipo, url: m.url || null }))), borradorId, now(), externoId);
    return true;
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return false;
    throw e;
  }
}

/** Manda las respuestas en orden y las deja registradas. */
async function responder({ operadorTel, canal, textos, borradorId = null }) {
  const enviar = enviadores.get(canal);
  for (const texto of textos.filter(Boolean)) {
    db.prepare(`INSERT INTO intake_mensaje (id, operador_tel, canal, direccion, texto, medios, borrador_id, timestamp)
      VALUES (?,?,?,?,?,?,?,?)`).run(uid(), operadorTel, canal, 'saliente', texto, '[]', borradorId, now());
    if (enviar) {
      try { await enviar(operadorTel, texto); }
      catch (e) { console.error(`[canal ${canal}] no se pudo enviar a ${operadorTel}:`, e.message); }
    }
  }
}

/** Por dónde le hablamos a un operador que no escribió recién: el último canal que usó. */
function canalPreferido(operadorTel) {
  const r = db.prepare(`SELECT canal FROM intake_mensaje WHERE operador_tel = ? AND direccion = 'entrante' ORDER BY timestamp DESC LIMIT 1`).get(operadorTel);
  return r ? r.canal : (operadorTel.startsWith('sim:') ? 'simulador' : 'whatsapp');
}

function conversacion(operadorTel, limite = 80) {
  return db.prepare(`SELECT * FROM (SELECT *, rowid AS orden FROM intake_mensaje WHERE operador_tel = ? ORDER BY timestamp DESC, rowid DESC LIMIT ?) ORDER BY timestamp, orden`)
    .all(operadorTel, limite).map(m => ({ ...m, medios: JSON.parse(m.medios || '[]') }));
}

module.exports = { registrarCanal, registrarEntrante, responder, canalPreferido, conversacion };
