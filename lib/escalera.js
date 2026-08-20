// Escalera náutica — score de upgrade (§4.2).
// Base temporal desde el año 3 de la compra, pico entre años 4 y 6, más señales pesadas.
const { db } = require('../db');

const PESOS = {
  taso_su_barco: 10,
  publico_en_portal: 9,
  dio_de_baja_seguro: 8,
  miro_embarcacion: 6,
  respondio_informe_anual: 6,
  menciono_limitacion: 5,
  interactuo_en_redes: 2,
  abrio_informe_anual: 2,
  visito_web: 2,
  aniversario_compra: 1,
};

const UMBRAL = 12; // calibrar con datos reales (§10) — valor inicial de demo

function scoreUpgrade() {
  // Una fila por persona: su ÚLTIMA compra cerrada (si compró varias veces, la más reciente)
  const exClientes = db.prepare(`
    SELECT p.*, o.fecha_cierre, o.embarcacion_id AS barco_actual_id
    FROM persona p
    JOIN operacion o ON o.comprador_id = p.id AND o.etapa = 'cerrada'
    WHERE p.roles LIKE '%ex-cliente-comprador%' AND p.no_contactar = 0
      AND o.fecha_cierre = (SELECT MAX(o2.fecha_cierre) FROM operacion o2 WHERE o2.comprador_id = p.id AND o2.etapa = 'cerrada')
    GROUP BY p.id
  `).all();

  const tarjetas = [];
  for (const p of exClientes) {
    const aniosDesdeCompra = (Date.now() - new Date(p.fecha_cierre).getTime()) / (365.25 * 864e5);
    // curva temporal: 0 hasta el año 3, sube y pica entre año 4 y 6, después baja suave
    let base = 0;
    if (aniosDesdeCompra >= 3) {
      base = aniosDesdeCompra <= 4 ? (aniosDesdeCompra - 3) * 5
        : aniosDesdeCompra <= 6 ? 5 + Math.min(3, (aniosDesdeCompra - 4) * 1.5)
        : Math.max(3, 8 - (aniosDesdeCompra - 6));
    }
    const senales = db.prepare(`
      SELECT * FROM senal WHERE persona_id = ? AND fecha > datetime('now','-365 days') ORDER BY peso DESC, fecha DESC
    `).all(p.id);
    let senalScore = 0;
    for (const s of senales) senalScore += PESOS[s.tipo] ?? s.peso ?? 1;

    const total = Math.round(base + senalScore);
    if (total < UMBRAL) continue;

    const barco = p.barco_actual_id ? db.prepare('SELECT * FROM embarcacion WHERE id = ?').get(p.barco_actual_id) : null;
    // qué le encaja del inventario actual: algo un escalón arriba de lo que tiene
    const sugeridas = db.prepare(`
      SELECT * FROM embarcacion
      WHERE situacion = 'en venta' AND eslora > COALESCE(?, 0) AND precio_pedido IS NOT NULL
      ORDER BY (CASE WHEN tiene_bano = 1 THEN 0 ELSE 1 END), eslora ASC LIMIT 3
    `).all(barco ? barco.eslora : 0);

    const busquedaActiva = db.prepare(`SELECT * FROM busqueda WHERE persona_id = ? AND estado = 'activa' ORDER BY creada_en DESC LIMIT 1`).get(p.id);

    tarjetas.push({
      persona: { id: p.id, nombre: p.nombre, telefono: p.telefono, contexto_personal: p.contexto_personal },
      score: total,
      anios_desde_compra: Math.round(aniosDesdeCompra * 10) / 10,
      barco_actual: barco ? { id: barco.id, etiqueta: `${barco.marca} ${barco.modelo} ${barco.anio}` } : null,
      senales: senales.map(s => ({ tipo: s.tipo, detalle: s.detalle, fecha: s.fecha, peso: PESOS[s.tipo] ?? s.peso })),
      sugeridas: sugeridas.map(e => ({ id: e.id, etiqueta: `${e.marca} ${e.modelo} ${e.anio}`, precio: e.precio_pedido, eslora: e.eslora, tiene_bano: e.tiene_bano })),
      busqueda_activa: busquedaActiva || null,
    });
  }
  tarjetas.sort((a, b) => b.score - a.score);
  return tarjetas;
}

module.exports = { scoreUpgrade, UMBRAL };
