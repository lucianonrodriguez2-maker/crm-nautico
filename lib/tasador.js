// Tasador — valuación con histórico propio (Caso 2).
// Base: comparables del inventario (precio_pedido) y ventas reales (precio_venta_real),
// ajustados por año, horas de motor y estado. Con pocos datos es una banda honesta, no un número mágico.
const { db } = require('../db');

const DEPRECIACION_ANUAL = 0.045;   // náutica usada se deprecia suave después de los primeros años
const AJUSTE_ESTADO = { 'excelente': 1.07, 'muy bueno': 1.0, 'bueno': 0.9, 'a reacondicionar': 0.72 };

function tasar(datos) {
  const { tipo, marca, modelo, anio, eslora, motor_hp, motor_horas, estado_general } = datos;
  const nMotores = Math.max(1, parseInt(datos.cantidad_motores) || 1);
  // el segundo/tercer motor suma valor real, pero no duplica el barco
  const ajusteMotores = 1 + (nMotores - 1) * 0.28;
  const notaMotores = nMotores > 1 ? ` Ajuste al alza por ${nMotores} motores${datos.motor_marca ? ' ' + datos.motor_marca : ''}.` : '';
  // comparables: mismo tipo, eslora parecida — ventas reales pesan doble
  const comparables = db.prepare(`
    SELECT marca, modelo, anio, eslora, motor_hp, motor_horas, precio_pedido, precio_venta_real, situacion
    FROM embarcacion
    WHERE tipo = ? AND (precio_pedido IS NOT NULL OR precio_venta_real IS NOT NULL)
      AND eslora BETWEEN ? AND ?
  `).all(tipo, (eslora || 5) - 1.2, (eslora || 5) + 1.2);

  const puntos = [];
  const usados = [];
  for (const c of comparables) {
    const precio = c.precio_venta_real || c.precio_pedido;
    const peso = c.precio_venta_real ? 2 : 1; // dato de venta real vale más que precio pedido
    // normalizar el comparable al año/horas del barco tasado
    let ajustado = precio;
    if (anio && c.anio) ajustado *= Math.pow(1 - DEPRECIACION_ANUAL, (c.anio - anio));
    if (motor_horas && c.motor_horas) {
      const deltaHoras = motor_horas - c.motor_horas;
      ajustado *= 1 - Math.max(-0.12, Math.min(0.12, deltaHoras / 1000 * 0.08));
    }
    puntos.push({ v: ajustado, w: peso });
    usados.push(`${c.marca} ${c.modelo} ${c.anio} — ${c.precio_venta_real ? 'venta real USD ' + c.precio_venta_real.toLocaleString('es-AR') : 'publicada a USD ' + c.precio_pedido.toLocaleString('es-AR')}`);
  }

  if (!puntos.length) {
    // sin comparables directos: estimación gruesa por eslora y tipo
    const basePorMetro = { 'crucero': 6800, 'lancha cuddy': 4900, 'lancha open': 4200, 'semirrigido/tracker': 3400, 'moto de agua': 4500, 'de coleccion': 7500 };
    let est = (eslora || 5) * (basePorMetro[tipo] || 4200);
    if (anio) est *= Math.pow(1 - DEPRECIACION_ANUAL, Math.max(0, new Date().getFullYear() - anio - 3));
    est *= (AJUSTE_ESTADO[estado_general] ?? 1) * ajusteMotores;
    return {
      valor_estimado_min: Math.round(est * 0.88 / 500) * 500,
      valor_estimado_max: Math.round(est * 1.08 / 500) * 500,
      fundamento: `Sin comparables directos de ${marca || tipo} en la base: estimación por tipo, eslora y año. Se ajusta al cargar más operaciones reales.${notaMotores}`,
      comparables: [],
    };
  }

  const media = puntos.reduce((a, p) => a + p.v * p.w, 0) / puntos.reduce((a, p) => a + p.w, 0);
  const conEstado = media * (AJUSTE_ESTADO[estado_general] ?? 1) * ajusteMotores;
  return {
    valor_estimado_min: Math.round(conEstado * 0.92 / 500) * 500,
    valor_estimado_max: Math.round(conEstado * 1.06 / 500) * 500,
    fundamento: `Base: ${usados.slice(0, 3).join(' · ')}. Ajuste por año${motor_horas ? ', horas de motor (' + motor_horas + ' hs)' : ''}${estado_general ? ' y estado declarado (' + estado_general + ')' : ''}.${notaMotores}`,
    comparables: usados,
  };
}

module.exports = { tasar };
