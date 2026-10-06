// db.js — Modelo de datos completo según CRM-NAUTICO-SPEC §3
// Esta capa NO se tira cuando el proyecto pase a producción.
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'crm.db');
// En un deploy nuevo la carpeta no existe (git no versiona directorios vacíos)
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS persona (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  telefono TEXT,                -- E.164 normalizado. Clave de deduplicación principal.
  email TEXT,
  instagram_handle TEXT,
  facebook_id TEXT,
  prometheo_id TEXT,            -- referencia, no clave de identidad
  origen TEXT,                  -- instagram·whatsapp·web·facebook·referido·guarderia/club·portal·otro
  referido_por TEXT REFERENCES persona(id),
  roles TEXT NOT NULL DEFAULT '[]',  -- JSON array acumulativo, nunca se pisa
  estado TEXT NOT NULL DEFAULT 'activo', -- activo·frio·dormido·cerrado·no-contactar
  notas_libres TEXT,
  contexto_personal TEXT,       -- campo clave: alimenta matching y escalera
  no_contactar INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL,
  ultima_interaccion TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_persona_tel ON persona(telefono) WHERE telefono IS NOT NULL;

CREATE TABLE IF NOT EXISTS busqueda (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL REFERENCES persona(id),
  tipo_embarcacion TEXT NOT NULL DEFAULT '[]', -- JSON array, ver §3.3
  eslora_min REAL, eslora_max REAL,
  presupuesto_min INTEGER, presupuesto_max INTEGER,
  motor_tipo TEXT,              -- fuera de borda·dentro-fuera·intraborda·indistinto
  hp_min INTEGER,
  uso_declarado TEXT DEFAULT '[]', -- JSON array
  necesita_bano INTEGER DEFAULT 0,
  necesita_trailer INTEGER DEFAULT 0,
  urgencia TEXT,                -- ya·en los próximos meses·mirando sin apuro
  entrega_algo INTEGER DEFAULT 0,
  embarcacion_entrega_id TEXT REFERENCES embarcacion(id),
  limitacion_declarada TEXT,    -- alimenta la escalera
  estado TEXT NOT NULL DEFAULT 'activa', -- activa·pausada·satisfecha·perdida
  motivo_cierre TEXT,
  texto_original TEXT,          -- el mensaje crudo del que se extrajo (si vino de extracción IA)
  creada_en TEXT NOT NULL,
  actualizada_en TEXT
);
CREATE INDEX IF NOT EXISTS idx_busqueda_persona ON busqueda(persona_id);

CREATE TABLE IF NOT EXISTS embarcacion (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,           -- crucero·lancha cuddy·lancha open·semirrigido/tracker·moto de agua·de coleccion
  marca TEXT, modelo TEXT, anio INTEGER,
  eslora REAL, manga REAL,
  motor_marca TEXT, motor_hp INTEGER, motor_tipo TEXT, motor_horas INTEGER,
  combustible_litros INTEGER,
  equipamiento TEXT DEFAULT '[]', -- JSON array
  estado_general TEXT,          -- excelente·muy bueno·bueno·a reacondicionar
  tiene_bano INTEGER DEFAULT 0,
  tiene_trailer INTEGER DEFAULT 0,
  precio_pedido INTEGER,
  precio_minimo_aceptado INTEGER, -- PRIVADO: nunca sale a vistas públicas ni mensajes
  precio_venta_real INTEGER,    -- se completa al cerrar; alimenta el tasador
  propietario_id TEXT REFERENCES persona(id),
  situacion TEXT NOT NULL DEFAULT 'en venta', -- en venta·vendida·retirada·no está a la venta
  exclusividad TEXT,            -- exclusiva·compartida·abierta·a confirmar
  papeles_estado TEXT,          -- al día·falta algo menor·falta bastante·sin revisar
  papeles_notas TEXT,
  fotos TEXT DEFAULT '[]',
  url_publicacion TEXT,
  ingresada_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operacion (
  id TEXT PRIMARY KEY,
  embarcacion_id TEXT NOT NULL REFERENCES embarcacion(id),
  comprador_id TEXT REFERENCES persona(id),
  vendedor_id TEXT REFERENCES persona(id),
  precio_cierre INTEGER,
  etapa TEXT NOT NULL DEFAULT 'consulta', -- consulta·visita agendada·visita hecha·prueba de navegación·oferta·reserva/seña·papeles en trámite·cerrada·caída
  fecha_primer_contacto TEXT,
  fecha_cierre TEXT,
  operacion_vinculada_id TEXT REFERENCES operacion(id), -- upgrades: venta del viejo ↔ compra del nuevo
  motivo_caida TEXT
);

CREATE TABLE IF NOT EXISTS conversacion (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL REFERENCES persona(id),
  canal TEXT NOT NULL,          -- whatsapp·instagram·facebook·web·email·telefono·presencial
  estado TEXT NOT NULL DEFAULT 'abierta', -- abierta·esperando respuesta de él·esperando respuesta nuestra·cerrada
  embarcacion_referida_id TEXT REFERENCES embarcacion(id),
  ultima_actividad TEXT
);
CREATE INDEX IF NOT EXISTS idx_conv_persona ON conversacion(persona_id);

CREATE TABLE IF NOT EXISTS mensaje (
  id TEXT PRIMARY KEY,
  conversacion_id TEXT NOT NULL REFERENCES conversacion(id),
  direccion TEXT NOT NULL,      -- entrante·saliente
  contenido TEXT,
  timestamp TEXT NOT NULL,
  autor TEXT,                   -- leandro·agente-ia·cliente
  leido_en TEXT,
  respondido_en TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON mensaje(conversacion_id);

CREATE TABLE IF NOT EXISTS tasacion (
  id TEXT PRIMARY KEY,
  persona_id TEXT REFERENCES persona(id),
  datos_embarcacion TEXT NOT NULL, -- JSON con mismos campos que embarcacion
  valor_estimado_min INTEGER,
  valor_estimado_max INTEGER,
  fundamento TEXT,
  convertida_en_captacion INTEGER DEFAULT 0,
  origen TEXT,                  -- web pública·informe anual·carga interna
  creada_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS senal (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL REFERENCES persona(id),
  tipo TEXT NOT NULL,           -- taso_su_barco·publico_en_portal·visito_web·miro_embarcacion·abrio_informe_anual·respondio_informe_anual·interactuo_en_redes·menciono_limitacion·dio_de_baja_seguro·aniversario_compra
  peso INTEGER NOT NULL DEFAULT 1,
  detalle TEXT,
  embarcacion_id TEXT REFERENCES embarcacion(id),
  fecha TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_senal_persona ON senal(persona_id);

-- Propuestas del motor de matching pendientes de aprobación humana (§4.1: nunca se envía solo)
CREATE TABLE IF NOT EXISTS propuesta (
  id TEXT PRIMARY KEY,
  embarcacion_id TEXT NOT NULL REFERENCES embarcacion(id),
  busqueda_id TEXT NOT NULL REFERENCES busqueda(id),
  persona_id TEXT NOT NULL REFERENCES persona(id),
  puntaje REAL NOT NULL,
  motivo TEXT NOT NULL,
  mensaje_borrador TEXT NOT NULL,
  via TEXT NOT NULL,            -- whatsapp·copy-paste (lead sin teléfono)
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente·aprobada·editada-y-aprobada·descartada
  creada_en TEXT NOT NULL,
  resuelta_en TEXT
);

-- Agenda: eventos del negocio, sincronizados con Google Calendar (mock en demo)
CREATE TABLE IF NOT EXISTS cita (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL REFERENCES persona(id),
  embarcacion_id TEXT REFERENCES embarcacion(id),
  tipo TEXT NOT NULL DEFAULT 'mostrar embarcación', -- mostrar embarcación·prueba de navegación·firma de transferencia·visita de tasación·entrega de embarcación·otro
  fecha TEXT NOT NULL,
  notas TEXT,
  gcal_event_id TEXT              -- id del evento espejado en Google Calendar
);

-- Radar de mercado: avisos de terceros en MercadoLibre / Facebook Marketplace.
-- Nuevos arriba; una baja de precio = vendedor frustrado = oportunidad de captación.
CREATE TABLE IF NOT EXISTS aviso_externo (
  id TEXT PRIMARY KEY,
  fuente TEXT NOT NULL,           -- mercadolibre·marketplace
  titulo TEXT NOT NULL,
  url TEXT,
  precio INTEGER NOT NULL,        -- USD, precio actual
  precio_anterior INTEGER,        -- el inmediato anterior (si hubo baja)
  precio_inicial INTEGER,         -- con el que se publicó
  bajas INTEGER NOT NULL DEFAULT 0,
  publicado_en TEXT NOT NULL,
  detectado_en TEXT NOT NULL,
  ultima_baja_en TEXT,
  persona_id TEXT REFERENCES persona(id), -- si el dueño ya está en la base
  contactado INTEGER NOT NULL DEFAULT 0,
  notas TEXT
);

-- Auditoría: toda acción sobre un contacto queda registrada con autor y timestamp (§4.4)
CREATE TABLE IF NOT EXISTS auditoria (
  id TEXT PRIMARY KEY,
  persona_id TEXT,
  accion TEXT NOT NULL,
  detalle TEXT,
  autor TEXT NOT NULL,          -- leandro·agente-ia·sistema
  timestamp TEXT NOT NULL
);
`);

// migraciones suaves para bases ya creadas
try { db.exec('ALTER TABLE cita ADD COLUMN gcal_event_id TEXT'); } catch { /* ya existe */ }
try { db.exec('ALTER TABLE aviso_externo ADD COLUMN foto TEXT'); } catch { /* ya existe */ }
try { db.exec('ALTER TABLE aviso_externo ADD COLUMN contacto TEXT'); } catch { /* ya existe */ }
// Dónde está publicada cada embarcación (web propia, Instagram, portales)
try { db.exec('ALTER TABLE embarcacion ADD COLUMN url_instagram TEXT'); } catch { /* ya existe */ }
try { db.exec('ALTER TABLE embarcacion ADD COLUMN publicado_en TEXT'); } catch { /* ya existe */ }
try { db.exec('ALTER TABLE embarcacion ADD COLUMN url_portal TEXT'); } catch { /* ya existe */ }
// Seguro de cada embarcación: renovaciones y bajas son señales de venta (§4.2)
try { db.exec('ALTER TABLE embarcacion ADD COLUMN aseguradora TEXT'); } catch { /* ya existe */ }
try { db.exec('ALTER TABLE embarcacion ADD COLUMN poliza_numero TEXT'); } catch { /* ya existe */ }
try { db.exec('ALTER TABLE embarcacion ADD COLUMN poliza_vence TEXT'); } catch { /* ya existe */ }
try { db.exec('ALTER TABLE embarcacion ADD COLUMN poliza_prima_anual INTEGER'); } catch { /* ya existe */ }
try { db.exec('ALTER TABLE embarcacion ADD COLUMN poliza_estado TEXT'); } catch { /* ya existe */ }

// ———————————————————————————————————————————————————————————————————————————
// Estructura de automatización: eventos, matching y carga de unidades por WhatsApp
// ———————————————————————————————————————————————————————————————————————————
db.exec(`
-- Eventos del dominio (outbox). Cada hecho relevante queda registrado y los handlers
-- (matching, avisos) lo procesan una sola vez, sin importar desde dónde se originó.
CREATE TABLE IF NOT EXISTS evento (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,           -- embarcacion.publicada · embarcacion.precio_bajado · busqueda.creada · busqueda.reabierta
  entidad_id TEXT NOT NULL,
  datos TEXT,                   -- JSON
  creado_en TEXT NOT NULL,
  procesado_en TEXT,
  resultado TEXT,               -- JSON con lo que hizo cada handler
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_evento_pendiente ON evento(procesado_en) WHERE procesado_en IS NULL;

-- Quiénes pueden cargar unidades por WhatsApp (Leandro y su equipo). Cualquier otro número se ignora.
CREATE TABLE IF NOT EXISTS operador (
  telefono TEXT PRIMARY KEY,    -- E.164
  nombre TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL
);

-- La unidad se arma conversando y recién pasa al inventario cuando el operador confirma.
CREATE TABLE IF NOT EXISTS borrador_embarcacion (
  id TEXT PRIMARY KEY,
  operador_tel TEXT NOT NULL,
  canal TEXT NOT NULL,          -- whatsapp · simulador · web
  estado TEXT NOT NULL DEFAULT 'abierto', -- abierto · publicado · cancelado
  datos TEXT NOT NULL DEFAULT '{}',
  fotos TEXT NOT NULL DEFAULT '[]',
  embarcacion_id TEXT REFERENCES embarcacion(id),
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

-- Todo lo que pasó por el canal de carga, en los dos sentidos.
CREATE TABLE IF NOT EXISTS intake_mensaje (
  id TEXT PRIMARY KEY,
  operador_tel TEXT NOT NULL,
  canal TEXT NOT NULL,
  direccion TEXT NOT NULL,      -- entrante · saliente
  texto TEXT,
  medios TEXT DEFAULT '[]',
  borrador_id TEXT,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intake_operador ON intake_mensaje(operador_tel, timestamp);

-- Última lista que se le mandó al operador, para que "1 3" o "todos" sepa a qué se refiere.
CREATE TABLE IF NOT EXISTS operador_contexto (
  operador_tel TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,           -- lista_propuestas
  datos TEXT NOT NULL,          -- JSON
  actualizado_en TEXT NOT NULL
);

-- Parámetros del negocio que Leandro puede ajustar sin tocar código.
CREATE TABLE IF NOT EXISTS config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  descripcion TEXT
);
`);
try { db.exec('ALTER TABLE propuesta ADD COLUMN origen TEXT'); } catch { /* ya existe */ }      // alta · precio_bajado · busqueda_nueva · manual
try { db.exec('ALTER TABLE propuesta ADD COLUMN factores TEXT'); } catch { /* ya existe */ }    // JSON: desglose del puntaje
try { db.exec('ALTER TABLE busqueda ADD COLUMN modelo_referencia TEXT'); } catch { /* ya existe */ } // "Quicksilver 1700"
try { db.exec('ALTER TABLE busqueda ADD COLUMN marcas_preferidas TEXT'); } catch { /* ya existe */ } // JSON
try { db.exec('ALTER TABLE embarcacion ADD COLUMN cantidad_motores INTEGER'); } catch { /* ya existe */ }
try { db.exec('ALTER TABLE embarcacion ADD COLUMN notas TEXT'); } catch { /* ya existe */ }
try { db.exec('ALTER TABLE embarcacion ADD COLUMN cargada_por TEXT'); } catch { /* ya existe */ } // operador y canal: "Leandro · whatsapp"
try { db.exec('ALTER TABLE intake_mensaje ADD COLUMN externo_id TEXT'); } catch { /* ya existe */ } // id del proveedor (wamid): Meta reintenta webhooks
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_externo ON intake_mensaje(externo_id) WHERE externo_id IS NOT NULL");
// El simulador del CRM siempre tiene un operador. Los números reales se habilitan por OPERADORES_WHATSAPP o desde el CRM.
db.prepare("INSERT OR IGNORE INTO operador (telefono, nombre, activo, creado_en) VALUES ('sim:leandro', 'Leandro', 1, ?)").run(new Date().toISOString());

const CONFIG_DEFAULT = {
  'matching.tolerancia_precio': ['0.15', 'Cuánto por encima del presupuesto máximo se acepta un barco (0.15 = 15%). La gente estira por el barco correcto.'],
  'matching.tolerancia_casi': ['0.30', 'Hasta cuánto por encima se considera "casi entra": si el dueño baja, se suma.'],
  'matching.piso_presupuesto': ['0.60', 'Por debajo de este % del presupuesto mínimo, el barco se considera fuera de su categoría.'],
  'matching.puntaje_minimo': ['25', 'Puntaje mínimo para proponer un barco desde la búsqueda (las propuestas desde el alta no tienen piso).'],
};
const insConfig = db.prepare('INSERT OR IGNORE INTO config (clave, valor, descripcion) VALUES (?,?,?)');
for (const [k, [v, d]] of Object.entries(CONFIG_DEFAULT)) insConfig.run(k, v, d);

function config(clave, porDefecto = null) {
  const r = db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave);
  return r ? r.valor : porDefecto;
}

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

// Normalización a E.164 argentino (clave de deduplicación, §3.1)
function normalizarTelefono(t) {
  if (!t) return null;
  let d = String(t).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('549')) return '+' + d;
  if (d.startsWith('54')) return '+549' + d.slice(2).replace(/^9/, '');
  if (d.startsWith('11') || d.startsWith('15')) return '+549' + d.replace(/^15/, '11');
  if (d.length === 10) return '+549' + d;
  return '+' + d;
}

function auditar(personaId, accion, detalle, autor = 'sistema') {
  db.prepare(`INSERT INTO auditoria (id, persona_id, accion, detalle, autor, timestamp) VALUES (?,?,?,?,?,?)`)
    .run(uid(), personaId, accion, detalle || null, autor, now());
}

module.exports = { db, uid, now, normalizarTelefono, auditar, config };
