// Núcleo de la carga de unidades por WhatsApp (o cualquier canal).
//
// Leandro está en la guardería frente a un barco que acaba de tomar. Le saca fotos y escribe
// como le sale: "Quicksilver 1800 del 2017, Mercury 115, 400 hs, con trailer, pide 23.500.
// Dueño Juan Pérez 11 5555 1234". El sistema:
//
//   1. arma un BORRADOR con lo que entendió y le dice qué falta (no publica nada solo)
//   2. suma lo que mande después ("ah, y tiene baño") o corrige ("no, el precio es 24.000")
//   3. con LISTO publica en el inventario → evento embarcacion.publicada → matching
//   4. le contesta a quién le sirve: "1) Carla 2) Gustavo… respondé con los números"
//   5. "1 2" → se envían esos mensajes (la aprobación humana sigue existiendo: es él)
//
// También entiende novedades de unidades que ya están en venta:
//   "la Klase A 2400 bajó a 52 lucas"  → nuevo precio → re-matching + aviso a los ya ofrecidos
//   "se vendió la Prinz 630"           → sale de la venta y se retiran las propuestas pendientes
//
// No sabe por qué canal llegó el mensaje: recibe {canal, operadorTel, texto, medios} y
// devuelve los textos a contestar. Los adaptadores (simulador, Cloud API) hacen el resto.
const { db, uid, now, normalizarTelefono, auditar } = require('../../db');
const { extraerEmbarcacion } = require('./extraccion-embarcacion');
const { guardarFoto } = require('./fotos');
const canales = require('./canales');
const avisos = require('./avisos');
const eventos = require('../eventos');
const { analizarEmbarcacion } = require('../matching');
const { upsertPersona, agregarRol } = require('../personas');
const { aprobarPropuesta, descartarPropuesta } = require('../propuestas');

const j = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
const usd = (n) => 'USD ' + Number(n).toLocaleString('es-AR');

const OBLIGATORIOS = [
  ['tipo', 'tipo (open, cuddy, crucero, semirrígido o moto de agua)'],
  ['marca', 'marca'], ['modelo', 'modelo'], ['anio', 'año'], ['precio_pedido', 'precio pedido'],
];
const RECOMENDADOS = [
  ['eslora', 'eslora'], ['motor_hp', 'potencia del motor'], ['motor_horas', 'horas de motor'],
  ['propietario_telefono', 'teléfono del dueño'],
];
const ETIQUETA_CAMPO = {
  tipo: 'tipo', marca: 'marca', modelo: 'modelo', anio: 'año', eslora: 'eslora', manga: 'manga',
  motor_marca: 'marca de motor', motor_hp: 'potencia', cantidad_motores: 'cantidad de motores',
  motor_tipo: 'tipo de motor', motor_horas: 'horas', combustible_litros: 'combustible',
  equipamiento: 'equipamiento', estado_general: 'estado', tiene_bano: 'baño', tiene_trailer: 'trailer',
  precio_pedido: 'precio', precio_minimo_aceptado: 'precio mínimo', propietario_nombre: 'dueño',
  propietario_telefono: 'teléfono del dueño', exclusividad: 'exclusividad', papeles_estado: 'papeles', notas: 'notas',
};

const AYUDA = [
  'Soy el asistente de carga del CRM. Podés:',
  '• Cargar una unidad: mandame fotos y los datos como te salgan. Ej: "Quicksilver 1800 del 2017, open, Mercury 115 con 400 hs, con trailer, pide 23.500. Dueño Juan Pérez 11 5555 1234"',
  '• Cambiar un precio: "la Klase A 2400 bajó a 52 lucas"',
  '• Marcar una venta: "se vendió la Prinz 630"',
  'Comandos: LISTO (publicar) · ESTADO (ver el borrador) · CANCELAR',
].join('\n');

/* ——————————————————————————————— Operadores ——————————————————————————————— */

function normalizarOperador(tel) {
  const t = String(tel || '').trim();
  return t.startsWith('sim:') ? t : normalizarTelefono(t);
}

function operadorActivo(tel) {
  return db.prepare('SELECT * FROM operador WHERE telefono = ? AND activo = 1').get(tel) || null;
}

/* ——————————————————————————————— Borradores ——————————————————————————————— */

function borradorAbierto(tel) {
  const b = db.prepare(`SELECT * FROM borrador_embarcacion WHERE operador_tel = ? AND estado = 'abierto' ORDER BY actualizado_en DESC LIMIT 1`).get(tel);
  return b ? { ...b, datos: j(b.datos, {}), fotos: j(b.fotos, []) } : null;
}

function crearBorrador(tel, canal) {
  const id = uid();
  db.prepare(`INSERT INTO borrador_embarcacion (id, operador_tel, canal, estado, datos, fotos, creado_en, actualizado_en) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, tel, canal, 'abierto', '{}', '[]', now(), now());
  return { id, operador_tel: tel, canal, estado: 'abierto', datos: {}, fotos: [] };
}

function guardarBorrador(b) {
  db.prepare('UPDATE borrador_embarcacion SET datos = ?, fotos = ?, estado = ?, embarcacion_id = ?, actualizado_en = ? WHERE id = ?')
    .run(JSON.stringify(b.datos), JSON.stringify(b.fotos), b.estado, b.embarcacion_id || null, now(), b.id);
}

/** Suma lo nuevo sobre lo que ya había. Lo que el mensaje no menciona (null) no pisa nada. */
function fusionar(datos, nuevo) {
  const cambiados = [];
  for (const [k, v] of Object.entries(nuevo)) {
    if (k.startsWith('_') || k === 'intencion' || k === 'referencia') continue;
    if (k === 'equipamiento') {
      const antes = datos.equipamiento || [];
      const despues = [...new Set([...antes, ...(v || [])])];
      if (despues.length > antes.length) { datos.equipamiento = despues; cambiados.push(k); }
      continue;
    }
    if (v === null || v === undefined || v === '') continue;
    if (k === 'notas') { // las notas se acumulan, no se pisan, y no se anuncian
      if (!String(datos.notas || '').includes(v)) datos.notas = datos.notas ? `${datos.notas} · ${v}` : v;
      continue;
    }
    if (datos[k] !== v) { if (datos[k] != null) cambiados.push(k); datos[k] = v; }
  }
  return cambiados;
}

const faltantes = (datos, lista) => lista.filter(([k]) => datos[k] == null || datos[k] === '').map(([, nombre]) => nombre);
const etiquetaDe = (d) => [d.marca, d.modelo, d.anio].filter(Boolean).join(' ') || 'la unidad';

function resumen(b, { cambiados = [] } = {}) {
  const d = b.datos;
  const lineas = [];
  if (cambiados.length) lineas.push(`✏️ Actualicé: ${cambiados.map(k => ETIQUETA_CAMPO[k] || k).join(', ')}.`);
  lineas.push(`📋 Borrador: ${etiquetaDe(d)}${d.tipo ? ' · ' + d.tipo : ''}`);
  if (d.precio_pedido) lineas.push(`💵 ${usd(d.precio_pedido)}${d.precio_minimo_aceptado ? ` (mínimo privado ${usd(d.precio_minimo_aceptado)})` : ''}`);
  const motor = [d.cantidad_motores > 1 ? `${d.cantidad_motores} × ` : '', d.motor_marca, d.motor_hp ? d.motor_hp + ' HP' : null, d.motor_tipo, d.motor_horas != null ? d.motor_horas + ' hs' : null].filter(Boolean).join(' ').replace('×  ', '× ');
  if (motor.trim()) lineas.push(`⚙️ ${motor}`);
  const casco = [d.eslora ? `${String(d.eslora).replace('.', ',')} m` : null,
    d.tiene_bano === true ? 'con baño' : d.tiene_bano === false ? 'sin baño' : null,
    d.tiene_trailer === true ? 'con trailer' : d.tiene_trailer === false ? 'sin trailer' : null,
    d.estado_general].filter(Boolean).join(' · ');
  if (casco) lineas.push(`📏 ${casco}`);
  if (d.equipamiento && d.equipamiento.length) lineas.push(`🧰 ${d.equipamiento.join(', ')}`);
  if (d.propietario_nombre || d.propietario_telefono) lineas.push(`👤 Dueño: ${[d.propietario_nombre, d.propietario_telefono && `(${d.propietario_telefono})`].filter(Boolean).join(' ')}`);
  if (b.fotos.length) lineas.push(`📷 ${b.fotos.length} foto${b.fotos.length > 1 ? 's' : ''}`);

  const dup = posibleDuplicado(d);
  if (dup) lineas.push(`⚠️ Ojo: ya hay una ${dup.marca} ${dup.modelo} ${dup.anio || ''} en venta (ingresó hace ${Math.max(1, Math.round((Date.now() - new Date(dup.ingresada_en)) / 864e5))} días). Si es otra unidad, seguí igual.`);

  const falta = faltantes(d, OBLIGATORIOS);
  const opcional = faltantes(d, RECOMENDADOS);
  lineas.push('');
  if (falta.length) {
    lineas.push(`Para publicarla me falta: ${falta.join(', ')}.`);
    if (opcional.length) lineas.push(`Si lo tenés, sumá también: ${opcional.join(', ')}.`);
  } else {
    if (opcional.length) lineas.push(`Opcional: ${opcional.join(', ')}.`);
    lineas.push('Respondé LISTO para publicarla, o mandame lo que quieras corregir.');
  }
  return lineas.join('\n');
}

function posibleDuplicado(d) {
  if (!d.marca || !d.modelo) return null;
  return db.prepare(`SELECT * FROM embarcacion WHERE situacion = 'en venta' AND lower(marca) = lower(?) AND lower(modelo) = lower(?) AND (? IS NULL OR anio = ?)`)
    .get(d.marca, String(d.modelo), d.anio ?? null, d.anio ?? null) || null;
}

/* ——————————————————————————————— Publicar ——————————————————————————————— */

function publicar(b, operador) {
  const d = b.datos;
  let propietarioId = null;
  if (d.propietario_nombre || d.propietario_telefono) {
    const { persona } = upsertPersona({ nombre: d.propietario_nombre, telefono: d.propietario_telefono, origen: 'otro' });
    propietarioId = persona.id;
    agregarRol(propietarioId, 'vendedor');
  }
  const id = uid();
  db.prepare(`INSERT INTO embarcacion (id,tipo,marca,modelo,anio,eslora,manga,motor_marca,motor_hp,cantidad_motores,motor_tipo,motor_horas,
      combustible_litros,equipamiento,estado_general,tiene_bano,tiene_trailer,precio_pedido,precio_minimo_aceptado,propietario_id,
      situacion,exclusividad,papeles_estado,fotos,notas,cargada_por,ingresada_en)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, d.tipo, d.marca, String(d.modelo), d.anio, d.eslora ?? null, d.manga ?? null, d.motor_marca ?? null, d.motor_hp ?? null,
      d.cantidad_motores ?? null, d.motor_tipo ?? null, d.motor_horas ?? null, d.combustible_litros ?? null,
      JSON.stringify(d.equipamiento || []), d.estado_general ?? null, d.tiene_bano ? 1 : 0, d.tiene_trailer ? 1 : 0,
      d.precio_pedido, d.precio_minimo_aceptado ?? null, propietarioId, 'en venta', d.exclusividad || 'a confirmar',
      d.papeles_estado || 'sin revisar', JSON.stringify(b.fotos.map(f => f.url)), d.notas ?? null,
      `${operador.nombre} · ${b.canal}`, now());
  b.estado = 'publicado';
  b.embarcacion_id = id;
  guardarBorrador(b);
  auditar(propietarioId, 'alta de embarcación', `${etiquetaDe(d)} · cargada por ${operador.nombre} vía ${b.canal}`, operador.nombre);
  // respondeIntake: el aviso de matching va en esta misma respuesta, en orden (ver automatizaciones)
  const ev = eventos.emitir('embarcacion.publicada', id, { operador_tel: b.operador_tel, canal: b.canal, borrador_id: b.id, respondeIntake: true });
  return { embarcacionId: id, propuestas: (ev.resultado && ev.resultado.matching) || [] };
}

/* ——————————————————————————— Novedades de unidades en venta ——————————————————————————— */

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/** Encuentra la unidad en venta que nombra el operador ("la Klase A 2400"). */
function buscarEnVenta(extraido) {
  const ref = norm(extraido.referencia);
  const marca = norm(extraido.marca), modelo = norm(extraido.modelo);
  return db.prepare(`SELECT * FROM embarcacion WHERE situacion = 'en venta'`).all()
    .map(e => {
      let s = 0;
      if (marca && norm(e.marca) === marca) s += 2;
      if (modelo && norm(e.modelo) === modelo) s += 3;
      else if (modelo && norm(e.modelo).includes(modelo)) s += 1;
      if (extraido.anio && e.anio === extraido.anio) s += 2;
      if (!marca && ref && ref.includes(norm(e.modelo)) && norm(e.modelo).length > 2) s += 2;
      return { e, s };
    })
    .filter(x => x.s >= 3)
    .sort((a, z) => z.s - a.s)
    .filter((x, _, arr) => x.s === arr[0].s)
    .map(x => x.e);
}

function aplicarPrecio(e, precio, operador) {
  const anterior = e.precio_pedido;
  db.prepare('UPDATE embarcacion SET precio_pedido = ? WHERE id = ?').run(precio, e.id);
  auditar(e.propietario_id, 'cambio de precio', `${e.marca} ${e.modelo}: ${usd(anterior)} → ${usd(precio)}`, operador.nombre);
  const etiqueta = `${e.marca} ${e.modelo} ${e.anio || ''}`.trim();
  const textos = [`✓ ${etiqueta}: ${usd(anterior)} → ${usd(precio)}.` + (e.precio_minimo_aceptado && precio < e.precio_minimo_aceptado
    ? `\n⚠️ Quedó por debajo del mínimo que había aceptado el dueño (${usd(e.precio_minimo_aceptado)}). Si lo autorizó, actualizá el mínimo en la ficha.` : '')];
  if (precio < anterior) {
    const ev = eventos.emitir('embarcacion.precio_bajado', e.id, { precio_anterior: anterior, precio_nuevo: precio, operador_tel: operador.telefono, respondeIntake: true });
    const creadas = (ev.resultado && ev.resultado.matching) || [];
    const { umbrales } = analizarEmbarcacion(e.id);
    textos.push(avisos.avisoPropuestas({ operadorTel: operador.telefono, embarcacionId: e.id, etiqueta, creadas, umbrales, motivoEvento: 'precio_bajado' }));
  }
  return textos;
}

function aplicarVenta(e, operador) {
  db.prepare(`UPDATE embarcacion SET situacion = 'vendida' WHERE id = ?`).run(e.id);
  const pendientes = db.prepare(`SELECT id FROM propuesta WHERE embarcacion_id = ? AND estado = 'pendiente'`).all(e.id);
  for (const p of pendientes) descartarPropuesta(p.id, { autor: operador.nombre });
  auditar(e.propietario_id, 'embarcación vendida', `${e.marca} ${e.modelo} ${e.anio || ''}`, operador.nombre);
  return [`✓ ${e.marca} ${e.modelo} ${e.anio || ''} marcada como vendida y fuera del inventario.${pendientes.length ? ` Retiré ${pendientes.length} propuesta${pendientes.length > 1 ? 's' : ''} que estaban sin enviar.` : ''} Cuando tengas el precio de cierre cargalo en Operaciones: alimenta el tasador.`];
}

function listarOpciones(operador, opciones, accion, extra) {
  avisos.guardarContexto(operador.telefono, 'elegir_embarcacion', { opciones: opciones.map(e => e.id), accion, ...extra });
  return [`Hay ${opciones.length} que coinciden. ¿Cuál?\n` +
    opciones.map((e, i) => `${i + 1}) ${e.marca} ${e.modelo} ${e.anio || ''} — ${usd(e.precio_pedido)}`).join('\n') +
    '\nRespondé con el número.'];
}

/* ——————————————————————————— Respuestas con números ——————————————————————————— */

const RE_SELECCION = /^(todos|todas|ninguno|ninguna|nadie|\d+(\s*(,|y|e|-|\s)\s*\d+)*)$/i;

function numeros(texto, max) {
  return [...new Set((texto.match(/\d+/g) || []).map(n => parseInt(n, 10)))].filter(n => n >= 1 && n <= max);
}

function resolverSeleccion(texto, ctx, operador) {
  const t = texto.toLowerCase();
  if (ctx.tipo === 'lista_propuestas') {
    const ids = ctx.datos.ids;
    if (/^(ninguno|ninguna|nadie)$/.test(t)) {
      ids.forEach(id => descartarPropuesta(id, { autor: operador.nombre }));
      avisos.borrarContexto(operador.telefono);
      return [`Listo, no se envía nada. Las ${ids.length} propuestas quedan descartadas.`];
    }
    const elegidas = /^(todos|todas)$/.test(t) ? ids.map((_, i) => i + 1) : numeros(t, ids.length);
    const invalidos = (t.match(/\d+/g) || []).map(Number).filter(n => n < 1 || n > ids.length);
    if (!elegidas.length) return [`No tengo ${invalidos.length ? 'ese número' : 'esa opción'} en la lista (son del 1 al ${ids.length}).`];
    const hechos = [];
    for (const n of elegidas) {
      try {
        const r = aprobarPropuesta(ids[n - 1], { autor: `${operador.nombre} (WhatsApp)` });
        hechos.push(`${r.persona}: ${r.envio.modo === 'copy-paste' ? 'queda para copiar en Instagram' : r.envio.modo === 'plantilla' ? 'enviado como plantilla de Meta' : 'enviado'}`);
      } catch (e) { hechos.push(`#${n}: ${e.message}`); }
    }
    const restantes = ids.filter((id, i) => !elegidas.includes(i + 1) && db.prepare(`SELECT estado FROM propuesta WHERE id = ?`).get(id)?.estado === 'pendiente');
    if (!restantes.length) avisos.borrarContexto(operador.telefono);
    return [`✓ ${ctx.datos.etiqueta}\n` + hechos.map(h => '• ' + h).join('\n') +
      (restantes.length ? `\n\nQuedan ${restantes.length} sin enviar: podés mandar otros números o verlas en el CRM.` : '')];
  }
  if (ctx.tipo === 'elegir_embarcacion') {
    const n = numeros(t, ctx.datos.opciones.length)[0];
    if (!n) return [`Respondé con un número del 1 al ${ctx.datos.opciones.length}.`];
    const e = db.prepare('SELECT * FROM embarcacion WHERE id = ?').get(ctx.datos.opciones[n - 1]);
    avisos.borrarContexto(operador.telefono);
    if (!e || e.situacion !== 'en venta') return ['Esa unidad ya no está en venta.'];
    return ctx.datos.accion === 'vendida' ? aplicarVenta(e, operador) : aplicarPrecio(e, ctx.datos.precio, operador);
  }
  return null;
}

/* ——————————————————————————————— Entrada ——————————————————————————————— */

/**
 * @param {{canal:string, operadorTel:string, texto?:string, medios?:Array<{tipo:'imagen'|'audio'|'documento', buffer?, dataUrl?, mime?}>, externoId?:string}} m
 * @returns {Promise<{respuestas:string[], ignorado?:boolean, duplicado?:boolean, borradorId?:string, embarcacionId?:string}>}
 */
async function procesarMensaje({ canal, operadorTel, texto = '', medios = [], externoId = null }) {
  const tel = normalizarOperador(operadorTel);
  const operador = operadorActivo(tel);
  if (!operador) {
    console.warn(`[intake] mensaje ignorado: ${tel} no es un operador habilitado`);
    return { respuestas: [], ignorado: true };
  }
  const t = String(texto || '').trim();
  const imagenes = medios.filter(m => m.tipo === 'imagen');
  const audios = medios.filter(m => m.tipo === 'audio');

  let borrador = borradorAbierto(tel);
  if (!canales.registrarEntrante({ operadorTel: tel, canal, texto: t, medios, externoId, borradorId: borrador?.id })) {
    return { respuestas: [], duplicado: true };
  }
  const contestar = async (textos, extra = {}) => {
    await canales.responder({ operadorTel: tel, canal, textos, borradorId: extra.borradorId || borrador?.id || null });
    return { respuestas: textos, ...extra };
  };

  // Audio sin texto: Meta entrega el archivo, no la transcripción. Se pide escrito.
  if (audios.length && !t && !imagenes.length) {
    return contestar(['Todavía no puedo escuchar audios: mandámelo escrito y lo cargo al toque.']);
  }

  // ¿Está respondiendo a una lista ("1 3", "todos")?
  const ctx = avisos.leerContexto(tel);
  if (ctx && t && RE_SELECCION.test(t) && !imagenes.length) {
    const r = resolverSeleccion(t, ctx, operador);
    if (r) return contestar(r);
  }

  const cmd = t.toLowerCase().replace(/[!.¡¿?]/g, '').trim();
  if (/^(ayuda|help|hola|buenas|menu|menú)$/.test(cmd)) return contestar([AYUDA]);

  if (/^(cancelar|cancel|borrar|descartar)$/.test(cmd)) {
    if (!borrador) return contestar(['No hay ninguna carga en curso.']);
    borrador.estado = 'cancelado'; guardarBorrador(borrador);
    return contestar([`Cancelé la carga de ${etiquetaDe(borrador.datos)}. No se publicó nada.`]);
  }

  if (/^(estado|ver|resumen|borrador)$/.test(cmd)) {
    return contestar([borrador ? resumen(borrador) : 'No hay ninguna carga en curso. Mandame los datos de una unidad para empezar.']);
  }

  if (/^(listo|ok|okey|okay|dale|publicar|publicala|publicalo|confirmo|confirmar|si|sí|va)$/.test(cmd)) {
    if (!borrador) return contestar(['No hay ninguna carga en curso para publicar.']);
    const falta = faltantes(borrador.datos, OBLIGATORIOS);
    if (falta.length) return contestar([`Todavía no la puedo publicar: me falta ${falta.join(', ')}.`]);
    const { embarcacionId, propuestas } = publicar(borrador, operador);
    const etiqueta = etiquetaDe(borrador.datos);
    const { umbrales } = analizarEmbarcacion(embarcacionId);
    return contestar([
      `✅ Publicada en el inventario: ${etiqueta} — ${usd(borrador.datos.precio_pedido)}.` +
        (borrador.fotos.length ? '' : '\nNo tiene fotos: podés mandarlas desde el CRM o en un mensaje nuevo.'),
      avisos.avisoPropuestas({ operadorTel: tel, embarcacionId, etiqueta, creadas: propuestas, umbrales }),
    ], { embarcacionId, borradorId: borrador.id });
  }

  // Contenido: datos y/o fotos
  if (!t && !imagenes.length) return contestar([AYUDA]);

  const extraido = await extraerEmbarcacion(t, []);

  // ¿El mensaje habla de OTRA lancha que la del borrador abierto? Entonces no se mezcla:
  // un "la Prinz 630 bajó a 24 lucas" con una carga en curso no puede pisarle marca y modelo.
  const nombraOtra = borrador && (extraido.marca || extraido.modelo) && (borrador.datos.marca || borrador.datos.modelo) &&
    ((extraido.marca && borrador.datos.marca && norm(extraido.marca) !== norm(borrador.datos.marca)) ||
     (extraido.modelo && borrador.datos.modelo && norm(extraido.modelo) !== norm(borrador.datos.modelo)));
  const novedadDeInventario = ['actualizar_precio', 'vendida'].includes(extraido.intencion) && (!borrador || nombraOtra);

  if (nombraOtra && !novedadDeInventario) {
    return contestar([`Tenés una carga en curso de ${etiquetaDe(borrador.datos)}. Para empezar otra unidad, primero respondé LISTO (la publico) o CANCELAR (la descarto), y después mandame la nueva.`]);
  }

  if (extraido.intencion === 'actualizar_precio' && novedadDeInventario) {
    if (!extraido.precio_pedido) return contestar(['Entendí que cambió un precio, pero no el monto. Ej: "la Klase A 2400 bajó a 52 lucas".']);
    const opciones = buscarEnVenta(extraido);
    if (!opciones.length) return contestar([`No encontré "${extraido.referencia || 'esa unidad'}" entre las que están en venta.`]);
    if (opciones.length > 1) return contestar(listarOpciones(operador, opciones, 'precio', { precio: extraido.precio_pedido }));
    return contestar(aplicarPrecio(opciones[0], extraido.precio_pedido, operador));
  }
  if (extraido.intencion === 'vendida' && novedadDeInventario) {
    const opciones = buscarEnVenta(extraido);
    if (!opciones.length) return contestar([`No encontré "${extraido.referencia || 'esa unidad'}" entre las que están en venta.`]);
    if (opciones.length > 1) return contestar(listarOpciones(operador, opciones, 'vendida', {}));
    return contestar(aplicarVenta(opciones[0], operador));
  }

  // Alta (o seguimiento de una carga en curso)
  const nuevo = !borrador;
  if (nuevo) borrador = crearBorrador(tel, canal);
  for (const img of imagenes) {
    try { borrador.fotos.push(guardarFoto(img, borrador.id)); }
    catch (e) { console.error('[intake] foto descartada:', e.message); }
  }
  // Con fotos y API key, la IA también mira las fotos (calcos, motor, trailer)
  const conFotos = imagenes.length && process.env.ANTHROPIC_API_KEY ? await extraerEmbarcacion(t, borrador.fotos.slice(-imagenes.length)) : extraido;
  const cambiados = fusionar(borrador.datos, conFotos);
  guardarBorrador(borrador);

  const hayDatos = Object.keys(borrador.datos).some(k => borrador.datos[k] != null && !(Array.isArray(borrador.datos[k]) && !borrador.datos[k].length));
  if (!hayDatos && !borrador.fotos.length) {
    borrador.estado = 'cancelado'; guardarBorrador(borrador);
    return contestar(['No encontré datos de una embarcación en tu mensaje. Escribí AYUDA para ver ejemplos.']);
  }
  if (!t && imagenes.length && !nuevo) {
    return contestar([`📷 Sumé ${imagenes.length} foto${imagenes.length > 1 ? 's' : ''} (van ${borrador.fotos.length}).`], { borradorId: borrador.id });
  }
  return contestar([resumen(borrador, { cambiados: nuevo ? [] : cambiados })], { borradorId: borrador.id });
}

module.exports = { procesarMensaje, fusionar, resumen, OBLIGATORIOS, AYUDA, normalizarOperador };
