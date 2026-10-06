// Fotos que llegan por el canal de carga. Se guardan en disco y se sirven en /fotos/…
// En producción conviene un bucket (S3/R2): esta es la única pieza a cambiar, el resto usa la URL.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FOTOS_DIR = process.env.FOTOS_DIR || path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'crm.db')), 'fotos');
const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * @param {{buffer?:Buffer, dataUrl?:string, mime?:string}} foto
 * @param {string} carpeta  normalmente el id del borrador
 * @returns {{ruta, url, mime}}
 */
function guardarFoto(foto, carpeta) {
  let { buffer, mime } = foto;
  if (!buffer && foto.dataUrl) {
    const m = String(foto.dataUrl).match(/^data:([\w/+.-]+);base64,(.+)$/);
    if (!m) throw new Error('Foto con formato inválido');
    mime = m[1]; buffer = Buffer.from(m[2], 'base64');
  }
  if (!buffer || !buffer.length) throw new Error('Foto vacía');
  if (buffer.length > MAX_BYTES) throw new Error('Foto demasiado grande (máx. 8 MB)');
  const ext = EXT[(mime || '').toLowerCase()];
  if (!ext) throw new Error(`Tipo de imagen no soportado: ${mime}`);
  const seguro = String(carpeta).replace(/[^a-zA-Z0-9-]/g, '');
  const dir = path.join(FOTOS_DIR, seguro);
  fs.mkdirSync(dir, { recursive: true });
  const nombre = crypto.randomBytes(6).toString('hex') + '.' + ext;
  const ruta = path.join(dir, nombre);
  fs.writeFileSync(ruta, buffer);
  return { ruta, url: `/fotos/${seguro}/${nombre}`, mime: mime.toLowerCase() };
}

module.exports = { guardarFoto, FOTOS_DIR };
