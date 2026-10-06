const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { db } = require('./helpers');
process.env.WA_APP_SECRET = 'secreto-de-prueba';
process.env.WA_VERIFY_TOKEN = 'token-verif';
process.env.OPERADORES_WHATSAPP = '+5491112345678:Leandro';
const wa = require('../lib/intake/whatsapp-cloud');

// Forma documentada del webhook de mensajes de WhatsApp Cloud API
const payload = (mensajes) => ({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
  messaging_product: 'whatsapp', metadata: { display_phone_number: '5491100000000', phone_number_id: 'PNID' },
  contacts: [{ profile: { name: 'Leandro' }, wa_id: '5491112345678' }], messages: mensajes } }] }] });

test('firma: válida con el secreto correcto, inválida si cambia el body o el secreto', () => {
  const body = Buffer.from(JSON.stringify({ a: 1 }));
  const firma = 'sha256=' + crypto.createHmac('sha256', 'secreto-de-prueba').update(body).digest('hex');
  assert.equal(wa.firmaValida(body, firma, 'secreto-de-prueba'), true);
  assert.equal(wa.firmaValida(Buffer.from('{"a":2}'), firma, 'secreto-de-prueba'), false);
  assert.equal(wa.firmaValida(body, firma, 'otro'), false);
  assert.equal(wa.firmaValida(body, undefined, 'secreto-de-prueba'), false);
});

test('parseo: texto, foto con caption, audio; ignora otro phone_number_id y estados', () => {
  const p = payload([
    { from: '5491112345678', id: 'w1', type: 'text', text: { body: 'hola' } },
    { from: '5491112345678', id: 'w2', type: 'image', image: { id: 'MEDIA1', mime_type: 'image/jpeg', caption: 'Quicksilver 1800' } },
    { from: '5491112345678', id: 'w3', type: 'audio', audio: { id: 'MEDIA2', mime_type: 'audio/ogg' } },
  ]);
  const m = wa.extraerMensajes(p, 'PNID');
  assert.deepEqual(m.map(x => [x.id, x.tipo, x.texto, x.mediaId]), [
    ['w1', 'text', 'hola', null], ['w2', 'image', 'Quicksilver 1800', 'MEDIA1'], ['w3', 'audio', '', 'MEDIA2']]);
  assert.equal(wa.extraerMensajes(p, 'OTRO').length, 0);
  assert.equal(wa.extraerMensajes({ entry: [{ changes: [{ value: { statuses: [{ id: 'x', status: 'read' }] } }] }] }).length, 0);
});

test('webhook por HTTP: verificación, firma inválida rechazada, mensaje procesado en DRY-RUN', async () => {
  const express = require('express');
  const app = express();
  app.use(express.json({ verify: (req, _r, buf) => { req.rawBody = buf; } }));
  wa.montar(app);
  wa.iniciar();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const v = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=token-verif&hub.challenge=4242`);
    assert.equal(await v.text(), '4242');
    assert.equal((await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=mal&hub.challenge=1`)).status, 403);

    const body = JSON.stringify(payload([{ from: '5491112345678', id: 'wamid.HTTP1', type: 'text', text: { body: 'ayuda' } }]));
    const mala = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=00' }, body });
    assert.equal(mala.status, 401);

    const firma = 'sha256=' + crypto.createHmac('sha256', 'secreto-de-prueba').update(body).digest('hex');
    const ok = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': firma }, body });
    assert.equal(ok.status, 200);
    await new Promise(r => setTimeout(r, 150));
    const salientes = db.prepare(`SELECT texto FROM intake_mensaje WHERE operador_tel = '+5491112345678' AND direccion = 'saliente'`).all();
    assert.ok(salientes.length === 1 && /asistente de carga/.test(salientes[0].texto), 'respondió la ayuda al operador habilitado');
  } finally { server.close(); }
});
