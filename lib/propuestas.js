// Propuestas del motor de coincidencias: aprobación humana y envío.
//
// Una propuesta = "a esta persona le sirve este barco, con este mensaje". NUNCA sale sola (§4.1):
// alguien la aprueba — desde la pantalla del CRM o respondiendo "1 3" por WhatsApp. Las dos
// puertas llaman a estas mismas funciones, así que las reglas son idénticas.
const { db, uid, now, auditar } = require('../db');
const prometheo = require('./prometheo');

const horas = (iso) => (Date.now() - new Date(iso).getTime()) / 36e5;

/**
 * Ventana de 24 hs de WhatsApp (§1.bis regla 7): dentro de la ventana sale texto libre; fuera,
 * plantilla aprobada por Meta. La API de Prometheo NO cambia sola de modo — elige quien llama
 * (respuesta oficial, PROMETHEO-API.md §6). Leandro nunca necesita saber que esta regla existe.
 */
function modoEnvio(personaId) {
  const ultimo = db.prepare(`
    SELECT m.timestamp FROM mensaje m JOIN conversacion c ON c.id = m.conversacion_id
    WHERE c.persona_id = ? AND m.direccion = 'entrante' AND c.canal = 'whatsapp'
    ORDER BY m.timestamp DESC LIMIT 1`).get(personaId);
  if (ultimo && horas(ultimo.timestamp) < 24) return { modo: 'texto libre', detalle: 'ventana de 24 hs activa' };
  return { modo: 'plantilla', detalle: 'fuera de ventana — sale como plantilla match_inventario aprobada por Meta' };
}

function envioPrevisto(p) {
  return p.via === 'whatsapp'
    ? modoEnvio(p.persona_id)
    : { modo: 'copy-paste', detalle: 'sin teléfono: queda como tarea en la bandeja de Prometheo' };
}

/** Aprueba y envía. `autor` queda en la auditoría (leandro · operador por WhatsApp). */
function aprobarPropuesta(propuestaId, { mensaje = null, autor = 'leandro' } = {}) {
  const pr = db.prepare('SELECT * FROM propuesta WHERE id = ?').get(propuestaId);
  if (!pr) throw Object.assign(new Error('La propuesta no existe'), { status: 404 });
  if (pr.estado !== 'pendiente') throw Object.assign(new Error(`La propuesta ya está ${pr.estado}`), { status: 409 });

  const contenido = mensaje || pr.mensaje_borrador;
  const editada = contenido !== pr.mensaje_borrador;
  const persona = db.prepare('SELECT * FROM persona WHERE id = ?').get(pr.persona_id);
  if (persona.no_contactar) throw Object.assign(new Error(`${persona.nombre} pidió no ser contactado`), { status: 409 });

  let envio;
  if (pr.via === 'whatsapp') {
    envio = modoEnvio(pr.persona_id);
    prometheo.enviarWhatsApp(persona.telefono, contenido, envio.modo);
    let conv = db.prepare(`SELECT id FROM conversacion WHERE persona_id = ? AND canal = 'whatsapp' ORDER BY ultima_actividad DESC LIMIT 1`).get(pr.persona_id);
    if (!conv) {
      const cid = uid();
      db.prepare(`INSERT INTO conversacion (id,persona_id,canal,estado,embarcacion_referida_id,ultima_actividad) VALUES (?,?,?,?,?,?)`)
        .run(cid, pr.persona_id, 'whatsapp', 'esperando respuesta de él', pr.embarcacion_id, now());
      conv = { id: cid };
    }
    db.prepare(`INSERT INTO mensaje (id,conversacion_id,direccion,contenido,timestamp,autor) VALUES (?,?,?,?,?,?)`)
      .run(uid(), conv.id, 'saliente', contenido, now(), 'leandro');
    db.prepare(`UPDATE conversacion SET ultima_actividad = ?, estado = 'esperando respuesta de él' WHERE id = ?`).run(now(), conv.id);
  } else {
    envio = { modo: 'copy-paste', detalle: 'tarea generada: pegar el mensaje en la bandeja de Prometheo (Instagram)' };
  }
  db.prepare(`UPDATE propuesta SET estado = ?, resuelta_en = ? WHERE id = ?`).run(editada ? 'editada-y-aprobada' : 'aprobada', now(), pr.id);
  auditar(pr.persona_id, 'mensaje de matching aprobado', `vía ${pr.via} · ${envio.modo}`, autor);
  return { ok: true, envio, persona: persona.nombre };
}

function descartarPropuesta(propuestaId, { autor = 'leandro' } = {}) {
  const pr = db.prepare('SELECT * FROM propuesta WHERE id = ?').get(propuestaId);
  if (!pr) throw Object.assign(new Error('La propuesta no existe'), { status: 404 });
  if (pr.estado !== 'pendiente') return { ok: true, yaResuelta: true };
  db.prepare(`UPDATE propuesta SET estado = 'descartada', resuelta_en = ? WHERE id = ?`).run(now(), pr.id);
  auditar(pr.persona_id, 'propuesta de matching descartada', null, autor);
  return { ok: true };
}

module.exports = { modoEnvio, envioPrevisto, aprobarPropuesta, descartarPropuesta };
