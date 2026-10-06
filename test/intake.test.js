const test = require('node:test');
const assert = require('node:assert');
const { db, persona, busqueda, barco } = require('./helpers');
const automatizaciones = require('../lib/automatizaciones');
automatizaciones.registrar();
const { procesarMensaje } = require('../lib/intake/nucleo');

const OP = 'sim:leandro';
const enviar = (texto, extra = {}) => procesarMensaje({ canal: 'simulador', operadorTel: OP, texto, ...extra });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('un número que no es operador se ignora sin contestar', async () => {
  const r = await procesarMensaje({ canal: 'whatsapp', operadorTel: '+5491199999999', texto: 'hola' });
  assert.equal(r.ignorado, true);
  assert.deepEqual(r.respuestas, []);
});

test('alta completa: borrador → falta dato → se completa → LISTO → publicada + matching → "1" envía', async () => {
  const carla = persona({ nombre: 'Carla Domínguez' });
  busqueda(carla.id, { presupuesto_max: 25000, modelo_referencia: 'Quicksilver 1700' });

  let r = await enviar('Entró una Quicksilver 1800 del 2017, Mercury 115 con 400 hs, con trailer. Pide 23.500. Dueño Juan Pérez 11 5555 1234', { medios: [{ tipo: 'imagen', dataUrl: PNG }] });
  assert.match(r.respuestas[0], /Borrador: Quicksilver 1800 2017/);
  assert.match(r.respuestas[0], /me falta: tipo/);
  assert.match(r.respuestas[0], /1 foto/);

  r = await enviar('listo');
  assert.match(r.respuestas[0], /no la puedo publicar: me falta tipo/);

  r = await enviar('es open');
  assert.match(r.respuestas[0], /Respondé LISTO/);

  r = await enviar('LISTO');
  assert.match(r.respuestas[0], /Publicada en el inventario: Quicksilver 1800 2017 — USD 23\.500/);
  assert.match(r.respuestas[1], /le sirve a 1 persona/);
  assert.match(r.respuestas[1], /1\) Carla Domínguez/);
  const e = db.prepare('SELECT * FROM embarcacion WHERE id = ?').get(r.embarcacionId);
  assert.equal(e.situacion, 'en venta');
  assert.equal(JSON.parse(e.fotos).length, 1);
  assert.equal(e.cargada_por, 'Leandro · simulador');
  const dueno = db.prepare('SELECT * FROM persona WHERE id = ?').get(e.propietario_id);
  assert.equal(dueno.nombre, 'Juan Pérez');
  assert.ok(JSON.parse(dueno.roles).includes('vendedor'));

  r = await enviar('1');
  assert.match(r.respuestas[0], /Carla Domínguez: enviado/);
  const prop = db.prepare('SELECT estado FROM propuesta WHERE embarcacion_id = ? AND persona_id = ?').get(e.id, carla.id);
  assert.equal(prop.estado, 'aprobada');
});

test('corrección en un mensaje posterior pisa el dato y lo informa', async () => {
  await enviar('Klase A 2400 2021 cuddy con baño, pide 58000');
  const r = await enviar('no, el precio es 56.000');
  assert.match(r.respuestas[0], /Actualicé: precio/);
  assert.match(r.respuestas[0], /USD 56\.000/);
  await enviar('cancelar');
});

test('cambio de precio por WhatsApp dispara re-matching', async () => {
  const e = barco({ marca: 'Prinz', modelo: '630', tipo: 'semirrigido/tracker', precio_pedido: 30000 });
  const p = persona({ nombre: 'Pescador' });
  busqueda(p.id, { tipo_embarcacion: ['semirrigido/tracker'], presupuesto_max: 22000, eslora_min: 5.5, eslora_max: 7 });
  const r = await enviar('la Prinz 630 bajó a 24 lucas');
  assert.match(r.respuestas[0], /Prinz 630 2017: USD 30\.000 → USD 24\.000/);
  assert.match(r.respuestas[1], /Con el precio nuevo de la Prinz 630 2017: 1 propuesta para aprobar \(1 entra gracias a la baja\)/);
  assert.match(r.respuestas[1], /Pescador — .*\(entra por la baja\)/);
  assert.equal(db.prepare('SELECT precio_pedido FROM embarcacion WHERE id = ?').get(e.id).precio_pedido, 24000);
  const ev = db.prepare("SELECT * FROM evento WHERE tipo = 'embarcacion.precio_bajado' AND entidad_id = ?").get(e.id);
  assert.ok(ev && ev.procesado_en);
  await enviar('ninguno');
});

test('venta por WhatsApp: sale del inventario y retira lo pendiente', async () => {
  const e = barco({ marca: 'Bayliner', modelo: '185', precio_pedido: 19500 });
  busqueda(persona().id, { presupuesto_max: 21000 });
  require('../lib/matching').generarPropuestas(e.id);
  const r = await enviar('se vendió la Bayliner 185');
  assert.match(r.respuestas[0], /marcada como vendida/);
  assert.equal(db.prepare('SELECT situacion FROM embarcacion WHERE id = ?').get(e.id).situacion, 'vendida');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM propuesta WHERE embarcacion_id = ? AND estado = 'pendiente'").get(e.id).n, 0);
});

test('audio sin texto: pide que lo mande escrito', async () => {
  const r = await enviar('', { medios: [{ tipo: 'audio' }] });
  assert.match(r.respuestas[0], /no puedo escuchar audios/);
});

test('reintento de Meta con el mismo id no se procesa dos veces', async () => {
  const a = await enviar('ayuda', { externoId: 'wamid.TEST1' });
  const b = await enviar('ayuda', { externoId: 'wamid.TEST1' });
  assert.ok(a.respuestas.length);
  assert.equal(b.duplicado, true);
});

test('con una carga en curso, una novedad de OTRA lancha no toca el borrador', async () => {
  const e = barco({ marca: 'Quest', modelo: '210', tipo: 'lancha cuddy', precio_pedido: 33000 });
  await enviar('Canestrari 215 2013 cuddy, pide 24500');
  const r = await enviar('la Quest 210 bajó a 31 lucas');
  assert.match(r.respuestas[0], /Quest 210 2017: USD 33\.000 → USD 31\.000/);
  const est = await enviar('estado');
  assert.match(est.respuestas[0], /Borrador: Canestrari 215 2013/);
  assert.match(est.respuestas[0], /USD 24\.500/);
  const otra = await enviar('Entró una Bayliner 175 2008 open, pide 14000');
  assert.match(otra.respuestas[0], /Tenés una carga en curso de Canestrari 215 2013/);
  await enviar('cancelar');
  assert.ok(e);
});

test('la conversación se lee en orden (lo que muestra el simulador)', async () => {
  const { conversacion } = require('../lib/intake/canales');
  await enviar('estado');
  const c = conversacion(OP);
  assert.ok(c.length >= 2);
  const ult = c.slice(-2);
  assert.deepEqual(ult.map(m => m.direccion), ['entrante', 'saliente']);
  assert.equal(ult[0].texto, 'estado');
});

test('bajar por debajo del mínimo privado del dueño avisa (no lo cambia solo)', async () => {
  const e = barco({ marca: 'Segue', modelo: '32', tipo: 'crucero', precio_pedido: 60000 });
  db.prepare('UPDATE embarcacion SET precio_minimo_aceptado = 55000 WHERE id = ?').run(e.id);
  const r = await enviar('la Segue 32 bajó a 52 lucas');
  assert.match(r.respuestas[0], /por debajo del mínimo que había aceptado el dueño \(USD 55\.000\)/);
  assert.equal(db.prepare('SELECT precio_minimo_aceptado FROM embarcacion WHERE id = ?').get(e.id).precio_minimo_aceptado, 55000);
  await enviar('ninguno');
});
