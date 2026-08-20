// Motor de coincidencias (§4.1) — filtros duros descartan, puntaje blando ordena.
// El motivo en texto importa tanto como el puntaje.
const { db } = require('../db');

const j = (s, def = []) => { try { return JSON.parse(s) || def; } catch { return def; } };

// Tipos compatibles: una cuddy le puede servir a quien busca crucero chico y viceversa
const TIPOS_AFINES = {
  'lancha open': ['lancha open'],
  'lancha cuddy': ['lancha cuddy', 'crucero'],
  'crucero': ['crucero', 'lancha cuddy'],
  'semirrigido/tracker': ['semirrigido/tracker'],
  'moto de agua': ['moto de agua'],
  'de coleccion': ['de coleccion'],
};

function diasDesde(iso) {
  if (!iso) return 9999;
  return (Date.now() - new Date(iso).getTime()) / 864e5;
}

function candidatosParaEmbarcacion(embId) {
  const e = db.prepare('SELECT * FROM embarcacion WHERE id = ?').get(embId);
  if (!e) return [];
  const busquedas = db.prepare(`
    SELECT b.*, p.nombre, p.telefono, p.instagram_handle, p.no_contactar, p.ultima_interaccion, p.contexto_personal, p.estado AS persona_estado
    FROM busqueda b JOIN persona p ON p.id = b.persona_id
    WHERE b.estado = 'activa' AND b.persona_id != COALESCE(?, '')
  `).all(e.propietario_id || null);

  const out = [];
  for (const b of busquedas) {
    // ——— Filtros duros ———
    if (b.no_contactar) continue;
    const tiposBuscados = j(b.tipo_embarcacion);
    const compatible = tiposBuscados.some(t => (TIPOS_AFINES[t] || [t]).includes(e.tipo));
    if (tiposBuscados.length && !compatible) continue;
    // precio: tolerancia +15% (la gente estira el presupuesto por el barco correcto)
    if (b.presupuesto_max && e.precio_pedido && e.precio_pedido > b.presupuesto_max * 1.15) continue;
    if (b.presupuesto_min && e.precio_pedido && e.precio_pedido < b.presupuesto_min * 0.6) continue;
    if (b.necesita_bano && !e.tiene_bano) continue;

    // ——— Puntaje blando ———
    let score = 0;
    const motivos = [];

    const tipoExacto = tiposBuscados.includes(e.tipo);
    score += tipoExacto ? 20 : 10;

    if (b.presupuesto_max && e.precio_pedido) {
      if (e.precio_pedido <= b.presupuesto_max) {
        score += 20;
        motivos.push(`entra en su presupuesto (hasta USD ${b.presupuesto_max.toLocaleString('es-AR')})`);
      } else {
        const excedente = Math.round((e.precio_pedido / b.presupuesto_max - 1) * 100);
        score += 8;
        motivos.push(`se pasa ${excedente}% del presupuesto, pero dentro de lo que la gente suele estirar`);
      }
    }
    if (b.eslora_min != null && b.eslora_max != null && e.eslora) {
      if (e.eslora >= b.eslora_min && e.eslora <= b.eslora_max) {
        score += 15;
        motivos.push(`la eslora (${e.eslora} m) está justo en el rango que pedía`);
      } else {
        const d = Math.min(Math.abs(e.eslora - b.eslora_min), Math.abs(e.eslora - b.eslora_max));
        if (d <= 0.5) { score += 8; motivos.push(`eslora apenas fuera del rango (${e.eslora} m)`); }
        else if (d > 1.2) score -= 5;
      }
    }
    const usos = j(b.uso_declarado);
    const equip = j(e.equipamiento).map(x => x.toLowerCase());
    if (usos.includes('wakeboard/deportes')) {
      if (equip.some(x => x.includes('torre')) || (e.motor_hp || 0) >= 150) {
        score += 12; motivos.push('sirve para wake' + (equip.some(x => x.includes('torre')) ? ' (tiene torre)' : ' (potencia suficiente)'));
      }
    }
    if (usos.includes('pesca') && (equip.some(x => x.includes('ecosonda') || x.includes('caña')) || e.tipo === 'semirrigido/tracker')) {
      score += 8; motivos.push('perfil de pesca');
    }
    if (usos.includes('dormir a bordo') && e.tiene_bano) { score += 8; }
    if (b.necesita_bano && e.tiene_bano) motivos.push('tiene baño, que era condición');
    if (b.necesita_trailer && e.tiene_trailer) { score += 6; motivos.push('viene con trailer, que lo pedía'); }
    if (b.necesita_trailer && !e.tiene_trailer) { score -= 6; }
    if (b.motor_tipo && b.motor_tipo !== 'indistinto' && e.motor_tipo === b.motor_tipo) score += 5;
    if (b.hp_min && e.motor_hp >= b.hp_min) score += 4;
    if (b.hp_min && e.motor_hp < b.hp_min) score -= 8;

    // antigüedad de la búsqueda: más reciente pesa más
    const edadBusq = diasDesde(b.creada_en);
    score += edadBusq < 30 ? 10 : edadBusq < 90 ? 6 : edadBusq < 180 ? 3 : 0;
    // temperatura de la persona
    const temp = diasDesde(b.ultima_interaccion);
    score += temp < 7 ? 8 : temp < 30 ? 5 : temp < 90 ? 2 : 0;
    if (b.urgencia === 'ya') { score += 8; motivos.push('urgencia declarada: quiere comprar ya'); }
    // señales recientes
    const señales = db.prepare(`SELECT COUNT(*) n FROM senal WHERE persona_id = ? AND fecha > datetime('now','-30 days')`).get(b.persona_id).n;
    if (señales > 0) { score += señales * 3; motivos.push('tiene señales de interés recientes'); }

    const motivo = armarMotivo(b, e, motivos);
    out.push({
      busqueda: b, persona_id: b.persona_id, nombre: b.nombre, telefono: b.telefono,
      instagram_handle: b.instagram_handle, contexto_personal: b.contexto_personal,
      puntaje: Math.round(score), motivo,
      via: b.telefono ? 'whatsapp' : 'copy-paste',
      mensaje_borrador: redactarMensaje(b, e),
    });
  }
  out.sort((a, b2) => b2.puntaje - a.puntaje);
  return out;
}

function armarMotivo(b, e, extras) {
  const tipos = j(b.tipo_embarcacion).join(' o ');
  const partes = [];
  let base = `Buscaba ${tipos || 'una embarcación'}`;
  if (b.presupuesto_max) base += ` hasta USD ${b.presupuesto_max.toLocaleString('es-AR')}`;
  const usos = j(b.uso_declarado);
  if (usos.length) base += ` para ${usos.join(' y ')}`;
  base += ` (${etiquetaAntiguedad(b.creada_en)})`;
  partes.push(base + '.');
  if (extras.length) partes.push(extras.slice(0, 3).map(m => m[0].toUpperCase() + m.slice(1)).join('. ') + '.');
  if (b.limitacion_declarada) partes.push(`Dijo: "${b.limitacion_declarada}".`);
  return partes.join(' ');
}

function etiquetaAntiguedad(iso) {
  const d = diasDesde(iso);
  if (d < 7) return 'esta semana';
  if (d < 35) return 'hace ' + Math.round(d / 7) + ' semanas';
  if (d < 60) return 'hace un mes';
  return 'hace ' + Math.round(d / 30) + ' meses';
}

// Borrador de mensaje — NUNCA se envía solo (§4.1): queda pendiente de aprobación.
// precio_minimo_aceptado jamás aparece acá (§4.4).
function redactarMensaje(b, e) {
  const nombre = (b.nombre || '').split(' ')[0];
  const barco = `${e.marca} ${e.modelo} ${e.anio}`;
  const tipos = j(b.tipo_embarcacion);
  const ARTICULO = { 'crucero': 'un crucero', 'semirrigido/tracker': 'un semirrígido', 'moto de agua': 'una moto de agua', 'de coleccion': 'un clásico', 'lancha open': 'una open', 'lancha cuddy': 'una cuddy' };
  const ref = tipos.length ? (ARTICULO[tipos[0]] || 'una ' + tipos[0]) : 'una embarcación';
  const lineas = [
    `Hola ${nombre}! Soy Leandro, del broker náutico de San Fernando. Hace un tiempo me consultaste por ${ref} y quedé en avisarte si entraba algo que encaje.`,
    `Acaba de entrar una ${barco}, ${e.eslora} m, ${e.motor_marca} ${e.motor_hp} HP con ${e.motor_horas ?? 's/d'} horas${e.tiene_bano ? ', con baño' : ''}${e.tiene_trailer ? ' y trailer incluido' : ''}. Está en USD ${e.precio_pedido ? e.precio_pedido.toLocaleString('es-AR') : 'a consultar'}.`,
    `¿Querés que te mande fotos y la ficha completa? ¡Avisame si querés saber más sobre esta embarcación!`,
  ];
  return lineas.join('\n\n');
}

// Matching inverso: qué embarcaciones del stock le pueden interesar a una búsqueda.
// Mismo criterio flexible que el tasador: quiere una 1700 → también una 1600 o 1800,
// o cualquier otra que entre en tamaño/precio.
function candidatasParaBusqueda(b) {
  const barcos = db.prepare(`
    SELECT * FROM embarcacion
    WHERE situacion = 'en venta' AND precio_pedido IS NOT NULL AND propietario_id IS NOT COALESCE((SELECT persona_id FROM busqueda WHERE id = ?), '')
  `).all(b.id);
  const tiposBuscados = j(b.tipo_embarcacion);
  const out = [];
  for (const e of barcos) {
    // filtros duros espejados de candidatosParaEmbarcacion
    const compatible = !tiposBuscados.length || tiposBuscados.some(t => (TIPOS_AFINES[t] || [t]).includes(e.tipo));
    if (!compatible) continue;
    if (b.presupuesto_max && e.precio_pedido > b.presupuesto_max * 1.15) continue;
    if (b.presupuesto_min && e.precio_pedido < b.presupuesto_min * 0.6) continue;
    if (b.necesita_bano && !e.tiene_bano) continue;

    let score = 0;
    if (b.presupuesto_max && e.precio_pedido <= b.presupuesto_max) score += 20; else score += 8;
    if (b.eslora_min != null && b.eslora_max != null && e.eslora) {
      if (e.eslora >= b.eslora_min && e.eslora <= b.eslora_max) score += 15;
      else if (Math.min(Math.abs(e.eslora - b.eslora_min), Math.abs(e.eslora - b.eslora_max)) <= 0.6) score += 8;
      else score -= 5;
    }
    const usos = j(b.uso_declarado);
    const equip = j(e.equipamiento).map(x => x.toLowerCase());
    if (usos.includes('wakeboard/deportes') && (equip.some(x => x.includes('torre')) || (e.motor_hp || 0) >= 150)) score += 10;
    if (usos.includes('dormir a bordo') && e.tiene_bano) score += 8;
    if (b.necesita_trailer && e.tiene_trailer) score += 6;
    if (b.necesita_trailer && !e.tiene_trailer) score -= 6;
    if (b.hp_min && e.motor_hp >= b.hp_min) score += 4;
    if (b.hp_min && e.motor_hp < b.hp_min) score -= 8;
    if (e.url_publicacion) score += 2;

    if (score < 15) continue;
    out.push({
      id: e.id, etiqueta: `${e.marca} ${e.modelo} ${e.anio}`, tipo: e.tipo,
      precio: e.precio_pedido, eslora: e.eslora, url: e.url_publicacion,
      foto: j(e.fotos)[0] || null, ingresada_en: e.ingresada_en, puntaje: Math.round(score),
    });
  }
  out.sort((a, z) => z.puntaje - a.puntaje);
  return out.slice(0, 4);
}

// Propuesta puntual: una búsqueda concreta contra una embarcación concreta.
// Reusa todo el scoring y el armado de motivo del motor principal.
function propuestaPuntual(busquedaId, embarcacionId) {
  const candidatos = candidatosParaEmbarcacion(embarcacionId);
  return candidatos.find(c => c.busqueda.id === busquedaId) || null;
}

module.exports = { candidatosParaEmbarcacion, candidatasParaBusqueda, propuestaPuntual };
