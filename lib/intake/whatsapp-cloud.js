// Adaptador de WhatsApp Cloud API (Meta) para la carga de unidades.
//
// Número dedicado del equipo (no el de atención al público que maneja Prometheo): en Cloud API
// cada número rutea su webhook a UN destino, así que compartirlo con Prometheo no es posible.
// Mismo criterio que el bot de liquidaciones de Baum.
//
// Variables de entorno (sin WA_TOKEN/WA_PHONE_NUMBER_ID corre en DRY-RUN: loguea en vez de enviar):
//   WA_TOKEN            token de acceso (usuario del sistema del Business Manager)
//   WA_PHONE_NUMBER_ID  id del número en Meta (no el número en sí)
//   WA_VERIFY_TOKEN     texto que se elige al registrar el webhook en Meta
//   WA_APP_SECRET       secreto de la app: valida la firma X-Hub-Signature-256 de cada POST
//   WA_GRAPH_VERSION    versión de la Graph API (por defecto v23.0 — confirmar la vigente en Meta)
//   OPERADORES_WHATSAPP "+5491100000000:Leandro,+5491100000001:Juan" — quiénes pueden cargar
//
// Límite de Meta a tener en cuenta: el sistema solo puede escribirle texto libre a un operador
// dentro de las 24 hs de su último mensaje. Los avisos que nacen del CRM (p. ej. un barco cargado
// desde la pantalla) a un operador que no escribió hoy necesitan una plantilla aprobada; si el
// envío falla, el aviso igual queda en el CRM.
const crypto = require('crypto');
const { db, now, normalizarTelefono } = require('../../db');
const canales = require('./canales');
const nucleo = require('./nucleo');

const cfg = () => ({
  token: process.env.WA_TOKEN || '',
  phoneNumberId: process.env.WA_PHONE_NUMBER_ID || '',
  verifyToken: process.env.WA_VERIFY_TOKEN || '',
  appSecret: process.env.WA_APP_SECRET || '',
  version: process.env.WA_GRAPH_VERSION || 'v23.0',
});
const dryRun = () => !cfg().token || !cfg().phoneNumberId;
const graph = (ruta) => `https://graph.facebook.com/${cfg().version}/${ruta}`;

/** Firma de Meta: 'sha256=' + HMAC-SHA256(app secret, body crudo). */
function firmaValida(rawBody, header, appSecret) {
  if (!rawBody || !header || !appSecret) return false;
  const esperada = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(esperada), b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Saca los mensajes de un webhook de Meta en una forma neutral. Ignora estados de entrega. */
function extraerMensajes(body, phoneNumberId = '') {
  const out = [];
  for (const entry of (body && body.entry) || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      if (phoneNumberId && v.metadata && v.metadata.phone_number_id && v.metadata.phone_number_id !== phoneNumberId) continue;
      for (const m of v.messages || []) {
        const msg = { id: m.id, from: m.from, tipo: m.type, texto: '', mediaId: null, mime: null };
        if (m.type === 'text') msg.texto = (m.text && m.text.body) || '';
        else if (m.type === 'image') { msg.mediaId = m.image.id; msg.mime = m.image.mime_type; msg.texto = m.image.caption || ''; }
        else if (m.type === 'document' && /^image\//.test((m.document || {}).mime_type || '')) {
          msg.tipo = 'image'; msg.mediaId = m.document.id; msg.mime = m.document.mime_type; msg.texto = m.document.caption || '';
        }
        else if (m.type === 'audio') { msg.mediaId = m.audio.id; msg.mime = m.audio.mime_type; }
        else if (m.type === 'interactive') {
          const i = m.interactive || {};
          msg.texto = (i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || '';
        } else if (m.type === 'button') msg.texto = (m.button && m.button.text) || '';
        out.push(msg);
      }
    }
  }
  return out;
}

async function descargarMedia(mediaId) {
  const { token } = cfg();
  const meta = await fetch(graph(mediaId), { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
  if (!meta.url) throw new Error('Meta no devolvió la URL del archivo');
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`descarga ${res.status}`);
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: meta.mime_type };
}

async function enviarTexto(telefono, texto) {
  const to = String(telefono).replace(/[^\d]/g, '');
  if (dryRun()) { console.log(`[whatsapp DRY-RUN] → ${to}: ${texto.slice(0, 120).replace(/\n/g, ' ⏎ ')}${texto.length > 120 ? '…' : ''}`); return; }
  const res = await fetch(graph(`${cfg().phoneNumberId}/messages`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg().token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: texto.slice(0, 4096), preview_url: false } }),
  });
  if (!res.ok) throw new Error(`Meta respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function procesarWebhook(body) {
  for (const m of extraerMensajes(body, cfg().phoneNumberId)) {
    const medios = [];
    if (m.tipo === 'image' && m.mediaId) {
      try { const f = await descargarMedia(m.mediaId); medios.push({ tipo: 'imagen', buffer: f.buffer, mime: f.mime || m.mime }); }
      catch (e) { console.error('[whatsapp] no se pudo bajar la foto:', e.message); }
    }
    if (m.tipo === 'audio') medios.push({ tipo: 'audio', mime: m.mime });
    await nucleo.procesarMensaje({ canal: 'whatsapp', operadorTel: '+' + m.from, texto: m.texto, medios, externoId: m.id });
  }
}

function montar(app) {
  // Registro del webhook en Meta: responde el challenge si el token coincide
  app.get('/webhooks/whatsapp', (req, res) => {
    const q = req.query;
    if (q['hub.mode'] === 'subscribe' && cfg().verifyToken && q['hub.verify_token'] === cfg().verifyToken) return res.status(200).send(q['hub.challenge']);
    res.sendStatus(403);
  });
  app.post('/webhooks/whatsapp', (req, res) => {
    const { appSecret } = cfg();
    if (appSecret && !firmaValida(req.rawBody, req.get('x-hub-signature-256'), appSecret)) {
      console.warn('[whatsapp] webhook con firma inválida: rechazado');
      return res.sendStatus(401);
    }
    if (!appSecret && !dryRun()) console.warn('[whatsapp] WA_APP_SECRET sin configurar: no se valida la firma');
    res.sendStatus(200); // Meta exige respuesta rápida; se procesa después
    procesarWebhook(req.body).catch(e => console.error('[whatsapp] error procesando webhook:', e));
  });
}

/** Al arrancar: registra el canal y da de alta los operadores de OPERADORES_WHATSAPP. */
function iniciar() {
  canales.registrarCanal('whatsapp', enviarTexto);
  const lista = String(process.env.OPERADORES_WHATSAPP || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const item of lista) {
    const [telefono, ...nombre] = item.split(':');
    const tel = normalizarTelefono(telefono);
    if (!tel) continue;
    db.prepare(`INSERT INTO operador (telefono, nombre, activo, creado_en) VALUES (?,?,1,?)
      ON CONFLICT(telefono) DO UPDATE SET nombre = excluded.nombre, activo = 1`).run(tel, nombre.join(':') || 'Operador', now());
  }
  console.log(`[whatsapp] canal de carga ${dryRun() ? 'en DRY-RUN (faltan WA_TOKEN / WA_PHONE_NUMBER_ID)' : 'activo'}${lista.length ? ` · ${lista.length} operador(es) habilitado(s)` : ''}`);
}

module.exports = { montar, iniciar, firmaValida, extraerMensajes, enviarTexto };
