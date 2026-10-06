// Personas: alta con deduplicación en el borde (§1.bis regla 5) y roles acumulativos (§3.1).
// La usan las rutas del CRM y la carga de unidades por WhatsApp (el dueño entra como vendedor).
const { db, uid, now, normalizarTelefono, auditar } = require('../db');

const j = (s, d = []) => { try { return JSON.parse(s) || d; } catch { return d; } };

/** Busca por teléfono normalizado, después por Instagram; si no existe, la crea. */
function upsertPersona({ nombre, telefono, email, instagram_handle, prometheo_id, origen, contexto_personal }) {
  const tel = normalizarTelefono(telefono);
  let p = null;
  if (tel) p = db.prepare('SELECT * FROM persona WHERE telefono = ?').get(tel);
  if (!p && instagram_handle) p = db.prepare('SELECT * FROM persona WHERE instagram_handle = ?').get(instagram_handle);
  if (p) {
    db.prepare(`UPDATE persona SET
      nombre = CASE WHEN nombre = '' OR nombre IS NULL OR nombre = 'Sin nombre' THEN COALESCE(?, nombre) ELSE nombre END,
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

/** Los roles se acumulan, nunca se pisan: quien compró y ahora vende tiene los dos. */
function agregarRol(personaId, rol) {
  const p = db.prepare('SELECT roles FROM persona WHERE id = ?').get(personaId);
  if (!p) return;
  const roles = j(p.roles);
  if (!roles.includes(rol)) { roles.push(rol); db.prepare('UPDATE persona SET roles = ? WHERE id = ?').run(JSON.stringify(roles), personaId); }
}

module.exports = { upsertPersona, agregarRol };
