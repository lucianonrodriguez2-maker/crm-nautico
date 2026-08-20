// Adapter de Google Calendar (§7.5). En demo es un mock; en producción se reemplaza
// este archivo por el conector real (Google Calendar API v3, OAuth de la cuenta de Leandro)
// sin tocar el resto del sistema. Misma filosofía que el adapter de Prometheo.

let contador = 0;

// En producción: POST /calendars/primary/events → devuelve el id real del evento.
function crearEvento({ titulo, fecha, notas }) {
  contador += 1;
  const id = 'gcal_demo_' + Date.now().toString(36) + '_' + contador;
  console.log(`[gcal-mock] evento creado en Google Calendar: "${titulo}" ${fecha}`);
  return { ok: true, mock: true, event_id: id };
}

// En producción: DELETE /calendars/primary/events/{id}
function borrarEvento(eventId) {
  console.log(`[gcal-mock] evento borrado de Google Calendar: ${eventId}`);
  return { ok: true, mock: true };
}

module.exports = { crearEvento, borrarEvento };
