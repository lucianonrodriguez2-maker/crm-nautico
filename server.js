// CRM Náutico — demo pre-venta. Servidor + API.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const { db, uid, now, normalizarTelefono, auditar } = require('./db');
const { candidatosParaEmbarcacion, candidatasParaBusqueda, propuestaPuntual } = require('./lib/matching');
const { scoreUpgrade } = require('./lib/escalera');
const { extraer } = require('./lib/extraccion');
const { tasar } = require('./lib/tasador');
const prometheo = require('./lib/prometheo');
const gcal = require('./lib/gcal');

// En un deploy nuevo la base arranca vacía (el .db no viaja en el repo):
// se siembran los datos de demo una sola vez, al primer arranque.
try {
  if (db.prepare('SELECT COUNT(*) n FROM persona').get().n === 0) {
    console.log('Base vacía — sembrando datos de demo…');
    require('./seed');
  }
} catch (e) {
  console.error('No se pudo sembrar la base:', e.message);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const j = (s, d = []) => { try { return JSON.parse(s) || d; } catch { return d; } };
const horas = (iso) => (Date.now() - new Date(iso).getTime()) / 36e5;

// Vista pública de embarcación: precio_minimo_aceptado NUNCA sale (§4.4)
function embPublica(e) { if (!e) return e; const { precio_minimo_aceptado, ...rest } = e; return rest; }

/* ============ Deduplicación en el borde (§1.bis regla 5) ============ */
function upsertPersona({ nombre, telefono, email, instagram_handle, prometheo_id, origen, contexto_personal }) {
  const tel = normalizarTelefono(telefono);
  let p = null;
  if (tel) p = db.prepare('SELECT * FROM persona WHERE telefono = ?').get(tel);
  if (!p && instagram_handle) p = db.prepare('SELECT * FROM persona WHERE instagram_handle = ?').get(instagram_handle);
  if (p) {
    db.prepare(`UPDATE persona SET
      nombre = CASE WHEN nombre = '' OR nombre IS NULL THEN COALESCE(?, nombre) ELSE nombre END,
      telefono = COALESCE(telefono, ?), email = COALESCE(email, ?),
      instagram_handle = COALESCE(instagram_handle, ?), prometheo_id = COALESCE(prometheo_id, ?),
      contexto_personal = COALESCE(?, contexto_personal), ultima_interaccion = ?
      WHERE id = ?`)
      .run(nombre || null, tel, email || null, instagram_handle || null, prometheo_id || null, contexto_personal || null, now(), p.id);
    return { persona: db.prepare('SELECT * FROM persona WHERE id = ?').get(p.id), creada: false };
  }
  const id = uid();
  db.prepare(`INSERT INTO persona (id,nombre,telefono,email,instagram_handle,prometheo_id,origen,roles,estado,contexto_personal,no_contactar,creado_en,ultima_interaccion)
    VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?)`)
    .run(id, nombre || 'Sin nombre', tel, email || null, instagram_handle || null, prometheo_id || null, origen || 'otro', '["comprador"]', 'activo', contexto_personal || null, now(), now());
  auditar(id, 'alta de persona', `origen: ${origen || 'otro'}`, 'sistema');
  return { persona: db.prepare('SELECT * FROM persona WHERE id = ?').get(id), creada: true };
}

function agregarRol(personaId, rol) {
  const p = db.prepare('SELECT roles FROM persona WHERE id = ?').get(personaId);
  const roles = j(p.roles);
  if (!roles.includes(rol)) { roles.push(rol); db.prepare('UPDATE persona SET roles = ? WHERE id = ?').run(JSON.stringify(roles), personaId); }
}

/* ============ Ventana de 24 hs de WhatsApp (§1.bis regla 7) ============ */
// Leandro nunca debe necesitar saber que esta regla existe: el sistema decide solo.
function modoEnvio(personaId) {
  const ultimo = db.prepare(`
    SELECT m.timestamp FROM mensaje m JOIN conversacion c ON c.id = m.conversacion_id
    WHERE c.persona_id = ? AND m.direccion = 'entrante' AND c.canal = 'whatsapp'
    ORDER BY m.timestamp DESC LIMIT 1`).get(personaId);
  if (ultimo && horas(ultimo.timestamp) < 24) return { modo: 'texto libre', detalle: 'ventana de 24 hs activa' };
  return { modo: 'plantilla', detalle: 'fuera de ventana — sale como plantilla match_inventario aprobada por Meta' };
}

/* ============================== HOY ============================== */
app.get('/api/hoy', (req, res) => {
  // conversaciones donde Prometheo ya respondió pero falta el seguimiento personal de Leandro.
  // El semáforo mide las horas desde el último mensaje entrante del cliente.
  const sinResponder = db.prepare(`
    SELECT c.id, c.canal, c.persona_id, p.nombre, m.contenido, m.timestamp,
           e.marca || ' ' || e.modelo AS embarcacion
    FROM conversacion c
    JOIN persona p ON p.id = c.persona_id
    LEFT JOIN embarcacion e ON e.id = c.embarcacion_referida_id
    JOIN mensaje m ON m.conversacion_id = c.id
    WHERE c.estado = 'esperando respuesta nuestra'
      AND m.direccion = 'entrante'
      AND m.timestamp = (SELECT MAX(timestamp) FROM mensaje WHERE conversacion_id = c.id AND direccion = 'entrante')
    ORDER BY m.timestamp ASC`).all()
    .map(r => {
      const bot = db.prepare(`
        SELECT contenido, timestamp FROM mensaje
        WHERE conversacion_id = ? AND direccion = 'saliente' AND autor = 'agente-ia' AND timestamp >= ?
        ORDER BY timestamp ASC LIMIT 1`).get(r.id, r.timestamp);
      const respondioEnMin = bot ? Math.max(1, Math.round((new Date(bot.timestamp) - new Date(r.timestamp)) / 6e4)) : null;
      return {
        ...r,
        bot_respuesta: bot ? bot.contenido : null,
        bot_respondio_en_min: respondioEnMin,
        horas_sin_responder: Math.round(horas(r.timestamp) * 10) / 10,
        semaforo: horas(r.timestamp) < 2 ? 'verde' : horas(r.timestamp) < 12 ? 'amarillo' : 'rojo',
      };
    });

  const citas = db.prepare(`
    SELECT c.*, p.nombre, e.marca || ' ' || e.modelo || ' ' || e.anio AS embarcacion
    FROM cita c JOIN persona p ON p.id = c.persona_id
    LEFT JOIN embarcacion e ON e.id = c.embarcacion_id
    WHERE c.fecha > datetime('now') ORDER BY c.fecha ASC LIMIT 6`).all();

  const propuestas = db.prepare(`
    SELECT pr.*, p.nombre, e.marca || ' ' || e.modelo || ' ' || e.anio AS embarcacion
    FROM propuesta pr JOIN persona p ON p.id = pr.persona_id JOIN embarcacion e ON e.id = pr.embarcacion_id
    WHERE pr.estado = 'pendiente' ORDER BY pr.puntaje DESC`).all();

  const captaciones = db.prepare(`
    SELECT t.*, p.nombre, p.telefono FROM tasacion t JOIN persona p ON p.id = t.persona_id
    WHERE t.origen = 'web pública' AND t.creada_en > datetime('now','-7 days')
    ORDER BY t.creada_en DESC LIMIT 5`).all()
    .map(t => ({ ...t, datos_embarcacion: j(t.datos_embarcacion, {}) }));

  const escalera = scoreUpgrade();
  res.json({ sinResponder, citas, propuestas, captaciones, escalera });
});

/* ============================== PERSONAS ============================== */
app.get('/api/personas', (req, res) => {
  const q = (req.query.q || '').trim();
  const rows = q
    // Clientes con historial de compras primero (son los que tienen trayectoria que mostrar),
    // después el resto por última interacción.
    ? db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM operacion o WHERE o.comprador_id = p.id AND o.etapa = 'cerrada') AS compras
        FROM persona p WHERE p.nombre LIKE ? OR p.telefono LIKE ? OR p.instagram_handle LIKE ?
        ORDER BY compras DESC, p.ultima_interaccion DESC`).all(`%${q}%`, `%${q}%`, `%${q}%`)
    : db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM operacion o WHERE o.comprador_id = p.id AND o.etapa = 'cerrada') AS compras
        FROM persona p ORDER BY compras DESC, p.ultima_interaccion DESC`).all();
  res.json(rows.map(p => ({ ...p, roles: j(p.roles), busquedas_activas: db.prepare(`SELECT COUNT(*) n FROM busqueda WHERE persona_id = ? AND estado='activa'`).get(p.id).n })));
});

app.get('/api/personas/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM persona WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'no existe' });
  const busquedas = db.prepare('SELECT * FROM busqueda WHERE persona_id = ? ORDER BY creada_en DESC').all(p.id)
    .map(b => ({ ...b, tipo_embarcacion: j(b.tipo_embarcacion), uso_declarado: j(b.uso_declarado) }));
  const embarcaciones = db.prepare('SELECT * FROM embarcacion WHERE propietario_id = ?').all(p.id).map(embPublica);
  const operaciones = db.prepare(`
    SELECT o.*, e.marca || ' ' || e.modelo || ' ' || e.anio AS embarcacion,
           pc.nombre AS comprador, pv.nombre AS vendedor
    FROM operacion o JOIN embarcacion e ON e.id = o.embarcacion_id
    LEFT JOIN persona pc ON pc.id = o.comprador_id LEFT JOIN persona pv ON pv.id = o.vendedor_id
    WHERE o.comprador_id = ? OR o.vendedor_id = ? ORDER BY o.fecha_primer_contacto DESC`).all(p.id, p.id);
  // línea de tiempo unificada: TODOS los canales juntos (§3.5)
  const timeline = db.prepare(`
    SELECT m.*, c.canal FROM mensaje m JOIN conversacion c ON c.id = m.conversacion_id
    WHERE c.persona_id = ? ORDER BY m.timestamp ASC`).all(p.id);
  const senales = db.prepare('SELECT * FROM senal WHERE persona_id = ? ORDER BY fecha DESC').all(p.id);
  const tasaciones = db.prepare('SELECT * FROM tasacion WHERE persona_id = ? ORDER BY creada_en DESC').all(p.id)
    .map(t => ({ ...t, datos_embarcacion: j(t.datos_embarcacion, {}) }));
  const referidor = p.referido_por ? db.prepare('SELECT id, nombre FROM persona WHERE id = ?').get(p.referido_por) : null;
  const referidos = db.prepare('SELECT id, nombre FROM persona WHERE referido_por = ?').all(p.id);

  // Trayectoria náutica: compras y ventas en orden, próximo contacto sugerido y qué ofrecerle
  const hitos = [];
  for (const o of operaciones.filter(x => x.etapa === 'cerrada')) {
    if (o.comprador_id === p.id) hitos.push({ tipo: 'compró', embarcacion: o.embarcacion, precio: o.precio_cierre, fecha: o.fecha_cierre, vinculada: !!o.operacion_vinculada_id });
    if (o.vendedor_id === p.id) hitos.push({ tipo: 'vendió', embarcacion: o.embarcacion, precio: o.precio_cierre, fecha: o.fecha_cierre, vinculada: !!o.operacion_vinculada_id });
  }
  hitos.sort((a, b2) => new Date(a.fecha) - new Date(b2.fecha));
  let trayectoria = null;
  const compras = hitos.filter(h => h.tipo === 'compró');
  if (compras.length) {
    const ultima = compras[compras.length - 1];
    const barcoActual = embarcaciones.find(e => e.situacion !== 'vendida');
    const aniosCiclo = (Date.now() - new Date(ultima.fecha).getTime()) / (365.25 * 864e5);
    // Ciclo propio: promedio de años entre sus compras. Con una sola compra, el promedio del mercado (4 años).
    const saltos = [];
    for (let i = 1; i < compras.length; i++) {
      saltos.push((new Date(compras[i].fecha) - new Date(compras[i - 1].fecha)) / (365.25 * 864e5));
    }
    const cicloPropio = saltos.length ? saltos.reduce((a, b2) => a + b2, 0) / saltos.length : 4;
    const proximaEstimada = new Date(new Date(ultima.fecha).getTime() + cicloPropio * 365.25 * 864e5);
    const contactoDesde = new Date(new Date(ultima.fecha).getTime() + 3 * 365.25 * 864e5);
    // Un escalón arriba de verdad: más eslora Y más precio que lo que pagó por el actual.
    // Prioriza las que suman baño (el salto que más pesa en la escalera náutica).
    const pisoPrecio = (ultima.precio || 0) * 1.1;
    const sugeridas = barcoActual ? db.prepare(`
      SELECT id, marca || ' ' || modelo || ' ' || anio AS etiqueta, precio_pedido, eslora, tiene_bano
      FROM embarcacion
      WHERE situacion = 'en venta' AND precio_pedido IS NOT NULL
        AND eslora > ? AND precio_pedido > ?
      ORDER BY (CASE WHEN tiene_bano > ? THEN 0 ELSE 1 END), precio_pedido ASC LIMIT 3`)
      .all(barcoActual.eslora || 0, pisoPrecio, barcoActual.tiene_bano || 0) : [];
    trayectoria = {
      hitos,
      compras: compras.length,
      anios_ciclo: Math.round(aniosCiclo * 10) / 10,
      ciclo_propio: Math.round(cicloPropio * 10) / 10,
      ciclo_es_propio: saltos.length > 0,
      proxima_estimada: proximaEstimada.toISOString(),
      proxima_vencida: proximaEstimada.getTime() <= Date.now(),
      contacto_sugerido: contactoDesde.toISOString(),
      contacto_vencido: aniosCiclo >= 3,
      barco_actual: barcoActual ? `${barcoActual.marca} ${barcoActual.modelo} ${barcoActual.anio || ''}` : null,
      sugeridas,
    };
  }
  res.json({ ...p, roles: j(p.roles), busquedas, embarcaciones, operaciones, timeline, senales, tasaciones, referidor, referidos, trayectoria });
});

/* ============================== BÚSQUEDAS ============================== */
// El lado de la demanda: quiénes buscan y qué, por presupuesto, con las lanchas
// del stock que les pueden interesar y las NUEVAS todavía sin ofrecer destacadas.
app.get('/api/busquedas', (req, res) => {
  const activas = db.prepare(`
    SELECT b.*, p.nombre, p.telefono, p.instagram_handle, p.contexto_personal, p.ultima_interaccion
    FROM busqueda b JOIN persona p ON p.id = b.persona_id
    WHERE b.estado = 'activa' AND p.no_contactar = 0
    ORDER BY COALESCE(b.presupuesto_max, 0) DESC`).all();
  const esNueva = (iso) => (Date.now() - new Date(iso).getTime()) / 864e5 <= 14;
  const rows = activas.map(b => {
    const candidatas = candidatasParaBusqueda(b).map(c => {
      // "ofrecida" = el mensaje ya salió (aprobado). Una propuesta pendiente todavía no se ofreció.
      const ofrecida = db.prepare(`
        SELECT 1 FROM propuesta WHERE persona_id = ? AND embarcacion_id = ? AND estado IN ('aprobada','editada-y-aprobada') LIMIT 1
      `).get(b.persona_id, c.id);
      return { ...c, ofrecida: !!ofrecida, nueva: esNueva(c.ingresada_en) };
    });
    return {
      ...b, tipo_embarcacion: j(b.tipo_embarcacion), uso_declarado: j(b.uso_declarado),
      candidatas,
      tiene_nueva_sin_ofrecer: candidatas.some(c => c.nueva && !c.ofrecida),
    };
  });
  res.json(rows);
});

// Ofrecer una embarcación puntual a una búsqueda puntual, desde la pantalla Búsquedas.
// Crea (o recupera) la propuesta pendiente con motivo y borrador — la aprobación sigue siendo humana.
app.post('/api/ofrecer', (req, res) => {
  const { busqueda_id, embarcacion_id } = req.body || {};
  const b = db.prepare('SELECT * FROM busqueda WHERE id = ?').get(busqueda_id);
  const e = db.prepare('SELECT * FROM embarcacion WHERE id = ?').get(embarcacion_id);
  if (!b || !e) return res.status(404).json({ error: 'búsqueda o embarcación inexistente' });

  let pr = db.prepare(`SELECT * FROM propuesta WHERE busqueda_id = ? AND embarcacion_id = ? AND estado = 'pendiente'`).get(busqueda_id, embarcacion_id);
  if (!pr) {
    const calc = propuestaPuntual(busqueda_id, embarcacion_id);
    if (!calc) return res.status(422).json({ error: 'no pasa los filtros del motor (tipo, presupuesto, baño o no-contactar)' });
    const id = uid();
    db.prepare(`INSERT INTO propuesta (id,embarcacion_id,busqueda_id,persona_id,puntaje,motivo,mensaje_borrador,via,estado,creada_en) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, embarcacion_id, busqueda_id, b.persona_id, calc.puntaje, calc.motivo, calc.mensaje_borrador, calc.via, 'pendiente', now());
    pr = db.prepare('SELECT * FROM propuesta WHERE id = ?').get(id);
  }
  const p = db.prepare('SELECT nombre, telefono, instagram_handle, contexto_personal FROM persona WHERE id = ?').get(pr.persona_id);
  res.json({
    ...pr, ...p,
    envio: pr.via === 'whatsapp' ? modoEnvio(pr.persona_id) : { modo: 'copy-paste', detalle: 'sin teléfono: queda como tarea en la bandeja de Prometheo' },
  });
});

// Alta rápida (§5): la pantalla que decide si el proyecto se adopta. Deduplica por teléfono.
app.post('/api/busquedas', (req, res) => {
  const b = req.body || {};
  const { persona: p, creada } = upsertPersona({
    nombre: b.nombre, telefono: b.telefono, instagram_handle: b.instagram_handle,
    origen: b.origen || 'telefono', contexto_personal: b.contexto_personal,
  });
  const id = uid();
  db.prepare(`INSERT INTO busqueda (id,persona_id,tipo_embarcacion,eslora_min,eslora_max,presupuesto_min,presupuesto_max,motor_tipo,hp_min,uso_declarado,necesita_bano,necesita_trailer,urgencia,entrega_algo,limitacion_declarada,estado,texto_original,creada_en)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, p.id, JSON.stringify(b.tipo_embarcacion || []), b.eslora_min ?? null, b.eslora_max ?? null,
      b.presupuesto_min ?? null, b.presupuesto_max ?? null, b.motor_tipo || 'indistinto', b.hp_min ?? null,
      JSON.stringify(b.uso_declarado || []), b.necesita_bano ? 1 : 0, b.necesita_trailer ? 1 : 0,
      b.urgencia || null, b.entrega_algo ? 1 : 0, b.limitacion_declarada || null, 'activa', b.texto_original || null, now());
  auditar(p.id, 'alta de búsqueda', `${(b.tipo_embarcacion || []).join(', ')} · hasta USD ${b.presupuesto_max || 's/d'}`, b.autor || 'leandro');
  // devolución a Prometheo: variables deducidas al lead (§1.bis tabla)
  if (p.prometheo_id) prometheo.escribirVariablesEnLead(p.prometheo_id, { busca: (b.tipo_embarcacion || []).join('/'), presupuesto_max: b.presupuesto_max });
  res.json({ ok: true, busqueda_id: id, persona_id: p.id, persona_creada: creada, persona_nombre: p.nombre });
});

// Cierre de búsqueda: nunca se borra, se cierra con motivo (§3.2)
app.post('/api/busquedas/:id/cerrar', (req, res) => {
  const { estado, motivo } = req.body || {};
  db.prepare(`UPDATE busqueda SET estado = ?, motivo_cierre = ?, actualizada_en = ? WHERE id = ?`)
    .run(estado || 'perdida', motivo || null, now(), req.params.id);
  const b = db.prepare('SELECT persona_id FROM busqueda WHERE id = ?').get(req.params.id);
  if (b) auditar(b.persona_id, 'cierre de búsqueda', `${estado}: ${motivo || 's/m'}`, 'leandro');
  res.json({ ok: true });
});

/* ============================== EXTRACCIÓN IA ============================== */
app.post('/api/extraer', async (req, res) => {
  const texto = (req.body && req.body.texto || '').trim();
  if (!texto) return res.status(400).json({ error: 'falta texto' });
  try {
    const r = await extraer(texto);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ============================== EMBARCACIONES ============================== */
app.get('/api/embarcaciones', (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, p.nombre AS propietario,
      (SELECT COUNT(*) FROM conversacion c WHERE c.embarcacion_referida_id = e.id) AS consultas,
      CAST(julianday('now') - julianday(e.ingresada_en) AS INTEGER) AS dias_en_stock
    FROM embarcacion e LEFT JOIN persona p ON p.id = e.propietario_id
    ORDER BY CASE e.situacion WHEN 'en venta' THEN 0 ELSE 1 END, e.ingresada_en DESC`).all();
  res.json(rows.map(e => ({ ...e, equipamiento: j(e.equipamiento) })));
});

app.get('/api/embarcaciones/:id', (req, res) => {
  const e = db.prepare('SELECT * FROM embarcacion WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'no existe' });
  const propietario = e.propietario_id ? db.prepare('SELECT id, nombre FROM persona WHERE id = ?').get(e.propietario_id) : null;
  const consultas = db.prepare(`
    SELECT c.id, c.canal, c.ultima_actividad, p.nombre, p.id AS persona_id
    FROM conversacion c JOIN persona p ON p.id = c.persona_id
    WHERE c.embarcacion_referida_id = ? ORDER BY c.ultima_actividad DESC`).all(e.id);
  const candidatos = e.situacion === 'en venta' ? candidatosParaEmbarcacion(e.id) : [];
  res.json({ ...e, equipamiento: j(e.equipamiento), propietario, consultas, candidatos });
});

// Alta de embarcación → matching inmediato → propuestas pendientes de aprobación (Caso 1)
app.post('/api/embarcaciones', (req, res) => {
  const b = req.body || {};
  let propietarioId = b.propietario_id || null;
  if (!propietarioId && b.propietario_nombre) {
    const { persona } = upsertPersona({ nombre: b.propietario_nombre, telefono: b.propietario_telefono, origen: 'otro' });
    propietarioId = persona.id;
    agregarRol(propietarioId, 'vendedor');
  }
  const id = uid();
  db.prepare(`INSERT INTO embarcacion (id,tipo,marca,modelo,anio,eslora,manga,motor_marca,motor_hp,motor_tipo,motor_horas,combustible_litros,equipamiento,estado_general,tiene_bano,tiene_trailer,precio_pedido,precio_minimo_aceptado,propietario_id,situacion,exclusividad,papeles_estado,ingresada_en)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, b.tipo, b.marca || '', b.modelo || '', b.anio ?? null, b.eslora ?? null, b.manga ?? null,
      b.motor_marca || null, b.motor_hp ?? null, b.motor_tipo || null, b.motor_horas ?? null, b.combustible_litros ?? null,
      JSON.stringify(b.equipamiento || []), b.estado_general || null, b.tiene_bano ? 1 : 0, b.tiene_trailer ? 1 : 0,
      b.precio_pedido ?? null, b.precio_minimo_aceptado ?? null, propietarioId, 'en venta', b.exclusividad || 'a confirmar', b.papeles_estado || 'sin revisar', now());

  // el corazón del Caso 1: candidatos + borrador por cada uno, pendientes de aprobación
  const candidatos = candidatosParaEmbarcacion(id);
  const insProp = db.prepare(`INSERT INTO propuesta (id,embarcacion_id,busqueda_id,persona_id,puntaje,motivo,mensaje_borrador,via,estado,creada_en) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (const c of candidatos) {
    insProp.run(uid(), id, c.busqueda.id, c.persona_id, c.puntaje, c.motivo, c.mensaje_borrador, c.via, 'pendiente', now());
  }
  res.json({ ok: true, embarcacion_id: id, candidatos: candidatos.length });
});

/* ============================== PROPUESTAS (aprobación humana) ============================== */
app.get('/api/embarcaciones/:id/propuestas', (req, res) => {
  const rows = db.prepare(`
    SELECT pr.*, p.nombre, p.telefono, p.instagram_handle, p.contexto_personal
    FROM propuesta pr JOIN persona p ON p.id = pr.persona_id
    WHERE pr.embarcacion_id = ? ORDER BY pr.puntaje DESC`).all(req.params.id);
  res.json(rows.map(r => ({ ...r, envio: r.via === 'whatsapp' ? modoEnvio(r.persona_id) : { modo: 'copy-paste', detalle: 'sin teléfono: queda como tarea en la bandeja de Prometheo' } })));
});

app.post('/api/propuestas/:id/aprobar', (req, res) => {
  const pr = db.prepare('SELECT * FROM propuesta WHERE id = ?').get(req.params.id);
  if (!pr) return res.status(404).json({ error: 'no existe' });
  const contenido = (req.body && req.body.mensaje) || pr.mensaje_borrador;
  const editada = contenido !== pr.mensaje_borrador;
  const persona = db.prepare('SELECT * FROM persona WHERE id = ?').get(pr.persona_id);

  let envio;
  if (pr.via === 'whatsapp') {
    envio = modoEnvio(pr.persona_id); // ventana 24 hs: el sistema decide solo
    prometheo.enviarWhatsApp(persona.telefono, contenido, envio.modo);
    // registrar el saliente en la conversación de WhatsApp de la persona
    let conv = db.prepare(`SELECT id FROM conversacion WHERE persona_id = ? AND canal = 'whatsapp' ORDER BY ultima_actividad DESC LIMIT 1`).get(pr.persona_id);
    if (!conv) { const cid = uid(); db.prepare(`INSERT INTO conversacion (id,persona_id,canal,estado,embarcacion_referida_id,ultima_actividad) VALUES (?,?,?,?,?,?)`).run(cid, pr.persona_id, 'whatsapp', 'esperando respuesta de él', pr.embarcacion_id, now()); conv = { id: cid }; }
    db.prepare(`INSERT INTO mensaje (id,conversacion_id,direccion,contenido,timestamp,autor) VALUES (?,?,?,?,?,?)`).run(uid(), conv.id, 'saliente', contenido, now(), 'leandro');
    db.prepare(`UPDATE conversacion SET ultima_actividad = ?, estado = 'esperando respuesta de él' WHERE id = ?`).run(now(), conv.id);
  } else {
    envio = { modo: 'copy-paste', detalle: 'tarea generada: pegar el mensaje en la bandeja de Prometheo (Instagram)' };
  }
  db.prepare(`UPDATE propuesta SET estado = ?, resuelta_en = ? WHERE id = ?`).run(editada ? 'editada-y-aprobada' : 'aprobada', now(), pr.id);
  auditar(pr.persona_id, 'mensaje de matching aprobado', `vía ${pr.via} · ${envio.modo}`, 'leandro');
  res.json({ ok: true, envio });
});

app.post('/api/propuestas/:id/descartar', (req, res) => {
  const pr = db.prepare('SELECT * FROM propuesta WHERE id = ?').get(req.params.id);
  if (!pr) return res.status(404).json({ error: 'no existe' });
  db.prepare(`UPDATE propuesta SET estado = 'descartada', resuelta_en = ? WHERE id = ?`).run(now(), pr.id);
  auditar(pr.persona_id, 'propuesta de matching descartada', null, 'leandro');
  res.json({ ok: true });
});

/* ============================== TASADOR (Caso 2) ============================== */
// Además de la banda de valor, arma el mensaje de WhatsApp listo para enviar,
// con embarcaciones del stock de tamaño/precio similar y sus links reales.
function similaresParaTasacion(b, resultado) {
  const medio = (resultado.valor_estimado_min + resultado.valor_estimado_max) / 2;
  const rows = db.prepare(`
    SELECT id, tipo, marca, modelo, anio, eslora, precio_pedido, fotos, url_publicacion, tiene_bano
    FROM embarcacion
    WHERE situacion = 'en venta' AND precio_pedido IS NOT NULL
      AND NOT (marca = ? AND modelo = ?)`).all(b.marca || '', b.modelo || '');
  const puntuados = rows.map(e => {
    let score = 0;
    if (e.precio_pedido >= medio * 0.7 && e.precio_pedido <= medio * 1.45) score += 3;
    if (b.eslora && e.eslora && Math.abs(e.eslora - b.eslora) <= 0.9) score += 2;
    if (e.tipo === b.tipo) score += 2;
    if (e.eslora && b.eslora && e.eslora > b.eslora && e.eslora - b.eslora <= 2) score += 1; // un escalón arriba
    if (e.url_publicacion) score += 2; // con link real se puede mandar
    return { e, score };
  }).filter(x => x.score >= 4).sort((a, z) => z.score - a.score).slice(0, 3);
  return puntuados.map(({ e }) => ({
    id: e.id, etiqueta: `${e.marca} ${e.modelo} ${e.anio}`, precio: e.precio_pedido,
    eslora: e.eslora, url: e.url_publicacion, foto: (j(e.fotos)[0]) || null,
  }));
}

function mensajeWhatsAppTasacion(b, resultado, similares) {
  const nombre = (b.nombre || '').split(' ')[0];
  const lineas = [
    `${nombre ? 'Hola ' + nombre + '!' : '¡Hola!'} Soy Leandro Ramos, broker náutico de San Fernando. Acá va la valuación de tu ${[b.marca, b.modelo, b.anio].filter(Boolean).join(' ')}:`,
    `📊 Hoy el mercado la ubica entre USD ${resultado.valor_estimado_min.toLocaleString('es-AR')} y USD ${resultado.valor_estimado_max.toLocaleString('es-AR')}. Si querés te paso el detalle de los comparables.`,
    `Si estás pensando en venderla, la trabajo yo y te consigo el mejor precio del Delta.`,
  ];
  if (similares.length) {
    lineas.push(`Y si la idea es cambiarla por algo más, mirá lo que tengo en stock ahora:`);
    for (const s of similares) {
      lineas.push(`⚓ ${s.etiqueta} — USD ${s.precio.toLocaleString('es-AR')}${s.url ? '\n' + s.url : ''}`);
    }
    lineas.push(`Te mando fotos y ficha de la que te interese. ¿Coordinamos?`);
  }
  return lineas.join('\n\n');
}

app.post('/api/tasar', (req, res) => {
  const b = req.body || {};
  const resultado = tasar(b);
  resultado.similares = similaresParaTasacion(b, resultado);
  resultado.mensaje_whatsapp = mensajeWhatsAppTasacion(b, resultado, resultado.similares);
  // Modo ejemplo (el bloque demostrativo del pie del tasador): calcula pero no persiste nada
  if (b._ejemplo) return res.json(resultado);
  let personaId = null;
  if (b.nombre || b.telefono) {
    const { persona } = upsertPersona({ nombre: b.nombre, telefono: b.telefono, email: b.email, origen: 'web' });
    personaId = persona.id;
    agregarRol(personaId, 'vendedor');
    // la tasación del propio barco es LA señal de la escalera (§4.2)
    db.prepare(`INSERT INTO senal (id,persona_id,tipo,peso,detalle,fecha) VALUES (?,?,?,?,?,?)`)
      .run(uid(), personaId, 'taso_su_barco', 10, `Tasó ${b.marca || ''} ${b.modelo || ''} ${b.anio || ''} desde la web`, now());
    auditar(personaId, 'tasación web', `${b.marca} ${b.modelo} → USD ${resultado.valor_estimado_min}-${resultado.valor_estimado_max}`, 'sistema');
  }
  db.prepare(`INSERT INTO tasacion (id,persona_id,datos_embarcacion,valor_estimado_min,valor_estimado_max,fundamento,convertida_en_captacion,origen,creada_en) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(uid(), personaId, JSON.stringify(b), resultado.valor_estimado_min, resultado.valor_estimado_max, resultado.fundamento, personaId ? 1 : 0, b._origen || 'web pública', now());
  res.json(resultado);
});

/* ============================== PROMETHEO MOCK ============================== */
// Simula la llegada de un webhook message.incoming → deduplica persona → extrae Busqueda con IA
app.post('/api/prometheo/simular', async (req, res) => {
  const ev = prometheo.simularMensajeEntrante();
  const { persona, creada } = upsertPersona({ ...ev.contacto, origen: ev.contacto.canal });
  let conv = db.prepare(`SELECT id FROM conversacion WHERE persona_id = ? AND canal = ? ORDER BY ultima_actividad DESC LIMIT 1`).get(persona.id, ev.contacto.canal);
  if (!conv) { const cid = uid(); db.prepare(`INSERT INTO conversacion (id,persona_id,canal,estado,ultima_actividad) VALUES (?,?,?,?,?)`).run(cid, persona.id, ev.contacto.canal, 'esperando respuesta nuestra', ev.timestamp); conv = { id: cid }; }
  db.prepare(`INSERT INTO mensaje (id,conversacion_id,direccion,contenido,timestamp,autor) VALUES (?,?,?,?,?,?)`).run(uid(), conv.id, 'entrante', ev.texto, ev.timestamp, 'cliente');
  db.prepare(`UPDATE conversacion SET ultima_actividad = ?, estado = 'esperando respuesta nuestra' WHERE id = ?`).run(ev.timestamp, conv.id);

  const extraido = await extraer(ev.texto);
  res.json({ evento: ev, persona: { id: persona.id, nombre: persona.nombre, creada }, extraido });
});

/* ============================== OPERACIONES / AUDITORÍA ============================== */
app.get('/api/operaciones', (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, e.marca || ' ' || e.modelo || ' ' || e.anio AS embarcacion, e.precio_pedido,
           pc.nombre AS comprador, pv.nombre AS vendedor
    FROM operacion o JOIN embarcacion e ON e.id = o.embarcacion_id
    LEFT JOIN persona pc ON pc.id = o.comprador_id LEFT JOIN persona pv ON pv.id = o.vendedor_id
    ORDER BY o.fecha_primer_contacto DESC`).all();
  res.json(rows);
});

app.get('/api/escalera', (req, res) => res.json(scoreUpgrade()));

/* ============================== RADAR DE MERCADO ============================== */
// En producción: job periódico contra la API de MercadoLibre (categoría náutica, zona norte)
// + revisión asistida de Marketplace. Acá los avisos ya están relevados (mock).
app.get('/api/radar', (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, p.nombre AS persona_nombre
    FROM aviso_externo a LEFT JOIN persona p ON p.id = a.persona_id
    ORDER BY a.detectado_en DESC`).all();
  res.json(rows.map(a => ({
    ...a,
    baja_pct: a.precio_inicial && a.precio < a.precio_inicial ? Math.round((1 - a.precio / a.precio_inicial) * 100) : 0,
    dias_publicado: Math.round((Date.now() - new Date(a.publicado_en).getTime()) / 864e5),
    es_nuevo: (Date.now() - new Date(a.detectado_en).getTime()) / 864e5 <= 3,
  })));
});

// Genera el mensaje de captación para el dueño del aviso (aprobación humana, como todo)
app.post('/api/radar/:id/captar', (req, res) => {
  const a = db.prepare('SELECT * FROM aviso_externo WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'no existe' });
  const compradores = db.prepare(`
    SELECT COUNT(*) n FROM busqueda b JOIN persona p ON p.id = b.persona_id
    WHERE b.estado = 'activa' AND p.no_contactar = 0
      AND (b.presupuesto_max IS NULL OR b.presupuesto_max * 1.15 >= ?)
      AND (b.presupuesto_min IS NULL OR b.presupuesto_min * 0.6 <= ?)`).get(a.precio, a.precio).n;
  const dias = Math.round((Date.now() - new Date(a.publicado_en).getTime()) / 864e5);
  const bajaTxt = a.bajas > 0 ? ` Vi que ajustaste el precio${a.bajas > 1 ? ' un par de veces' : ''} — pasa mucho cuando se publica sin tasación de mercado.` : '';
  const mensaje = [
    `Hola! Vi tu publicación de la ${a.titulo.split('—')[0].trim()} (hace ${dias >= 30 ? Math.round(dias / 30) + ' meses' : dias + ' días'} publicada).${bajaTxt}`,
    `Soy Leandro Ramos, broker náutico de San Fernando. Me dedico exactamente a esto: hoy tengo ${compradores} compradores activos buscando embarcaciones en ese rango de precio.`,
    `Si querés, te hago una tasación real con ventas concretas del Delta y la trabajo yo — vos no pagás nada hasta que se vende. ¿Te interesa que lo charlemos?`,
  ].join('\n\n');
  db.prepare('UPDATE aviso_externo SET contactado = 1 WHERE id = ?').run(a.id);
  if (a.persona_id) auditar(a.persona_id, 'captación desde radar', a.titulo, 'leandro');
  res.json({ ok: true, mensaje, compradores });
});

/* ============================== AGENDA (Google Calendar) ============================== */
app.get('/api/agenda', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, p.nombre AS persona, p.telefono,
           e.marca || ' ' || e.modelo || ' ' || COALESCE(e.anio,'') AS embarcacion
    FROM cita c JOIN persona p ON p.id = c.persona_id
    LEFT JOIN embarcacion e ON e.id = c.embarcacion_id
    WHERE c.fecha > datetime('now','-12 hours')
    ORDER BY c.fecha ASC`).all();
  res.json(rows);
});

app.post('/api/citas', (req, res) => {
  const b = req.body || {};
  if (!b.persona_id || !b.fecha || !b.tipo) return res.status(400).json({ error: 'faltan persona, tipo o fecha' });
  const persona = db.prepare('SELECT nombre FROM persona WHERE id = ?').get(b.persona_id);
  const emb = b.embarcacion_id ? db.prepare(`SELECT marca || ' ' || modelo AS et FROM embarcacion WHERE id = ?`).get(b.embarcacion_id) : null;
  const titulo = `${b.tipo} — ${persona ? persona.nombre : ''}${emb ? ' · ' + emb.et : ''}`;
  const sync = gcal.crearEvento({ titulo, fecha: b.fecha, notas: b.notas });
  const id = uid();
  db.prepare(`INSERT INTO cita (id,persona_id,embarcacion_id,tipo,fecha,notas,gcal_event_id) VALUES (?,?,?,?,?,?,?)`)
    .run(id, b.persona_id, b.embarcacion_id || null, b.tipo, b.fecha, b.notas || null, sync.event_id);
  auditar(b.persona_id, 'cita agendada', titulo, 'leandro');
  res.json({ ok: true, cita_id: id, gcal: sync });
});

app.delete('/api/citas/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM cita WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'no existe' });
  if (c.gcal_event_id) gcal.borrarEvento(c.gcal_event_id);
  db.prepare('DELETE FROM cita WHERE id = ?').run(req.params.id);
  auditar(c.persona_id, 'cita cancelada', c.tipo, 'leandro');
  res.json({ ok: true });
});

// Tasador público como página propia
app.get('/tasador', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tasador.html')));

const PORT = process.env.PORT || 3411;
app.listen(PORT, () => console.log(`CRM Náutico demo — http://localhost:${PORT}  ·  tasador público: /tasador`));
