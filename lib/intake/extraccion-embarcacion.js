// Extracción de una EMBARCACIÓN desde lo que manda el operador por WhatsApp:
// texto libre ("entró una Quicksilver 1800 del 2017, Mercury 115 con 400 hs, pide 23.500…")
// más, opcionalmente, fotos. Con ANTHROPIC_API_KEY usa Claude (lee también las fotos: un
// calco en el casco, el motor, si hay trailer); sin key, un parser determinístico.
//
// Devuelve SIEMPRE la misma forma. Los campos que el mensaje no menciona vuelven null —
// nunca false ni 0 — para que al sumar mensajes no se pise un dato que ya estaba.
const fs = require('fs');

const TIPOS = ['crucero', 'lancha cuddy', 'lancha open', 'semirrigido/tracker', 'moto de agua', 'de coleccion'];

const VACIO = () => ({
  intencion: 'alta', referencia: null,
  tipo: null, marca: null, modelo: null, anio: null, eslora: null, manga: null,
  motor_marca: null, motor_hp: null, cantidad_motores: null, motor_tipo: null, motor_horas: null,
  combustible_litros: null, equipamiento: [], estado_general: null,
  tiene_bano: null, tiene_trailer: null,
  precio_pedido: null, precio_minimo_aceptado: null,
  propietario_nombre: null, propietario_telefono: null,
  exclusividad: null, papeles_estado: null, notas: null,
});

const SYSTEM = `Sos el asistente de carga de inventario de un broker náutico del Delta (San Fernando, Buenos Aires).
El broker o su equipo te mandan por WhatsApp los datos de una embarcación que acaba de entrar (a veces con fotos), o una novedad sobre una que ya está en venta.

Devolvé SOLO un JSON válido, sin markdown, con esta forma exacta:
{
  "intencion": "alta" | "actualizar_precio" | "vendida" | "otro",
  "referencia": string|null,          // si es actualizar_precio o vendida: qué barco nombra ("la Klase A 2400")
  "tipo": ${TIPOS.map(t => `"${t}"`).join(' | ')} | null,
  "marca": string|null,               // del casco: "Quicksilver", "Klase A", "Canestrari", "Arco Iris"…
  "modelo": string|null,              // "1800", "2400", "Eclipse 19", "245"
  "anio": number|null,
  "eslora": number|null,              // metros. Pies → metros (1 pie = 0.3048)
  "manga": number|null,
  "motor_marca": string|null,         // "Mercury", "Yamaha", "Mercruiser", "Evinrude", "Volvo Penta"…
  "motor_hp": number|null,            // HP de CADA motor
  "cantidad_motores": number|null,    // "bimotor" = 2
  "motor_tipo": "fuera de borda" | "dentro-fuera" | "intraborda" | null,
  "motor_horas": number|null,
  "combustible_litros": number|null,
  "equipamiento": string[],           // "ecosonda", "VHF", "toldo", "estéreo", "escalera inox", "torre de wakeboard"…
  "estado_general": "excelente" | "muy bueno" | "bueno" | "a reacondicionar" | null,
  "tiene_bano": boolean|null,
  "tiene_trailer": boolean|null,
  "precio_pedido": number|null,       // USD. "23,5 lucas" = 23500. Si es actualizar_precio: el precio NUEVO
  "precio_minimo_aceptado": number|null, // "pide 25 pero acepta 23" → 23000. Es privado.
  "propietario_nombre": string|null,
  "propietario_telefono": string|null,
  "exclusividad": "exclusiva" | "compartida con otros brokers" | "abierta" | null,
  "papeles_estado": "al día" | "falta algo menor" | "falta bastante" | null,
  "notas": string|null                // cualquier otro dato útil que no entre arriba
}

Reglas:
- Si un dato no aparece, null (o [] en equipamiento). NO inventes ni completes con lo "típico" del modelo.
- tiene_bano / tiene_trailer: true solo si se dice o se VE claramente en las fotos; false solo si se dice "sin"; si no, null.
- En las fotos podés leer marca/modelo de calcos en el casco, la marca y potencia del motor, si hay trailer. Si no se lee, null.
- Ojo con números de modelo que parecen años: "Quicksilver 2000" es el modelo 2000, "Klase A 2400" es el modelo 2400.
- Jerga argentina: "lucas" = miles, "verdes" = USD, "gomón" = semirrígido, "hs" = horas de motor.`;

async function extraerConIA(texto, fotos = []) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const contenido = [];
  for (const f of fotos.slice(0, 3)) {
    try {
      const data = fs.readFileSync(f.ruta).toString('base64');
      contenido.push({ type: 'image', source: { type: 'base64', media_type: f.mime || 'image/jpeg', data } });
    } catch { /* foto ilegible: se sigue con el texto */ }
  }
  contenido.push({ type: 'text', text: texto && texto.trim() ? texto : '(sin texto: solo fotos)' });
  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 2000,
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [{ role: 'user', content: contenido }],
  });
  if (response.stop_reason === 'refusal') throw new Error('refusal');
  const raw = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const datos = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  return { ...VACIO(), ...datos, equipamiento: Array.isArray(datos.equipamiento) ? datos.equipamiento : [], _fuente: 'ia' };
}

/* ————————————————————————————— Parser de respaldo ————————————————————————————— */

const MARCAS = ['Quicksilver', 'Klase A', 'Canestrari', 'Bayliner', 'Arco Iris', 'Quest', 'Piccini', 'Bermuda',
  'Regnicoli', 'Prinz', 'Kiel', 'Benavidez', 'MasterCraft', 'Sea-Doo', 'Seadoo', 'Kawasaki', 'Segue', 'Trento',
  'Geuna', 'Virgin Marine', 'Baader', 'Paglietini', 'Genesis', 'Patagonia', 'Hunter', 'Mediterranean',
  'Sea Ray', 'Chaparral', 'Four Winns', 'Cobalt', 'Zodiac', 'Brig', 'Tracker'];
const MARCAS_MOTOR = ['Mercruiser', 'Mercury', 'Yamaha', 'Evinrude', 'Suzuki', 'Honda', 'Volvo Penta', 'Volvo',
  'Johnson', 'Tohatsu', 'Cummins', 'Perkins', 'Rotax', 'Ilmor'];
const EQUIPOS = ['ecosonda', 'vhf', 'gps', 'plotter', 'toldo', 'estéreo', 'estereo', 'escalera inox', 'torre',
  'heladera', 'cocina', 'radar', 'generador', 'cubre', 'funda', 'porta cañas', 'bimini'];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const aNumero = (s) => {
  const t = String(s).replace(/\s/g, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return parseInt(t.replace(/[.,]/g, ''), 10); // 23.500 / 23,500
  return parseFloat(t.replace(',', '.'));
};

function montoEn(fragmento) {
  // "23.500" · "23500" · "23,5 lucas" · "23 mil" · "23k"
  const m = fragmento.match(/(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(lucas|mil|k)?/i);
  if (!m) return null;
  let n = aNumero(m[1]);
  if (m[2] || n < 1000) n = Math.round(n * 1000);
  return n >= 2000 && n <= 3000000 ? n : null;
}

function extraerHeuristico(texto) {
  const out = { ...VACIO(), _fuente: 'heuristica' };
  const t = String(texto || '');
  const tl = t.toLowerCase();

  // Intención
  if (/\b(se vendi[oó]|vendida|la vendimos|ya se vendi[oó])(?![a-z])/.test(tl)) out.intencion = 'vendida';
  else if (/\b(baj[oó]|bajamos|nuevo precio|ahora (pide|est[aá] en)|rebaj)/.test(tl) && !/\bentr[oó]\b/.test(tl)) out.intencion = 'actualizar_precio';

  // Marca y modelo (la palabra que sigue a la marca)
  for (const marca of MARCAS) {
    const m = t.match(new RegExp(`\\b${esc(marca)}\\b\\s*([A-Za-z]*\\s?\\d{2,4}[A-Za-z]?|[A-Za-z]+(?:\\s\\d{2,4})?)?`, 'i'));
    if (m) {
      out.marca = marca === 'Seadoo' ? 'Sea-Doo' : marca;
      if (m[1] && !/^(del|de|con|año|modelo|y|en|a)$/i.test(m[1].trim())) out.modelo = m[1].trim();
      break;
    }
  }
  if (out.intencion !== 'alta' && out.marca) out.referencia = [out.marca, out.modelo].filter(Boolean).join(' ');

  // Año: 19xx/20xx que NO sea el número de modelo; preferentemente después de "año/del/modelo"
  const numModelo = out.modelo && (out.modelo.match(/\d{4}/) || [])[0];
  const anioCtx = t.match(/\b(?:a[ñn]o|del|modelo|m\.)\s*('?\d{2}|19[5-9]\d|20[0-3]\d)\b/i);
  if (anioCtx) {
    let a = anioCtx[1].replace("'", '');
    if (a.length === 2) a = (parseInt(a, 10) > 40 ? '19' : '20') + a;
    out.anio = parseInt(a, 10);
  } else {
    for (const m of t.matchAll(/\b(19[5-9]\d|20[0-3]\d)\b/g)) {
      if (m[1] !== numModelo) { out.anio = parseInt(m[1], 10); break; }
    }
  }

  // Tipo
  if (/\bcuddy\b/.test(tl)) out.tipo = 'lancha cuddy';
  else if (/\bcrucero\b/.test(tl)) out.tipo = 'crucero';
  else if (/\b(tracker|semirr[ií]gido|gom[oó]n)\b/.test(tl)) out.tipo = 'semirrigido/tracker';
  else if (/\b(moto de agua|jet ?ski|moto acu[aá]tica)\b/.test(tl) || ['Sea-Doo', 'Kawasaki'].includes(out.marca)) out.tipo = 'moto de agua';
  else if (/\bopen\b/.test(tl)) out.tipo = 'lancha open';
  else if (/\bcl[aá]sic[oa]|de colecci[oó]n\b/.test(tl)) out.tipo = 'de coleccion';

  // Motor
  for (const mm of MARCAS_MOTOR) {
    const m = t.match(new RegExp(`\\b${esc(mm)}\\b(?:\\s*(\\d{2,3})\\b)?`, 'i'));
    if (m && !(mm === 'Yamaha' && out.marca === 'Yamaha' && !m[1])) {
      out.motor_marca = mm === 'Volvo' ? 'Volvo Penta' : mm;
      if (m[1]) out.motor_hp = parseInt(m[1], 10);
      break;
    }
  }
  const hp = t.match(/\b(\d{2,3})\s*(?:hp|cv|caballos)\b/i);
  if (hp) out.motor_hp = parseInt(hp[1], 10);
  if (/\bbimotor\b|\b2\s*motores\b|\bdos motores\b/.test(tl)) out.cantidad_motores = 2;
  if (/fuera de borda|fueraborda/.test(tl)) out.motor_tipo = 'fuera de borda';
  else if (/dentro[- ]?fuera|centro[- ]?fuera/.test(tl)) out.motor_tipo = 'dentro-fuera';
  else if (/intraborda/.test(tl)) out.motor_tipo = 'intraborda';
  const horas = t.match(/\b(\d{1,5})\s*(?:hs|hrs|horas|h)\b/i);
  if (horas) out.motor_horas = parseInt(horas[1], 10);

  // Eslora
  const esl = t.match(/\b(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:m|mts|metros)\b(?!\s*de\s*manga)/i);
  if (esl) out.eslora = aNumero(esl[1]);
  const pies = t.match(/\b(\d{2})\s*(?:pies|ft)\b/i);
  if (!out.eslora && pies) out.eslora = Math.round(parseInt(pies[1], 10) * 0.3048 * 10) / 10;

  // Equipamiento, baño, trailer, estado
  out.equipamiento = EQUIPOS.filter(eq => tl.includes(eq)).map(eq => (eq === 'estereo' ? 'estéreo' : eq === 'torre' ? 'torre de wakeboard' : eq === 'vhf' ? 'VHF' : eq === 'gps' ? 'GPS' : eq));
  if (/\bsin (trailer|tr[aá]iler)\b/.test(tl)) out.tiene_trailer = false;
  else if (/\b(trailer|tr[aá]iler)\b/.test(tl)) out.tiene_trailer = true;
  if (/\bsin ba[ñn]o\b/.test(tl)) out.tiene_bano = false;
  else if (/\bba[ñn]o\b/.test(tl)) out.tiene_bano = true;
  if (/impecable|excelente|como nueva/.test(tl)) out.estado_general = 'excelente';
  else if (/muy buen/.test(tl)) out.estado_general = 'muy bueno';
  else if (/(a|para) reacondicionar|para arreglar|necesita trabajo/.test(tl)) out.estado_general = 'a reacondicionar';
  else if (/buen estado/.test(tl)) out.estado_general = 'bueno';

  // Precios: pedido y mínimo (privado)
  const min = t.match(/\b(?:acepta|m[ií]nimo|piso|deja en)\s*(?:usd|u\$s|\$)?\s*([\d.,]+\s*(?:lucas|mil|k)?)/i);
  if (min) out.precio_minimo_aceptado = montoEn(min[1]);
  const precioCtx = t.match(/\b(?:pide|precio|vale|est[aá] en|baj[oó] a|ahora (?:pide|est[aá] en)|nuevo precio)\s*(?:es|de|:)?\s*(?:usd|u\$s|us\$|\$)?\s*([\d.,]+\s*(?:lucas|mil|k)?)\s*(?:usd|d[oó]lares|verdes)?/i);
  const precioUsd = t.match(/(?:usd|u\$s|us\$)\s*([\d.,]+\s*(?:lucas|mil|k)?)|([\d.,]+\s*(?:lucas|mil|k)?)\s*(?:usd|d[oó]lares|verdes)/i);
  const cand = [precioCtx && precioCtx[1], precioUsd && (precioUsd[1] || precioUsd[2])].filter(Boolean)
    .map(montoEn).filter(n => n && n !== out.precio_minimo_aceptado && n !== out.anio && String(n) !== String(numModelo));
  if (cand.length) out.precio_pedido = cand[0];

  // Dueño
  const tel = t.match(/(?:\+?54\s?9?\s?)?(?:11|15)[\s-]?\d{4}[\s-]?\d{4}/);
  if (tel) out.propietario_telefono = tel[0].trim();
  const dueno = t.match(/(?:^|[\s,.;(])(?:[Dd]ue[ñn][oa]|[Pp]ropietari[oa]|[Vv]ende)\s*:?\s*(?:es\s+)?([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})/);
  if (dueno) out.propietario_nombre = dueno[1].trim();

  // Exclusividad / papeles
  if (/\bexclusiv/.test(tl)) out.exclusividad = 'exclusiva';
  if (/papeles al d[ií]a/.test(tl)) out.papeles_estado = 'al día';
  else if (/falta(n)? papeles|papeles a medio/.test(tl)) out.papeles_estado = 'falta bastante';

  return out;
}

async function extraerEmbarcacion(texto, fotos = []) {
  if (process.env.ANTHROPIC_API_KEY) {
    try { return await extraerConIA(texto, fotos); }
    catch (e) { console.error('Extracción IA de embarcación falló, uso el parser:', e.message); }
  }
  return extraerHeuristico(texto);
}

module.exports = { extraerEmbarcacion, extraerHeuristico, TIPOS, VACIO };
