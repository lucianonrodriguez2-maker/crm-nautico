// Capa de abstracción de la bandeja (§1.bis / §11.4).
// El CRM habla SIEMPRE contra esta interfaz normalizada; hoy la implementa un mock,
// en producción se reemplaza este archivo por el conector real (webhooks + API de Prometheo).
//
// Evento normalizado de mensaje entrante:
//   { contacto: { nombre, telefono, instagram_handle, prometheo_id, canal }, texto, timestamp }

const MENSAJES_SIMULADOS = [
  {
    contacto: { nombre: 'Ramiro Onetto', telefono: '+5491144873362', instagram_handle: null, prometheo_id: 'prm_00461', canal: 'whatsapp' },
    texto: 'Hola, ¿qué tal? Estoy buscando una lancha con baño para hacer noche en el Delta con mi señora y los nenes. Algo de 6 metros para arriba. Tengo hasta 35 lucas verdes y una Tracker 16 del 2014 que entregaría en parte de pago. Lo ideal sería para esta primavera.',
  },
  {
    contacto: { nombre: 'Julieta Ferrari', telefono: '+5491160254478', instagram_handle: '@juli.ferrari', prometheo_id: 'prm_00462', canal: 'instagram' },
    texto: 'Holaa! Vi la publicación de la Eclipse. Con mi novio hacemos wakeboard, queremos algo con torre o mínimo 150 HP, hasta 30 mil dólares. ¿Tenés algo? Lo necesitamos ya porque arranca la temporada 🙌',
  },
  {
    contacto: { nombre: 'Esteban Quiroga', telefono: '+5491152308914', instagram_handle: null, prometheo_id: 'prm_00463', canal: 'whatsapp' },
    texto: '(audio transcripto) Buenas Leandro, te paso mi consulta. Yo pesco en el río abierto, salgo de San Isidro. Quiero un tracker o semirrígido de 5 metros y pico, motor de 90 para arriba, con trailer porque lo guardo en casa. Ando con 20, 22 mil dólares. Sin apuro, pero si aparece algo bueno me avisás.',
  },
];

let cursor = 0;

// Simula la llegada de un webhook message.incoming de Prometheo (firma ya validada).
function simularMensajeEntrante() {
  const evento = MENSAJES_SIMULADOS[cursor % MENSAJES_SIMULADOS.length];
  cursor += 1;
  return { ...evento, timestamp: new Date().toISOString() };
}

// En producción: PATCH /leads/{id} con variables y tags. Acá solo se registra.
function escribirVariablesEnLead(prometheoId, variables) {
  console.log(`[prometheo-mock] PATCH /leads/${prometheoId}`, JSON.stringify(variables));
  return { ok: true, mock: true };
}

// En producción: POST /whatsapp-business/message/{text|template} según ventana de 24 hs.
function enviarWhatsApp(telefono, contenido, modo) {
  console.log(`[prometheo-mock] envío ${modo} a ${telefono}: ${contenido.slice(0, 60)}…`);
  return { ok: true, mock: true, modo };
}

module.exports = { simularMensajeEntrante, escribirVariablesEnLead, enviarWhatsApp };
