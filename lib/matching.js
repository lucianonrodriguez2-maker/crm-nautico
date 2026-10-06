// Motor de coincidencias v2 (§4.1).
//
// Una sola función — evaluar(búsqueda, embarcación) — decide si un par encaja y por qué.
// La usan los dos sentidos del negocio:
//   · entra un barco  → ¿a quién le sirve?            (analizarEmbarcacion / generarPropuestas)
//   · entra una búsqueda → ¿qué barcos del stock le sirven? (candidatasParaBusqueda)
// Antes cada sentido tenía su propio puntaje y un barco podía ser candidato en una
// dirección y no en la otra. Ahora es imposible: hay una sola regla.
//
// Filtros duros descartan. Puntaje blando ordena. Cada punto queda explicado en `factores`
// y el motivo en texto es lo que le permite a Leandro decidir en dos segundos.
const { db, uid, now, config } = require('../db');

const j = (s, def = []) => { try { return JSON.parse(s) ?? def; } catch { return def; } };
const usd = (n) => 'USD ' + Number(n).toLocaleString('es-AR');

// Tipos compatibles: una cuddy le puede servir a quien busca crucero chico y viceversa.
const TIPOS_AFINES = {
  'lancha open': ['lancha open'],
  'lancha cuddy': ['lancha cuddy', 'crucero'],
  'crucero': ['crucero', 'lancha cuddy'],
  'semirrigido/tracker': ['semirrigido/tracker'],
  'moto de agua': ['moto de agua'],
  'de coleccion': ['de coleccion'],
};

function parametros() {
  return {
    tolerancia: parseFloat(config('matching.tolerancia_precio', '0.15')),
    toleranciaCasi: parseFloat(config('matching.tolerancia_casi', '0.30')),
    piso: parseFloat(config('matching.piso_presupuesto', '0.60')),
    puntajeMinimo: parseFloat(config('matching.puntaje_minimo', '25')),
  };
}

function diasDesde(iso) {
  if (!iso) return 9999;
  return (Date.now() - new Date(iso).getTime()) / 864e5;
}

const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const numeroDeModelo = (s) => { const m = String(s || '').match(/(\d{2,4})/); return m ? parseInt(m[1], 10) : null; };

/**
 * ¿El barco es "de la misma línea" que el modelo que la persona nombró?
 * "Quicksilver 1700" ↔ Quicksilver 1800 / 1600 / 2000 → sí. Misma marca, número cercano.
 */
function afinidadDeModelo(referencia, e) {
  if (!referencia) return null;
  const ref = String(referencia);
  const marcaBarco = normalizar(e.marca);
  if (!marcaBarco || !normalizar(ref).startsWith(marcaBarco.slice(0, 5))) return null;
  const nRef = numeroDeModelo(ref.replace(new RegExp(e.marca, 'i'), ''));
  const nBarco = numeroDeModelo(e.modelo);
  if (nRef && nBarco) {
    if (nRef === nBarco) return { nivel: 'mismo', texto: `es justo el modelo que nombró (${ref})` };
    if (Math.abs(nRef - nBarco) <= 300 && String(nRef).length === String(nBarco).length) {
      return { nivel: 'linea', texto: `nombró una ${ref}: esta es de la misma línea, un escalón ${nBarco > nRef ? 'arriba' : 'abajo'}` };
    }
  }
  return { nivel: 'marca', texto: `es ${e.marca}, la marca que nombró` };
}

/**
 * Evalúa un par búsqueda ↔ embarcación.
 * @param b  fila de busqueda unida a persona (nombre, telefono, no_contactar, ultima_interaccion…)
 * @param e  fila de embarcacion
 * @param ctx { senalesRecientes?: number, params? }
 * @returns {{pasa, casi, descartes, puntaje, factores, motivo}}
 *   casi: si el ÚNICO problema es el precio y está dentro de la tolerancia "casi",
 *         { precioQueEntra } = a cuánto tendría que bajar el dueño para que entre.
 */
function evaluar(b, e, ctx = {}) {
  const p = ctx.params || parametros();
  const descartes = [];
  const factores = [];
  const suma = (clave, puntos, texto) => factores.push({ clave, puntos, texto });

  // ——— Filtros duros ———
  if (b.no_contactar) descartes.push('pidió no ser contactado');
  if (e.propietario_id && e.propietario_id === b.persona_id) descartes.push('es su propio barco');

  const tiposBuscados = j(b.tipo_embarcacion);
  if (tiposBuscados.length && !tiposBuscados.some(t => (TIPOS_AFINES[t] || [t]).includes(e.tipo))) {
    descartes.push(`busca ${tiposBuscados.join(' o ')} y esto es ${e.tipo}`);
  }
  if (b.necesita_bano && !e.tiene_bano) descartes.push('necesita baño y no tiene');

  let casi = null;
  if (b.presupuesto_max && e.precio_pedido) {
    const techo = b.presupuesto_max * (1 + p.tolerancia);
    if (e.precio_pedido > techo) {
      const techoCasi = b.presupuesto_max * (1 + p.toleranciaCasi);
      const exceso = Math.round((e.precio_pedido / b.presupuesto_max - 1) * 100);
      descartes.push(`se pasa ${exceso}% de su presupuesto (${usd(b.presupuesto_max)})`);
      if (e.precio_pedido <= techoCasi) casi = { precioQueEntra: Math.floor(techo / 500) * 500 };
    }
  }
  if (b.presupuesto_min && e.precio_pedido && e.precio_pedido < b.presupuesto_min * p.piso) {
    descartes.push('está muy por debajo de lo que busca (otra categoría de barco)');
  }

  // "casi" solo vale si el precio es el ÚNICO motivo de descarte
  if (casi && descartes.length > 1) casi = null;

  // ——— Puntaje blando (se calcula igual aunque no pase: sirve para mostrar el "casi") ———
  if (tiposBuscados.includes(e.tipo)) suma('tipo', 20, `es ${e.tipo}, lo que busca`);
  else if (tiposBuscados.length) suma('tipo', 10, `${e.tipo}: no es exactamente lo que pidió, pero le sirve`);

  if (b.presupuesto_max && e.precio_pedido) {
    if (e.precio_pedido <= b.presupuesto_max) {
      suma('precio', 20, `entra en su presupuesto (hasta ${usd(b.presupuesto_max)})`);
    } else if (e.precio_pedido <= b.presupuesto_max * (1 + p.tolerancia)) {
      const exceso = Math.round((e.precio_pedido / b.presupuesto_max - 1) * 100);
      suma('precio', 8, `se pasa ${exceso}% del presupuesto, dentro de lo que la gente suele estirar`);
    }
  }

  if (b.eslora_min != null && b.eslora_max != null && e.eslora) {
    if (e.eslora >= b.eslora_min && e.eslora <= b.eslora_max) suma('eslora', 15, `la eslora (${e.eslora} m) está en el rango que pidió`);
    else {
      const d = Math.min(Math.abs(e.eslora - b.eslora_min), Math.abs(e.eslora - b.eslora_max));
      if (d <= 0.5) suma('eslora', 8, `eslora apenas fuera del rango (${e.eslora} m)`);
      else if (d > 1.2) suma('eslora', -5, `eslora lejos de lo que pidió (${e.eslora} m)`);
    }
  }

  const afin = afinidadDeModelo(b.modelo_referencia, e);
  if (afin) suma('modelo', afin.nivel === 'mismo' ? 14 : afin.nivel === 'linea' ? 10 : 5, afin.texto);
  const marcas = j(b.marcas_preferidas).map(normalizar);
  if (!afin && marcas.length && marcas.includes(normalizar(e.marca))) suma('marca', 6, `es ${e.marca}, una de las marcas que prefiere`);

  const usos = j(b.uso_declarado);
  const equip = j(e.equipamiento).map(x => String(x).toLowerCase());
  const tieneTorre = equip.some(x => x.includes('torre'));
  if (usos.includes('wakeboard/deportes') && (tieneTorre || (e.motor_hp || 0) >= 150)) {
    suma('uso', 12, 'sirve para wake' + (tieneTorre ? ' (tiene torre)' : ' (potencia suficiente)'));
  }
  if (usos.includes('pesca') && (equip.some(x => x.includes('ecosonda') || x.includes('caña')) || e.tipo === 'semirrigido/tracker')) {
    suma('uso', 8, 'perfil de pesca');
  }
  if (usos.includes('dormir a bordo') && e.tiene_bano) suma('uso', 8, 'tiene baño para hacer noche');
  if (b.necesita_bano && e.tiene_bano) suma('bano', 0, 'tiene baño, que era condición');

  if (b.necesita_trailer) {
    if (e.tiene_trailer) suma('trailer', 6, 'viene con trailer, que lo pedía');
    else suma('trailer', -6, 'pidió trailer y no incluye');
  }
  if (b.motor_tipo && b.motor_tipo !== 'indistinto' && e.motor_tipo === b.motor_tipo) suma('motor', 5, `motor ${e.motor_tipo}, como prefiere`);
  if (b.hp_min && e.motor_hp) {
    if (e.motor_hp >= b.hp_min) suma('hp', 4, `${e.motor_hp} HP, cubre lo que pide`);
    else suma('hp', -8, `${e.motor_hp} HP, menos de los ${b.hp_min} que pide`);
  }

  // Temperatura: búsqueda reciente y persona activa pesan más
  const edadBusq = diasDesde(b.creada_en);
  const pBusq = edadBusq < 30 ? 10 : edadBusq < 90 ? 6 : edadBusq < 180 ? 3 : 0;
  if (pBusq) suma('recencia', pBusq, `consultó ${etiquetaAntiguedad(b.creada_en)}`);
  const temp = diasDesde(b.ultima_interaccion);
  const pTemp = temp < 7 ? 8 : temp < 30 ? 5 : temp < 90 ? 2 : 0;
  if (pTemp) suma('temperatura', pTemp, 'tuvo contacto reciente');
  if (b.urgencia === 'ya') suma('urgencia', 8, 'quiere comprar ya');
  const senales = ctx.senalesRecientes ?? 0;
  if (senales > 0) suma('senales', Math.min(9, senales * 3), 'tiene señales de interés recientes');

  const puntaje = Math.round(factores.reduce((a, f) => a + f.puntos, 0));
  const pasa = descartes.length === 0;
  return { pasa, casi, descartes, puntaje, factores, motivo: armarMotivo(b, e, factores) };
}

function armarMotivo(b, e, factores) {
  const tipos = j(b.tipo_embarcacion).join(' o ');
  let base = `Buscaba ${tipos || 'una embarcación'}`;
  if (b.modelo_referencia) base += ` (nombró una ${b.modelo_referencia})`;
  if (b.presupuesto_max) base += ` hasta ${usd(b.presupuesto_max)}`;
  const usos = j(b.uso_declarado);
  if (usos.length) base += ` para ${usos.join(' y ')}`;
  base += ` — ${etiquetaAntiguedad(b.creada_en)}.`;
  const destacados = factores
    .filter(f => f.puntos > 0 && !['recencia', 'temperatura', 'tipo'].includes(f.clave))
    .sort((x, y) => y.puntos - x.puntos)
    .slice(0, 3)
    .map(f => f.texto[0].toUpperCase() + f.texto.slice(1));
  const partes = [base];
  if (destacados.length) partes.push(destacados.join('. ') + '.');
  if (b.limitacion_declarada) partes.push(`Dijo: "${b.limitacion_declarada}".`);
  return partes.join(' ');
}

function etiquetaAntiguedad(iso) {
  const d = diasDesde(iso);
  if (d < 1) return 'hoy';
  if (d < 7) return 'esta semana';
  if (d < 35) return 'hace ' + Math.max(1, Math.round(d / 7)) + ' semanas';
  if (d < 60) return 'hace un mes';
  return 'hace ' + Math.round(d / 30) + ' meses';
}

/* ————————————————————————————————— Mensajes ————————————————————————————————— */

const ARTICULO = {
  'crucero': 'un crucero', 'semirrigido/tracker': 'un semirrígido', 'moto de agua': 'una moto de agua',
  'de coleccion': 'un clásico', 'lancha open': 'una open', 'lancha cuddy': 'una cuddy',
};

// Borrador — NUNCA se envía solo (§4.1). precio_minimo_aceptado jamás aparece (§4.4).
function redactarMensaje(b, e, { origen = 'alta', precioAnterior = null, yaOfrecida = false } = {}) {
  const nombre = (b.nombre || '').split(' ')[0];
  const barco = `${e.marca} ${e.modelo} ${e.anio || ''}`.trim();
  const tipos = j(b.tipo_embarcacion);
  const ref = b.modelo_referencia ? `una ${b.modelo_referencia}` : (tipos.length ? (ARTICULO[tipos[0]] || 'una ' + tipos[0]) : 'una embarcación');

  if (origen === 'precio_bajado' && yaOfrecida && precioAnterior) {
    return [
      `Hola ${nombre}! ¿Te acordás de la ${barco} que te pasé? Te aviso porque bajó de precio: ahora está en ${usd(e.precio_pedido)} (antes ${usd(precioAnterior)}).`,
      `Si te sigue interesando, coordinamos para que la veas. ¡Avisame si querés saber más sobre esta embarcación!`,
    ].join('\n\n');
  }
  const ficha = [
    e.eslora ? `${e.eslora} m` : null,
    e.motor_marca || e.motor_hp ? `${e.motor_marca || ''} ${e.motor_hp ? e.motor_hp + ' HP' : ''}`.trim() : null,
    e.motor_horas != null ? `${e.motor_horas} horas` : null,
  ].filter(Boolean).join(', ');
  const extras = [e.tiene_bano ? 'con baño' : null, e.tiene_trailer ? 'trailer incluido' : null].filter(Boolean).join(' y ');
  const intro = origen === 'precio_bajado'
    ? `Hola ${nombre}! Soy Leandro, del broker náutico de San Fernando. Me consultaste por ${ref} y te aviso de una que bajó de precio y ahora entra en lo que buscabas.`
    : `Hola ${nombre}! Soy Leandro, del broker náutico de San Fernando. Hace un tiempo me consultaste por ${ref} y quedé en avisarte si entraba algo que encaje.`;
  return [
    intro,
    `${origen === 'precio_bajado' ? 'Es una' : 'Acaba de entrar una'} ${barco}${ficha ? ', ' + ficha : ''}${extras ? ', ' + extras : ''}. Está en ${e.precio_pedido ? usd(e.precio_pedido) : 'precio a consultar'}.`,
    `¿Querés que te mande fotos y la ficha completa? ¡Avisame si querés saber más sobre esta embarcación!`,
  ].join('\n\n');
}

/* ————————————————————————————————— Consultas ————————————————————————————————— */

const SQL_BUSQUEDAS_ACTIVAS = `
  SELECT b.*, p.nombre, p.telefono, p.instagram_handle, p.no_contactar, p.ultima_interaccion,
         p.contexto_personal, p.estado AS persona_estado
  FROM busqueda b JOIN persona p ON p.id = b.persona_id
  WHERE b.estado = 'activa'`;

function senalesRecientesPorPersona() {
  const rows = db.prepare(`SELECT persona_id, COUNT(*) n FROM senal WHERE fecha > datetime('now','-30 days') GROUP BY persona_id`).all();
  return Object.fromEntries(rows.map(r => [r.persona_id, r.n]));
}

/**
 * Todo lo que el motor sabe de un barco frente a las búsquedas activas:
 *   candidatos — le sirve, ordenado por puntaje
 *   casi       — no entra SOLO por precio: a cuánto tendría que bajar para que entre
 *   umbrales   — "si baja a USD X, se suman N compradores" (acumulado, para negociar con el dueño)
 */
function analizarEmbarcacion(embId) {
  const e = db.prepare('SELECT * FROM embarcacion WHERE id = ?').get(embId);
  if (!e) return { embarcacion: null, candidatos: [], casi: [], umbrales: [] };
  const params = parametros();
  const senales = senalesRecientesPorPersona();
  const candidatos = [];
  const casi = [];
  for (const b of db.prepare(SQL_BUSQUEDAS_ACTIVAS).all()) {
    const r = evaluar(b, e, { params, senalesRecientes: senales[b.persona_id] || 0 });
    const fila = {
      busqueda: b, persona_id: b.persona_id, nombre: b.nombre, telefono: b.telefono,
      instagram_handle: b.instagram_handle, contexto_personal: b.contexto_personal,
      puntaje: r.puntaje, motivo: r.motivo, factores: r.factores,
      via: b.telefono ? 'whatsapp' : 'copy-paste',
    };
    if (r.pasa) candidatos.push({ ...fila, mensaje_borrador: redactarMensaje(b, e) });
    else if (r.casi) casi.push({ ...fila, precioQueEntra: r.casi.precioQueEntra, descartes: r.descartes });
  }
  candidatos.sort((a, z) => z.puntaje - a.puntaje);
  casi.sort((a, z) => z.precioQueEntra - a.precioQueEntra);
  return { embarcacion: e, candidatos, casi, umbrales: umbralesDePrecio(casi) };
}

/** Agrupa los "casi" en escalones de precio con conteo acumulado. */
function umbralesDePrecio(casi) {
  const porPrecio = new Map();
  for (const c of casi) porPrecio.set(c.precioQueEntra, (porPrecio.get(c.precioQueEntra) || []).concat(c.nombre));
  let acumulado = 0;
  return [...porPrecio.entries()]
    .sort((a, z) => z[0] - a[0])
    .map(([precio, nombres]) => { acumulado += nombres.length; return { precio, se_suman: nombres.length, total: acumulado, nombres }; });
}

/** Compatibilidad con las rutas existentes: solo los candidatos. */
function candidatosParaEmbarcacion(embId) {
  return analizarEmbarcacion(embId).candidatos;
}

/** Sentido inverso: qué barcos del stock le sirven a una búsqueda. Misma regla, mismo puntaje. */
function candidatasParaBusqueda(b, { limite = 4 } = {}) {
  const params = parametros();
  const persona = b.nombre !== undefined ? b
    : { ...b, ...db.prepare('SELECT nombre, telefono, no_contactar, ultima_interaccion FROM persona WHERE id = ?').get(b.persona_id) };
  const senales = senalesRecientesPorPersona()[b.persona_id] || 0;
  const out = [];
  for (const e of db.prepare(`SELECT * FROM embarcacion WHERE situacion = 'en venta' AND precio_pedido IS NOT NULL`).all()) {
    const r = evaluar(persona, e, { params, senalesRecientes: senales });
    if (!r.pasa || r.puntaje < params.puntajeMinimo) continue;
    out.push({
      id: e.id, etiqueta: `${e.marca} ${e.modelo} ${e.anio || ''}`.trim(), tipo: e.tipo,
      precio: e.precio_pedido, eslora: e.eslora, url: e.url_publicacion,
      foto: j(e.fotos)[0] || null, ingresada_en: e.ingresada_en,
      puntaje: r.puntaje, motivo: r.motivo, factores: r.factores,
    });
  }
  out.sort((a, z) => z.puntaje - a.puntaje);
  return out.slice(0, limite);
}

/** Una búsqueda puntual contra un barco puntual (botón "Ofrecer"). */
function propuestaPuntual(busquedaId, embarcacionId) {
  const b = db.prepare(SQL_BUSQUEDAS_ACTIVAS + ' AND b.id = ?').get(busquedaId);
  const e = db.prepare('SELECT * FROM embarcacion WHERE id = ?').get(embarcacionId);
  if (!b || !e) return null;
  const r = evaluar(b, e, { senalesRecientes: senalesRecientesPorPersona()[b.persona_id] || 0 });
  if (!r.pasa) return null;
  return {
    busqueda: b, persona_id: b.persona_id, nombre: b.nombre, telefono: b.telefono,
    puntaje: r.puntaje, motivo: r.motivo, factores: r.factores,
    via: b.telefono ? 'whatsapp' : 'copy-paste', mensaje_borrador: redactarMensaje(b, e),
  };
}

/**
 * Convierte el análisis en propuestas pendientes de aprobación. Idempotente:
 *   · nunca duplica una propuesta pendiente para el mismo par
 *   · no vuelve a proponer lo que Leandro ya descartó ni lo que ya se envió…
 *   · …salvo origen 'precio_bajado': a quien ya se le ofreció se le arma el aviso de baja.
 * @returns propuestas creadas (con persona y puntaje) para avisar al operador
 */
function generarPropuestas(embId, { origen = 'alta', precioAnterior = null } = {}) {
  const { embarcacion: e, candidatos } = analizarEmbarcacion(embId);
  if (!e || e.situacion !== 'en venta') return [];
  const previa = db.prepare(`SELECT estado, origen FROM propuesta WHERE embarcacion_id = ? AND busqueda_id = ? ORDER BY creada_en DESC LIMIT 1`);
  const ins = db.prepare(`INSERT INTO propuesta (id,embarcacion_id,busqueda_id,persona_id,puntaje,motivo,mensaje_borrador,via,estado,creada_en,origen,factores)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const creadas = [];
  const tx = db.transaction(() => {
    for (const c of candidatos) {
      const ant = previa.get(e.id, c.busqueda.id);
      if (ant && ant.estado === 'pendiente') continue;               // ya está esperando aprobación
      if (ant && ant.estado === 'descartada') continue;              // Leandro dijo que no
      const yaOfrecida = !!ant && ant.estado.includes('aprobada');
      if (yaOfrecida && origen !== 'precio_bajado') continue;        // ya se le mandó
      if (yaOfrecida && !precioAnterior) continue;                   // sin precio anterior no hay "bajó de precio" que contar
      // Con una baja de precio: ¿entra GRACIAS a la baja, o ya entraba y nunca se le ofreció?
      // El aviso no puede decir "con el precio nuevo le sirve" si le servía igual.
      const entraPorPrecio = origen === 'precio_bajado' && !yaOfrecida && !!precioAnterior &&
        !evaluar(c.busqueda, { ...e, precio_pedido: precioAnterior }).pasa;
      const origenReal = yaOfrecida || entraPorPrecio ? 'precio_bajado' : (origen === 'precio_bajado' ? 'alta' : origen);
      const mensaje = redactarMensaje(c.busqueda, e, { origen: origenReal, precioAnterior, yaOfrecida });
      const id = uid();
      ins.run(id, e.id, c.busqueda.id, c.persona_id, c.puntaje, c.motivo, mensaje, c.via, 'pendiente', now(),
        origenReal, JSON.stringify(c.factores));
      creadas.push({ id, persona_id: c.persona_id, nombre: c.nombre, puntaje: c.puntaje, via: c.via, yaOfrecida, entraPorPrecio, motivo: c.motivo });
    }
  });
  tx();
  return creadas;
}

/** Al crear o reabrir una búsqueda: propuestas con los barcos del stock que ya le sirven. */
function generarPropuestasParaBusqueda(busquedaId) {
  const b = db.prepare(SQL_BUSQUEDAS_ACTIVAS + ' AND b.id = ?').get(busquedaId);
  if (!b) return [];
  const previa = db.prepare(`SELECT estado FROM propuesta WHERE embarcacion_id = ? AND busqueda_id = ? ORDER BY creada_en DESC LIMIT 1`);
  const ins = db.prepare(`INSERT INTO propuesta (id,embarcacion_id,busqueda_id,persona_id,puntaje,motivo,mensaje_borrador,via,estado,creada_en,origen,factores)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const creadas = [];
  for (const c of candidatasParaBusqueda(b, { limite: 3 })) {
    if (previa.get(c.id, b.id)) continue;
    const e = db.prepare('SELECT * FROM embarcacion WHERE id = ?').get(c.id);
    const id = uid();
    ins.run(id, c.id, b.id, b.persona_id, c.puntaje, c.motivo, redactarMensaje(b, e), b.telefono ? 'whatsapp' : 'copy-paste',
      'pendiente', now(), 'busqueda_nueva', JSON.stringify(c.factores));
    creadas.push({ id, embarcacion_id: c.id, etiqueta: c.etiqueta, puntaje: c.puntaje });
  }
  return creadas;
}

module.exports = {
  evaluar, analizarEmbarcacion, umbralesDePrecio, redactarMensaje,
  candidatosParaEmbarcacion, candidatasParaBusqueda, propuestaPuntual,
  generarPropuestas, generarPropuestasParaBusqueda, afinidadDeModelo, TIPOS_AFINES,
};
