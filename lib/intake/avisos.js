// Avisos al operador sobre lo que encontró el motor de coincidencias, y el "contexto" que
// permite contestar con números ("1 3", "todos", "ninguno") sin entrar al CRM.
const { db, now } = require('../../db');

const usd = (n) => 'USD ' + Number(n).toLocaleString('es-AR');
const VIGENCIA_HORAS = 24;

function guardarContexto(operadorTel, tipo, datos) {
  db.prepare(`INSERT INTO operador_contexto (operador_tel, tipo, datos, actualizado_en) VALUES (?,?,?,?)
    ON CONFLICT(operador_tel) DO UPDATE SET tipo = excluded.tipo, datos = excluded.datos, actualizado_en = excluded.actualizado_en`)
    .run(operadorTel, tipo, JSON.stringify(datos), now());
}

function leerContexto(operadorTel) {
  const r = db.prepare('SELECT * FROM operador_contexto WHERE operador_tel = ?').get(operadorTel);
  if (!r) return null;
  if ((Date.now() - new Date(r.actualizado_en).getTime()) / 36e5 > VIGENCIA_HORAS) return null;
  return { tipo: r.tipo, datos: JSON.parse(r.datos) };
}

function borrarContexto(operadorTel) {
  db.prepare('DELETE FROM operador_contexto WHERE operador_tel = ?').run(operadorTel);
}

/** Primera oración del motivo, recortada: lo justo para decidir desde el celular. */
function motivoCorto(motivo) {
  const primera = String(motivo || '').split(' — ')[0].replace(/\.$/, '');
  return primera.length > 90 ? primera.slice(0, 87) + '…' : primera;
}

/**
 * Arma el aviso "le sirve a N" para el operador y deja el contexto para que conteste con números.
 * @param etiqueta  "Quicksilver 1800 2017"
 * @param creadas   propuestas recién creadas por generarPropuestas()
 * @param umbrales  "si baja a USD X se suman N" (analizarEmbarcacion().umbrales)
 * @param motivoEvento 'alta' | 'precio_bajado'
 */
function avisoPropuestas({ operadorTel, embarcacionId, etiqueta, creadas, umbrales = [], motivoEvento = 'alta' }) {
  const lineas = [];
  if (!creadas.length) {
    lineas.push(motivoEvento === 'precio_bajado'
      ? `Con el precio nuevo todavía no se suma nadie de las búsquedas activas.`
      : `Por ahora la ${etiqueta} no le sirve a nadie de las búsquedas activas. Queda en el inventario y el sistema avisa cuando entre alguien que la busque.`);
  } else {
    const nuevos = creadas.filter(c => c.entraPorPrecio).length;
    const encabezado = motivoEvento === 'precio_bajado'
      ? `Con el precio nuevo de la ${etiqueta}: ${creadas.length === 1 ? '1 propuesta' : creadas.length + ' propuestas'} para aprobar` +
        (nuevos ? ` (${nuevos === 1 ? '1 entra' : nuevos + ' entran'} gracias a la baja)` : '') + ':'
      : `La ${etiqueta} le sirve a ${creadas.length === 1 ? '1 persona' : creadas.length + ' personas'}:`;
    lineas.push('🎯 ' + encabezado);
    creadas.forEach((c, i) => {
      const nota = [
        c.yaOfrecida ? 'ya se la habías ofrecido: aviso de baja' : null,
        c.entraPorPrecio ? 'entra por la baja' : null,
        motivoEvento === 'precio_bajado' && !c.yaOfrecida && !c.entraPorPrecio ? 'ya le servía y no se le había ofrecido' : null,
        c.via !== 'whatsapp' ? 'sin teléfono: queda para copiar en Instagram' : null,
      ].filter(Boolean).map(n => ` (${n})`).join('');
      lineas.push(`${i + 1}) ${c.nombre} — ${motivoCorto(c.motivo)}${nota}`);
    });
    lineas.push('');
    lineas.push(creadas.length === 1
      ? 'Respondé 1 para enviarle el mensaje, o NINGUNO.'
      : 'Respondé con los números para enviarles el mensaje (ej: 1 3), TODOS o NINGUNO.');
    guardarContexto(operadorTel, 'lista_propuestas', { ids: creadas.map(c => c.id), etiqueta, embarcacionId });
  }
  const proximo = umbrales[0];
  if (proximo) {
    lineas.push(`💡 Si el dueño baja a ${usd(proximo.precio)}, se ${proximo.total === 1 ? 'suma 1 comprador más' : 'suman ' + proximo.total + ' compradores más'}.`);
  }
  return lineas.join('\n');
}

module.exports = { avisoPropuestas, guardarContexto, leerContexto, borrarContexto };
