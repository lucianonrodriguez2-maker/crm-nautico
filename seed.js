// seed.js — Datos ficticios pero verosímiles (spec: modo demo)
// ~30 personas argentinas, ~25 embarcaciones reales del mercado, los 3 Casos de §2 armados.
const { db, uid, now, normalizarTelefono } = require('./db');

const hoy = new Date();
const dias = (n) => new Date(hoy.getTime() - n * 864e5).toISOString();
const enDias = (n, hora = 10) => { const d = new Date(hoy.getTime() + n * 864e5); d.setHours(hora, 0, 0, 0); return d.toISOString(); };

db.exec(`DELETE FROM evento; DELETE FROM intake_mensaje; DELETE FROM borrador_embarcacion; DELETE FROM operador_contexto; DELETE FROM auditoria; DELETE FROM aviso_externo; DELETE FROM propuesta; DELETE FROM cita; DELETE FROM senal;
DELETE FROM tasacion; DELETE FROM mensaje; DELETE FROM conversacion; DELETE FROM operacion;
DELETE FROM busqueda; UPDATE embarcacion SET propietario_id=NULL; DELETE FROM embarcacion; DELETE FROM persona;`);

const insP = db.prepare(`INSERT INTO persona (id,nombre,telefono,email,instagram_handle,prometheo_id,origen,referido_por,roles,estado,contexto_personal,notas_libres,no_contactar,creado_en,ultima_interaccion)
VALUES (@id,@nombre,@telefono,@email,@instagram_handle,@prometheo_id,@origen,@referido_por,@roles,@estado,@contexto_personal,@notas_libres,@no_contactar,@creado_en,@ultima_interaccion)`);
const insB = db.prepare(`INSERT INTO busqueda (id,persona_id,tipo_embarcacion,eslora_min,eslora_max,presupuesto_min,presupuesto_max,motor_tipo,hp_min,uso_declarado,necesita_bano,necesita_trailer,urgencia,entrega_algo,limitacion_declarada,estado,motivo_cierre,texto_original,creada_en,actualizada_en,modelo_referencia,marcas_preferidas)
VALUES (@id,@persona_id,@tipo_embarcacion,@eslora_min,@eslora_max,@presupuesto_min,@presupuesto_max,@motor_tipo,@hp_min,@uso_declarado,@necesita_bano,@necesita_trailer,@urgencia,@entrega_algo,@limitacion_declarada,@estado,@motivo_cierre,@texto_original,@creada_en,@actualizada_en,@modelo_referencia,@marcas_preferidas)`);
const insE = db.prepare(`INSERT INTO embarcacion (id,tipo,marca,modelo,anio,eslora,manga,motor_marca,motor_hp,motor_tipo,motor_horas,combustible_litros,equipamiento,estado_general,tiene_bano,tiene_trailer,precio_pedido,precio_minimo_aceptado,precio_venta_real,propietario_id,situacion,exclusividad,papeles_estado,fotos,url_publicacion,url_instagram,publicado_en,ingresada_en)
VALUES (@id,@tipo,@marca,@modelo,@anio,@eslora,@manga,@motor_marca,@motor_hp,@motor_tipo,@motor_horas,@combustible_litros,@equipamiento,@estado_general,@tiene_bano,@tiene_trailer,@precio_pedido,@precio_minimo_aceptado,@precio_venta_real,@propietario_id,@situacion,@exclusividad,@papeles_estado,@fotos,@url_publicacion,@url_instagram,@publicado_en,@ingresada_en)`);
const insO = db.prepare(`INSERT INTO operacion (id,embarcacion_id,comprador_id,vendedor_id,precio_cierre,etapa,fecha_primer_contacto,fecha_cierre,operacion_vinculada_id) VALUES (?,?,?,?,?,?,?,?,?)`);
const insC = db.prepare(`INSERT INTO conversacion (id,persona_id,canal,estado,embarcacion_referida_id,ultima_actividad) VALUES (?,?,?,?,?,?)`);
const insM = db.prepare(`INSERT INTO mensaje (id,conversacion_id,direccion,contenido,timestamp,autor,respondido_en) VALUES (?,?,?,?,?,?,?)`);
const insS = db.prepare(`INSERT INTO senal (id,persona_id,tipo,peso,detalle,embarcacion_id,fecha) VALUES (?,?,?,?,?,?,?)`);
const insT = db.prepare(`INSERT INTO tasacion (id,persona_id,datos_embarcacion,valor_estimado_min,valor_estimado_max,fundamento,convertida_en_captacion,origen,creada_en) VALUES (?,?,?,?,?,?,?,?,?)`);
const insCita = db.prepare(`INSERT INTO cita (id,persona_id,embarcacion_id,tipo,fecha,notas) VALUES (?,?,?,?,?,?)`);

function persona(o) {
  const p = Object.assign({
    id: uid(), nombre: '', telefono: null, email: null, instagram_handle: null,
    prometheo_id: null, origen: 'whatsapp', referido_por: null, roles: '["comprador"]',
    estado: 'activo', contexto_personal: null, notas_libres: null, no_contactar: 0,
    creado_en: dias(400), ultima_interaccion: dias(30)
  }, o);
  if (p.telefono) p.telefono = normalizarTelefono(p.telefono);
  insP.run(p); return p;
}
function busqueda(o) {
  const b = Object.assign({
    id: uid(), persona_id: null, tipo_embarcacion: '["lancha open"]', eslora_min: null, eslora_max: null,
    presupuesto_min: null, presupuesto_max: null, motor_tipo: 'indistinto', hp_min: null,
    uso_declarado: '["paseo familiar"]', necesita_bano: 0, necesita_trailer: 0, urgencia: 'en los próximos meses',
    entrega_algo: 0, limitacion_declarada: null, estado: 'activa', motivo_cierre: null, texto_original: null,
    creada_en: dias(60), actualizada_en: null, modelo_referencia: null, marcas_preferidas: '[]'
  }, o);
  insB.run(b); return b;
}
function barco(o) {
  const e = Object.assign({
    id: uid(), tipo: 'lancha open', marca: '', modelo: '', anio: 2015, eslora: 5.2, manga: 2.1,
    motor_marca: 'Mercury', motor_hp: 90, motor_tipo: 'fuera de borda', motor_horas: 300,
    combustible_litros: 100, equipamiento: '["ecosonda","estéreo","toldo"]', estado_general: 'muy bueno',
    tiene_bano: 0, tiene_trailer: 0, precio_pedido: 20000, precio_minimo_aceptado: null, precio_venta_real: null,
    propietario_id: null, situacion: 'en venta', exclusividad: 'exclusiva', papeles_estado: 'al día',
    fotos: '[]', url_publicacion: null, url_instagram: null, publicado_en: null,
    ingresada_en: dias(90)
  }, o);
  if (!e.precio_minimo_aceptado && e.precio_pedido) e.precio_minimo_aceptado = Math.round(e.precio_pedido * 0.9);
  insE.run(e); return e;
}

/* ============================== PERSONAS ============================== */

// —— CASO 3: escalera náutica. Ex-cliente que compró en 2021 y está por dar el salto.
const martin = persona({
  nombre: 'Martín Aguirre', telefono: '11 5522 8090', email: 'martin.aguirre@gmail.com',
  origen: 'referido', roles: '["comprador","ex-cliente-comprador"]',
  contexto_personal: 'Familia de 4, nena de 8 y nene de 5. Guarda en Náutica del Delta (San Fernando). Sale casi todos los fines de semana.',
  notas_libres: 'Arrancó con un tracker Kiel en 2017 y en 2021 pasó a la Quicksilver 1700. Muy conforme, recomendó a dos amigos.',
  creado_en: dias(1780), ultima_interaccion: dias(2)
});
// —— CASO 1: buscó una Quicksilver 1700 y no había. Búsqueda activa hace meses.
const carla = persona({
  nombre: 'Carla Domínguez', telefono: '11 6033 4471', email: 'carla.dominguez@hotmail.com',
  origen: 'instagram', instagram_handle: '@carla.dmg', prometheo_id: 'prm_00341',
  contexto_personal: 'Pareja joven, primer barco. Van a usarla en el Tigre con amigos.',
  creado_en: dias(140), ultima_interaccion: dias(9)
});
const gustavo = persona({
  nombre: 'Gustavo Pereyra', telefono: '11 4478 2216', origen: 'whatsapp', prometheo_id: 'prm_00302',
  contexto_personal: 'Pesca con amigos en el río abierto. Ya tuvo un tracker, sabe de motores.',
  creado_en: dias(210), ultima_interaccion: dias(25)
});
// Lead SOLO Instagram, sin teléfono → matching debe generar tarea copy-paste (criterio §9)
const flor = persona({
  nombre: 'Florencia Ibarra', telefono: null, instagram_handle: '@flor.ibarra88',
  origen: 'instagram', prometheo_id: 'prm_00415',
  contexto_personal: 'Preguntó por DM, todavía no pasó el número. Quiere algo para paseos con la familia.',
  creado_en: dias(45), ultima_interaccion: dias(6)
});
const diego = persona({
  nombre: 'Diego Salvatierra', telefono: '11 3390 1123', email: 'dsalvatierra@yahoo.com.ar',
  origen: 'web', contexto_personal: 'Wakeboard con el hijo adolescente. Mira desde hace un año, ahora apura.',
  creado_en: dias(370), ultima_interaccion: dias(4)
});
// —— CASO 2: dueño que quiere vender — entró por el tasador público HOY.
const raul = persona({
  nombre: 'Raúl Benítez', telefono: '11 5901 7734', email: 'raul.benitez62@gmail.com',
  origen: 'web', roles: '["vendedor"]',
  contexto_personal: 'Usó el tasador web. Tiene una Canestrari 195 del 2016, dice que la usa poco.',
  creado_en: dias(0), ultima_interaccion: dias(0)
});
// Persona con doble rol a lo largo del tiempo (criterio §9: comprador 2023 → vendedor ahora)
const silvia = persona({
  nombre: 'Silvia Cattaneo', telefono: '11 4890 5567', email: 'silvia.cattaneo@gmail.com',
  origen: 'guarderia/club', roles: '["comprador","ex-cliente-comprador","vendedor"]',
  contexto_personal: 'Arrancó con una Piccini open en 2018 y en 2023 pasó a la Bermuda Cuddy. Ahora la vende: se mudan a Nordelta y quiere algo con más manga.',
  creado_en: dias(1100), ultima_interaccion: dias(0.6)
});
const marcelo = persona({
  nombre: 'Marcelo Funes', telefono: '11 6702 3348', origen: 'facebook',
  contexto_personal: 'Jubilado, quiere un crucero chico para dormir a bordo con la señora.',
  creado_en: dias(95), ultima_interaccion: dias(18)
});
const andrea = persona({
  nombre: 'Andrea Kaplan', telefono: '11 5210 9963', email: 'akaplan@estudiokaplan.com.ar',
  origen: 'referido', referido_por: martin.id,
  contexto_personal: 'Amiga de Martín Aguirre. Primer barco, prioriza que sea fácil de manejar.',
  creado_en: dias(75), ultima_interaccion: dias(1)
});
const pablo = persona({
  nombre: 'Pablo Ricciardi', telefono: '11 4432 8875', origen: 'whatsapp', prometheo_id: 'prm_00378',
  contexto_personal: 'Tiene amarra en el CUBA de Núñez. Busca semirrígido para llegar rápido a la isla.',
  creado_en: dias(160), ultima_interaccion: dias(3)
});
// Ex-cliente vendedor (le vendió el barco a través de Leandro en 2022)
const jorge = persona({
  nombre: 'Jorge Etchegaray', telefono: '11 5588 0412', origen: 'guarderia/club',
  roles: '["vendedor","ex-cliente-vendedor"]',
  contexto_personal: 'Vendió su Bayliner por Leandro en 2022. Quedó conforme. Dice que "algún día vuelve al río".',
  creado_en: dias(1500), ultima_interaccion: dias(400)
});
const vero = persona({
  nombre: 'Verónica Almada', telefono: '11 3345 6690', origen: 'instagram', instagram_handle: '@vero.almada',
  prometheo_id: 'prm_00422',
  contexto_personal: 'Escribió primero por Instagram y después por WhatsApp con el mismo número.',
  creado_en: dias(150), ultima_interaccion: dias(0.08)
});
const nico = persona({
  nombre: 'Nicolás Bruzzone', telefono: '11 6115 2280', origen: 'whatsapp', prometheo_id: 'prm_00450',
  contexto_personal: 'Consultó hoy por la Klase A. Primer contacto.',
  creado_en: dias(0.05), ultima_interaccion: dias(0.05)
});
const cachi = persona({
  nombre: 'Osvaldo "Cachi" Medrano', telefono: '11 4901 3356', origen: 'guarderia/club',
  roles: '["vendedor"]',
  contexto_personal: 'Guardería Náutica San Fernando. Vende la Paglietini de su viejo, un clásico del 80. Papeles a medio hacer.',
  notas_libres: 'Papeles: falta sucesión. No publicar hasta resolver.',
  creado_en: dias(30), ultima_interaccion: dias(15)
});
const romina = persona({
  nombre: 'Romina Scarpa', telefono: '11 5677 4821', email: 'romi.scarpa@gmail.com', origen: 'web',
  contexto_personal: 'Formulario web. Pareja sin hijos, quieren cuddy para escapadas de finde.',
  creado_en: dias(50), ultima_interaccion: dias(7)
});
const federico = persona({
  nombre: 'Federico Lanusse', telefono: '11 4055 9932', origen: 'portal', roles: '["comprador","ex-cliente-comprador"]',
  contexto_personal: 'Vino de MercadoLibre. Compara mucho, pregunta por todo el inventario.',
  creado_en: dias(220), ultima_interaccion: dias(40)
});
const ceci = persona({
  nombre: 'Cecilia Ferrero', telefono: '11 6820 1147', origen: 'whatsapp', prometheo_id: 'prm_00398',
  roles: '["curioso"]', estado: 'frio',
  contexto_personal: 'Preguntó precios "para más adelante". Sin apuro real.',
  creado_en: dias(180), ultima_interaccion: dias(120)
});
const hernan = persona({
  nombre: 'Hernán Duarte', telefono: '11 5340 2299', origen: 'whatsapp',
  roles: '["comprador","ex-cliente-comprador"]',
  contexto_personal: 'Compró la Quest 210 en 2020 (antes tuvo una Bayliner). Pesca embarcado. Guarda en Escobar.',
  creado_en: dias(4400), ultima_interaccion: dias(1.5)
});
const lucia = persona({
  nombre: 'Lucía Bermúdez', telefono: '11 4788 6034', origen: 'instagram', instagram_handle: '@lu.bermudez',
  contexto_personal: 'Compraría con el hermano a medias. Presupuesto ajustado pero concreto.',
  creado_en: dias(20), ultima_interaccion: dias(2)
});
const walter = persona({
  nombre: 'Walter Giordano', telefono: '11 5099 8123', origen: 'whatsapp', roles: '["vendedor"]',
  contexto_personal: 'Vende su semirrígido porque se va a vivir a Córdoba.',
  creado_en: dias(70), ultima_interaccion: dias(35)
});
const mati = persona({
  nombre: 'Matías Echeverría', telefono: '11 6234 0917', origen: 'referido', referido_por: hernan.id,
  contexto_personal: 'Compañero de pesca de Hernán. Quiere tracker con poco uso.',
  creado_en: dias(110), ultima_interaccion: dias(28)
});
const graciela = persona({
  nombre: 'Graciela Ponce', telefono: '11 4456 7788', origen: 'telefono', estado: 'dormido',
  contexto_personal: 'Llamó en verano. Dijo que retoma en primavera.',
  creado_en: dias(240), ultima_interaccion: dias(190)
});
const tomas = persona({
  nombre: 'Tomás Uriburu', telefono: '11 5920 3345', origen: 'web',
  contexto_personal: 'Vive en San Isidro, amarra propia. Busca crucero, mira hace poco pero tiene el dinero listo.',
  creado_en: dias(15), ultima_interaccion: dias(1)
});
const anibal = persona({
  nombre: 'Aníbal Sosa', telefono: '11 3211 4567', origen: 'facebook', estado: 'cerrado',
  roles: '["curioso"]', contexto_personal: 'Preguntó dos veces y no respondió más.',
  creado_en: dias(300), ultima_interaccion: dias(260)
});
const marina = persona({
  nombre: 'Marina Oyarzábal', telefono: '11 6540 8890', origen: 'instagram', instagram_handle: '@marina.oyar',
  prometheo_id: 'prm_00431',
  contexto_personal: 'Instructora de wakeboard. Busca lancha con torre para trabajar.',
  creado_en: dias(35), ultima_interaccion: dias(5)
});
const ruben = persona({
  nombre: 'Rubén Alcaraz', telefono: '11 4123 9908', origen: 'guarderia/club', roles: '["vendedor"]',
  contexto_personal: 'Vende la Geuna del padre. Exclusividad firmada.',
  creado_en: dias(120), ultima_interaccion: dias(60)
});
const caro = persona({
  nombre: 'Carolina Espinosa', telefono: '11 5867 2213', origen: 'whatsapp', prometheo_id: 'prm_00405',
  no_contactar: 1, estado: 'no-contactar',
  contexto_personal: 'Pidió que no le escriban más: compró en otro lado. Respetar SIEMPRE.',
  creado_en: dias(90), ultima_interaccion: dias(55)
});
const seba = persona({
  nombre: 'Sebastián Larralde', telefono: '11 6788 4302', origen: 'whatsapp',
  roles: '["comprador","ex-cliente-comprador"]',
  contexto_personal: 'Compró la Eclipse 16 en 2019 (arrancó con una moto de agua). Familia con 3 chicos, la lancha les quedó chica hace rato.',
  creado_en: dias(3700), ultima_interaccion: dias(2.5)
});
const ines = persona({
  nombre: 'Inés Malbrán', telefono: '11 5490 6675', origen: 'referido', referido_por: silvia.id,
  contexto_personal: 'Vecina de Silvia en el club. Quiere "algo chico y sin complicaciones".',
  creado_en: dias(25), ultima_interaccion: dias(10)
});
const oscar = persona({
  nombre: 'Óscar Taboada', telefono: '11 4302 5561', origen: 'portal', roles: '["vendedor"]',
  contexto_personal: 'Publicó su crucero en un portal y no lo vende hace 8 meses. Abierto a que lo trabaje un broker.',
  creado_en: dias(12), ultima_interaccion: dias(12)
});


// Vendedores y compradores de las operaciones (toda operación tiene dos puntas)
const alberto = persona({
  nombre: 'Alberto Giménez', telefono: '11 4530 7789', origen: 'guarderia/club', roles: '["vendedor"]',
  contexto_personal: 'Vende la Klase A 2400 porque se compró una más grande en Punta del Este. Exclusiva firmada.',
  creado_en: dias(25), ultima_interaccion: dias(4)
});
const nestor = persona({
  nombre: 'Néstor Palacios', telefono: '11 5218 9034', origen: 'referido', roles: '["vendedor"]',
  contexto_personal: 'Vende la Quest 210 por poco uso: los hijos ya no van al río. Quiere cerrar antes de la primavera.',
  creado_en: dias(80), ultima_interaccion: dias(3)
});
const fabian = persona({
  nombre: 'Fabián Cardozo', telefono: '11 6402 1187', origen: 'portal', roles: '["vendedor"]',
  contexto_personal: 'Vende la MasterCraft X214: se lesionó la rodilla y dejó el wake. La tiene impecable.',
  creado_en: dias(12), ultima_interaccion: dias(2)
});
const rodolfo = persona({
  nombre: 'Rodolfo Ferreyra', telefono: '11 4788 2245', origen: 'guarderia/club', roles: '["vendedor","ex-cliente-vendedor"]',
  contexto_personal: 'Vendió dos barcos por Leandro (la Quest 2011 y la Quicksilver 1700). Cliente de años.',
  creado_en: dias(2200), ultima_interaccion: dias(300)
});
const marta = persona({
  nombre: 'Marta Iglesias', telefono: '11 5093 6672', origen: 'referido', roles: '["vendedor","ex-cliente-vendedor"]',
  contexto_personal: 'Vendió la Canestrari 215 en 2023 (la compró Silvia) y la Eclipse 16 en 2019.',
  creado_en: dias(2600), ultima_interaccion: dias(900)
});
const claudio = persona({
  nombre: 'Claudio Barreiro', telefono: '11 6544 8810', origen: 'whatsapp', roles: '["comprador","ex-cliente-comprador"]',
  contexto_personal: 'Arrancó con la moto de Sebastián (2019) y en 2022 pasó a la Bayliner de Jorge. Pesca tranquila en el Luján.',
  creado_en: dias(2500), ultima_interaccion: dias(3)
});
const sergio = persona({
  nombre: 'Sergio Vega', telefono: '11 4211 5990', origen: 'portal', roles: '["comprador","ex-cliente-comprador"]',
  contexto_personal: 'Compró la Quicksilver 1700 2014 el año pasado (la que Carla llegó tarde a ver).',
  creado_en: dias(520), ultima_interaccion: dias(200)
});

/* ============================== EMBARCACIONES ============================== */
// Inventario en venta (marcas y modelos reales del mercado del Delta, USD 12k–60k)
const inv = [];
const qs2000 = barco({ tipo: 'lancha open', marca: 'Quicksilver', modelo: '2000', anio: 2011, eslora: 6.1, manga: 2.34, motor_marca: 'Mercury', motor_hp: 150, motor_horas: 420, combustible_litros: 140, precio_pedido: 26500, url_publicacion: 'https://leandroramosbrokernautico.com/property/quicksilver-2000-2011/', fotos: '["https://leandroramosbrokernautico.com/wp-content/uploads/2026/03/Quicksilver2000_2011_ML-340x340.png"]', equipamiento: '["ecosonda Garmin","VHF","toldo","escalera inox","estéreo"]', estado_general: 'muy bueno', tiene_trailer: 1, ingresada_en: dias(45), propietario_id: ruben.id });
const klaseA = barco({ tipo: 'lancha cuddy', marca: 'Klase A', modelo: '2400', anio: 2021, propietario_id: alberto.id, url_publicacion: 'https://leandroramosbrokernautico.com/property/klase-a-2400-2021-3/', fotos: '["https://leandroramosbrokernautico.com/wp-content/uploads/2026/07/KlaseA2400_2021_ML-340x340.png"]', eslora: 7.3, manga: 2.6, motor_marca: 'Mercruiser', motor_hp: 250, motor_tipo: 'dentro-fuera', motor_horas: 380, combustible_litros: 220, precio_pedido: 58000, equipamiento: '["baño químico","cocina","VHF","ecosonda","estéreo Fusion","toldo completo"]', estado_general: 'excelente', tiene_bano: 1, ingresada_en: dias(20) });
const eclipse19 = barco({ tipo: 'lancha open', marca: 'Arco Iris', modelo: 'Eclipse 19', anio: 2020, url_publicacion: 'https://leandroramosbrokernautico.com/property/arco-iris-eclipse-19-2020/', fotos: '["https://leandroramosbrokernautico.com/wp-content/uploads/2026/04/Eclipse19_2020_ML-340x340.png"]', eslora: 5.8, manga: 2.3, motor_marca: 'Yamaha', motor_hp: 115, motor_horas: 190, combustible_litros: 120, precio_pedido: 27500, equipamiento: '["ecosonda","toldo","estéreo","escalera inox"]', estado_general: 'excelente', tiene_trailer: 1, ingresada_en: dias(8) });
const canestrari245 = barco({ tipo: 'crucero', marca: 'Canestrari', modelo: '245', anio: 2015, url_publicacion: 'https://leandroramosbrokernautico.com/property/canestrari-245-2015-2-2/', fotos: '["https://leandroramosbrokernautico.com/wp-content/uploads/2026/07/Canestrari245_2015_ML-340x340.png"]', eslora: 7.5, manga: 2.7, motor_marca: 'Volvo Penta', motor_hp: 270, motor_tipo: 'dentro-fuera', motor_horas: 610, combustible_litros: 280, precio_pedido: 52000, equipamiento: '["baño marino","camarote doble","cocina","heladera","VHF","GPS plotter"]', estado_general: 'muy bueno', tiene_bano: 1, ingresada_en: dias(130) });
const quest210 = barco({ tipo: 'lancha cuddy', marca: 'Quest', modelo: '210', anio: 2016, propietario_id: nestor.id, url_publicacion: 'https://leandroramosbrokernautico.com/property/quest-210-2016/', fotos: '["https://leandroramosbrokernautico.com/wp-content/uploads/2026/05/Quest210_2016_ML-340x340.png"]', eslora: 6.4, manga: 2.44, motor_marca: 'Mercruiser', motor_hp: 220, motor_tipo: 'dentro-fuera', motor_horas: 540, combustible_litros: 180, precio_pedido: 33000, equipamiento: '["baño químico","VHF","ecosonda","toldo"]', estado_general: 'bueno', tiene_bano: 1, ingresada_en: dias(75) });
const bayliner185 = barco({ tipo: 'lancha open', marca: 'Bayliner', modelo: '185', anio: 2010, url_publicacion: 'https://leandroramosbrokernautico.com/property/bayliner-185-2010/', fotos: '["https://leandroramosbrokernautico.com/wp-content/uploads/2026/02/Bayliner185_2010_ML-340x340.png"]', eslora: 5.6, manga: 2.2, motor_marca: 'Mercruiser', motor_hp: 135, motor_tipo: 'dentro-fuera', motor_horas: 700, combustible_litros: 110, precio_pedido: 19500, equipamiento: '["estéreo","toldo"]', estado_general: 'bueno', tiene_trailer: 1, ingresada_en: dias(160) });
const piccini = barco({ tipo: 'lancha open', marca: 'Paglietini', modelo: '620', anio: 1980, eslora: 6.2, manga: 2.2, motor_marca: 'Evinrude', motor_hp: 75, motor_horas: 850, url_publicacion: 'https://leandroramosbrokernautico.com/property/paglietini-620-1980/', fotos: '["https://leandroramosbrokernautico.com/wp-content/uploads/2025/04/Paglietini620_1980_ML-340x340.png"]', combustible_litros: 80, precio_pedido: 12500, equipamiento: '["toldo"]', estado_general: 'a reacondicionar', situacion: 'en venta', papeles_estado: 'falta bastante', propietario_id: cachi.id, ingresada_en: dias(28) });
const bermuda180 = barco({ tipo: 'lancha cuddy', marca: 'Canestrari', modelo: '215', anio: 2013, eslora: 6.4, manga: 2.44, motor_marca: 'Mercruiser', motor_hp: 180, motor_tipo: 'dentro-fuera', motor_horas: 460, url_publicacion: 'https://leandroramosbrokernautico.com/property/canestrari-215-2013-2/', fotos: '["https://leandroramosbrokernautico.com/wp-content/uploads/2026/05/Canestrari215_2013_ML-340x340.png"]', combustible_litros: 100, precio_pedido: 24500, equipamiento: '["baño químico","ecosonda","toldo","estéreo"]', estado_general: 'muy bueno', tiene_bano: 1, propietario_id: silvia.id, ingresada_en: dias(18) });
const geunaF44 = barco({ tipo: 'crucero', marca: 'Segue', modelo: '32', anio: 2008, eslora: 9.75, manga: 3.2, motor_marca: 'Volvo Penta', motor_hp: 300, motor_tipo: 'intraborda', motor_horas: 1200, combustible_litros: 400, precio_pedido: 60000, url_publicacion: 'https://leandroramosbrokernautico.com/property/segue-32-2008/', fotos: '["https://leandroramosbrokernautico.com/wp-content/uploads/2026/05/Segue32_2008_ML-340x340.png"]', equipamiento: '["dos camarotes","baño marino","cocina completa","heladera","VHF","radar"]', estado_general: 'muy bueno', tiene_bano: 1, propietario_id: ruben.id, ingresada_en: dias(120) });
const kiel190 = barco({ tipo: 'semirrigido/tracker', marca: 'Prinz', modelo: '630', anio: 2012, propietario_id: walter.id, eslora: 6.3, url_publicacion: 'https://leandroramosbrokernautico.com/property/prinz-630-2012/', fotos: '["https://leandroramosbrokernautico.com/wp-content/uploads/2023/11/Portada_Web_Prinz630_2012-340x340.png"]', manga: 2.3, motor_marca: 'Yamaha', motor_hp: 100, motor_horas: 350, combustible_litros: 90, precio_pedido: 21000, equipamiento: '["ecosonda","VHF"]', estado_general: 'muy bueno', tiene_trailer: 1, ingresada_en: dias(55) });
const tracker16 = barco({ tipo: 'semirrigido/tracker', marca: 'Benavidez', modelo: '720', anio: 2011, eslora: 7.2, manga: 2.5, motor_marca: 'Mercury', motor_hp: 150, motor_horas: 520, combustible_litros: 60, precio_pedido: 19500, equipamiento: '["ecosonda","porta cañas"]', estado_general: 'bueno', tiene_trailer: 1, ingresada_en: dias(200) });
const regnicoli = barco({ tipo: 'crucero', marca: 'Trento', modelo: '285 Success', anio: 2010, eslora: 8.7, manga: 3.0, motor_marca: 'Volvo Penta', motor_hp: 260, motor_tipo: 'intraborda', motor_horas: 980, combustible_litros: 350, precio_pedido: 55000, url_publicacion: 'https://leandroramosbrokernautico.com/property/trento-285-success-2010/', fotos: '["https://leandroramosbrokernautico.com/wp-content/uploads/2026/03/Trento285_2010_ML-340x340.png"]', equipamiento: '["dos camarotes","baño marino","cocina","generador"]', estado_general: 'bueno', tiene_bano: 1, ingresada_en: dias(240) });
const eclipse21 = barco({ tipo: 'lancha open', marca: 'MasterCraft', modelo: 'X214', anio: 2010, propietario_id: fabian.id, eslora: 6.55, manga: 2.49, motor_marca: 'Ilmor', motor_hp: 350, motor_tipo: 'intraborda', motor_horas: 480, combustible_litros: 160, precio_pedido: 36500, url_publicacion: 'https://leandroramosbrokernautico.com/property/mastercraft-x214-2010/', fotos: '["https://leandroramosbrokernautico.com/wp-content/uploads/2026/04/MastercraftX214_2010_ML-340x340.png"]', equipamiento: '["torre de wakeboard","ecosonda","estéreo","toldo"]', estado_general: 'excelente', ingresada_en: dias(10) });
const qs1800w = barco({ tipo: 'lancha open', marca: 'Quicksilver', modelo: '1800', anio: 2007, eslora: 5.5, manga: 2.24, motor_marca: 'Mercury', motor_hp: 115, motor_horas: 620, combustible_litros: 100, precio_pedido: 16500, url_publicacion: 'https://leandroramosbrokernautico.com/property/quicksilver-1800-2007/', fotos: '["https://leandroramosbrokernautico.com/wp-content/uploads/2026/02/Quicksilver1800_2007_ML-340x340.png"]', equipamiento: '["estéreo","toldo"]', estado_general: 'muy bueno', tiene_trailer: 1, ingresada_en: dias(65) });
const virgin20 = barco({ tipo: 'lancha open', marca: 'Piccini', modelo: '229 S', anio: 2021, eslora: 6.9, manga: 2.45, motor_marca: 'Yamaha', motor_hp: 200, motor_horas: 260, combustible_litros: 130, precio_pedido: 32000, url_publicacion: 'https://leandroramosbrokernautico.com/property/piccini-229-s-2021/', fotos: '["https://leandroramosbrokernautico.com/wp-content/uploads/2026/02/Piccini229S_2021_ML-340x340.png"]', equipamiento: '["ecosonda","toldo","estéreo"]', estado_general: 'muy bueno', ingresada_en: dias(95) });
const baader = barco({ tipo: 'lancha open', marca: 'Baader', modelo: 'Malibú', anio: 2009, eslora: 5.3, manga: 2.1, motor_marca: 'Johnson', motor_hp: 90, motor_horas: 900, combustible_litros: 90, precio_pedido: 14000, equipamiento: '["toldo"]', estado_general: 'bueno', tiene_trailer: 1, ingresada_en: dias(310) });
const motoYam = barco({ tipo: 'moto de agua', marca: 'Yamaha', modelo: 'FX Cruiser', anio: 2021, eslora: 3.58, manga: 1.27, motor_marca: 'Yamaha', motor_hp: 180, motor_horas: 90, combustible_litros: 70, precio_pedido: 17500, url_publicacion: 'https://leandroramosbrokernautico.com/property/yamaha-fx-cruiser-2021/', fotos: '["https://leandroramosbrokernautico.com/wp-content/uploads/2025/03/YamahaFXCruiser_2021_ML-340x340.png"]', equipamiento: '["cover","trailer"]', estado_general: 'excelente', tiene_trailer: 1, ingresada_en: dias(40) });
const colec = barco({ tipo: 'de coleccion', marca: 'Astillero San Isidro', modelo: '70', anio: 1984, eslora: 7.0, manga: 2.6, motor_marca: 'Perkins', motor_hp: 90, motor_tipo: 'intraborda', motor_horas: 1500, combustible_litros: 200, precio_pedido: 45000, url_publicacion: 'https://leandroramosbrokernautico.com/property/san-isidro-70-1984/', fotos: '["https://leandroramosbrokernautico.com/wp-content/uploads/2026/02/SanIsidro70_1984_ML-340x340.png"]', equipamiento: '["clásico de madera","restaurado"]', estado_general: 'excelente', ingresada_en: dias(400) });
const canes195 = barco({ tipo: 'lancha open', marca: 'Klase A', modelo: '210', anio: 2022, eslora: 6.4, manga: 2.44, motor_marca: 'Mercury', motor_hp: 150, motor_horas: 220, combustible_litros: 110, precio_pedido: 28500, url_publicacion: 'https://leandroramosbrokernautico.com/property/klase-a-210-2022-2/', fotos: '["https://leandroramosbrokernautico.com/wp-content/uploads/2026/04/KlaseA210_2022_ML-340x340.png"]', equipamiento: '["ecosonda","toldo","estéreo","escalera inox"]', estado_general: 'muy bueno', tiene_trailer: 1, ingresada_en: dias(33) });
const qs1700b = barco({ tipo: 'lancha open', marca: 'Quicksilver', modelo: '1700', anio: 2014, eslora: 5.2, manga: 2.13, motor_marca: 'Mercury', motor_hp: 90, motor_horas: 620, combustible_litros: 90, precio_pedido: 18500, equipamiento: '["toldo","estéreo"]', estado_general: 'bueno', tiene_trailer: 1, situacion: 'vendida', precio_venta_real: 17800, ingresada_en: dias(500) });
inv.push(qs2000, klaseA, eclipse19, canestrari245, quest210, bayliner185, piccini, bermuda180, geunaF44, kiel190, tracker16, regnicoli, eclipse21, qs1800w, virgin20, baader, motoYam, colec, canes195);

// Barcos históricos de las trayectorias (compró → vendió → compró más grande)
const trackerMartin = barco({ tipo: 'semirrigido/tracker', marca: 'Kiel', modelo: '160', anio: 2010, eslora: 4.8, motor_marca: 'Mercury', motor_hp: 60, motor_horas: 700, situacion: 'vendida', precio_pedido: 9500, precio_venta_real: 9000, exclusividad: null, tiene_trailer: 1, ingresada_en: dias(3300) });
const openSilvia = barco({ tipo: 'lancha open', marca: 'Piccini', modelo: '450 Open', anio: 2011, eslora: 4.5, motor_marca: 'Yamaha', motor_hp: 60, motor_horas: 520, situacion: 'vendida', precio_pedido: 9000, precio_venta_real: 8500, exclusividad: null, tiene_trailer: 1, ingresada_en: dias(2900) });
const bayHernan = barco({ tipo: 'lancha open', marca: 'Bayliner', modelo: '175', anio: 2009, eslora: 5.3, motor_marca: 'Mercruiser', motor_hp: 135, motor_tipo: 'dentro-fuera', motor_horas: 950, situacion: 'vendida', precio_pedido: 11000, precio_venta_real: 10500, exclusividad: null, ingresada_en: dias(2300) });
const motoSeba = barco({ tipo: 'moto de agua', marca: 'Sea-Doo', modelo: 'GTI 90', anio: 2015, eslora: 3.2, motor_marca: 'Rotax', motor_hp: 90, motor_horas: 300, situacion: 'vendida', precio_pedido: 7000, precio_venta_real: 6500, exclusividad: null, tiene_trailer: 1, ingresada_en: dias(2700) });

// Barcos de ex-clientes (situacion: no está a la venta) — habilitan el Caso 3
const qs1700martin = barco({ tipo: 'lancha open', marca: 'Quicksilver', modelo: '1700', anio: 2013, eslora: 5.2, manga: 2.13, motor_marca: 'Mercury', motor_hp: 90, motor_horas: 710, precio_pedido: null, precio_minimo_aceptado: null, situacion: 'no está a la venta', propietario_id: martin.id, exclusividad: null, papeles_estado: 'al día', ingresada_en: dias(1750), precio_venta_real: 16500 });
const quest210hernan = barco({ tipo: 'lancha cuddy', marca: 'Quest', modelo: '210', anio: 2011, eslora: 6.4, manga: 2.44, motor_marca: 'Mercruiser', motor_hp: 220, motor_tipo: 'dentro-fuera', motor_horas: 880, situacion: 'no está a la venta', propietario_id: hernan.id, precio_pedido: null, precio_minimo_aceptado: null, exclusividad: null, tiene_bano: 1, ingresada_en: dias(2050), precio_venta_real: 28000 });
const eclipse16seba = barco({ tipo: 'lancha open', marca: 'Arco Iris', modelo: 'Eclipse 16', anio: 2015, eslora: 4.9, manga: 2.0, motor_marca: 'Yamaha', motor_hp: 70, motor_horas: 640, situacion: 'no está a la venta', propietario_id: seba.id, precio_pedido: null, precio_minimo_aceptado: null, exclusividad: null, ingresada_en: dias(2450), precio_venta_real: 12800 });
const bayJorge = barco({ tipo: 'lancha open', marca: 'Bayliner', modelo: '175', anio: 2008, eslora: 5.3, manga: 2.1, motor_marca: 'Mercruiser', motor_hp: 135, motor_tipo: 'dentro-fuera', motor_horas: 800, situacion: 'vendida', propietario_id: jorge.id, precio_pedido: 15000, precio_venta_real: 14200, ingresada_en: dias(1450) });

/* ============================== OPERACIONES ============================== */
// Martín compró su Quicksilver 1700 en 2021 (base temporal de la escalera: año 4-5 ahora)
// Trayectoria de Martín: tracker 2017 → lo vendió 2021 → compró la Quicksilver 1700 (upgrade vinculado)
insO.run(uid(), trackerMartin.id, martin.id, rodolfo.id, 9500, 'cerrada', dias(3300), dias(3250), null);
const opVentaTrackerMartin = uid();
insO.run(opVentaTrackerMartin, trackerMartin.id, mati.id, martin.id, 9000, 'cerrada', dias(1800), dias(1760), null);
insO.run(uid(), qs1700martin.id, martin.id, jorge.id, 16500, 'cerrada', dias(1790), dias(1745), opVentaTrackerMartin);
// Trayectoria de Hernán: compró la Bayliner 2014 → la vendió 2020 → compró la Quest (upgrade vinculado)
insO.run(uid(), bayHernan.id, hernan.id, marta.id, 12000, 'cerrada', dias(4400), dias(4350), null);
const opVentaBayHernan = uid();
insO.run(opVentaBayHernan, bayHernan.id, federico.id, hernan.id, 10500, 'cerrada', dias(2120), dias(2060), null);
insO.run(uid(), quest210hernan.id, hernan.id, rodolfo.id, 28000, 'cerrada', dias(2100), dias(2040), opVentaBayHernan);
// Trayectoria de Sebastián: moto de agua 2016 → la vendió 2019 → compró la Eclipse 16 (upgrade vinculado)
insO.run(uid(), motoSeba.id, seba.id, rodolfo.id, 8000, 'cerrada', dias(3700), dias(3650), null);
const opVentaMotoSeba = uid();
insO.run(opVentaMotoSeba, motoSeba.id, claudio.id, seba.id, 6500, 'cerrada', dias(2500), dias(2450), null);
insO.run(uid(), eclipse16seba.id, seba.id, marta.id, 12800, 'cerrada', dias(2520), dias(2440), opVentaMotoSeba);
// Jorge vendió su Bayliner en 2022
insO.run(uid(), bayJorge.id, claudio.id, jorge.id, 14200, 'cerrada', dias(1480), dias(1400), null);
// Silvia compró la Bermuda en 2023 y AHORA la vende (doble rol, criterio §9)
// Trayectoria de Silvia: open chica 2018 → la vendió 2023 → compró la Bermuda Cuddy (upgrade vinculado)
insO.run(uid(), openSilvia.id, silvia.id, rodolfo.id, 9000, 'cerrada', dias(2900), dias(2860), null);
const opVentaOpenSilvia = uid();
insO.run(opVentaOpenSilvia, openSilvia.id, ines.id, silvia.id, 8500, 'cerrada', dias(1130), dias(1090), null);
insO.run(uid(), bermuda180.id, silvia.id, marta.id, 22000, 'cerrada', dias(1120), dias(1080), opVentaOpenSilvia);
// Operaciones en curso
insO.run(uid(), klaseA.id, tomas.id, alberto.id, null, 'visita agendada', dias(4), null, null);
insO.run(uid(), eclipse21.id, marina.id, fabian.id, null, 'prueba de navegación', dias(12), null, null);
insO.run(uid(), quest210.id, marcelo.id, nestor.id, null, 'oferta', dias(30), null, null);
insO.run(uid(), qs1700b.id, gustavo.id, rodolfo.id, null, 'caída', dias(480), dias(465), null);
// La 1700 de Rodolfo finalmente se la llevó Sergio (por eso Carla llegó tarde — Caso 1)
insO.run(uid(), qs1700b.id, sergio.id, rodolfo.id, 17800, 'cerrada', dias(475), dias(455), null);

// ——— Seguros de las embarcaciones ———
// Renovaciones próximas = oportunidad de servicio; una baja = señal de que vendió (§4.2).
const asegurar = db.prepare(`UPDATE embarcacion SET aseguradora=?, poliza_numero=?, poliza_vence=?, poliza_prima_anual=?, poliza_estado=? WHERE id=?`);
asegurar.run('Allianz',   'ALZ-4471902', enDias(21, 12),  980, 'vigente', klaseA.id);
asegurar.run('Sancor',    'SNC-118443',  enDias(9, 12),   540, 'vigente', eclipse19.id);
asegurar.run('La Caja',   'LCJ-772310',  enDias(64, 12),  760, 'vigente', canestrari245.id);
asegurar.run('Allianz',   'ALZ-4409155', enDias(-12, 12), 610, 'vencida', quest210.id);
asegurar.run('Federación Patronal', 'FDP-205518', enDias(133, 12), 430, 'vigente', bayliner185.id);
asegurar.run('Sancor',    'SNC-120877',  enDias(48, 12),  520, 'vigente', bermuda180.id);
asegurar.run('La Caja',   'LCJ-780044',  enDias(88, 12),  890, 'vigente', geunaF44.id);
asegurar.run('Allianz',   'ALZ-4502330', enDias(150, 12), 470, 'vigente', kiel190.id);
asegurar.run('Sancor',    'SNC-119006',  enDias(-40, 12), 850, 'vencida', regnicoli.id);
asegurar.run('La Caja',   'LCJ-771988',  enDias(27, 12),  690, 'vigente', eclipse21.id);
asegurar.run('Federación Patronal', 'FDP-210043', enDias(96, 12), 390, 'vigente', qs1800w.id);
asegurar.run('Allianz',   'ALZ-4488210', enDias(5, 12),   410, 'vigente', motoYam.id);
asegurar.run('La Caja',   'LCJ-769901',  enDias(72, 12),  560, 'vigente', canes195.id);
asegurar.run('Sancor',    'SNC-121455',  enDias(119, 12), 600, 'vigente', virgin20.id);
asegurar.run('Allianz',   'ALZ-4390077', enDias(35, 12),  520, 'vigente', qs2000.id);
// Barcos de ex-clientes: acá el seguro es la señal más valiosa de la escalera
asegurar.run('Allianz',   'ALZ-4102338', enDias(16, 12),  380, 'vigente', qs1700martin.id);
asegurar.run('Sancor',    'SNC-098771',  enDias(58, 12),  620, 'vigente', quest210hernan.id);
asegurar.run('La Caja',   'LCJ-733015',  dias(24),        340, 'dada de baja', eclipse16seba.id);
asegurar.run('Federación Patronal', 'FDP-188220', enDias(102, 12), 300, 'vigente', bayJorge.id);
// Sin seguro registrado (alerta): piccini, colec, tracker16, bermuda de Silvia ya cubierta arriba

// ——— Dónde está publicada cada embarcación ———
// Las que tienen ficha en el sitio se publicaron ahí (y varias también en Instagram).
// Las que NO figuran acá quedan "sin publicar": el CRM las marca como alerta.
const publicar = db.prepare(`UPDATE embarcacion SET publicado_en = ?, url_instagram = ?, url_portal = ? WHERE id = ?`);
const IG = 'https://www.instagram.com/leandroramosbrokernautico/';
publicar.run(dias(44), IG, null, qs2000.id);
publicar.run(dias(19), 'https://www.instagram.com/leandroramosbrokernautico/reel/DbRgeGhz04C/', null, klaseA.id);
publicar.run(dias(7), IG, null, eclipse19.id);
publicar.run(dias(128), null, 'https://listado.mercadolibre.com.ar/canestrari-245', canestrari245.id);
publicar.run(dias(74), IG, null, quest210.id);
publicar.run(dias(158), null, null, bayliner185.id);
publicar.run(dias(17), IG, null, bermuda180.id);
publicar.run(dias(118), null, 'https://listado.mercadolibre.com.ar/segue-32', geunaF44.id);
publicar.run(dias(54), null, null, kiel190.id);
publicar.run(dias(238), null, null, regnicoli.id);
publicar.run(dias(9), IG, null, eclipse21.id);
publicar.run(dias(64), null, null, qs1800w.id);
publicar.run(dias(39), IG, null, motoYam.id);
publicar.run(dias(398), null, null, colec.id);
publicar.run(dias(32), IG, null, canes195.id);
publicar.run(dias(94), null, null, virgin20.id);
publicar.run(dias(27), null, null, piccini.id);
// Sin publicar en ningún lado (alerta del CRM): tracker16 (Benavidez recién ingresado)

// Al cerrarse una venta el barco pasa al comprador (así el ex-cliente tiene barco propio → Caso 3)
const traspaso = db.prepare(`UPDATE embarcacion SET propietario_id = ?, situacion = 'no está a la venta' WHERE id = ?`);
traspaso.run(mati.id, trackerMartin.id);       // el tracker de Martín lo compró Matías
traspaso.run(ines.id, openSilvia.id);          // la open de Silvia la compró Inés
traspaso.run(federico.id, bayHernan.id);       // la Bayliner de Hernán la compró Federico
traspaso.run(claudio.id, bayJorge.id);         // la Bayliner de Jorge la compró Claudio
traspaso.run(claudio.id, motoSeba.id);         // la moto de Sebastián la compró Claudio
traspaso.run(sergio.id, qs1700b.id);           // la Quicksilver 1700 la compró Sergio

/* ============================== BÚSQUEDAS ============================== */
// CASO 1 — Carla buscó una Quicksilver 1700 hace 4 meses y no había
const bCarla = busqueda({ persona_id: carla.id, modelo_referencia: 'Quicksilver 1700', marcas_preferidas: '["Quicksilver"]', tipo_embarcacion: '["lancha open"]', eslora_min: 4.8, eslora_max: 5.8, presupuesto_min: 15000, presupuesto_max: 25000, hp_min: 80, motor_tipo: 'fuera de borda', uso_declarado: '["paseo familiar"]', necesita_trailer: 1, urgencia: 'en los próximos meses', creada_en: dias(130), texto_original: 'Hola! Vi la Quicksilver 1700 que tenían publicada, sigue disponible? Buscamos algo así, hasta 25 mil dólares, con trailer si se puede.' });
const bGustavo = busqueda({ persona_id: gustavo.id, tipo_embarcacion: '["lancha open","semirrigido/tracker"]', eslora_min: 5.0, eslora_max: 6.2, presupuesto_min: 15000, presupuesto_max: 26000, hp_min: 90, uso_declarado: '["pesca"]', urgencia: 'en los próximos meses', creada_en: dias(90), limitacion_declarada: 'El tracker que tenía le quedaba chico para el río abierto' });
busqueda({ persona_id: flor.id, tipo_embarcacion: '["lancha open"]', eslora_min: 5.0, eslora_max: 6.0, presupuesto_min: 18000, presupuesto_max: 28000, uso_declarado: '["paseo familiar"]', urgencia: 'ya', creada_en: dias(40) });
busqueda({ persona_id: diego.id, tipo_embarcacion: '["lancha open"]', eslora_min: 5.2, eslora_max: 6.5, presupuesto_min: 20000, presupuesto_max: 35000, hp_min: 115, uso_declarado: '["wakeboard/deportes","paseo familiar"]', urgencia: 'ya', creada_en: dias(25), limitacion_declarada: 'Necesita torre o al menos potencia para wake' });
const bMarcelo = busqueda({ persona_id: marcelo.id, tipo_embarcacion: '["crucero","lancha cuddy"]', eslora_min: 6.0, eslora_max: 8.0, presupuesto_min: 30000, presupuesto_max: 55000, necesita_bano: 1, uso_declarado: '["dormir a bordo","paseo familiar"]', urgencia: 'en los próximos meses', creada_en: dias(85) });
const bAndrea = busqueda({ persona_id: andrea.id, tipo_embarcacion: '["lancha open"]', eslora_min: 4.8, eslora_max: 5.6, presupuesto_min: 12000, presupuesto_max: 22000, uso_declarado: '["paseo familiar"]', necesita_trailer: 0, urgencia: 'mirando sin apuro', creada_en: dias(70) });
busqueda({ persona_id: pablo.id, tipo_embarcacion: '["semirrigido/tracker"]', eslora_min: 5.0, eslora_max: 6.5, presupuesto_min: 15000, presupuesto_max: 25000, hp_min: 90, uso_declarado: '["paseo familiar","navegación río abierto"]', urgencia: 'ya', creada_en: dias(150) });
const bRomina = busqueda({ persona_id: romina.id, tipo_embarcacion: '["lancha cuddy"]', eslora_min: 5.2, eslora_max: 6.5, presupuesto_min: 20000, presupuesto_max: 30000, necesita_bano: 1, uso_declarado: '["dormir a bordo"]', urgencia: 'en los próximos meses', creada_en: dias(48) });
busqueda({ persona_id: lucia.id, tipo_embarcacion: '["lancha open"]', eslora_min: 4.5, eslora_max: 5.5, presupuesto_min: 10000, presupuesto_max: 16000, uso_declarado: '["paseo familiar"]', necesita_trailer: 1, urgencia: 'ya', creada_en: dias(18) });
busqueda({ persona_id: mati.id, tipo_embarcacion: '["semirrigido/tracker"]', eslora_min: 4.5, eslora_max: 5.5, presupuesto_min: 10000, presupuesto_max: 16000, uso_declarado: '["pesca"]', necesita_trailer: 1, urgencia: 'en los próximos meses', creada_en: dias(100) });
busqueda({ persona_id: marina.id, tipo_embarcacion: '["lancha open"]', eslora_min: 5.5, eslora_max: 6.8, presupuesto_min: 25000, presupuesto_max: 38000, hp_min: 150, uso_declarado: '["wakeboard/deportes"]', urgencia: 'ya', creada_en: dias(33), limitacion_declarada: 'Necesita torre de wakeboard sí o sí, es para trabajar' });
const bTomas = busqueda({ persona_id: tomas.id, tipo_embarcacion: '["crucero"]', eslora_min: 7.0, eslora_max: 9.0, presupuesto_min: 45000, presupuesto_max: 65000, necesita_bano: 1, uso_declarado: '["dormir a bordo","navegación río abierto"]', urgencia: 'ya', creada_en: dias(14) });
busqueda({ persona_id: ines.id, tipo_embarcacion: '["lancha open"]', eslora_min: 4.5, eslora_max: 5.3, presupuesto_min: 10000, presupuesto_max: 15000, uso_declarado: '["paseo familiar"]', urgencia: 'mirando sin apuro', creada_en: dias(22) });
busqueda({ persona_id: nico.id, tipo_embarcacion: '["lancha cuddy"]', eslora_min: 6.5, eslora_max: 7.5, presupuesto_min: 45000, presupuesto_max: 60000, necesita_bano: 1, uso_declarado: '["dormir a bordo","paseo familiar"]', urgencia: 'ya', creada_en: dias(0.04), texto_original: 'Buenas! Vi la Klase A 2400 publicada. Está impecable? Busco algo así con baño para hacer noche en el Delta con mi mujer. Hasta 60 lucas verdes llego.' });
// Búsquedas históricas CERRADAS (el activo del negocio, §3.2)
busqueda({ persona_id: martin.id, tipo_embarcacion: '["lancha open"]', eslora_min: 4.8, eslora_max: 5.5, presupuesto_min: 12000, presupuesto_max: 18000, uso_declarado: '["paseo familiar"]', urgencia: 'ya', estado: 'satisfecha', motivo_cierre: 'Compró la Quicksilver 1700 (operación cerrada 2021)', creada_en: dias(1800), actualizada_en: dias(1745) });
// CASO 3 — la búsqueda NUEVA de Martín, deducida de señales: quiere cuddy/crucero con baño
busqueda({ persona_id: martin.id, tipo_embarcacion: '["lancha cuddy","crucero"]', eslora_min: 6.0, eslora_max: 7.8, presupuesto_min: 30000, presupuesto_max: 60000, necesita_bano: 1, uso_declarado: '["paseo familiar","dormir a bordo"]', urgencia: 'en los próximos meses', entrega_algo: 1, embarcacion_entrega_id: qs1700martin.id, limitacion_declarada: 'Con dos chicos ya no les alcanza la open: quieren baño y hacer noche', creada_en: dias(2), texto_original: '(deducida por el sistema a partir de señales — pendiente de confirmar con Martín)' });
busqueda({ persona_id: hernan.id, tipo_embarcacion: '["lancha cuddy"]', eslora_min: 6.0, eslora_max: 6.8, presupuesto_min: 22000, presupuesto_max: 30000, necesita_bano: 1, uso_declarado: '["pesca"]', urgencia: 'ya', estado: 'satisfecha', motivo_cierre: 'Compró la Quest 210 (2020)', creada_en: dias(2110), actualizada_en: dias(2040) });
busqueda({ persona_id: silvia.id, tipo_embarcacion: '["lancha cuddy"]', eslora_min: 5.2, eslora_max: 6.0, presupuesto_min: 18000, presupuesto_max: 24000, necesita_bano: 1, uso_declarado: '["paseo familiar"]', urgencia: 'ya', estado: 'satisfecha', motivo_cierre: 'Compró la Canestrari 215 (2023)', creada_en: dias(1130), actualizada_en: dias(1080) });
busqueda({ persona_id: seba.id, tipo_embarcacion: '["lancha open"]', presupuesto_min: 10000, presupuesto_max: 14000, uso_declarado: '["paseo familiar"]', urgencia: 'ya', estado: 'satisfecha', motivo_cierre: 'Compró la Eclipse 16 (2019)', creada_en: dias(2530), actualizada_en: dias(2440) });
busqueda({ persona_id: federico.id, tipo_embarcacion: '["lancha open"]', eslora_min: 5.5, eslora_max: 6.5, presupuesto_min: 22000, presupuesto_max: 32000, uso_declarado: '["paseo familiar"]', urgencia: 'mirando sin apuro', estado: 'perdida', motivo_cierre: 'Dejó de responder — probablemente compró por MercadoLibre', creada_en: dias(215), actualizada_en: dias(100) });
busqueda({ persona_id: graciela.id, tipo_embarcacion: '["lancha open"]', presupuesto_min: 15000, presupuesto_max: 20000, uso_declarado: '["paseo familiar"]', urgencia: 'mirando sin apuro', estado: 'pausada', motivo_cierre: 'Retoma en primavera (dijo en marzo)', creada_en: dias(235), actualizada_en: dias(190) });
busqueda({ persona_id: ceci.id, tipo_embarcacion: '["lancha open"]', presupuesto_min: 12000, presupuesto_max: 20000, uso_declarado: '["paseo familiar"]', urgencia: 'mirando sin apuro', estado: 'pausada', motivo_cierre: 'Sin apuro real, revisar en 6 meses', creada_en: dias(175), actualizada_en: dias(120) });

/* ============================== CONVERSACIONES Y MENSAJES ============================== */
function conv(personaId, canal, estado, embId, msgs) {
  const cid = uid();
  const ult = msgs.length ? msgs[msgs.length - 1][2] : now();
  insC.run(cid, personaId, canal, estado, embId, ult);
  for (const [dir, txt, ts, autor, resp] of msgs) insM.run(uid(), cid, dir, txt, ts, autor, resp || null);
  return cid;
}

// Verónica: Instagram en un momento, WhatsApp después — misma línea de tiempo (criterio §9)
conv(vero.id, 'instagram', 'cerrada', eclipse19.id, [
  ['entrante', 'Hola! Vi la Eclipse 19 en la publicación. ¿Sigue disponible? ¿El precio es negociable?', dias(150), 'cliente', dias(150)],
  ['saliente', '¡Hola Verónica! Sí, disponible. El precio pedido es USD 27.500, con margen chico de conversación viéndola. ¿Querés coordinar para verla en San Fernando?', dias(150), 'agente-ia', null],
  ['entrante', 'Puede ser en dos semanas, ando de viaje. Te escribo a la vuelta!', dias(149), 'cliente', dias(149)],
]);
conv(vero.id, 'whatsapp', 'esperando respuesta nuestra', eclipse19.id, [
  ['entrante', 'Hola Leandro! Soy Verónica, te había escrito por Instagram por la Eclipse 19. Ya volví, ¿la puedo ir a ver este finde?', dias(0.08), 'cliente', null],
  ['saliente', '¡Hola Verónica, bienvenida de vuelta! 🙌 La Eclipse 19 sigue disponible: 2020, Yamaha 115 con 190 hs, impecable. El finde se puede ver en San Fernando — Leandro te confirma el horario en breve.', dias(0.079), 'agente-ia', null],
]);
// Nico: consulta de HOY — el bot ya respondió, falta el toque de Leandro (semáforo)
conv(nico.id, 'whatsapp', 'esperando respuesta nuestra', klaseA.id, [
  ['entrante', 'Buenas! Vi la Klase A 2400 publicada. ¿Está impecable como dice? Busco algo así con baño para hacer noche en el Delta con mi mujer. Hasta 60 lucas verdes llego.', dias(0.05), 'cliente', null],
  ['saliente', '¡Hola Nicolás! Sí, la 2400 está impecable: 2019, Mercruiser 250 con 380 hs, baño y cocina, ideal para hacer noche. Está en USD 58.000, dentro de lo que manejás. ¿Te paso fotos y coordinamos una visita? Leandro te escribe para el detalle fino.', dias(0.049), 'agente-ia', null],
]);
// Andrea: consulta reciente respondida
conv(andrea.id, 'whatsapp', 'esperando respuesta de él', null, [
  ['entrante', 'Hola! Me pasó tu contacto Martín Aguirre. Estoy buscando mi primera lancha, algo simple para pasear con mis hijos.', dias(75), 'cliente', dias(75)],
  ['saliente', '¡Hola Andrea! Bienvenida. Contame un poco más: ¿cuántos son, dónde la guardarías y qué presupuesto manejás? Así te armo opciones.', dias(75), 'leandro', null],
  ['entrante', 'Somos 4. Presupuesto hasta 22 mil dólares. Guardería, no tengo amarra.', dias(74), 'cliente', dias(74)],
  ['saliente', 'Perfecto. Tengo un par de opciones open con trailer que te sirven. Te paso fichas mañana.', dias(1), 'leandro', null],
]);
// Carla (Caso 1): consulta original de hace 4 meses
conv(carla.id, 'instagram', 'cerrada', null, [
  ['entrante', 'Hola! Vi la Quicksilver 1700 que tenían publicada, ¿sigue disponible? Buscamos algo así, hasta 25 mil dólares, con trailer si se puede.', dias(130), 'cliente', dias(130)],
  ['saliente', 'Hola Carla! Esa se vendió la semana pasada, pero apenas entre algo parecido te aviso. ¿Te sirve que te agende la búsqueda?', dias(130), 'leandro', null],
  ['entrante', 'Sí, dale! Gracias!', dias(129), 'cliente', dias(129)],
]);
// Flor: DM sin teléfono
conv(flor.id, 'instagram', 'esperando respuesta de él', null, [
  ['entrante', 'Holaa, ¿tienen lanchas para 6 personas? Algo para pasear con la familia, entre 18 y 28 mil dólares.', dias(40), 'cliente', dias(40)],
  ['saliente', '¡Hola Flor! Sí, tengo varias. ¿Me pasás tu número así te mando fotos y fichas por WhatsApp?', dias(40), 'agente-ia', null],
]);
// Tomás: caliente, visita agendada
conv(tomas.id, 'whatsapp', 'esperando respuesta nuestra', klaseA.id, [
  ['entrante', 'Leandro, confirmame la visita del jueves por la 2400. Llevo al mecánico de confianza si no hay problema.', dias(1), 'cliente', null],
  ['saliente', '¡Hola Tomás! Anotado: visita el jueves por la 2400, con tu mecánico, ningún problema. Leandro te confirma la hora y el acceso a la guardería enseguida.', dias(0.999), 'agente-ia', null],
]);
// Martín (Caso 3): la conversación que disparó las señales
conv(martin.id, 'whatsapp', 'esperando respuesta nuestra', null, [
  ['entrante', 'Leandro, ¿cómo andás? Che, una consulta: ¿cuánto estará saliendo hoy una 1700 como la mía? Por curiosidad nomás.', dias(2), 'cliente', null],
  ['saliente', '¡Hola Martín! Qué bueno leerte. Le paso tu consulta a Leandro así te arma la valuación de tu 1700 con datos reales del mercado. Te escribe él en el día.', dias(1.999), 'agente-ia', null],
]);
// Marcelo: negociación en curso
conv(marcelo.id, 'whatsapp', 'esperando respuesta de él', quest210.id, [
  ['entrante', '¿32 mil la Quest? La vi bien pero el motor tiene sus horas.', dias(3), 'cliente', dias(3)],
  ['saliente', 'Marcelo, el pedido es 33. Con 32 el dueño no baja, pero llevale una oferta seria en mano y lo charlamos. El motor tiene service completo al día.', dias(2.5), 'leandro', null],
]);
// Marina: prueba de navegación
conv(marina.id, 'instagram', 'esperando respuesta de él', eclipse21.id, [
  ['entrante', 'La MasterCraft X214 con torre me interesa mucho para las clases. ¿Cuándo puedo probarla?', dias(12), 'cliente', dias(12)],
  ['saliente', 'Coordinamos para el sábado a las 10 en Náutica del Delta. ¡Traé antiparras!', dias(11), 'leandro', null],
]);
// Pablo: el bot respondió hace 3 días y Leandro nunca hizo el seguimiento (alerta roja)
conv(pablo.id, 'whatsapp', 'esperando respuesta nuestra', kiel190.id, [
  ['entrante', '¿El Kiel 190 tiene los papeles al día? ¿Se puede ver el finde?', dias(3), 'cliente', null],
  ['saliente', '¡Hola Pablo! Sí, el Kiel 190 tiene los papeles al día. El finde se puede ver en San Fernando: ¿sábado o domingo te queda mejor? Leandro te confirma el horario.', dias(2.999), 'agente-ia', null],
]);

/* ============================== SEÑALES (Caso 3) ============================== */
// Martín — el caso armado de escalera náutica
insS.run(uid(), martin.id, 'taso_su_barco', 10, 'Usó el tasador web con los datos exactos de su Quicksilver 1700 (2013, 710 hs)', qs1700martin.id, dias(2));
insS.run(uid(), martin.id, 'miro_embarcacion', 6, 'Visitó 3 veces la ficha de la Klase A 2400 y 2 veces la Canestrari 245', klaseA.id, dias(5));
insS.run(uid(), martin.id, 'menciono_limitacion', 7, '"Con los chicos ya no nos alcanza, mi señora quiere baño sí o sí" (conversación de marzo)', null, dias(160));
insS.run(uid(), martin.id, 'aniversario_compra', 3, 'Se cumplen 5 años de la compra de la Quicksilver 1700', null, dias(35));
// Sebastián — señales más débiles, segundo en el ranking
insS.run(uid(), seba.id, 'interactuo_en_redes', 2, 'Le dio like a las últimas 4 publicaciones de cuddys en Instagram', null, dias(20));
insS.run(uid(), seba.id, 'dio_de_baja_seguro', 8, 'Dio de baja el seguro de la Eclipse 16 en La Caja — el barco ya no está asegurado', eclipse16seba.id, dias(24));
insS.run(uid(), seba.id, 'menciono_limitacion', 7, '"Somos 5, vamos apretados" (última conversación)', null, dias(80));
insS.run(uid(), seba.id, 'aniversario_compra', 3, '6 años de la compra de la Eclipse 16', null, dias(60));
// Hernán — todavía tranquilo
insS.run(uid(), hernan.id, 'abrio_informe_anual', 2, 'Abrió el informe anual de valor de su Quest 210 (no respondió)', quest210hernan.id, dias(90));
// Señales de compradores activos
insS.run(uid(), tomas.id, 'visito_web', 2, 'Visitó la web 6 veces esta semana', null, dias(1));
insS.run(uid(), diego.id, 'miro_embarcacion', 4, 'Miró la MasterCraft X214 con torre cuatro veces', eclipse21.id, dias(3));

/* ============================== TASACIONES ============================== */
// CASO 2 — Raúl usó el tasador público HOY
insT.run(uid(), raul.id, JSON.stringify({ tipo: 'lancha open', marca: 'Canestrari', modelo: '195', anio: 2016, eslora: 5.8, motor_marca: 'Mercury', motor_hp: 115, motor_horas: 520, estado_general: 'muy bueno' }), 21500, 24500,
  'Base: Canestrari 185 Open 2017 en inventario a USD 24.000 y venta real de Quicksilver 1700 2014 a USD 17.800. Ajuste por año, horas de motor (520 hs, dentro de lo esperable) y estado declarado.', 1, 'web pública', dias(0.02));
// La tasación de Martín (la señal fuerte del Caso 3)
insT.run(uid(), martin.id, JSON.stringify({ tipo: 'lancha open', marca: 'Quicksilver', modelo: '1700', anio: 2013, eslora: 5.2, motor_marca: 'Mercury', motor_hp: 90, motor_horas: 710, estado_general: 'muy bueno' }), 15500, 17500,
  'Base: venta real de Quicksilver 1700 2014 a USD 17.800 (2024). Ajuste por horas de motor y año.', 0, 'web pública', dias(2));
// Tasaciones históricas del tasador
insT.run(uid(), oscar.id, JSON.stringify({ tipo: 'crucero', marca: 'Regnicoli', modelo: 'Marfil 26', anio: 2009, eslora: 8.0, motor_hp: 200, motor_horas: 1100 }), 42000, 48000, 'Base: Regnicoli Marfil 28 2011 en inventario a USD 55.000, ajuste por año y eslora.', 1, 'web pública', dias(12));
insT.run(uid(), walter.id, JSON.stringify({ tipo: 'semirrigido/tracker', marca: 'Kiel', modelo: '160', anio: 2015, motor_hp: 90, motor_horas: 600 }), 14500, 16500, 'Base: Kiel 190 2017 en inventario a USD 21.000, ajuste por eslora y horas.', 1, 'web pública', dias(68));

/* ============================== CITAS ============================== */
insCita.run(uid(), tomas.id, klaseA.id, 'mostrar embarcación', enDias(2, 15), 'Trae mecánico de confianza. Confirmar con Alberto el acceso.');
insCita.run(uid(), marina.id, eclipse21.id, 'prueba de navegación', enDias(4, 10), 'Sábado 10:00, Náutica del Delta.');
insCita.run(uid(), marcelo.id, quest210.id, 'mostrar embarcación', enDias(6, 16), 'Segunda visita — viene con la señora.');
insCita.run(uid(), raul.id, null, 'visita de tasación', enDias(1, 9), 'Canestrari 195 2016 — verla en la guardería de Escobar y confirmar la valuación web.');
insCita.run(uid(), silvia.id, bermuda180.id, 'firma de transferencia', enDias(3, 11), 'Escribanía Robles, San Fernando, 11:00. Llevar formulario 02.');

/* ============================== PROPUESTAS YA OFRECIDAS ============================== */
// Historial del motor: estas ya se ofrecieron y salieron (estado aprobada).
const insProp = db.prepare(`INSERT INTO propuesta (id,embarcacion_id,busqueda_id,persona_id,puntaje,motivo,mensaje_borrador,via,estado,creada_en,resuelta_en) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
function ofrecida(busq, emb, puntaje, hace) {
  insProp.run(uid(), emb.id, busq.id, busq.persona_id, puntaje,
    'Ofrecida por el motor de coincidencias (histórico).',
    'Mensaje enviado — ver conversación en la ficha de la persona.',
    'whatsapp', 'aprobada', dias(hace + 0.2), dias(hace));
}
ofrecida(bCarla, bayliner185, 71, 20);
ofrecida(bCarla, qs1800w, 68, 20);
ofrecida(bGustavo, kiel190, 74, 15);
ofrecida(bAndrea, qs1800w, 63, 9);
ofrecida(bRomina, bermuda180, 78, 12);
ofrecida(bMarcelo, quest210, 80, 28);
ofrecida(bTomas, canestrari245, 76, 10);
ofrecida(bTomas, geunaF44, 70, 10);

/* ============================== RADAR DE MERCADO ============================== */
// Avisos de terceros en ML / Marketplace. Una baja de precio = vendedor frustrado = captación.
db.exec('DELETE FROM aviso_externo;');
const insA = db.prepare(`INSERT INTO aviso_externo (id,fuente,titulo,url,precio,precio_anterior,precio_inicial,bajas,publicado_en,detectado_en,ultima_baja_en,persona_id,contactado,notas,foto,contacto)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

// ——— Avisos REALES de MercadoLibre (relevados el 20/8/2026; historial de precio simulado para la demo) ———
insA.run(uid(), 'mercadolibre', 'Lancha Bermuda Sport 160 c/Yamaha 90 HP 4T | 2020 | 144 hs',
  'https://vehiculo.mercadolibre.com.ar/MLA-3020295488-lancha-bermuda-sport-160-cyamaha-90-hp-4t-2020-144-hs-_JM',
  18500, null, 18500, 0, dias(2), dias(0.3), null, null, 0, 'Como nueva, nylon original en tapizados. Eslora 4,69 m.',
  'https://http2.mlstatic.com/D_NQ_NP_810170-MLA112076390188_062026-O.webp', '11 5493 2210');
insA.run(uid(), 'mercadolibre', 'Barco Canestrari 275 Sport Cruiser 2017 — Mercury 4T',
  'https://vehiculo.mercadolibre.com.ar/MLA-1585518789-barco-canestrari-275-sport-cruiser-_JM',
  85000, null, 85000, 0, dias(1), dias(0.5), null, null, 0, null,
  'https://http2.mlstatic.com/D_NQ_NP_818948-MLA98195007334_112025-O.webp', '11 4720 8863');
insA.run(uid(), 'mercadolibre', 'Canestrari 195 Open 2017 — Evinrude ETEC 150 HP, 100 hs',
  'https://vehiculo.mercadolibre.com.ar/MLA-1987828803-canestrari-195-2017-evinr-etec-150hp-100hs-gatti-barcos-_JM',
  18000, 19500, 21000, 2, dias(75), dias(72), dias(3), null, 0, 'Excelente estado. Dos bajas en dos meses y medio.',
  'https://http2.mlstatic.com/D_NQ_NP_878209-MLA114763115676_082026-O.webp', '11 6870 4415');
insA.run(uid(), 'mercadolibre', 'Quicksilver 2700 Sport Cruiser 2016 — Mercruiser 6.2 300 HP',
  'https://vehiculo.mercadolibre.com.ar/MLA-3090733702-quicksilver-2700-2016-mercruiser-62-300hp-gatti-barcos-_JM',
  65000, 72000, 72000, 1, dias(50), dias(48), dias(5), null, 0, 'Calefacción marina a gasoil, carpa completa.',
  'https://http2.mlstatic.com/D_NQ_NP_945548-MLA83172874841_032025-O.webp', '11 5027 8834');

// ——— Avisos simulados que sostienen la historia de la demo ———
// Óscar Taboada: ya está en la base (publicó hace 8 meses, dos bajas — el caso perfecto de captación)
insA.run(uid(), 'mercadolibre', 'Crucero Regnicoli Marfil 26 2009 — motor Cummins',
  'https://listado.mercadolibre.com.ar/crucero-regnicoli', 43500, 46000, 52000, 2, dias(240), dias(238), dias(3), oscar.id, 0,
  'Coincide con la tasación web que hizo Óscar hace 12 días', null, '11 4302 5561');
insA.run(uid(), 'marketplace', 'Tracker de pesca 2016 con trailer y ecosonda',
  'https://www.facebook.com/marketplace/search?query=tracker%20pesca', 15800, 17500, 17500, 1, dias(60), dias(55), dias(7), null, 0, null, null, 'vía Marketplace (Messenger)');
insA.run(uid(), 'marketplace', 'Yamaha GP1800 2018 — service hecho, poco uso',
  'https://www.facebook.com/marketplace/search?query=yamaha%20gp1800', 11500, null, 11500, 0, dias(5), dias(4), null, null, 0, null, 'https://leandroramosbrokernautico.com/wp-content/uploads/2024/08/YamahaGP1800_2018_ML-340x340.png', 'vía Marketplace (Messenger)');

console.log('Seed OK:',
  db.prepare('SELECT COUNT(*) n FROM persona').get().n, 'personas ·',
  db.prepare('SELECT COUNT(*) n FROM embarcacion').get().n, 'embarcaciones ·',
  db.prepare('SELECT COUNT(*) n FROM busqueda').get().n, 'búsquedas ·',
  db.prepare('SELECT COUNT(*) n FROM mensaje').get().n, 'mensajes ·',
  db.prepare('SELECT COUNT(*) n FROM senal').get().n, 'señales');
