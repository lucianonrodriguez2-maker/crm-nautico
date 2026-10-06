/* CRM Náutico — SPA buildless */
const vista = document.getElementById('vista');

const api = async (url, opts) => {
  const r = await fetch(url, opts ? { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined } : undefined);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => n == null ? '—' : 'USD ' + Number(n).toLocaleString('es-AR');
const fecha = (iso) => iso ? new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fechaHora = (iso) => iso ? new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const plural = (n, uno, muchos) => n === 1 ? '1 ' + uno : n + ' ' + muchos;
const haceCuanto = (iso) => {
  if (!iso) return '—';
  const d = (Date.now() - new Date(iso).getTime()) / 864e5;
  if (d < 0) return 'en ' + plural(Math.round(-d), 'día', 'días');
  if (d < 0.08) return 'hace minutos';
  if (d < 1) return 'hace ' + plural(Math.round(d * 24), 'hora', 'hs');
  if (d < 30) return 'hace ' + plural(Math.round(d), 'día', 'días');
  if (d < 365) return 'hace ' + plural(Math.round(d / 30), 'mes', 'meses');
  return 'hace ' + (d / 365).toFixed(1) + ' años';
};
let toastTimer;
const toast = (msg) => {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('visible'), 4200);
};

const ESTADO_CHIP = { activa: 'verde', pausada: 'amarillo', satisfecha: '', perdida: 'rojo', abierta: 'verde' };
const chipEstado = (e) => `<span class="chip ${ESTADO_CHIP[e] ?? 'gris'}">${esc(e)}</span>`;
const chips = (arr, cls = '') => (arr || []).map(x => `<span class="chip ${cls}">${esc(x)}</span>`).join('');

/* ==================== ROUTER ==================== */
const rutas = {};
function navegar() {
  const hash = location.hash.slice(2) || 'busquedas';
  const [nombre, id] = hash.split('/');
  document.querySelectorAll('.nav-item[data-ruta]').forEach(n => n.classList.toggle('activo', n.dataset.ruta === nombre));
  (rutas[nombre] || rutas.busquedas)(id);
}
window.addEventListener('hashchange', navegar);
document.querySelectorAll('.nav-item[data-ruta]').forEach(n => n.onclick = () => location.hash = '#/' + n.dataset.ruta);

/* ==================== HOY · AGENDA (unificadas) ==================== */
rutas.hoy = async () => {
  vista.innerHTML = '<div class="cargando">Cargando…</div>';
  const [d, citas, personas, embarcaciones, actividad] = await Promise.all([
    api('/api/hoy'), api('/api/agenda'), api('/api/personas'), api('/api/embarcaciones'), api('/api/eventos?limite=8'),
  ]);
  const ETIQUETA_EVENTO = {
    'embarcacion.publicada': ['📥', 'Entró al inventario'], 'embarcacion.precio_bajado': ['📉', 'Bajó de precio'],
    'busqueda.creada': ['🔎', 'Nueva búsqueda'], 'busqueda.reabierta': ['🔁', 'Búsqueda reabierta'],
  };
  const badge = document.getElementById('badge-hoy');
  const pendientes = d.sinResponder.length + d.propuestas.length;
  badge.hidden = !pendientes; badge.textContent = pendientes;

  vista.innerHTML = `
    <h1>Hoy</h1>
    <p class="sub">${new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })} — lo que necesita tu atención, en orden.</p>

    ${d.escalera.length ? `<h2>Escalera náutica — ex-clientes por dar el salto</h2>
      <p class="sub" style="margin-bottom:12px">Cada señal suma puntos (+10 tasó su barco, +6 miró fichas, +5 mencionó una limitación…). El número de la esquina es el total: cuando cruza el umbral, la persona aparece acá.</p>
      ${d.escalera.map(t => `
        <div class="tarjeta-escalera">
          <div class="score">${t.score}</div>
          <div style="font-weight:600;font-size:1rem"><a href="#/persona/${t.persona.id}">${esc(t.persona.nombre)}</a></div>
          <div style="color:var(--gris);font-size:0.84rem;margin:2px 0 10px">
            ${t.barco_actual ? 'Tiene una ' + esc(t.barco_actual.etiqueta) + ' · ' : ''}compró hace ${t.anios_desde_compra} años
            ${t.persona.contexto_personal ? ' · ' + esc(t.persona.contexto_personal) : ''}
          </div>
          ${t.senales.map(s => `<div class="senal-linea"><span class="peso">+${s.peso}</span><span><strong>${esc(s.tipo.replace(/_/g, ' '))}</strong> — ${esc(s.detalle || '')} <span style="color:var(--gris-claro)">(${haceCuanto(s.fecha)})</span></span></div>`).join('')}
          ${t.sugeridas.length ? `<div style="margin-top:12px;font-size:0.8rem;color:var(--gris)">Del inventario le encajan:</div>
            <div>${t.sugeridas.map(s => `<span class="chip">${esc(s.etiqueta)} · ${usd(s.precio)}</span>`).join('')}</div>` : ''}
          <div class="aviso-privacidad">Las señales de navegación son para saber cuándo llamar — nunca para mencionárselas al cliente.</div>
        </div>`).join('')}` : ''}

    ${d.propuestas.length ? `<h2>Matching pendiente de tu aprobación</h2>
      ${d.propuestas.map(p => `
        <div class="alerta-card">
          <span class="semaforo amarillo" style="margin-top:6px"></span>
          <div class="cuerpo">
            <div class="titulo">${esc(p.nombre)} ← ${esc(p.embarcacion)} <span class="chip">puntaje ${p.puntaje}</span></div>
            <div class="detalle">${esc(p.motivo)}</div>
          </div>
          <button class="btn mini" onclick="location.hash='#/embarcacion/${p.embarcacion_id}'">Revisar</button>
        </div>`).join('')}` : ''}

    ${d.captaciones.length ? `<h2>Oportunidades de captación — tasador web</h2>
      ${d.captaciones.map(t => `
        <div class="alerta-card">
          <span class="semaforo verde" style="margin-top:6px"></span>
          <div class="cuerpo">
            <div class="titulo"><a href="#/persona/${t.persona_id}">${esc(t.nombre)}</a> tasó su ${esc([t.datos_embarcacion.marca, t.datos_embarcacion.modelo, t.datos_embarcacion.anio].filter(Boolean).join(' '))}</div>
            <div class="detalle">Le dimos ${usd(t.valor_estimado_min)}–${usd(t.valor_estimado_max)} · ${haceCuanto(t.creada_en)} · ${esc(t.telefono || 'sin teléfono')}</div>
            <div class="detalle" style="color:var(--azul)">Está evaluando vender → llamalo antes de que publique en un portal.</div>
          </div>
        </div>`).join('')}` : ''}

    <h2>Esperan tu seguimiento <span style="color:var(--gris-claro);font-weight:400;font-size:0.8rem">— Prometheo ya dio la primera respuesta</span></h2>
    ${d.sinResponder.length ? d.sinResponder.map(c => `
      <div class="alerta-card">
        <span class="semaforo ${c.semaforo}" style="margin-top:6px"></span>
        <div class="cuerpo">
          <div class="titulo"><a href="#/persona/${c.persona_id}">${esc(c.nombre)}</a>
            <span class="chip gris">${esc(c.canal)}</span>
            ${c.embarcacion ? `<span class="chip">${esc(c.embarcacion)}</span>` : ''}
          </div>
          <div class="detalle">"${esc(c.contenido.length > 160 ? c.contenido.slice(0, 160) + '…' : c.contenido)}"</div>
          ${c.bot_respuesta ? `<div class="detalle" style="color:var(--verde)">✓ Prometheo respondió ${c.bot_respondio_en_min <= 2 ? 'al instante' : 'en ' + c.bot_respondio_en_min + ' min'}: "${esc(c.bot_respuesta.length > 110 ? c.bot_respuesta.slice(0, 110) + '…' : c.bot_respuesta)}"</div>` : ''}
          <div class="detalle" style="color:${c.semaforo === 'rojo' ? 'var(--rojo)' : 'var(--gris-claro)'}">Tu toque personal pendiente hace ${c.horas_sin_responder < 24 ? c.horas_sin_responder + ' hs' : plural(Math.round(c.horas_sin_responder / 24), 'día', 'días')} — respondé desde Prometheo</div>
        </div>
      </div>`).join('') : '<div class="vacio">Nada pendiente. 👌</div>'}

    ${actividad.length ? `<h2>Actividad del motor de coincidencias</h2>
      <div class="card actividad">${actividad.map(ev => {
        const [ic, txt] = ETIQUETA_EVENTO[ev.tipo] || ['•', ev.tipo];
        const link = ev.tipo.startsWith('embarcacion') ? `#/embarcacion/${ev.entidad_id}` : '#/busquedas';
        return `<a class="act-fila" href="${link}"><span class="act-ic">${ic}</span><span><b>${txt}:</b> ${esc(ev.etiqueta)}${ev.datos.precio_nuevo ? ` → USD ${Number(ev.datos.precio_nuevo).toLocaleString('es-AR')}` : ''}${ev.datos.canal ? ` <span class="chip gris">${esc(ev.datos.canal)}</span>` : ''}</span>
          <span class="act-res">${ev.propuestas ? ev.propuestas + ' propuesta' + (ev.propuestas > 1 ? 's' : '') : 'sin coincidencias'} · ${haceCuanto(ev.creado_en)}</span></a>`;
      }).join('')}</div>` : ''}

    <h2 id="agenda" style="margin-top:34px;padding-top:22px;border-top:1px solid var(--borde)">
      Agenda <span class="chip verde" style="vertical-align:middle">✓ sincronizada con Google Calendar</span>
    </h2>
    <p class="sub">Cada evento que cargás acá aparece en el Google Calendar de Leandro, y al revés.</p>
    <div class="grid dos" style="align-items:start">
      <div>
        ${(() => {
          const porDia = {};
          for (const c of citas) {
            const dia = new Date(c.fecha).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
            (porDia[dia] = porDia[dia] || []).push(c);
          }
          const iconos = { 'mostrar embarcación': '⚓', 'prueba de navegación': '🌊', 'firma de transferencia': '✍️', 'visita de tasación': '📋', 'entrega de embarcación': '🔑', 'otro': '📌' };
          return Object.keys(porDia).length ? Object.entries(porDia).map(([dia, evs]) => `
            <div style="font-size:0.76rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--gris-claro);font-weight:600;margin:16px 0 8px">${dia}</div>
            ${evs.map(c => `
              <div class="alerta-card" data-cita="${c.id}">
                <div style="font-size:1.3rem">${iconos[c.tipo] || '📌'}</div>
                <div class="cuerpo">
                  <div class="titulo">${esc(c.tipo[0].toUpperCase() + c.tipo.slice(1))} — <a href="#/persona/${c.persona_id}">${esc(c.persona)}</a></div>
                  <div class="detalle">${new Date(c.fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })} hs${c.embarcacion && c.embarcacion.trim() ? ' · ' + esc(c.embarcacion) : ''}${c.notas ? ' · ' + esc(c.notas) : ''}</div>
                </div>
                <button class="btn fantasma mini cancelar-cita">Cancelar</button>
              </div>`).join('')}`).join('') : '<div class="vacio">Agenda libre.</div>';
        })()}
      </div>
      <form class="card" id="form-cita">
        <strong style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--azul)">Nuevo evento</strong>
        <label>Tipo</label>
        <select name="tipo">${TIPOS_CITA.map(t => `<option>${t}</option>`).join('')}</select>
        <label>Persona</label>
        <select name="persona_id">${personas.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select>
        <label>Embarcación (opcional)</label>
        <select name="embarcacion_id"><option value="">—</option>${embarcaciones.map(e => `<option value="${e.id}">${esc(e.marca + ' ' + e.modelo + ' ' + (e.anio || ''))}</option>`).join('')}</select>
        <div class="fila">
          <div><label>Fecha</label><input type="date" name="fecha" required style="width:100%;padding:10px 14px;border:1px solid var(--borde);border-radius:10px;font-family:inherit"></div>
          <div><label>Hora</label><input type="time" name="hora" required style="width:100%;padding:10px 14px;border:1px solid var(--borde);border-radius:10px;font-family:inherit"></div>
        </div>
        <label>Notas</label>
        <input type="text" name="notas" placeholder="Trae mecánico / llevar papeles…">
        <button class="btn" style="margin-top:16px" type="submit">Agendar y sincronizar</button>
      </form>
    </div>
  `;

  document.getElementById('form-cita').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    await api('/api/citas', { method: 'POST', body: {
      tipo: f.tipo.value, persona_id: f.persona_id.value,
      embarcacion_id: f.embarcacion_id.value || null,
      fecha: new Date(f.fecha.value + 'T' + f.hora.value).toISOString(),
      notas: f.notas.value || null,
    }});
    toast('Evento agendado y sincronizado con Google Calendar.');
    rutas.hoy();
  };
  document.querySelectorAll('.cancelar-cita').forEach(btn => btn.onclick = async (ev) => {
    const id = ev.target.closest('[data-cita]').dataset.cita;
    await api('/api/citas/' + id, { method: 'DELETE', body: {} });
    toast('Evento cancelado (también en Google Calendar).');
    rutas.hoy();
  });
};

/* ==================== BÚSQUEDAS (la demanda) ==================== */
rutas.busquedas = async () => {
  vista.innerHTML = '<div class="cargando">Cargando…</div>';
  const busquedas = await api('/api/busquedas');
  const conNuevas = busquedas.filter(b => b.tiene_nueva_sin_ofrecer);
  const badge = document.getElementById('badge-busq');
  badge.hidden = !conNuevas.length; badge.textContent = conNuevas.length;

  const candidataHtml = (b, c) => `
    <div class="candidata ${c.nueva && !c.ofrecida ? 'destacada' : ''}">
      <a href="#/embarcacion/${c.id}" style="display:contents">
        ${c.foto ? `<img src="${c.foto}" alt="">` : '<div class="sin-foto">⚓</div>'}
      </a>
      <div class="cand-info">
        <div class="cand-nombre"><a href="#/embarcacion/${c.id}" style="color:inherit">${esc(c.etiqueta)}</a></div>
        <div class="cand-precio">${usd(c.precio)}</div>
        ${c.ofrecida
          ? '<span class="chip verde">✓ ya ofrecida</span>'
          : c.nueva
            ? '<span class="chip rojo">NUEVA · sin ofrecer</span>'
            : '<span class="chip gris">sin ofrecer</span>'}
        ${!c.ofrecida ? `<button class="btn ${c.nueva ? '' : 'sec'} mini btn-ofrecer" data-busq="${b.id}" data-emb="${c.id}" style="margin-top:6px">Ofrecer →</button>` : ''}
      </div>
    </div>`;

  const tarjeta = (b) => `
    <div class="card busq-card ${b.tiene_nueva_sin_ofrecer ? 'con-nueva' : ''}" style="margin-bottom:12px">
      <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
        <strong style="font-size:0.98rem"><a href="#/persona/${b.persona_id}">${esc(b.nombre)}</a></strong>
        <span style="color:var(--azul);font-weight:600">${b.presupuesto_max ? 'paga hasta ' + usd(b.presupuesto_max) : 'presupuesto s/d'}</span>
        <span style="color:var(--gris-claro);font-size:0.78rem">consultó ${haceCuanto(b.creada_en)}</span>
        ${b.urgencia === 'ya' ? '<span class="chip amarillo">quiere YA</span>' : ''}
        ${b.tiene_nueva_sin_ofrecer ? '<span class="chip rojo">tiene lancha nueva sin ofrecer</span>' : ''}
      </div>
      <div style="margin-top:6px">${chips(b.tipo_embarcacion)}${chips(b.uso_declarado, 'gris')}
        ${b.eslora_min || b.eslora_max ? `<span class="chip gris">${b.eslora_min || '?'}–${b.eslora_max || '?'} m</span>` : ''}
        ${b.necesita_bano ? '<span class="chip gris">con baño</span>' : ''}
        ${b.entrega_algo ? '<span class="chip amarillo">entrega en parte de pago</span>' : ''}
      </div>
      ${b.limitacion_declarada ? `<div style="font-size:0.8rem;color:var(--gris);margin-top:6px">Dijo: "${esc(b.limitacion_declarada)}"</div>` : ''}
      ${b.candidatas.length ? `<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--gris-claro);margin:12px 0 6px">Del stock le pueden interesar</div>
        <div class="candidatas">${b.candidatas.map(c => candidataHtml(b, c)).join('')}</div>
        <div class="prop-inline" id="prop-${b.id}"></div>`
      : '<div style="font-size:0.8rem;color:var(--gris-claro);margin-top:10px">Nada en stock le encaja hoy — queda esperando ingreso.</div>'}
    </div>`;

  const wireOfrecer = () => {
    document.querySelectorAll('.btn-ofrecer').forEach(btn => btn.onclick = async (ev) => {
      ev.preventDefault();
      btn.disabled = true; btn.textContent = 'Armando…';
      try {
        const p = await api('/api/ofrecer', { method: 'POST', body: { busqueda_id: btn.dataset.busq, embarcacion_id: btn.dataset.emb } });
        const cont = document.getElementById('prop-' + btn.dataset.busq);
        cont.innerHTML = propuestaHtml(p);
        cont.style.marginTop = '12px';
        wirePropuestas();
        cont.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (e) { toast('No se puede ofrecer: ' + e.message); }
      btn.disabled = false; btn.textContent = 'Ofrecer →';
    });
  };

  const render = (lista) => lista.length ? lista.map(tarjeta).join('') : '<div class="vacio">Sin búsquedas activas con ese filtro.</div>';
  vista.innerHTML = `
    <h1>Búsquedas activas <span style="color:var(--gris-claro);font-weight:400;font-size:1rem">— ${busquedas.length} personas esperando lancha</span></h1>
    <p class="sub">Ordenadas por cuánto están dispuestos a pagar. El criterio es flexible: quien busca una 1700 también ve una 1600 o una 1800 si entran en su presupuesto.</p>
    <div style="margin-bottom:10px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn sec mini" id="f-todas">Todas (${busquedas.length})</button>
      <button class="btn mini" id="f-nuevas">Con lancha nueva sin ofrecer (${conNuevas.length})</button>
    </div>
    <div style="margin-bottom:16px;font-size:0.78rem;color:var(--gris)">
      Cada lancha del stock muestra su estado:
      <span class="chip rojo">NUEVA · sin ofrecer</span> entró hace poco y todavía no se la mandaste ·
      <span class="chip gris">sin ofrecer</span> le encaja pero nunca se la ofreciste ·
      <span class="chip verde">✓ ya ofrecida</span> el mensaje ya salió.
    </div>
    <div id="lista-busq">${render(busquedas)}</div>`;
  wireOfrecer();
  document.getElementById('f-todas').onclick = (e) => {
    document.getElementById('lista-busq').innerHTML = render(busquedas);
    e.target.className = 'btn sec mini'; document.getElementById('f-nuevas').className = 'btn mini';
    wireOfrecer();
  };
  document.getElementById('f-nuevas').onclick = (e) => {
    document.getElementById('lista-busq').innerHTML = render(conNuevas);
    e.target.className = 'btn sec mini'; document.getElementById('f-todas').className = 'btn mini';
    wireOfrecer();
  };
};

/* ==================== AGENDA ==================== */
// La agenda vive dentro de la pantalla Hoy (unificadas). Este alias mantiene vivos
// los enlaces #/agenda y lleva el scroll a la sección.
const TIPOS_CITA = ['mostrar embarcación', 'prueba de navegación', 'firma de transferencia', 'visita de tasación', 'entrega de embarcación', 'otro'];
rutas.agenda = async () => {
  await rutas.hoy();
  const ancla = document.getElementById('agenda');
  if (ancla) ancla.scrollIntoView({ behavior: 'smooth' });
};

/* ==================== SEGUROS ==================== */
rutas.seguros = async () => {
  vista.innerHTML = '<div class="cargando">Cargando…</div>';
  const polizas = await api('/api/seguros');
  const conSeguro = polizas.filter(p => !p.sin_seguro);
  const bajas = conSeguro.filter(p => p.poliza_estado === 'dada de baja');
  const vencidas = conSeguro.filter(p => p.poliza_estado === 'vencida');
  const porVencer = conSeguro.filter(p => p.poliza_estado === 'vigente' && p.dias_para_vencer !== null && p.dias_para_vencer <= 30);
  const sinSeguro = polizas.filter(p => p.sin_seguro && p.situacion === 'en venta');
  const badge = document.getElementById('badge-seguros');
  const urgentes = bajas.length + vencidas.length + porVencer.length;
  badge.hidden = !urgentes; badge.textContent = urgentes;

  const porCia = {};
  for (const p of conSeguro) {
    const c = porCia[p.aseguradora] = porCia[p.aseguradora] || { n: 0, prima: 0 };
    c.n++; c.prima += p.poliza_prima_anual || 0;
  }

  const estadoChip = (p) => {
    if (p.poliza_estado === 'dada de baja') return '<span class="chip rojo">dada de baja</span>';
    if (p.poliza_estado === 'vencida') return '<span class="chip rojo">vencida</span>';
    if (p.dias_para_vencer !== null && p.dias_para_vencer <= 30) return `<span class="chip amarillo">vence en ${p.dias_para_vencer} días</span>`;
    return '<span class="chip verde">vigente</span>';
  };

  const filaPoliza = (p) => `
    <tr class="click" onclick="location.hash='#/embarcacion/${p.id}'">
      <td style="font-weight:600">${esc(p.marca)} ${esc(p.modelo)} <span style="color:var(--gris);font-weight:400">${p.anio || ''}</span>
        <div style="font-size:0.76rem;color:var(--gris-claro);font-weight:400">${esc(p.situacion)}</div></td>
      <td>${p.aseguradora ? `<strong>${esc(p.aseguradora)}</strong><div style="font-size:0.76rem;color:var(--gris-claro)">${esc(p.poliza_numero || '')}</div>` : '<span class="chip rojo">sin seguro</span>'}</td>
      <td>${p.poliza_vence ? fecha(p.poliza_vence) : '—'}</td>
      <td>${p.poliza_prima_anual ? usd(p.poliza_prima_anual) + '<div style="font-size:0.72rem;color:var(--gris-claro)">al año</div>' : '—'}</td>
      <td>${p.aseguradora ? estadoChip(p) : ''}</td>
      <td>${p.propietario ? `<a href="#/persona/${p.propietario_id}" onclick="event.stopPropagation()">${esc(p.propietario)}</a>` : '<span style="color:var(--gris-claro)">—</span>'}</td>
    </tr>`;

  vista.innerHTML = `
    <h1>Seguros <span style="color:var(--gris-claro);font-weight:400;font-size:1rem">— ${conSeguro.length} pólizas registradas</span></h1>
    <p class="sub">Qué compañía asegura cada embarcación, cuándo vence y cuánto se paga. Sirve para tres cosas: que ningún barco quede sin cobertura, tener una excusa legítima de contacto en cada renovación, y detectar bajas de póliza — que casi siempre significan que el dueño vendió.</p>

    <div class="kpis">
      ${Object.entries(porCia).sort((a, b) => b[1].n - a[1].n).map(([cia, d]) => `
        <div class="kpi"><div class="valor">${d.n}</div><div class="etiqueta">${esc(cia)}</div>
        <div style="font-size:0.74rem;color:var(--gris-claro);margin-top:4px">${usd(d.prima)} en primas</div></div>`).join('')}
    </div>

    ${bajas.length ? `<h2>Dieron de baja el seguro — casi seguro vendieron</h2>
      ${bajas.map(p => `
        <div class="alerta-card" style="border-left:4px solid var(--rojo)">
          <div style="font-size:1.3rem">🚨</div>
          <div class="cuerpo">
            <div class="titulo">${esc(p.marca)} ${esc(p.modelo)} ${p.anio || ''} — ${p.propietario ? `<a href="#/persona/${p.propietario_id}">${esc(p.propietario)}</a>` : 'sin dueño registrado'}</div>
            <div class="detalle">Póliza de ${esc(p.aseguradora)} dada de baja. Si vendió el barco por su cuenta, hoy es un comprador sin embarcación: llamalo.</div>
          </div>
          ${p.propietario_id ? `<button class="btn mini" onclick="location.hash='#/persona/${p.propietario_id}'">Ver ficha</button>` : ''}
        </div>`).join('')}` : ''}

    ${vencidas.length ? `<h2>Pólizas vencidas</h2>
      ${vencidas.map(p => `
        <div class="alerta-card">
          <span class="semaforo rojo" style="margin-top:6px"></span>
          <div class="cuerpo">
            <div class="titulo">${esc(p.marca)} ${esc(p.modelo)} ${p.anio || ''} <span class="chip gris">${esc(p.situacion)}</span></div>
            <div class="detalle">${esc(p.aseguradora)} · venció ${haceCuanto(p.poliza_vence)}${p.propietario ? ' · ' + esc(p.propietario) : ''} — sin cobertura no conviene ni sacarla a probar.</div>
          </div>
        </div>`).join('')}` : ''}

    ${porVencer.length ? `<h2>Vencen en los próximos 30 días</h2>
      ${porVencer.map(p => `
        <div class="alerta-card">
          <span class="semaforo amarillo" style="margin-top:6px"></span>
          <div class="cuerpo">
            <div class="titulo">${esc(p.marca)} ${esc(p.modelo)} ${p.anio || ''}</div>
            <div class="detalle">${esc(p.aseguradora)} vence el ${fecha(p.poliza_vence)} (en ${p.dias_para_vencer} días) · ${usd(p.poliza_prima_anual)} al año${p.propietario ? ' · ' + esc(p.propietario) : ''}</div>
          </div>
        </div>`).join('')}` : ''}

    ${sinSeguro.length ? `<h2>En venta y sin seguro registrado</h2>
      <div class="alerta-card">
        <div style="font-size:1.3rem">📋</div>
        <div class="cuerpo">
          <div class="titulo">${sinSeguro.length === 1 ? '1 embarcación' : sinSeguro.length + ' embarcaciones'} del stock sin póliza cargada</div>
          <div class="detalle">${sinSeguro.map(p => esc(p.marca + ' ' + p.modelo + ' ' + (p.anio || ''))).join(' · ')} — conviene confirmarlo antes de una prueba de navegación.</div>
        </div>
      </div>` : ''}

    <h2>Todas las pólizas</h2>
    <div class="card">
      <table>
        <tr><th>Embarcación</th><th>Compañía</th><th>Vence</th><th>Prima</th><th>Estado</th><th>Dueño</th></tr>
        ${polizas.map(filaPoliza).join('')}
      </table>
    </div>`;
};

/* ==================== RADAR DE MERCADO (ML / Marketplace) ==================== */
rutas.radar = async () => {
  vista.innerHTML = '<div class="cargando">Cargando…</div>';
  const avisos = await api('/api/radar');
  const bajas = avisos.filter(a => a.bajas > 0).sort((x, y) => new Date(y.ultima_baja_en) - new Date(x.ultima_baja_en));
  const nuevos = avisos.filter(a => a.bajas === 0);
  const badge = document.getElementById('badge-radar');
  badge.hidden = !bajas.filter(a => !a.contactado).length; badge.textContent = bajas.filter(a => !a.contactado).length;

  const fuenteChip = (f) => f === 'mercadolibre' ? '<span class="chip amarillo">MercadoLibre</span>' : '<span class="chip">Marketplace</span>';
  const avisoCard = (a, destacado) => `
    <div class="card ${destacado ? 'busq-card con-nueva' : ''}" style="margin-bottom:12px;display:flex;gap:16px" data-aviso="${a.id}">
      ${a.foto ? `<a href="${esc(a.url)}" target="_blank" style="flex-shrink:0"><img src="${esc(a.foto)}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:12px;background:var(--azul-suave)"></a>` : ''}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
          ${fuenteChip(a.fuente)}
          <strong style="font-size:0.94rem"><a href="${esc(a.url)}" target="_blank">${esc(a.titulo)} ↗</a></strong>
          ${a.es_nuevo ? '<span class="chip verde">detectado ' + haceCuanto(a.detectado_en) + '</span>' : ''}
        </div>
        <div style="margin-top:8px;font-size:0.95rem">
          <strong style="color:var(--azul);font-size:1.05rem">${usd(a.precio)}</strong>
          ${a.baja_pct ? `<span style="text-decoration:line-through;color:var(--gris-claro);margin-left:8px">${usd(a.precio_inicial)}</span>
            <span class="chip rojo">bajó ${a.baja_pct}%${a.bajas > 1 ? ' · ' + a.bajas + ' bajas' : ''} — última ${haceCuanto(a.ultima_baja_en)}</span>` : ''}
          <span style="color:var(--gris-claro);font-size:0.8rem;margin-left:8px">publicado ${haceCuanto(a.publicado_en)}</span>
        </div>
        ${a.contacto ? `<div style="font-size:0.82rem;margin-top:6px;color:var(--tinta)">📞 ${esc(a.contacto)}</div>` : ''}
        <div style="margin-top:8px"><a class="btn sec mini" href="${esc(a.url)}" target="_blank">Ver aviso en ${a.fuente === 'mercadolibre' ? 'MercadoLibre' : 'Marketplace'} ↗</a></div>
        ${a.persona_nombre ? `<div style="font-size:0.82rem;margin-top:6px;color:var(--verde)">⚡ Ya está en tu base: <a href="#/persona/${a.persona_id}">${esc(a.persona_nombre)}</a>${a.notas ? ' · ' + esc(a.notas) : ''}</div>` : a.notas ? `<div style="font-size:0.8rem;margin-top:6px;color:var(--gris)">${esc(a.notas)}</div>` : ''}
        ${a.bajas > 0 && !a.contactado ? `<div style="margin-top:10px"><button class="btn mini btn-captar" data-id="${a.id}">Ofrecer servicios de broker</button></div>` : a.contactado ? '<div style="margin-top:8px"><span class="chip verde">ya contactado</span></div>' : ''}
        <div class="captar-panel"></div>
      </div>
    </div>`;

  vista.innerHTML = `
    <h1>Radar de mercado <span style="color:var(--gris-claro);font-weight:400;font-size:1rem">— MercadoLibre y Marketplace</span></h1>
    <p class="sub">El sistema releva avisos de la zona todos los días. Una baja de precio es un vendedor al que no le está funcionando publicar solo: momento justo para ofrecerle el servicio de broker.</p>
    ${bajas.length ? `<h2>Bajaron el precio — oportunidades de captación</h2>${bajas.map(a => avisoCard(a, true)).join('')}` : ''}
    <h2>Avisos nuevos detectados</h2>
    ${nuevos.length ? nuevos.map(a => avisoCard(a, false)).join('') : '<div class="vacio">Nada nuevo hoy.</div>'}
    <p class="sub" style="margin-top:16px">En producción: consulta diaria a la API de MercadoLibre (categoría náutica, zona norte) + revisión asistida de Marketplace. El contacto siempre lo aprobás vos.</p>`;

  document.querySelectorAll('.btn-captar').forEach(btn => btn.onclick = async () => {
    btn.disabled = true;
    const r = await api(`/api/radar/${btn.dataset.id}/captar`, { method: 'POST', body: {} });
    const panel = btn.closest('[data-aviso]').querySelector('.captar-panel');
    panel.innerHTML = `
      <div class="motivo" style="margin-top:12px"><strong>Dato para el mensaje:</strong> tenés ${r.compradores} compradores activos buscando en ese rango de precio.</div>
      <textarea rows="6" style="margin-top:8px">${esc(r.mensaje)}</textarea>
      <div style="margin-top:8px;display:flex;gap:10px;align-items:center">
        <button class="btn mini btn-copiar-captacion">Copiar para enviar</button>
        <span class="nota-envio">Se manda a mano desde ML/Marketplace (no hay API de mensajes de terceros) — quedó registrado como contactado.</span>
      </div>`;
    btn.outerHTML = '<span class="chip verde">ya contactado</span>';
    panel.querySelector('.btn-copiar-captacion').onclick = async (e2) => {
      await navigator.clipboard.writeText(panel.querySelector('textarea').value);
      e2.target.textContent = '¡Copiado!';
      setTimeout(() => e2.target.textContent = 'Copiar para enviar', 2000);
    };
  });
};

/* ==================== PERSONAS ==================== */
rutas.personas = async () => {
  vista.innerHTML = '<div class="cargando">Cargando…</div>';
  const personas = await api('/api/personas');
  const render = (lista) => `
    <table>
      <tr><th>Nombre</th><th>Roles</th><th>Contacto</th><th>Búsquedas activas</th><th>Última interacción</th></tr>
      ${lista.map(p => `
        <tr class="click" onclick="location.hash='#/persona/${p.id}'">
          <td style="font-weight:600">${esc(p.nombre)}${p.no_contactar ? ' <span class="chip rojo">no contactar</span>' : ''}</td>
          <td>${chips(p.roles)}</td>
          <td style="color:var(--gris)">${esc(p.telefono || p.instagram_handle || p.email || '—')}</td>
          <td>${p.busquedas_activas || '—'}</td>
          <td style="color:var(--gris)">${haceCuanto(p.ultima_interaccion)}</td>
        </tr>`).join('')}
    </table>`;
  vista.innerHTML = `
    <h1>Clientes</h1>
    <p class="sub">Una sola entidad para todos los roles: la misma persona compra, vende y vuelve a comprar.</p>
    <input type="text" id="buscar" placeholder="Buscar por nombre, teléfono o Instagram…" style="margin-bottom:16px">
    <div class="card" id="tabla-personas">${render(personas)}</div>`;
  document.getElementById('buscar').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    document.getElementById('tabla-personas').innerHTML = render(personas.filter(p =>
      (p.nombre + (p.telefono || '') + (p.instagram_handle || '')).toLowerCase().includes(q)));
  };
};

rutas.persona = async (id) => {
  vista.innerHTML = '<div class="cargando">Cargando…</div>';
  const p = await api('/api/personas/' + id);
  vista.innerHTML = `
    <a class="volver" href="#/personas">← Clientes</a>
    <h1>${esc(p.nombre)} ${chips(p.roles)}${p.no_contactar ? '<span class="chip rojo">NO CONTACTAR</span>' : ''}</h1>
    <p class="sub">
      ${esc(p.telefono || '')} ${p.instagram_handle ? ' · ' + esc(p.instagram_handle) : ''}${p.email ? ' · ' + esc(p.email) : ''}
      · origen: ${esc(p.origen)}${p.referidor ? ` · referido por <a href="#/persona/${p.referidor.id}">${esc(p.referidor.nombre)}</a>` : ''}
      · cliente desde ${fecha(p.creado_en)}
    </p>
    ${p.contexto_personal ? `<div class="card" style="margin-bottom:14px"><strong style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--azul)">Contexto personal</strong><div style="margin-top:6px;font-size:0.9rem">${esc(p.contexto_personal)}</div>${p.notas_libres ? `<div style="margin-top:8px;font-size:0.85rem;color:var(--gris)">${esc(p.notas_libres)}</div>` : ''}</div>` : ''}

    ${p.trayectoria ? `<div class="card" style="margin-bottom:14px;border-left:4px solid var(--azul)">
      <strong style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--azul)">Línea de tiempo — sus embarcaciones</strong>
      <div class="trayectoria">
        ${p.trayectoria.hitos.map(h => `
          <div class="hito ${h.tipo === 'compró' ? 'compra' : 'venta'}">
            <span class="hito-anio">${fecha(h.fecha)}</span>
            <span class="hito-icono">${h.tipo === 'compró' ? '🛥' : '💰'}</span>
            <span><strong>${h.tipo === 'compró' ? 'Compró' : 'Vendió'}</strong> ${esc(h.embarcacion)}${h.precio ? ' por <strong>' + usd(h.precio) + '</strong>' : ''}${h.vinculada ? ' <span class="chip">upgrade</span>' : ''}</span>
          </div>`).join('')}
      </div>
      <div class="proximo-contacto ${p.trayectoria.proxima_vencida ? 'vencido' : ''}">
        ${p.trayectoria.ciclo_es_propio
          ? `🔁 <strong>Su ciclo: cambia de barco cada ${p.trayectoria.ciclo_propio} años</strong> (${p.trayectoria.compras} compras registradas)`
          : `🔁 Una sola compra registrada — se estima con el ciclo típico del mercado (4 años)`}
        <div style="margin-top:5px">
          ${p.trayectoria.proxima_vencida
            ? `⏰ <strong>Próxima compra estimada: ya está en ventana</strong> — le tocaba en ${fecha(p.trayectoria.proxima_estimada)} y hoy va por el año ${p.trayectoria.anios_ciclo}`
            : `📅 Próxima compra estimada: <strong>${fecha(p.trayectoria.proxima_estimada)}</strong> — hoy va por el año ${p.trayectoria.anios_ciclo} desde la última`}
        </div>
        ${p.trayectoria.barco_actual ? `<div style="margin-top:5px;font-size:0.8rem;color:var(--gris)">Hoy tiene: ${esc(p.trayectoria.barco_actual)}</div>` : ''}
      </div>
      ${p.trayectoria.sugeridas.length ? `<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--gris-claro);margin:10px 0 4px">Qué ofrecerle cuando lo llames (un escalón arriba)</div>
        <div>${p.trayectoria.sugeridas.map(s => `<a class="chip" href="#/embarcacion/${s.id}">${esc(s.etiqueta)} · ${usd(s.precio_pedido)}</a>`).join('')}</div>` : ''}
    </div>` : ''}

    <div class="grid dos">
      <div>
        <h2>Búsquedas <span style="color:var(--gris-claro);font-weight:400;font-size:0.8rem">— el histórico nunca se borra</span></h2>
        ${p.busquedas.length ? p.busquedas.map(b => `
          <div class="card" style="margin-bottom:10px">
            <div>${chipEstado(b.estado)} ${chips(b.tipo_embarcacion)} <span style="color:var(--gris-claro);font-size:0.75rem">${fecha(b.creada_en)}</span></div>
            <div style="font-size:0.86rem;margin-top:8px">
              ${b.presupuesto_max ? `Presupuesto ${b.presupuesto_min ? usd(b.presupuesto_min) + '–' : 'hasta '}${usd(b.presupuesto_max)}` : ''}
              ${b.eslora_min || b.eslora_max ? ` · eslora ${b.eslora_min || '?'}–${b.eslora_max || '?'} m` : ''}
              ${b.necesita_bano ? ' · con baño' : ''}${b.necesita_trailer ? ' · con trailer' : ''}
              ${b.urgencia ? ` · <strong>${esc(b.urgencia)}</strong>` : ''}
            </div>
            ${(b.uso_declarado || []).length ? `<div style="margin-top:6px">${chips(b.uso_declarado, 'gris')}</div>` : ''}
            ${b.limitacion_declarada ? `<div style="font-size:0.82rem;color:var(--gris);margin-top:6px">Dijo: "${esc(b.limitacion_declarada)}"</div>` : ''}
            ${b.motivo_cierre ? `<div style="font-size:0.8rem;color:var(--gris-claro);margin-top:6px">Cierre: ${esc(b.motivo_cierre)}</div>` : ''}
          </div>`).join('') : '<div class="vacio">Sin búsquedas registradas.</div>'}

        ${p.embarcaciones.length ? `<h2>${p.embarcaciones.length === 1 ? 'Embarcación actual' : 'Sus embarcaciones'}</h2>${p.embarcaciones.map(e => `
          <div class="card" style="margin-bottom:10px">
            <a href="#/embarcacion/${e.id}" style="font-weight:600">${esc(e.marca)} ${esc(e.modelo)} ${e.anio || ''}</a>
            <span class="chip gris">${esc(e.situacion)}</span>
            <div style="font-size:0.83rem;color:var(--gris);margin-top:4px">${e.eslora || '?'} m · ${esc(e.motor_marca || '')} ${e.motor_hp || '?'} HP · ${e.motor_horas ?? '?'} hs${e.precio_pedido ? ' · pide ' + usd(e.precio_pedido) : ''}</div>
          </div>`).join('')}` : ''}

        ${p.operaciones.length ? `<h2>Operaciones</h2>${p.operaciones.map(o => `
          <div class="card" style="margin-bottom:10px">
            <strong>${esc(o.embarcacion)}</strong> ${chipEstado(o.etapa)}
            <div style="font-size:0.83rem;color:var(--gris);margin-top:4px">
              ${o.comprador ? 'Comprador: ' + esc(o.comprador) : ''}${o.vendedor ? ' · Vendedor: ' + esc(o.vendedor) : ''}
              ${o.precio_cierre ? ' · cierre ' + usd(o.precio_cierre) : ''}
              ${o.fecha_cierre ? ' · ' + fecha(o.fecha_cierre) : ''}
            </div>
          </div>`).join('')}` : ''}

        ${p.senales.length ? `<h2>Señales</h2><div class="card">${p.senales.map(s => `
          <div class="senal-linea"><span class="peso">+${s.peso}</span><span><strong>${esc(s.tipo.replace(/_/g, ' '))}</strong> — ${esc(s.detalle || '')} <span style="color:var(--gris-claro)">(${haceCuanto(s.fecha)})</span></span></div>`).join('')}
          <div class="aviso-privacidad">Solo para uso interno: nunca mencionarle estas señales al cliente.</div></div>` : ''}

        ${p.tasaciones.length ? `<h2>Tasaciones</h2>${p.tasaciones.map(t => `
          <div class="card" style="margin-bottom:10px">
            <strong>${esc([t.datos_embarcacion.marca, t.datos_embarcacion.modelo, t.datos_embarcacion.anio].filter(Boolean).join(' '))}</strong>
            → ${usd(t.valor_estimado_min)}–${usd(t.valor_estimado_max)}
            <div style="font-size:0.8rem;color:var(--gris);margin-top:4px">${esc(t.origen)} · ${fecha(t.creada_en)}</div>
          </div>`).join('')}` : ''}
      </div>

      <div>
        <h2>Historial de conversaciones <span style="color:var(--gris-claro);font-weight:400;font-size:0.8rem">— todos los canales juntos</span></h2>
        <div class="card">
          ${p.timeline.length ? `<div class="timeline">${p.timeline.map(m => `
            <div class="burbuja ${m.direccion}">
              ${esc(m.contenido)}
              <div class="meta">${esc(m.canal)} · ${esc(m.autor)} · ${fechaHora(m.timestamp)}</div>
            </div>`).join('')}</div>
          <div style="font-size:0.72rem;color:var(--gris-claro);margin-top:14px;text-align:center">Espejo de solo lectura — para responder se usa Prometheo.</div>`
          : '<div class="vacio">Sin conversaciones registradas.</div>'}
        </div>
      </div>
    </div>`;
};

/* ==================== INVENTARIO ==================== */
rutas.inventario = async () => {
  vista.innerHTML = '<div class="cargando">Cargando…</div>';
  const emb = await api('/api/embarcaciones');
  const enVenta = emb.filter(e => e.situacion === 'en venta');
  const resto = emb.filter(e => e.situacion !== 'en venta');
  const sinPublicar = enVenta.filter(e => !e.publicado_en);

  const publicacionChips = (e) => {
    if (!e.publicado_en) return '<span class="chip rojo">sin publicar</span>';
    const chips = [];
    if (e.url_publicacion) chips.push('<span class="chip verde">🌐 web</span>');
    if (e.url_instagram) chips.push('<span class="chip">📷 Instagram</span>');
    if (e.url_portal) chips.push('<span class="chip amarillo">portal</span>');
    if (!chips.length) chips.push('<span class="chip gris">publicada</span>');
    return chips.join('');
  };

  const tarjetaBarco = (e) => `
    <div class="barco-card" onclick="location.hash='#/embarcacion/${e.id}'">
      <div class="barco-foto">
        ${e.fotos && e.fotos.length ? `<img src="${esc(e.fotos[0])}" alt="${esc(e.marca + ' ' + e.modelo)}" loading="lazy">` : '<div class="barco-sinfoto">⚓<span>sin fotos cargadas</span></div>'}
        ${e.situacion === 'en venta' && e.dias_en_stock > 120 ? `<span class="barco-alerta">${e.dias_en_stock} días en stock</span>` : ''}
        ${e.situacion !== 'en venta' ? `<span class="barco-situacion">${esc(e.situacion)}</span>` : ''}
      </div>
      <div class="barco-cuerpo">
        <div class="barco-nombre">${esc(e.marca)} ${esc(e.modelo)} <span style="color:var(--gris);font-weight:400">${e.anio || ''}</span></div>
        <div class="barco-precio">${usd(e.precio_pedido)}</div>
        <div class="barco-meta">${esc(e.tipo)} · ${e.eslora || '?'} m${e.motor_hp ? ' · ' + e.motor_hp + ' HP' : ''}${e.tiene_bano ? ' · con baño' : ''}</div>
        <div style="margin-top:8px">${publicacionChips(e)}</div>
        <div class="barco-meta" style="margin-top:6px">
          ${e.situacion === 'en venta' ? `${e.dias_en_stock} días en stock · ` : ''}${e.consultas ? e.consultas + ' consulta' + (e.consultas > 1 ? 's' : '') : 'sin consultas'}
        </div>
      </div>
    </div>`;

  vista.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <h1>Inventario <span style="color:var(--gris-claro);font-weight:400;font-size:1rem">— ${enVenta.length} en venta</span></h1>
      <div style="display:flex;gap:8px"><a class="btn sec mini" href="#/carga">📱 Cargar por WhatsApp</a><a class="btn mini" href="#/alta-embarcacion">+ Cargar con formulario</a></div>
    </div>
    <p class="sub">Cada lancha muestra dónde está publicada. Las que llevan más de 120 días en stock salen marcadas.</p>
    ${sinPublicar.length ? `<div class="alerta-card" style="border-left:4px solid var(--rojo)">
      <div style="font-size:1.3rem">📣</div>
      <div class="cuerpo">
        <div class="titulo">${sinPublicar.length === 1 ? '1 embarcación' : sinPublicar.length + ' embarcaciones'} en venta sin publicar en ningún lado</div>
        <div class="detalle">${sinPublicar.map(e => esc(e.marca + ' ' + e.modelo + ' ' + (e.anio || ''))).join(' · ')} — no están ni en la web ni en Instagram: nadie las está viendo.</div>
      </div>
    </div>` : ''}
    <div class="barcos-grid">${enVenta.map(tarjetaBarco).join('')}</div>

    <h2 style="margin-top:34px;padding-top:22px;border-top:1px solid var(--borde)">
      Fuera de inventario <span style="color:var(--gris-claro);font-weight:400;font-size:0.8rem">— ${resto.length} barcos que no están a la venta</span>
    </h2>
    <p class="sub">No son stock: son los que ya vendiste y los que hoy tienen tus ex-clientes. El CRM los recuerda porque son la materia prima de la escalera náutica — cuando uno de esos dueños esté para cambiar, ya sabés qué tiene, qué pagó y qué ofrecerle. Además, sus precios de venta reales son los que alimentan el tasador.</p>
    <button class="btn sec mini" id="ver-fuera" style="margin-bottom:14px">Ver los ${resto.length} barcos</button>
    <div class="barcos-grid" id="grid-fuera" hidden>${resto.map(tarjetaBarco).join('')}</div>`;

  const btnFuera = document.getElementById('ver-fuera');
  btnFuera.onclick = () => {
    const g = document.getElementById('grid-fuera');
    g.hidden = !g.hidden;
    btnFuera.textContent = g.hidden ? `Ver los ${resto.length} barcos` : 'Ocultar';
  };
};

rutas.embarcacion = async (id) => {
  vista.innerHTML = '<div class="cargando">Cargando…</div>';
  const [e, propuestas] = await Promise.all([api('/api/embarcaciones/' + id), api(`/api/embarcaciones/${id}/propuestas`)]);
  const pendientes = propuestas.filter(p => p.estado === 'pendiente');
  const resueltas = propuestas.filter(p => p.estado !== 'pendiente');
  vista.innerHTML = `
    <a class="volver" href="#/inventario">← Inventario</a>
    <h1>${esc(e.marca)} ${esc(e.modelo)} ${e.anio || ''} <span class="chip ${e.situacion === 'en venta' ? 'verde' : 'gris'}">${esc(e.situacion)}</span></h1>
    <p class="sub">${esc(e.tipo)} · ${e.eslora || '?'} m de eslora${e.manga ? ' × ' + e.manga + ' m' : ''} · ${e.cantidad_motores > 1 ? e.cantidad_motores + ' × ' : ''}${esc(e.motor_marca || '')} ${e.motor_hp || '?'} HP ${esc(e.motor_tipo || '')} · ${e.motor_horas ?? '?'} horas${e.cargada_por ? ` · <span class="chip gris">cargada por ${esc(e.cargada_por)}</span>` : ''}</p>

    ${(e.fotos && e.fotos.length) ? `<div class="ficha-fotos">
      ${e.fotos.map(f => `<img src="${esc(f)}" alt="${esc(e.marca + ' ' + e.modelo)}">`).join('')}
    </div>` : `<div class="ficha-sinfoto">⚓<div>Sin fotos cargadas${e.situacion === 'en venta' ? ' — hace falta una sesión de fotos antes de publicarla' : ''}</div></div>`}

    <div class="card" style="margin-bottom:14px">
      <strong style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--azul)">Dónde está publicada</strong>
      ${e.publicado_en ? `
        <div style="font-size:0.85rem;margin-top:8px">Publicada ${haceCuanto(e.publicado_en)}</div>
        <div style="margin-top:8px;display:flex;gap:10px;flex-wrap:wrap">
          ${e.url_publicacion ? `<a class="btn sec mini" href="${esc(e.url_publicacion)}" target="_blank">🌐 Ver ficha en la web ↗</a>` : ''}
          ${e.url_instagram ? `<a class="btn sec mini" href="${esc(e.url_instagram)}" target="_blank">📷 ${/\/(reel|p)\//.test(e.url_instagram) ? 'Ver posteo en Instagram' : 'Ver perfil de Instagram'} ↗</a>` : ''}
          ${e.url_portal ? `<a class="btn sec mini" href="${esc(e.url_portal)}" target="_blank">Ver aviso en el portal ↗</a>` : ''}
        </div>
        ${!e.url_instagram && e.situacion === 'en venta' ? '<div style="font-size:0.8rem;color:var(--gris);margin-top:8px">No está en Instagram — es el canal por el que llegan más consultas.</div>' : ''}
        ${e.url_instagram && !/\/(reel|p)\//.test(e.url_instagram) ? '<div style="font-size:0.78rem;color:var(--gris-claro);margin-top:8px">Del posteo solo quedó el perfil: cuando se publica desde el CRM, el link del posteo se guarda solo.</div>' : ''}`
      : `<div style="margin-top:8px"><span class="chip rojo">sin publicar</span>
         <span style="font-size:0.85rem;color:var(--gris)">No está ni en la web ni en Instagram: hoy no la está viendo nadie.</span></div>`}
    </div>

    <div class="grid dos">
      <div class="card">
        <strong style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--azul)">Ficha</strong>
        <table style="margin-top:8px">
          <tr><td style="color:var(--gris)">Precio pedido</td><td style="font-weight:600">${usd(e.precio_pedido)}</td></tr>
          ${e.precio_minimo_aceptado ? `<tr><td style="color:var(--gris)">Mínimo aceptado <span class="chip amarillo">privado</span></td><td>${usd(e.precio_minimo_aceptado)}
            ${e.precio_pedido && e.precio_pedido < e.precio_minimo_aceptado ? `<div class="aviso-minimo">⚠️ El precio pedido quedó por debajo del mínimo del dueño. <a href="#" id="ajustar-minimo">Si lo autorizó, igualarlo a ${usd(e.precio_pedido)}</a></div>` : ''}</td></tr>` : ''}
          ${e.precio_venta_real ? `<tr><td style="color:var(--gris)">Venta real</td><td>${usd(e.precio_venta_real)}</td></tr>` : ''}
          <tr><td style="color:var(--gris)">Estado</td><td>${esc(e.estado_general || '—')}</td></tr>
          <tr><td style="color:var(--gris)">Baño / Trailer</td><td>${e.tiene_bano ? 'baño ✓' : 'sin baño'} · ${e.tiene_trailer ? 'trailer ✓' : 'sin trailer'}</td></tr>
          <tr><td style="color:var(--gris)">Exclusividad</td><td>${esc(e.exclusividad || '—')}</td></tr>
          <tr><td style="color:var(--gris)">Papeles</td><td>${esc(e.papeles_estado || '—')}${e.papeles_notas ? ' · ' + esc(e.papeles_notas) : ''}</td></tr>
          ${e.propietario ? `<tr><td style="color:var(--gris)">Propietario</td><td><a href="#/persona/${e.propietario.id}">${esc(e.propietario.nombre)}</a></td></tr>` : ''}
          ${e.combustible_litros ? `<tr><td style="color:var(--gris)">Combustible</td><td>${e.combustible_litros} L</td></tr>` : ''}
          <tr><td style="color:var(--gris)">Seguro</td><td>${e.aseguradora
            ? esc(e.aseguradora) + (e.poliza_estado && e.poliza_estado !== 'vigente' ? ' <span class="chip rojo">' + esc(e.poliza_estado) + '</span>' : '') + (e.poliza_vence ? '<div style="font-size:0.76rem;color:var(--gris-claro)">vence ' + fecha(e.poliza_vence) + (e.poliza_prima_anual ? ' · ' + usd(e.poliza_prima_anual) + '/año' : '') + '</div>' : '')
            : '<span class="chip rojo">sin seguro registrado</span>'}</td></tr>
        </table>
        ${(e.equipamiento || []).length ? `<div style="margin-top:10px">${chips(e.equipamiento, 'gris')}</div>` : ''}
      </div>
      <div class="card">
        <strong style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--azul)">Consultas recibidas</strong>
        ${e.consultas.length ? `<table style="margin-top:8px">${e.consultas.map(c => `
          <tr class="click" onclick="location.hash='#/persona/${c.persona_id}'"><td>${esc(c.nombre)}</td><td><span class="chip gris">${esc(c.canal)}</span></td><td style="color:var(--gris)">${haceCuanto(c.ultima_actividad)}</td></tr>`).join('')}</table>`
        : '<div class="vacio">Todavía sin consultas.</div>'}
      </div>
    </div>

    ${e.situacion === 'en venta' ? `
      <div class="card precio-card">
        <div>
          <strong style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--azul)">Precio pedido</strong>
          <div style="font-size:1.3rem;font-weight:700;color:var(--azul);margin-top:2px">${usd(e.precio_pedido)}</div>
          <div style="font-size:0.78rem;color:var(--gris)">Si baja, el motor vuelve a cruzar todas las búsquedas: suma a los que ahora entran y les avisa a los que ya la tenían.</div>
        </div>
        <form id="form-precio" style="display:flex;gap:8px;align-items:center">
          <input type="number" name="precio" placeholder="Nuevo precio" step="500" min="1000" style="width:150px" required>
          <button class="btn mini" type="submit">Actualizar</button>
        </form>
      </div>
      ${e.umbrales && e.umbrales.length ? `
        <div class="card casi-card">
          <strong style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--amarillo-osc, #a3720e)">💡 Para negociar con el dueño — compradores que entran si baja el precio</strong>
          <div class="escalones">
            ${e.umbrales.map(u => `
              <div class="escalon">
                <div class="escalon-precio">${usd(u.precio)}</div>
                <div class="escalon-txt">se ${u.se_suman === 1 ? 'suma 1' : 'suman ' + u.se_suman} <span style="color:var(--gris)">(${u.total} en total)</span></div>
                <div class="escalon-nombres">${u.nombres.map(esc).join(', ')}</div>
              </div>`).join('')}
          </div>
        </div>` : ''}` : ''}

    ${pendientes.length ? `
      <h2>A quién le sirve — ${pendientes.length} candidato${pendientes.length > 1 ? 's' : ''} esperando tu aprobación</h2>
      <p class="sub" style="margin-bottom:14px">El sistema nunca envía solo: aprobás, editás o descartás. En USD 30.000 el contacto personal es el activo.</p>
      ${pendientes.map(p => propuestaHtml(p)).join('')}` :
    e.situacion === 'en venta' && e.candidatos.length ? `
      <h2>A quién le sirve — según el motor de coincidencias</h2>
      ${e.candidatos.map(c => `
        <div class="propuesta">
          <div class="encabezado">
            <span class="puntaje">${c.puntaje}</span>
            <strong><a href="#/persona/${c.persona_id}">${esc(c.nombre)}</a></strong>
            <span style="color:var(--gris);font-size:0.8rem">${esc(c.telefono || c.instagram_handle || '')}</span>
          </div>
          <div class="motivo">${esc(c.motivo)}</div>
          ${factoresHtml(c.factores)}
        </div>`).join('')}` : ''}

    ${resueltas.length ? `<h2>Propuestas resueltas</h2>${resueltas.map(p => `
      <div class="alerta-card">
        <div class="cuerpo">
          <div class="titulo">${esc(p.nombre)} — <span class="chip ${p.estado.includes('aprobada') ? 'verde' : 'gris'}">${esc(p.estado)}</span></div>
          <div class="detalle">${haceCuanto(p.resuelta_en)}</div>
        </div>
      </div>`).join('')}` : ''}
  `;
  wirePropuestas();
  const am = document.getElementById('ajustar-minimo');
  if (am) am.onclick = async (ev) => {
    ev.preventDefault();
    await api(`/api/embarcaciones/${id}/minimo`, { method: 'PATCH', body: { minimo: e.precio_pedido } });
    toast('Mínimo actualizado (queda registrado en la auditoría).');
    rutas.embarcacion(id);
  };
  const fp = document.getElementById('form-precio');
  if (fp) fp.onsubmit = async (ev) => {
    ev.preventDefault();
    const precio = parseInt(fp.precio.value, 10);
    const r = await api(`/api/embarcaciones/${id}/precio`, { method: 'PATCH', body: { precio } });
    if (r.debajoDelMinimo) setTimeout(() => toast(`⚠️ Quedó por debajo del mínimo que aceptaba el dueño (${usd(r.minimo)}). Revisalo en la ficha.`), 4300);
    toast(precio < r.precio_anterior
      ? `Precio actualizado. ${r.propuestas.length ? r.propuestas.length + ' propuesta' + (r.propuestas.length > 1 ? 's' : '') + ' nueva' + (r.propuestas.length > 1 ? 's' : '') + ' para aprobar.' : 'Con este precio no se suma nadie nuevo.'}`
      : 'Precio actualizado.');
    rutas.embarcacion(id);
  };
};

/** "¿Por qué N puntos?" — el desglose que arma el motor, para que el puntaje no sea una caja negra. */
function factoresHtml(factores) {
  let lista = factores;
  if (typeof lista === 'string') { try { lista = JSON.parse(lista); } catch { lista = []; } }
  if (!lista || !lista.length) return '';
  return `<details class="factores"><summary>¿Por qué ${lista.reduce((a, f) => a + f.puntos, 0)} puntos?</summary>
    ${lista.map(f => `<div class="factor"><span class="factor-pts ${f.puntos < 0 ? 'neg' : ''}">${f.puntos > 0 ? '+' : ''}${f.puntos}</span>${esc(f.texto)}</div>`).join('')}
  </details>`;
}

function propuestaHtml(p) {
  return `
    <div class="propuesta" data-id="${p.id}">
      <div class="encabezado">
        <span class="puntaje">${p.puntaje}</span>
        <strong style="font-size:1rem"><a href="#/persona/${p.persona_id}">${esc(p.nombre)}</a></strong>
        <span style="color:var(--gris);font-size:0.82rem">${esc(p.telefono || p.instagram_handle || '')}</span>
        ${p.via === 'copy-paste' ? '<span class="chip amarillo">sin teléfono → tarea copy-paste</span>' : ''}
        ${p.origen === 'precio_bajado' ? '<span class="chip rojo">bajó de precio</span>' : p.origen === 'busqueda_nueva' ? '<span class="chip">búsqueda nueva</span>' : ''}
      </div>
      ${p.contexto_personal ? `<div style="font-size:0.8rem;color:var(--gris);margin-top:4px">${esc(p.contexto_personal)}</div>` : ''}
      <div class="motivo"><strong>Por qué:</strong> ${esc(p.motivo)}</div>
      ${factoresHtml(p.factores)}
      <textarea rows="5">${esc(p.mensaje_borrador)}</textarea>
      <div class="acciones-prop">
        <button class="btn mini aprobar">Aprobar y enviar</button>
        <button class="btn fantasma mini descartar">Descartar</button>
        <span class="nota-envio">${p.envio ? esc(p.envio.modo === 'plantilla' ? 'Saldrá como plantilla de Meta (fuera de la ventana de 24 hs) — el sistema lo decide solo' : p.envio.modo === 'texto libre' ? 'Ventana de 24 hs activa: sale como texto libre' : p.envio.detalle) : ''}</span>
      </div>
    </div>`;
}

function wirePropuestas() {
  document.querySelectorAll('.propuesta[data-id]').forEach(el => {
    const id = el.dataset.id;
    const btnA = el.querySelector('.aprobar'), btnD = el.querySelector('.descartar');
    if (btnA) btnA.onclick = async () => {
      btnA.disabled = true;
      const r = await api(`/api/propuestas/${id}/aprobar`, { method: 'POST', body: { mensaje: el.querySelector('textarea').value } });
      toast(r.envio.modo === 'copy-paste' ? 'Tarea creada: pegá el mensaje en la bandeja de Prometheo.' : `Enviado como ${r.envio.modo} (${r.envio.detalle}).`);
      el.style.opacity = 0.45; el.querySelector('.acciones-prop').innerHTML = `<span class="chip verde">aprobada</span>`;
    };
    if (btnD) btnD.onclick = async () => {
      await api(`/api/propuestas/${id}/descartar`, { method: 'POST', body: {} });
      el.style.opacity = 0.45; el.querySelector('.acciones-prop').innerHTML = `<span class="chip gris">descartada</span>`;
    };
  });
}

/* ==================== CARGA POR WHATSAPP (simulador) ==================== */
const EJEMPLOS_CARGA = [
  ['Cargar una unidad', 'Entró una Quicksilver 1800 del 2017, Mercury 115 con 400 hs, con trailer, impecable. Pide 23.500, acepta 22 lucas. Dueño Juan Pérez 11 5555 1234'],
  ['Completar lo que falta', 'es open'],
  ['Publicar', 'LISTO'],
  ['Enviar a los elegidos', '1'],
  ['Bajar un precio', 'la Klase A 2400 bajó a 52 lucas'],
  ['Marcar una venta', 'se vendió la Paglietini 620'],
  ['Ver comandos', 'AYUDA'],
];

/** Achica la foto en el navegador antes de mandarla (una foto de celular pesa 3-5 MB). */
function fotoADataUrl(file, max = 1280) {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      ok(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = mal;
    img.src = URL.createObjectURL(file);
  });
}

const horaCorta = (iso) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });

rutas.carga = async () => {
  vista.innerHTML = '<div class="cargando">Cargando…</div>';
  const [conv, borradores, operadores] = await Promise.all([
    api('/api/intake/conversacion?tel=sim:leandro'), api('/api/intake/borradores'), api('/api/operadores'),
  ]);
  let fotosPendientes = [];

  const burbujas = (msgs) => msgs.length ? msgs.map(m => `
    <div class="wa-msg ${m.direccion === 'entrante' ? 'yo' : 'bot'}">
      ${(m.medios || []).filter(x => x.url).map(x => `<img src="${esc(x.url)}" alt="">`).join('')}
      ${(m.medios || []).some(x => x.tipo === 'imagen' && !x.url) ? '<div class="wa-foto-ph">📷 foto</div>' : ''}
      ${m.texto ? `<div class="wa-txt">${esc(m.texto)}</div>` : ''}
      <div class="wa-hora">${horaCorta(m.timestamp)}${m.direccion === 'entrante' ? ' ✓✓' : ''}</div>
    </div>`).join('')
    : '<div class="wa-vacio">Escribile como le escribirías a alguien del equipo.<br>Probá con los ejemplos de la derecha →</div>';

  vista.innerHTML = `
    <h1>Carga por WhatsApp</h1>
    <p class="sub">Leandro está en la guardería frente a un barco que acaba de tomar: le saca fotos y lo manda por WhatsApp como le sale. El sistema arma la ficha, pregunta lo que falta, la publica cuando él confirma y le contesta al toque a quién le sirve. Este simulador usa exactamente el mismo motor que el número real.</p>
    <div class="carga-layout">
      <div class="wa-telefono">
        <div class="wa-header">
          <div class="wa-avatar"><img src="/img/logo.png" alt=""></div>
          <div><div class="wa-nombre">Asistente de carga · CRM</div><div class="wa-estado">en línea</div></div>
        </div>
        <div class="wa-chat" id="wa-chat">${burbujas(conv)}</div>
        <div class="wa-adjuntos" id="wa-adjuntos" hidden></div>
        <form class="wa-input" id="wa-form">
          <label class="wa-clip" title="Adjuntar fotos">📎<input type="file" id="wa-fotos" accept="image/*" multiple hidden></label>
          <textarea id="wa-texto" rows="1" placeholder="Mensaje"></textarea>
          <button class="wa-enviar" type="submit" title="Enviar">➤</button>
        </form>
      </div>
      <div>
        <div class="card" style="margin-bottom:14px">
          <strong class="titulo-seccion">Probá con</strong>
          <div class="ejemplos-carga">${EJEMPLOS_CARGA.map(([t, txt], i) => `
            <button class="ejemplo-carga" data-i="${i}"><span>${esc(t)}</span><em>${esc(txt.length > 70 ? txt.slice(0, 70) + '…' : txt)}</em></button>`).join('')}
          </div>
          <button class="btn fantasma mini" id="wa-reiniciar" style="margin-top:10px">Reiniciar conversación</button>
        </div>
        <div class="card" style="margin-bottom:14px">
          <strong class="titulo-seccion">Qué pasa por detrás</strong>
          <ol class="pasos-carga">
            <li><b>Entiende el mensaje</b> (y las fotos, con IA): marca, modelo, año, motor, horas, precio, mínimo privado, dueño.</li>
            <li><b>Arma un borrador</b> y pide solo lo que falta. Nada se publica sin un LISTO.</li>
            <li><b>Publica</b> → el evento dispara el motor de coincidencias contra todas las búsquedas activas.</li>
            <li><b>Contesta a quién le sirve</b>; respondiendo "1 3" se envían esos mensajes (la aprobación sigue siendo de él).</li>
            <li>Un <b>cambio de precio</b> vuelve a cruzar todo: suma a los que ahora entran y avisa a los que ya la tenían.</li>
          </ol>
        </div>
        <div class="card">
          <strong class="titulo-seccion">Cargas recientes</strong>
          ${borradores.length ? `<table style="margin-top:6px">${borradores.slice(0, 8).map(b => `
            <tr${b.embarcacion_id ? ` class="click" onclick="location.hash='#/embarcacion/${b.embarcacion_id}'"` : ''}>
              <td>${esc([b.datos.marca, b.datos.modelo, b.datos.anio].filter(Boolean).join(' ') || 'sin datos')}</td>
              <td><span class="chip ${b.estado === 'publicado' ? 'verde' : b.estado === 'abierto' ? 'amarillo' : 'gris'}">${esc(b.estado)}</span></td>
              <td style="color:var(--gris)">${esc(b.canal)} · ${haceCuanto(b.actualizado_en)}</td>
            </tr>`).join('')}</table>` : '<div class="vacio">Todavía no se cargó nada por este canal.</div>'}
          <div style="font-size:0.78rem;color:var(--gris);margin-top:10px">
            Números habilitados para cargar: ${operadores.filter(o => o.activo && !o.telefono.startsWith('sim:')).map(o => esc(o.nombre + ' ' + o.telefono)).join(', ') || 'ninguno todavía (se configuran al conectar el número de WhatsApp). Cualquier otro número que escriba es ignorado.'}
          </div>
        </div>
      </div>
    </div>`;

  const chat = document.getElementById('wa-chat');
  chat.scrollTop = chat.scrollHeight;
  const form = document.getElementById('wa-form');
  const input = document.getElementById('wa-texto');
  const adj = document.getElementById('wa-adjuntos');

  const pintarAdjuntos = () => {
    adj.hidden = !fotosPendientes.length;
    adj.innerHTML = fotosPendientes.map((f, i) => `<div class="wa-adj"><img src="${f}"><button type="button" data-i="${i}">×</button></div>`).join('');
    adj.querySelectorAll('button').forEach(b => b.onclick = () => { fotosPendientes.splice(+b.dataset.i, 1); pintarAdjuntos(); });
  };
  document.getElementById('wa-fotos').onchange = async (ev) => {
    for (const f of ev.target.files) { try { fotosPendientes.push(await fotoADataUrl(f)); } catch { toast('No pude leer esa imagen'); } }
    ev.target.value = ''; pintarAdjuntos();
  };

  const enviar = async (texto) => {
    if (!texto.trim() && !fotosPendientes.length) return;
    const fotos = fotosPendientes; fotosPendientes = []; pintarAdjuntos();
    input.value = '';
    const vacio = chat.querySelector('.wa-vacio'); if (vacio) vacio.remove();
    chat.insertAdjacentHTML('beforeend', `<div class="wa-msg yo">${fotos.map(f => `<img src="${f}">`).join('')}${texto ? `<div class="wa-txt">${esc(texto)}</div>` : ''}<div class="wa-hora">${horaCorta(new Date())}</div></div>
      <div class="wa-msg bot escribiendo" id="wa-escribiendo"><div class="wa-txt">escribiendo…</div></div>`);
    chat.scrollTop = chat.scrollHeight;
    try {
      await api('/api/intake/simulador', { method: 'POST', body: { texto, fotos } });
    } catch (e) { toast('Error: ' + e.message); }
    const msgs = await api('/api/intake/conversacion?tel=sim:leandro');
    chat.innerHTML = burbujas(msgs);
    chat.scrollTop = chat.scrollHeight;
    actualizarBadges();
  };

  form.onsubmit = (ev) => { ev.preventDefault(); enviar(input.value); };
  input.onkeydown = (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); enviar(input.value); } };
  document.querySelectorAll('.ejemplo-carga').forEach(b => b.onclick = () => enviar(EJEMPLOS_CARGA[+b.dataset.i][1]));
  document.getElementById('wa-reiniciar').onclick = async () => {
    await api('/api/intake/reiniciar', { method: 'POST', body: {} });
    rutas.carga();
  };
};

/* ==================== ALTA RÁPIDA DE BÚSQUEDA ==================== */
const TIPOS = ['lancha open', 'lancha cuddy', 'crucero', 'semirrigido/tracker', 'moto de agua', 'de coleccion'];
const USOS = ['paseo familiar', 'pesca', 'wakeboard/deportes', 'dormir a bordo', 'navegación río abierto'];

rutas['alta-busqueda'] = async (_, prefill) => {
  vista.innerHTML = `
    <h1>Alta rápida de búsqueda</h1>
    <p class="sub">Para cargar mientras hablás por teléfono — menos de un minuto. O pegá el mensaje y la IA lo estructura sola.</p>

    <div class="grid dos" style="align-items:start">
      <div class="card">
        <strong style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--azul)">Pegar mensaje (WhatsApp, Instagram, audio transcripto)</strong>
        <textarea id="texto-libre" rows="6" placeholder="Ej: Hola! Busco una lancha con baño para hacer noche en el Delta, somos 4. Hasta 35 lucas verdes. Tengo una Tracker del 2014 para entregar…" style="margin-top:10px"></textarea>
        <button class="btn" id="btn-extraer" style="margin-top:12px">Extraer con IA</button>
        <div id="resultado-extraccion"></div>
      </div>

      <form class="card" id="form-busqueda">
        <strong style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--azul)">La búsqueda</strong>
        <div class="fila">
          <div><label>Nombre</label><input type="text" name="nombre" required></div>
          <div><label>Teléfono</label><input type="text" name="telefono" placeholder="11 5555 5555"></div>
        </div>
        <div class="fila">
          <div><label>Instagram (si no hay tel.)</label><input type="text" name="instagram_handle" placeholder="@usuario"></div>
          <div><label>Origen</label><select name="origen">
            <option>whatsapp</option><option>instagram</option><option selected>telefono</option><option>web</option><option>facebook</option><option>referido</option><option>guarderia/club</option><option>portal</option><option>otro</option>
          </select></div>
        </div>
        <label>Tipo de embarcación</label>
        <div>${TIPOS.map(t => `<label class="check" style="display:inline-flex;margin-right:14px"><input type="checkbox" name="tipo" value="${t}"> ${t}</label>`).join('')}</div>
        <div class="fila">
          <div><label>Presupuesto mín (USD)</label><input type="number" name="presupuesto_min"></div>
          <div><label>Presupuesto máx (USD)</label><input type="number" name="presupuesto_max"></div>
        </div>
        <div class="fila">
          <div><label>Eslora mín (m)</label><input type="number" step="0.1" name="eslora_min"></div>
          <div><label>Eslora máx (m)</label><input type="number" step="0.1" name="eslora_max"></div>
        </div>
        <label>Uso</label>
        <div>${USOS.map(u => `<label class="check" style="display:inline-flex;margin-right:14px"><input type="checkbox" name="uso" value="${u}"> ${u}</label>`).join('')}</div>
        <div class="fila tres">
          <div><label>Urgencia</label><select name="urgencia"><option value="">—</option><option>ya</option><option>en los próximos meses</option><option>mirando sin apuro</option></select></div>
          <div><label>Motor</label><select name="motor_tipo"><option>indistinto</option><option>fuera de borda</option><option>dentro-fuera</option><option>intraborda</option></select></div>
          <div><label>HP mínimo</label><input type="number" name="hp_min"></div>
        </div>
        <label class="check"><input type="checkbox" name="necesita_bano"> Necesita baño (diferencia real entre open y cuddy)</label>
        <label class="check"><input type="checkbox" name="necesita_trailer"> Necesita trailer</label>
        <label class="check"><input type="checkbox" name="entrega_algo"> Entrega algo en parte de pago</label>
        <label>Limitación declarada (lo que le falta o le molesta)</label>
        <input type="text" name="limitacion_declarada">
        <label>Contexto personal (familia, guardería, qué contó)</label>
        <input type="text" name="contexto_personal">
        <button class="btn" style="margin-top:18px" type="submit">Guardar búsqueda</button>
      </form>
    </div>`;

  const form = document.getElementById('form-busqueda');
  const llenarForm = (d) => {
    if (d.nombre) form.nombre.value = d.nombre;
    if (d.telefono) form.telefono.value = d.telefono;
    form.querySelectorAll('input[name=tipo]').forEach(c => c.checked = (d.tipo_embarcacion || []).includes(c.value));
    form.querySelectorAll('input[name=uso]').forEach(c => c.checked = (d.uso_declarado || []).includes(c.value));
    ['presupuesto_min', 'presupuesto_max', 'eslora_min', 'eslora_max', 'hp_min'].forEach(k => { if (d[k] != null) form[k].value = d[k]; });
    if (d.urgencia) form.urgencia.value = d.urgencia;
    if (d.motor_tipo) form.motor_tipo.value = d.motor_tipo;
    form.necesita_bano.checked = !!d.necesita_bano;
    form.necesita_trailer.checked = !!d.necesita_trailer;
    form.entrega_algo.checked = !!d.entrega_algo;
    if (d.limitacion_declarada) form.limitacion_declarada.value = d.limitacion_declarada;
    if (d.contexto_personal) form.contexto_personal.value = d.contexto_personal;
    form.dataset.modeloReferencia = d.modelo_referencia || '';
    form.dataset.marcas = JSON.stringify(d.marcas_preferidas || []);
  };

  const mostrarExtraccion = (d) => {
    document.getElementById('resultado-extraccion').innerHTML = `
      <div class="resultado-extraccion">
        <strong style="font-size:0.8rem">Búsqueda detectada ${d._fuente === 'ia' ? '(IA)' : '(modo sin conexión)'}</strong> — ya está cargada en el formulario, revisala y guardá.
        <dl>
          ${d.nombre ? `<dt>Nombre</dt><dd>${esc(d.nombre)}</dd>` : ''}
          ${(d.tipo_embarcacion || []).length ? `<dt>Tipo</dt><dd>${esc(d.tipo_embarcacion.join(', '))}</dd>` : ''}
          ${d.modelo_referencia ? `<dt>Modelo que nombró</dt><dd>${esc(d.modelo_referencia)} — el matching le ofrece también la misma línea (más chicas y más grandes)</dd>` : ''}
          ${d.presupuesto_max ? `<dt>Presupuesto</dt><dd>${d.presupuesto_min ? usd(d.presupuesto_min) + ' – ' : 'hasta '}${usd(d.presupuesto_max)}</dd>` : ''}
          ${d.eslora_min || d.eslora_max ? `<dt>Eslora</dt><dd>${d.eslora_min || '?'} – ${d.eslora_max || '?'} m</dd>` : ''}
          ${(d.uso_declarado || []).length ? `<dt>Uso</dt><dd>${esc(d.uso_declarado.join(', '))}</dd>` : ''}
          ${d.necesita_bano ? `<dt>Baño</dt><dd>sí, lo necesita</dd>` : ''}
          ${d.urgencia ? `<dt>Urgencia</dt><dd>${esc(d.urgencia)}</dd>` : ''}
          ${d.entrega_algo ? `<dt>Parte de pago</dt><dd>tiene algo para entregar</dd>` : ''}
          ${d.limitacion_declarada ? `<dt>Limitación declarada</dt><dd>"${esc(d.limitacion_declarada)}"</dd>` : ''}
          ${d.contexto_personal ? `<dt>Contexto personal</dt><dd>${esc(d.contexto_personal)}</dd>` : ''}
        </dl>
      </div>`;
  };

  document.getElementById('btn-extraer').onclick = async () => {
    const texto = document.getElementById('texto-libre').value.trim();
    if (!texto) return toast('Pegá primero el mensaje.');
    const btn = document.getElementById('btn-extraer');
    btn.disabled = true; btn.textContent = 'Extrayendo…';
    try {
      const d = await api('/api/extraer', { method: 'POST', body: { texto } });
      d.texto_original = texto;
      llenarForm(d); mostrarExtraccion(d);
      form.dataset.textoOriginal = texto;
    } catch (e) { toast('Error: ' + e.message); }
    btn.disabled = false; btn.textContent = 'Extraer con IA';
  };

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const f = form;
    const body = {
      nombre: f.nombre.value, telefono: f.telefono.value || null, instagram_handle: f.instagram_handle.value || null,
      origen: f.origen.value,
      tipo_embarcacion: [...f.querySelectorAll('input[name=tipo]:checked')].map(c => c.value),
      uso_declarado: [...f.querySelectorAll('input[name=uso]:checked')].map(c => c.value),
      presupuesto_min: f.presupuesto_min.value ? +f.presupuesto_min.value : null,
      presupuesto_max: f.presupuesto_max.value ? +f.presupuesto_max.value : null,
      eslora_min: f.eslora_min.value ? +f.eslora_min.value : null,
      eslora_max: f.eslora_max.value ? +f.eslora_max.value : null,
      hp_min: f.hp_min.value ? +f.hp_min.value : null,
      urgencia: f.urgencia.value || null, motor_tipo: f.motor_tipo.value,
      necesita_bano: f.necesita_bano.checked, necesita_trailer: f.necesita_trailer.checked,
      entrega_algo: f.entrega_algo.checked,
      limitacion_declarada: f.limitacion_declarada.value || null,
      contexto_personal: f.contexto_personal.value || null,
      texto_original: form.dataset.textoOriginal || null,
      modelo_referencia: form.dataset.modeloReferencia || null,
      marcas_preferidas: form.dataset.marcas ? JSON.parse(form.dataset.marcas) : [],
    };
    const r = await api('/api/busquedas', { method: 'POST', body });
    if (r.propuestas && r.propuestas.length) setTimeout(() => toast(`🎯 Ya hay ${r.propuestas.length} embarcación${r.propuestas.length > 1 ? 'es' : ''} en stock que le sirve${r.propuestas.length > 1 ? 'n' : ''}: quedaron para aprobar en Hoy.`), 4300);
    toast(`Búsqueda guardada para ${r.persona_nombre}${r.persona_creada ? ' (persona nueva)' : ' (ya estaba en la base — deduplicada por teléfono)'}.`);
    location.hash = '#/persona/' + r.persona_id;
  };

  if (prefill) { llenarForm(prefill.extraido); document.getElementById('texto-libre').value = prefill.texto; mostrarExtraccion(prefill.extraido); form.dataset.textoOriginal = prefill.texto; }
};

/* ==================== ALTA DE EMBARCACIÓN ==================== */
rutas['alta-embarcacion'] = async () => {
  vista.innerHTML = `
    <h1>Alta de embarcación</h1>
    <p class="sub">Al guardar, el motor de coincidencias busca al instante a quién le sirve y redacta el mensaje para cada candidato.</p>
    <form class="card" id="form-emb" style="max-width:760px">
      <div class="fila tres">
        <div><label>Tipo</label><select name="tipo">${TIPOS.map(t => `<option>${t}</option>`).join('')}</select></div>
        <div><label>Marca</label><input type="text" name="marca" required placeholder="Quicksilver"></div>
        <div><label>Modelo</label><input type="text" name="modelo" required placeholder="1800"></div>
      </div>
      <div class="fila tres">
        <div><label>Año</label><input type="number" name="anio"></div>
        <div><label>Eslora (m)</label><input type="number" step="0.1" name="eslora"></div>
        <div><label>Manga (m)</label><input type="number" step="0.1" name="manga"></div>
      </div>
      <div class="fila tres">
        <div><label>Motor marca</label><input type="text" name="motor_marca"></div>
        <div><label>HP</label><input type="number" name="motor_hp"></div>
        <div><label>Horas</label><input type="number" name="motor_horas"></div>
      </div>
      <div class="fila tres">
        <div><label>Motor tipo</label><select name="motor_tipo"><option>fuera de borda</option><option>dentro-fuera</option><option>intraborda</option></select></div>
        <div><label>Precio pedido (USD)</label><input type="number" name="precio_pedido" required></div>
        <div><label>Mínimo aceptado (USD, privado)</label><input type="number" name="precio_minimo_aceptado"></div>
      </div>
      <div class="fila">
        <div><label>Estado general</label><select name="estado_general"><option>excelente</option><option selected>muy bueno</option><option>bueno</option><option>a reacondicionar</option></select></div>
        <div><label>Equipamiento (separado por comas)</label><input type="text" name="equipamiento" placeholder="ecosonda, toldo, estéreo"></div>
      </div>
      <label class="check"><input type="checkbox" name="tiene_bano"> Tiene baño</label>
      <label class="check"><input type="checkbox" name="tiene_trailer"> Incluye trailer</label>
      <div class="fila">
        <div><label>Propietario (nombre)</label><input type="text" name="propietario_nombre"></div>
        <div><label>Teléfono del propietario</label><input type="text" name="propietario_telefono"></div>
      </div>
      <div class="fila">
        <div><label>Exclusividad</label><select name="exclusividad"><option>exclusiva</option><option>compartida con otros brokers</option><option>abierta</option><option selected>a confirmar</option></select></div>
        <div><label>Papeles</label><select name="papeles_estado"><option>al día</option><option>falta algo menor</option><option>falta bastante</option><option selected>sin revisar</option></select></div>
      </div>
      <button class="btn" style="margin-top:18px" type="submit">Guardar y buscar candidatos</button>
    </form>`;

  document.getElementById('form-emb').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const body = {
      tipo: f.tipo.value, marca: f.marca.value, modelo: f.modelo.value,
      anio: f.anio.value ? +f.anio.value : null, eslora: f.eslora.value ? +f.eslora.value : null, manga: f.manga.value ? +f.manga.value : null,
      motor_marca: f.motor_marca.value || null, motor_hp: f.motor_hp.value ? +f.motor_hp.value : null,
      motor_horas: f.motor_horas.value ? +f.motor_horas.value : null, motor_tipo: f.motor_tipo.value,
      precio_pedido: +f.precio_pedido.value, precio_minimo_aceptado: f.precio_minimo_aceptado.value ? +f.precio_minimo_aceptado.value : null,
      estado_general: f.estado_general.value,
      equipamiento: f.equipamiento.value ? f.equipamiento.value.split(',').map(s => s.trim()).filter(Boolean) : [],
      tiene_bano: f.tiene_bano.checked, tiene_trailer: f.tiene_trailer.checked,
      propietario_nombre: f.propietario_nombre.value || null, propietario_telefono: f.propietario_telefono.value || null,
      exclusividad: f.exclusividad.value, papeles_estado: f.papeles_estado.value,
    };
    const r = await api('/api/embarcaciones', { method: 'POST', body });
    toast(r.candidatos ? `¡${r.candidatos} candidato${r.candidatos > 1 ? 's' : ''} encontrado${r.candidatos > 1 ? 's' : ''}! Mensajes listos para aprobar.` : 'Embarcación guardada. Sin candidatos por ahora.');
    location.hash = '#/embarcacion/' + r.embarcacion_id;
  };
};

/* ==================== OPERACIONES ==================== */
const ETAPAS = ['consulta', 'visita agendada', 'visita hecha', 'prueba de navegación', 'oferta', 'reserva/seña', 'papeles en trámite', 'cerrada', 'caída'];
rutas.operaciones = async () => {
  vista.innerHTML = '<div class="cargando">Cargando…</div>';
  const ops = await api('/api/operaciones');
  const activas = ops.filter(o => !['cerrada', 'caída'].includes(o.etapa));
  const cerradas = ops.filter(o => ['cerrada', 'caída'].includes(o.etapa));
  const valor = activas.reduce((a, o) => a + (o.precio_pedido || 0), 0);
  vista.innerHTML = `
    <h1>Operaciones</h1>
    <p class="sub">Cada operación vincula embarcación, comprador y vendedor — Leandro trabaja para las dos puntas.</p>
    <div class="kpis">
      <div class="kpi"><div class="valor">${activas.length}</div><div class="etiqueta">en curso</div></div>
      <div class="kpi"><div class="valor">${usd(valor)}</div><div class="etiqueta">valor involucrado</div></div>
      <div class="kpi"><div class="valor">${cerradas.filter(o => o.etapa === 'cerrada').length}</div><div class="etiqueta">cerradas</div></div>
    </div>
    <div class="card">
      <table>
        <tr><th>Embarcación</th><th>Etapa</th><th>Comprador</th><th>Vendedor</th><th>Precio</th><th>Inicio</th></tr>
        ${ops.map(o => `
          <tr>
            <td style="font-weight:600">${esc(o.embarcacion)}</td>
            <td>${chipEstado(o.etapa)}</td>
            <td>${esc(o.comprador || '—')}</td>
            <td>${esc(o.vendedor || '—')}</td>
            <td>${usd(o.precio_cierre || o.precio_pedido)}</td>
            <td style="color:var(--gris)">${fecha(o.fecha_primer_contacto)}</td>
          </tr>`).join('')}
      </table>
    </div>`;
};

/* ==================== SIMULAR PROMETHEO ==================== */
document.getElementById('btn-simular').onclick = async (ev) => {
  const btn = ev.target;
  btn.disabled = true; btn.textContent = 'Llegando mensaje…';
  try {
    const r = await api('/api/prometheo/simular', { method: 'POST', body: {} });
    toast(`Mensaje entrante de ${r.evento.contacto.nombre} por ${r.evento.contacto.canal} — búsqueda extraída con IA.`);
    location.hash = '#/alta-busqueda';
    setTimeout(() => rutas['alta-busqueda'](null, { texto: r.evento.texto, extraido: { ...r.extraido, nombre: r.evento.contacto.nombre, telefono: r.evento.contacto.telefono } }), 60);
  } catch (e) { toast('Error: ' + e.message); }
  btn.disabled = false; btn.textContent = 'Simular mensaje entrante';
};

// Contadores del menú: se cargan al arrancar y después de cada acción que los mueve
async function actualizarBadges() {
  try {
    const [hoy, busquedas, radar] = await Promise.all([api('/api/hoy'), api('/api/busquedas'), api('/api/radar')]);
    const set = (id, n) => { const b = document.getElementById(id); if (b) { b.hidden = !n; b.textContent = n; } };
    set('badge-hoy', hoy.sinResponder.length + hoy.propuestas.length);
    set('badge-busq', busquedas.filter(b => b.tiene_nueva_sin_ofrecer).length);
    set('badge-radar', radar.filter(a => a.bajas > 0 && !a.contactado).length);
  } catch {}
}
actualizarBadges();

navegar();
