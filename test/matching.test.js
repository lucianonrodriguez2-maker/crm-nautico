const test = require('node:test');
const assert = require('node:assert');
const { db, persona, busqueda, barco, fila } = require('./helpers');
const m = require('../lib/matching');

test('un barco que encaja pasa, con motivo y factores explicados', () => {
  const p = persona({ nombre: 'Carla Domínguez' });
  const b = busqueda(p.id);
  const e = barco();
  const r = m.evaluar(fila(b.id), db.prepare('SELECT * FROM embarcacion WHERE id = ?').get(e.id));
  assert.equal(r.pasa, true);
  assert.ok(r.puntaje > 0);
  assert.ok(r.factores.some(f => f.clave === 'precio' && f.puntos === 20));
  assert.match(r.motivo, /Buscaba lancha open hasta USD 25\.000/);
});

test('filtros duros: tipo, baño, no contactar y su propio barco', () => {
  const p = persona();
  const e = barco();
  const leer = (id) => db.prepare('SELECT * FROM embarcacion WHERE id = ?').get(id);
  assert.equal(m.evaluar(fila(busqueda(p.id, { tipo_embarcacion: ['crucero'] }).id), leer(e.id)).pasa, false);
  assert.equal(m.evaluar(fila(busqueda(p.id, { necesita_bano: 1 }).id), leer(e.id)).pasa, false);
  const nc = persona({ no_contactar: 1 });
  assert.match(m.evaluar(fila(busqueda(nc.id).id), leer(e.id)).descartes.join(), /no ser contactado/);
  const propio = barco({ propietario_id: p.id });
  assert.match(m.evaluar(fila(busqueda(p.id).id), leer(propio.id)).descartes.join(), /propio barco/);
});

test('precio: +15% entra estirado; +25% es "casi" con el precio al que entraría', () => {
  const p = persona();
  const b = fila(busqueda(p.id, { presupuesto_max: 20000 }).id);
  const leer = (id) => db.prepare('SELECT * FROM embarcacion WHERE id = ?').get(id);
  const estirado = m.evaluar(b, leer(barco({ precio_pedido: 22500 }).id));
  assert.equal(estirado.pasa, true);
  assert.ok(estirado.factores.some(f => f.clave === 'precio' && f.puntos === 8));
  const casi = m.evaluar(b, leer(barco({ precio_pedido: 25000 }).id));
  assert.equal(casi.pasa, false);
  assert.deepEqual(casi.casi, { precioQueEntra: 23000 });
  const lejos = m.evaluar(b, leer(barco({ precio_pedido: 30000 }).id));
  assert.equal(lejos.casi, null);
});

test('modelo de referencia: "Quicksilver 1700" reconoce la 1800 como misma línea', () => {
  const p = persona();
  const b = fila(busqueda(p.id, { modelo_referencia: 'Quicksilver 1700' }).id);
  const r = m.evaluar(b, db.prepare('SELECT * FROM embarcacion WHERE id = ?').get(barco({ modelo: '1800' }).id));
  const f = r.factores.find(x => x.clave === 'modelo');
  assert.ok(f && f.puntos === 10, 'esperaba bonus de misma línea');
  assert.match(f.texto, /misma línea, un escalón arriba/);
});

test('los dos sentidos dan el mismo puntaje (una sola regla)', () => {
  const p = persona();
  const b = busqueda(p.id);
  const e = barco();
  const ida = m.analizarEmbarcacion(e.id).candidatos.find(c => c.busqueda.id === b.id);
  const vuelta = m.candidatasParaBusqueda(fila(b.id), { limite: 50 }).find(c => c.id === e.id);
  assert.ok(ida && vuelta);
  assert.equal(ida.puntaje, vuelta.puntaje);
});

test('generarPropuestas es idempotente y respeta lo descartado', () => {
  const p = persona();
  busqueda(p.id);
  const e = barco();
  const primera = m.generarPropuestas(e.id);
  assert.ok(primera.length >= 1);
  assert.equal(m.generarPropuestas(e.id).length, 0, 'no duplica pendientes');
  db.prepare("UPDATE propuesta SET estado = 'descartada' WHERE embarcacion_id = ?").run(e.id);
  assert.equal(m.generarPropuestas(e.id).length, 0, 'no vuelve a proponer lo descartado');
});

test('baja de precio: suma a los nuevos y avisa a los ya ofrecidos', () => {
  const ofrecido = persona({ nombre: 'Ya Ofrecido' });
  busqueda(ofrecido.id, { presupuesto_max: 30000 });
  const e = barco({ precio_pedido: 27000 });
  m.generarPropuestas(e.id);
  db.prepare("UPDATE propuesta SET estado = 'aprobada' WHERE embarcacion_id = ?").run(e.id);

  const nuevo = persona({ nombre: 'Nuevo Comprador' });
  busqueda(nuevo.id, { presupuesto_max: 20000 }); // a 27.000 no entra (+35%)
  db.prepare('UPDATE embarcacion SET precio_pedido = 22000 WHERE id = ?').run(e.id);
  const creadas = m.generarPropuestas(e.id, { origen: 'precio_bajado', precioAnterior: 27000 });
  const nombres = creadas.map(c => c.nombre);
  assert.ok(nombres.includes('Nuevo Comprador'), 'el que ahora entra por precio');
  assert.ok(nombres.includes('Ya Ofrecido'), 'el que ya la tenía recibe el aviso de baja');
  assert.equal(creadas.find(c => c.nombre === 'Ya Ofrecido').yaOfrecida, true);
  assert.equal(creadas.find(c => c.nombre === 'Nuevo Comprador').entraPorPrecio, true);
  const aviso = db.prepare(`SELECT mensaje_borrador FROM propuesta WHERE persona_id = ? AND estado = 'pendiente'`).get(ofrecido.id);
  assert.match(aviso.mensaje_borrador, /bajó de precio: ahora está en USD 22\.000 \(antes USD 27\.000\)/);
});

test('baja de precio: quien ya entraba y nunca se le ofreció no figura como "entra por la baja"', () => {
  const p = persona({ nombre: 'Siempre Entraba' });
  busqueda(p.id, { presupuesto_max: 40000 });
  const e = barco({ precio_pedido: 30000 });
  db.prepare('UPDATE embarcacion SET precio_pedido = 28000 WHERE id = ?').run(e.id);
  const c = m.generarPropuestas(e.id, { origen: 'precio_bajado', precioAnterior: 30000 }).find(x => x.nombre === 'Siempre Entraba');
  assert.equal(c.entraPorPrecio, false);
  const msg = db.prepare('SELECT mensaje_borrador, origen FROM propuesta WHERE id = ?').get(c.id);
  assert.equal(msg.origen, 'alta');
  assert.doesNotMatch(msg.mensaje_borrador, /bajó de precio/);
});

test('umbrales: "si baja a X se suman N" acumulado', () => {
  const e = barco({ precio_pedido: 26000 });
  for (const max of [21000, 21000, 20500]) busqueda(persona().id, { presupuesto_max: max }); // techos 24.150 / 23.575
  const { umbrales } = m.analizarEmbarcacion(e.id);
  assert.equal(umbrales[0].precio, 24000);
  assert.equal(umbrales[0].total, 2);
  assert.equal(umbrales[1].precio, 23500);
  assert.equal(umbrales[1].total, 3);
});

test('el mensaje nunca incluye el precio mínimo aceptado', () => {
  const p = persona();
  busqueda(p.id);
  const e = barco();
  db.prepare('UPDATE embarcacion SET precio_minimo_aceptado = 19999 WHERE id = ?').run(e.id);
  for (const c of m.analizarEmbarcacion(e.id).candidatos) assert.doesNotMatch(c.mensaje_borrador, /19[.]?999/);
});
