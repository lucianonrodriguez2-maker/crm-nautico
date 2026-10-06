// Extracción de Busqueda estructurada desde texto libre — el único lugar del pipeline
// donde la IA es insustituible (§1.bis regla 2).
// IA real vía API de Anthropic; si no hay key o falla la red, cae a un parser heurístico
// para que la demo nunca se quede en blanco.
const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM = `Sos el extractor de búsquedas de un CRM para un broker náutico del Delta (San Fernando, Buenos Aires).
Recibís el texto crudo de una conversación (WhatsApp, Instagram, transcripción de audio) y devolvés SOLO un JSON válido, sin markdown ni explicación, con esta forma exacta:
{
  "nombre": string|null,            // si el texto lo revela
  "telefono": string|null,          // si aparece un número de contacto
  "tipo_embarcacion": string[],     // valores posibles: "crucero","lancha cuddy","lancha open","semirrigido/tracker","moto de agua","de coleccion"
  "modelo_referencia": string|null, // si nombra un modelo concreto: "Quicksilver 1700", "Klase A 2400"
  "marcas_preferidas": string[],    // marcas que menciona como preferidas
  "eslora_min": number|null,        // metros. Si habla en pies, convertí (1 pie = 0.3048 m). "una 1700" de Quicksilver ≈ 5.2 m
  "eslora_max": number|null,
  "presupuesto_min": number|null,   // USD. "25 lucas verdes" = 25000
  "presupuesto_max": number|null,
  "motor_tipo": "fuera de borda"|"dentro-fuera"|"intraborda"|"indistinto"|null,
  "hp_min": number|null,
  "uso_declarado": string[],        // valores: "paseo familiar","pesca","wakeboard/deportes","dormir a bordo","navegación río abierto"
  "necesita_bano": boolean,         // "con baño", "para hacer noche con mi mujer" implica baño
  "necesita_trailer": boolean,
  "urgencia": "ya"|"en los próximos meses"|"mirando sin apuro"|null,
  "entrega_algo": boolean,          // si menciona que tiene algo para dar en parte de pago
  "limitacion_declarada": string|null, // lo que dice que le falta o le molesta de lo que tiene, textual resumido
  "contexto_personal": string|null  // datos de vida útiles: "familia de 4", "pesca con amigos", "guarda en X"
}
Reglas: si un dato no está, null o [] o false — no inventes. Modelos conocidos te dan pistas de tipo y eslora (Quicksilver 1700/1800/2000 son open; Klase A K24 cuddy; Canestrari 245 crucero). Jerga argentina: "lucas" = miles, "verdes"/"dólares" = USD, "gomón" = semirrígido.`;

async function extraerConIA(texto) {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 2000,
    output_config: { effort: 'low' }, // extracción simple: prioriza latencia en la demo
    system: SYSTEM,
    messages: [{ role: 'user', content: texto }],
  });
  if (response.stop_reason === 'refusal') throw new Error('refusal');
  const raw = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const jsonStr = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  return { ...JSON.parse(jsonStr), _fuente: 'ia' };
}

// Fallback heurístico — cubre los ejemplos precargados de la demo si no hay red/key.
function extraerHeuristico(texto) {
  const t = texto.toLowerCase();
  const out = {
    nombre: null, telefono: null, tipo_embarcacion: [], eslora_min: null, eslora_max: null,
    presupuesto_min: null, presupuesto_max: null, motor_tipo: null, hp_min: null,
    uso_declarado: [], necesita_bano: false, necesita_trailer: false, urgencia: null,
    entrega_algo: false, limitacion_declarada: null, contexto_personal: null, modelo_referencia: null, marcas_preferidas: [], _fuente: 'heuristica',
  };
  if (/cruceros?\b/.test(t)) out.tipo_embarcacion.push('crucero');
  if (/cuddy/.test(t)) out.tipo_embarcacion.push('lancha cuddy');
  if (/\bopen\b|lancha/.test(t) && !out.tipo_embarcacion.length) out.tipo_embarcacion.push('lancha open');
  if (/semirr|gom[oó]n|tracker/.test(t)) out.tipo_embarcacion.push('semirrigido/tracker');
  if (/moto de agua|jet ?ski/.test(t)) out.tipo_embarcacion.push('moto de agua');
  const ref = texto.match(/\b(Quicksilver|Klase A|Canestrari|Bayliner|Quest|Piccini|Bermuda|Regnicoli|Prinz|Kiel|Eclipse|MasterCraft)\s+(\d{2,4})\b/i);
  if (ref) { out.modelo_referencia = `${ref[1]} ${ref[2]}`; out.marcas_preferidas = [ref[1]]; }
  const lucas = t.match(/(\d+)\s*(lucas|mil|k)\b/g);
  if (lucas) {
    const nums = lucas.map(x => parseInt(x) * 1000).sort((a, b) => a - b);
    out.presupuesto_max = nums[nums.length - 1];
    if (nums.length > 1) out.presupuesto_min = nums[0];
  }
  const usd = t.match(/(?:usd|u\$s|d[oó]lares?)\s*\.?\s*([\d.,]+)/) || t.match(/([\d.,]+)\s*(?:usd|u\$s|d[oó]lares)/);
  if (usd && !out.presupuesto_max) out.presupuesto_max = parseInt(usd[1].replace(/[.,]/g, ''));
  if (/pesca/.test(t)) out.uso_declarado.push('pesca');
  if (/wake|esqu[ií]/.test(t)) out.uso_declarado.push('wakeboard/deportes');
  if (/dormir|hacer noche|camarote/.test(t)) { out.uso_declarado.push('dormir a bordo'); out.necesita_bano = true; }
  if (/familia|chicos|hijos|se[ñn]ora|pasear|paseo/.test(t)) out.uso_declarado.push('paseo familiar');
  if (/con ba[ñn]o/.test(t)) out.necesita_bano = true;
  if (/trailer|tra[íi]ler/.test(t)) out.necesita_trailer = true;
  if (/ya mismo|urgente|esta semana|cuanto antes|\bya\b/.test(t)) out.urgencia = 'ya';
  else if (/pr[oó]ximos meses|primavera|verano/.test(t)) out.urgencia = 'en los próximos meses';
  else if (/sin apuro|mirando|m[aá]s adelante/.test(t)) out.urgencia = 'mirando sin apuro';
  if (/parte de pago|entrego|permuto|permuta/.test(t)) out.entrega_algo = true;
  const hp = t.match(/(\d+)\s*hp/);
  if (hp) out.hp_min = parseInt(hp[1]);
  const tel = texto.match(/(?:\+?54\s?9?\s?)?(?:11|15)[\s-]?\d{4}[\s-]?\d{4}/);
  if (tel) out.telefono = tel[0];
  return out;
}

async function extraer(texto) {
  if (process.env.ANTHROPIC_API_KEY) {
    try { return await extraerConIA(texto); }
    catch (e) { console.error('Extracción IA falló, uso heurística:', e.message); }
  }
  return extraerHeuristico(texto);
}

module.exports = { extraer };
