// Base temporal y fixtures. Cada archivo de test corre en su propio proceso (node --test),
// así que cada uno tiene su base limpia. Sin API key: la extracción usa el parser determinístico.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.FOTOS_DIR = path.join(dir, 'fotos');
delete process.env.ANTHROPIC_API_KEY;
delete process.env.WA_TOKEN;
delete process.env.WA_PHONE_NUMBER_ID;

const { db, uid, now } = require('../db');
const hace = (dias) => new Date(Date.now() - dias * 864e5).toISOString();

function persona(o = {}) {
  const p = { id: uid(), nombre: 'Persona Test', telefono: '+5491100000' + String(Math.floor(Math.random() * 900) + 100), no_contactar: 0, ultima_interaccion: hace(3), ...o };
  db.prepare(`INSERT INTO persona (id,nombre,telefono,roles,estado,no_contactar,creado_en,ultima_interaccion) VALUES (?,?,?,?,?,?,?,?)`)
    .run(p.id, p.nombre, p.telefono, '["comprador"]', 'activo', p.no_contactar, now(), p.ultima_interaccion);
  return p;
}

function busqueda(personaId, o = {}) {
  const b = { id: uid(), tipo_embarcacion: ['lancha open'], presupuesto_min: 15000, presupuesto_max: 25000, eslora_min: 5, eslora_max: 6,
    uso_declarado: ['paseo familiar'], necesita_bano: 0, necesita_trailer: 0, urgencia: null, modelo_referencia: null, creada_en: hace(20), ...o };
  db.prepare(`INSERT INTO busqueda (id,persona_id,tipo_embarcacion,eslora_min,eslora_max,presupuesto_min,presupuesto_max,uso_declarado,
      necesita_bano,necesita_trailer,urgencia,estado,creada_en,modelo_referencia) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.id, personaId, JSON.stringify(b.tipo_embarcacion), b.eslora_min, b.eslora_max, b.presupuesto_min, b.presupuesto_max,
      JSON.stringify(b.uso_declarado), b.necesita_bano, b.necesita_trailer, b.urgencia, 'activa', b.creada_en, b.modelo_referencia);
  return b;
}

function barco(o = {}) {
  const e = { id: uid(), tipo: 'lancha open', marca: 'Quicksilver', modelo: '1800', anio: 2017, eslora: 5.5, motor_hp: 115,
    precio_pedido: 23000, tiene_bano: 0, tiene_trailer: 1, propietario_id: null, situacion: 'en venta', ...o };
  db.prepare(`INSERT INTO embarcacion (id,tipo,marca,modelo,anio,eslora,motor_hp,precio_pedido,tiene_bano,tiene_trailer,propietario_id,situacion,equipamiento,fotos,ingresada_en)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(e.id, e.tipo, e.marca, e.modelo, e.anio, e.eslora, e.motor_hp, e.precio_pedido, e.tiene_bano, e.tiene_trailer, e.propietario_id, e.situacion, '[]', '[]', now());
  return e;
}

const fila = (busqId) => db.prepare(`SELECT b.*, p.nombre, p.telefono, p.no_contactar, p.ultima_interaccion FROM busqueda b JOIN persona p ON p.id = b.persona_id WHERE b.id = ?`).get(busqId);

module.exports = { db, persona, busqueda, barco, fila, hace };
