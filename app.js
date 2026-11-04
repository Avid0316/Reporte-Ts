/*
 * Informe de inventario — lógica de la página.
 *
 * - Muestra los datos de datos.js (window.DATOS_INFORME).
 * - Los 12 meses del año se eligen arriba. En "Actualizar datos" se cargan las
 *   entradas de cada mes (reporte ENTRADAS del sistema) y el inventario general.
 * - "Guardar cambios" publica datos.js en GitHub (con un token del usuario) o lo
 *   descarga para subirlo a mano. Hasta entonces, los cambios viven en el navegador.
 * - Todas las cifras y los textos del informe se calculan de los datos.
 *
 * Formato de los datos:
 *   meta:    { corteInventario: "AAAA-MM-DD", fuenteInventario, meses: { "AAAA-MM": { fuente, cargado } } }
 *   entries: [{ fecha: "dd/mm/aaaa", tipo, equipo, cantidad, origen, recibe, categoria, proveedor? }]
 *   stock:   [{ equipo, sucursal, cantidad, marca, categoria, condicion }]
 */
(function () {
  'use strict';

  /* ---------- Configuración que se puede ajustar ---------- */

  // Sucursales conocidas (se comparan sin espacios, acentos ni mayúsculas).
  const BRANCHES = {
    towncenter: 'Town Center',
    cityplaza: 'City Plaza',
    novaprisa: 'Novaprisa',
    agalta: 'Agalta',
    trinidad: 'Trinidad',
    tallerdetalle: 'Taller/Detalle'
  };
  // Otros nombres que se cuentan como una sucursal o grupo.
  const BRANCH_ALIASES = {
    technologysales: 'Novaprisa',
    nathan: 'Novaprisa',
    cambiosdecelulares: 'Town / City / Agalta'
  };
  // Grupos que se muestran aparte (no compiten por "la sucursal con más cambios").
  const GROUPED = ['Town / City / Agalta'];
  const OTHER_ORIGIN = 'Otro origen';

  // Palabras que identifican un accesorio cuando no se conoce su categoría.
  // Insumos: no cuentan como equipos ni como accesorios; se listan aparte en el resumen.
  const SUPPLY_WORDS = ['HIDROGEL'];

  const ACCESSORY_WORDS = ['CABLE', 'CUBO', 'CARGADOR', 'ADAPTADOR', 'PENCIL', 'KEYBOARD', 'TECLADO',
    'FUNDA', 'CASE ', 'PROTECTOR', 'MICA', 'CORREA', 'MOUSE', 'AUDIFONO', 'POWER BANK'];

  // Cómo se nombran los "otros ingresos" en el texto del resumen: [singular, plural].
  const TYPE_LABELS = {
    'ENTRADA POR CAMBIO': ['entrada por cambio', 'entradas por cambio'],
    'INVENTARIO INICIAL': ['de inventario inicial', 'de inventario inicial'],
    'REINGRESO': ['reingreso', 'reingresos'],
    'RESAGADOS': ['resagado', 'resagados']
  };

  // Posibles nombres de columna (se comparan sin acentos, espacios ni mayúsculas; el primero que aparezca gana).
  const FIELDS = {
    // Entradas
    fecha: { label: 'Fecha', syn: ['fecha', 'fechadocumento', 'fechamovimiento', 'fechaingreso'] },
    tipo: { label: 'Tipo de ingreso', syn: ['nombreconceptoajuste', 'conceptoajuste', 'tipomovimiento', 'tipodeingreso', 'tipoingreso', 'tipo'] },
    equipo: { label: 'Equipo / producto', syn: ['nombreproducto', 'equipo', 'descripcion', 'descripcionproducto', 'articulo', 'producto'] },
    cantidad: { label: 'Cantidad', syn: ['cantidadvirtual', 'cantidad', 'unidades', 'cant', 'existencia', 'existencias', 'stock', 'disponible', 'saldo'] },
    origen: { label: 'Referencia (proveedor u origen del cambio)', syn: ['referencia', 'sucursalorigen', 'origen', 'proveedor'] },
    recibe: { label: 'Sucursal que recibe', syn: ['nombresucursal', 'sucursaldestino'] },
    // Inventario
    sucursal: { label: 'Sucursal', syn: ['nombresucursal', 'sucursal', 'tienda', 'bodega', 'almacen'] },
    marca: { label: 'Marca', syn: ['marca', 'referencia'] },
    categoria: { label: 'Categoría', syn: ['nombresubgrupoproducto', 'subgrupo', 'categoria'] },
    condicion: { label: 'Condición', syn: ['nombregrupoproducto', 'condicion', 'estado', 'grupo'] }
  };
  const KINDS = {
    entries: { label: 'Entradas', required: ['equipo', 'tipo'], optional: ['fecha', 'cantidad', 'origen', 'recibe'] },
    stock: { label: 'Inventario (existencias)', required: ['equipo', 'cantidad', 'sucursal'], optional: ['marca', 'categoria', 'condicion'] }
  };

  const STORE_KEY = 'informe-inventario-datos-v2';
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  /* ---------- Utilidades ---------- */

  const $ = id => document.getElementById(id);
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const up = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toUpperCase();
  const sum = rows => rows.reduce((a, r) => a + r.cantidad, 0);
  const pad = n => String(n).padStart(2, '0');
  const listJoin = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1];
  const plural = (n, one, many) => n === 1 ? one : many;
  const titleCase = s => s.toLowerCase().replace(/(^|[\s\/-])\p{L}/gu, c => c.toUpperCase());
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  function storageGet() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; } }
  function storageSet(v) { try { v ? localStorage.setItem(STORE_KEY, JSON.stringify(v)) : localStorage.removeItem(STORE_KEY); } catch (e) { /* sin almacenamiento */ } }

  function toNumber(v) {
    if (typeof v === 'number') return v;
    const s = String(v == null ? '' : v).trim().replace(/[^\d.,-]/g, '');
    if (!s) return NaN;
    return parseFloat(s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, ''));
  }

  function toDate(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number' && v > 20000 && window.XLSX) {
      const d = XLSX.SSF.parse_date_code(v);
      if (d) return pad(d.d) + '/' + pad(d.m) + '/' + d.y;
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
    if (m) return pad(m[1]) + '/' + pad(m[2]) + '/' + (m[3].length === 2 ? '20' + m[3] : m[3]);
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return pad(m[3]) + '/' + pad(m[2]) + '/' + m[1];
    return s;
  }
  const monthKey = fecha => { const m = String(fecha).match(/^\d{2}\/(\d{2})\/(\d{4})$/); return m ? m[2] + '-' + m[1] : ''; };
  const monthName = key => { const [y, m] = key.split('-'); return MESES[+m - 1] + ' ' + y; };
  const isoParts = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? { d: +m[3], m: +m[2], y: +m[1] } : null; };

  // "TechnologySales Town Center" -> "Town Center", "NOVA PRISA" -> "Novaprisa", "CAMBIOS DE CELULARES" -> "Town / City / Agalta"
  function canonBranch(v) {
    const raw = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
    if (!raw) return { name: '', known: false };
    let n = norm(raw);
    if (BRANCH_ALIASES[n]) return { name: BRANCH_ALIASES[n], known: true };
    if (n.startsWith('technologysales')) n = n.slice('technologysales'.length);
    if (BRANCHES[n]) return { name: BRANCHES[n], known: true };
    if (BRANCH_ALIASES[n]) return { name: BRANCH_ALIASES[n], known: true };
    return { name: raw === raw.toUpperCase() ? titleCase(raw) : raw, known: false };
  }

  // "13 PRO MAX 128GB VERDE" -> "13 PRO MAX 128GB"
  function modelOf(name) { const m = name.match(/^(.*?\d+\s*(GB|TB))\b/); return m ? m[1] : name; }

  /* ---------- Clasificación de entradas ---------- */

  let categoryOf = {}; // nombre de producto -> categoría (sale del inventario)
  function isAccessory(r) {
    const c = r.categoria || categoryOf[r.equipo];
    if (c) return norm(c).startsWith('accesorio');
    const n = ' ' + r.equipo + ' ';
    return ACCESSORY_WORDS.some(w => n.includes(w));
  }
  const isSupply = r => SUPPLY_WORDS.some(w => r.equipo.includes(w));
  const category = r => isSupply(r) ? 'supplies' : /COMPRA/.test(r.tipo) ? (isAccessory(r) ? 'accessories' : 'purchases')
    : (r.tipo === 'CAMBIOS' || r.tipo === 'CAMBIO') ? 'changes' : 'others';

  /* ---------- Lectura de Excel ---------- */

  function detectColumns(headers, fields) {
    const keys = headers.map(norm);
    const used = new Set(), map = {};
    for (const f of fields) {
      map[f] = null;
      const syn = FIELDS[f].syn;
      let idx = -1;
      for (const s of syn) { idx = keys.findIndex((k, i) => k === s && !used.has(i)); if (idx >= 0) break; }
      if (idx < 0) for (const s of syn) { if (s.length < 5) continue; idx = keys.findIndex((k, i) => k.startsWith(s) && !used.has(i)); if (idx >= 0) break; }
      if (idx >= 0) { map[f] = idx; used.add(idx); }
    }
    return map;
  }
  const kindFields = k => KINDS[k].required.concat(KINDS[k].optional);
  const complete = (k, map) => KINDS[k].required.every(f => map[f] != null);

  function analyseSheet(fileName, sheetName, rows) {
    let best = null;
    for (let r = 0; r < Math.min(25, rows.length); r++) {
      const headers = rows[r] || [];
      const maps = { entries: detectColumns(headers, kindFields('entries')), stock: detectColumns(headers, kindFields('stock')) };
      const score = Math.max(...['entries', 'stock'].map(k => Object.values(maps[k]).filter(v => v != null).length + (complete(k, maps[k]) ? 10 : 0)));
      if (!best || score > best.score) best = { row: r, maps, score };
    }
    const label = norm(fileName + ' ' + sheetName);
    let kind = 'ignore';
    const okE = complete('entries', best.maps.entries), okS = complete('stock', best.maps.stock);
    if (okS && (/inv|exist|stock|corte/.test(label) || !okE)) kind = 'stock';
    else if (okE) kind = 'entries';
    const headers = (rows[best.row] || []).map((h, i) => String(h).trim() || ('Columna ' + (i + 1)));
    return { fileName, sheetName, rows, headerRow: best.row, headers, maps: best.maps, kind };
  }

  function sheetIssues(s) {
    if (s.kind === 'ignore') return [];
    return KINDS[s.kind].required.filter(f => s.maps[s.kind][f] == null).map(f => FIELDS[f].label);
  }

  function parseSheet(s) {
    const m = s.maps[s.kind], out = [];
    const cell = (row, f) => m[f] == null ? '' : row[m[f]];
    for (let i = s.headerRow + 1; i < s.rows.length; i++) {
      const row = s.rows[i] || [];
      const equipo = up(cell(row, 'equipo'));
      if (!equipo) continue;
      if (s.kind === 'entries') {
        // Sin columna de cantidad, cada fila es una unidad (los reportes traen un IMEI por fila).
        const cantidad = m.cantidad == null ? 1 : toNumber(cell(row, 'cantidad'));
        if (!(cantidad > 0)) continue;
        const tipo = up(cell(row, 'tipo'));
        const r = { fecha: toDate(cell(row, 'fecha')), tipo, equipo, cantidad, origen: '', recibe: canonBranch(cell(row, 'recibe')).name };
        if (tipo === 'CAMBIOS' || tipo === 'CAMBIO') {
          const o = canonBranch(cell(row, 'origen'));
          r.origen = o.known ? o.name : OTHER_ORIGIN;
        } else if (/COMPRA/.test(tipo)) {
          const prov = String(cell(row, 'origen') == null ? '' : cell(row, 'origen')).trim().replace(/\s+/g, ' ');
          if (prov) r.proveedor = prov === prov.toUpperCase() ? titleCase(prov) : prov;
        }
        out.push(r);
      } else {
        const cantidad = toNumber(cell(row, 'cantidad'));
        if (isNaN(cantidad)) continue;
        out.push({
          equipo, cantidad,
          sucursal: canonBranch(cell(row, 'sucursal')).name,
          marca: up(cell(row, 'marca')),
          categoria: up(cell(row, 'categoria')),
          condicion: up(cell(row, 'condicion'))
        });
      }
    }
    return out;
  }

  // "Inventario_02.11.26.xlsx" -> "2026-11-02"
  function dateFromFileName(name) {
    const m = name.match(/(\d{1,2})[._-](\d{1,2})[._-](\d{2,4})(?!\d)/);
    if (!m) return '';
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return y + '-' + pad(m[2]) + '-' + pad(m[1]);
  }

  /* ---------- Estado ---------- */

  // Repositorio donde se guarda datos.js (en GitHub Pages se deduce de la dirección).
  const GITHUB_REPO = { owner: 'avid0316', repo: 'Reporte-Ts' };
  const TOKEN_KEY = 'informe-gh-token';

  let PUBLISHED = window.DATOS_INFORME || { meta: {}, entries: [], stock: [] };
  if (!PUBLISHED.meta) PUBLISHED.meta = {};
  let DATA = PUBLISHED, draft = null, month = '';
  let sheets = [], uploadKind = null, uploadMonth = '', baseForUpload = PUBLISHED;
  const TODAY = new Date();
  const CURRENT = TODAY.getFullYear() + '-' + pad(TODAY.getMonth() + 1);
  const todayIso = TODAY.getFullYear() + '-' + pad(TODAY.getMonth() + 1) + '-' + pad(TODAY.getDate());

  // Cambios sin guardar de este navegador: { data, changes: ['entradas de septiembre 2026', ...] }
  draft = storageGet();
  if (draft && draft.data && Array.isArray(draft.data.entries) && Array.isArray(draft.changes)) {
    if (JSON.stringify(draft.data) === JSON.stringify(PUBLISHED)) { draft = null; storageSet(null); } // ya está publicado
    else DATA = draft.data;
  } else draft = null;

  function setDraft(data, changes) {
    const list = draft ? draft.changes.filter(c => !changes.includes(c)) : [];
    draft = { data, changes: list.concat(changes) };
    DATA = data;
    storageSet(draft);
    renderAll();
  }
  function clearDraft() { draft = null; storageSet(null); DATA = PUBLISHED; renderAll(); }

  const isGoodsOnly = r => !['accessories', 'supplies'].includes(category(r));
  const monthsWithData = () => [...new Set(DATA.entries.map(r => monthKey(r.fecha)).filter(Boolean))].sort();
  const defaultMonth = () => { const l = monthsWithData(); return l[l.length - 1] || CURRENT; };
  const monthEntries = () => DATA.entries.filter(r => monthKey(r.fecha) === month);
  const fmtIso = iso => { const c = isoParts(iso); return c ? pad(c.d) + '/' + pad(c.m) + '/' + c.y : ''; };

  function tokenGet() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function tokenSet(v) { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch (e) { /* sin almacenamiento */ } }

  /* ---------- Render: meses y panel de datos ---------- */

  function renderMonths() {
    if (!month) month = defaultMonth();
    const year = +month.slice(0, 4);
    const years = [...new Set(monthsWithData().map(k => +k.slice(0, 4)).concat([TODAY.getFullYear(), year]))].sort();
    $('year').innerHTML = years.map(y => '<option>' + y + '</option>').join('');
    $('year').value = String(year);
    const counts = {};
    DATA.entries.forEach(r => { const k = monthKey(r.fecha); if (k) counts[k] = (counts[k] || 0) + (isGoodsOnly(r) ? r.cantidad : 0); });
    $('monthStrip').innerHTML = MESES.map((m, i) => {
      const key = year + '-' + pad(i + 1), has = key in counts;
      return '<button class="mbtn' + (has ? ' has' : '') + (key > CURRENT ? ' future' : '') + '" data-month="' + key + '" aria-pressed="' + (key === month) +
        '" title="' + cap(monthName(key)) + (has ? ': ' + counts[key] + ' equipos ingresados' : ': sin datos') + '"><span>' + cap(m.slice(0, 3)) +
        '</span><small>' + (has ? counts[key] : '—') + '</small></button>';
    }).join('');
  }

  function renderAdmin() {
    const list = monthsWithData();
    $('srcState').innerHTML = '<b>Meses con entradas:</b> ' + (list.length ? esc(list.map(k => cap(monthName(k))).join(', ')) : 'ninguno todavía') +
      ' · <b>Inventario:</b> ' + (DATA.stock.length ? (DATA.meta.corteInventario ? 'corte ' + fmtIso(DATA.meta.corteInventario) : 'sin fecha de corte') : 'sin cargar');
    const rows = monthEntries(), info = (DATA.meta.meses || {})[month];
    $('upMonth').textContent = monthName(month);
    $('upMonthState').textContent = rows.length
      ? 'Guardado: ' + rows.length + ' filas, ' + sum(rows.filter(isGoodsOnly)) + ' equipos' + (info && info.fuente ? ' (' + info.fuente + (info.cargado ? ', ' + fmtIso(info.cargado) : '') + ')' : '') + '. Cargar otro archivo lo reemplaza.'
      : 'Sin datos todavía.';
    $('stockState').textContent = DATA.stock.length
      ? DATA.stock.length + ' filas' + (DATA.meta.fuenteInventario ? ' · ' + DATA.meta.fuenteInventario : '') + '. Cargar otro archivo lo reemplaza.'
      : 'Sin cargar todavía.';
    $('corte').value = DATA.meta.corteInventario || '';

    const token = tokenGet(), repo = ghRepo();
    $('saveRow').hidden = !draft;
    if (draft) $('dirtyText').innerHTML = '<b>Cambios sin guardar:</b> ' + esc(listJoin(draft.changes)) + '. Solo se ven en este navegador.';
    $('saveBtn').textContent = token ? 'Guardar cambios' : 'Guardar (descargar datos.js)';
    $('ghState').textContent = token ? '· conectado' : '· sin conectar';
    $('ghForget').hidden = !token;
    $('ghRepoName').textContent = repo.owner + '/' + repo.repo;
    $('adminToggle').textContent = 'Actualizar datos' + (draft ? ' •' : '');
  }

  /* ---------- Render: resumen y cambios ---------- */

  function renderSummary() {
    const rows = monthEntries();
    const mName = monthName(month);
    const days = rows.map(r => +r.fecha.slice(0, 2)).filter(Boolean);
    $('sumEyebrow').textContent = 'ENTRADAS REGISTRADAS · ' + (days.length ? Math.min(...days) + '–' + Math.max(...days) + ' ' : '') + mName.toUpperCase();
    document.title = 'Informe mensual DZ · ' + mName;
    $('sumTitle').textContent = 'Resumen de ' + mName.split(' ')[0];

    const empty = !rows.length;
    $('sumEmpty').hidden = !empty; $('sumBody').hidden = empty;
    $('sumEmpty').innerHTML = 'No hay entradas cargadas para ' + esc(mName) + '.<br><span class="note">Para agregarlas: <b>Actualizar datos → Cargar Excel de entradas</b>.</span>';
    if (empty) return;

    const metrics = [['purchases', 'Dispositivos comprados'], ['changes', 'Equipos en cambio'], ['others', 'Reingresos y otros'], ['accessories', 'Accesorios comprados']];
    $('entryCards').innerHTML = metrics.map(([k, l]) =>
      '<button class="card" data-kind="' + k + '"><strong>' + sum(rows.filter(r => category(r) === k)) + '</strong><span>' + l + '</span></button>').join('');
    const devices = sum(rows.filter(isGoodsOnly)), accUnits = sum(rows.filter(r => category(r) === 'accessories'));
    $('entryTotal').textContent = devices + ' ' + plural(devices, 'equipo ingresado', 'equipos ingresados');
    $('entryAcc').textContent = accUnits ? ' + ' + accUnits + ' ' + plural(accUnits, 'accesorio', 'accesorios') : '';

    const c = isoParts(DATA.meta.corteInventario);
    $('sumText').textContent = 'Las entradas registradas describen los movimientos de ' + mName.split(' ')[0] + '. ' +
      (c ? 'Las existencias disponibles se consultan en el corte de inventario del ' + c.d + ' de ' + MESES[c.m - 1] + ' de ' + c.y + '.'
         : 'Las existencias disponibles se consultan en la pestaña de existencias.');

    const others = new Map();
    rows.filter(r => category(r) === 'others').forEach(r => others.set(r.tipo, (others.get(r.tipo) || 0) + r.cantidad));
    const parts = [...others].sort((a, b) => b[1] - a[1]).map(([t, n]) => {
      const lbl = TYPE_LABELS[t] || [t.toLowerCase(), t.toLowerCase()];
      return n + ' ' + plural(n, lbl[0], lbl[1]);
    });
    const acc = new Map();
    rows.filter(r => category(r) === 'accessories').forEach(r => acc.set(r.equipo, (acc.get(r.equipo) || 0) + r.cantidad));
    const accParts = [...acc].map(([name, n]) => n > 1 ? name + ' (' + n + ')' : name);
    const sup = new Map();
    rows.filter(r => category(r) === 'supplies').forEach(r => sup.set(r.equipo, (sup.get(r.equipo) || 0) + r.cantidad));
    const supParts = [...sup].map(([name, n]) => name + ' (' + n + ')');
    let note = '';
    if (parts.length) note += 'Reingresos y otros: ' + listJoin(parts) + '. ';
    if (accParts.length) note += 'Accesorios comprados: ' + listJoin(accParts) + '. ';
    if (supParts.length) note += 'Insumos (no se cuentan como equipos ni accesorios): ' + listJoin(supParts) + '.';
    $('sumNote').textContent = note;
    $('sumNote').hidden = !note;
    renderEntries();
  }

  function renderEntries() {
    const t = $('entryType').value, q = $('entrySearch').value.toLowerCase();
    const rows = monthEntries().filter(r => (t === 'all' || category(r) === t) && r.equipo.toLowerCase().includes(q));
    $('entryCount').textContent = rows.length + ' registros · ' + sum(rows) + ' unidades';
    $('entryRows').innerHTML = rows.map(r => '<tr><td>' + esc(r.fecha) + '</td><td>' + esc(r.equipo) + '</td><td>' + esc(r.tipo) + '</td><td>' +
      esc(r.origen || r.recibe || '') + '</td><td class="num">' + r.cantidad + '</td></tr>').join('') ||
      '<tr><td colspan="5" class="empty">No hay resultados con estos filtros.</td></tr>';
  }

  const isGroup = b => GROUPED.includes(b) || b === OTHER_ORIGIN;
  function changeBranches() {
    const counts = new Map();
    monthEntries().filter(r => category(r) === 'changes').forEach(r => {
      const b = r.origen || OTHER_ORIGIN;
      counts.set(b, (counts.get(b) || 0) + r.cantidad);
    });
    return [...counts].sort((a, b) => (isGroup(a[0]) - isGroup(b[0])) || (a[0] === OTHER_ORIGIN) - (b[0] === OTHER_ORIGIN) || b[1] - a[1]);
  }

  function renderChanges() {
    $('chgEyebrow').textContent = 'CAMBIOS REGISTRADOS · ' + monthName(month).toUpperCase();
    const empty = !monthEntries().length;
    $('chgEmpty').hidden = !empty; $('chgBody').hidden = empty;
    $('chgEmpty').innerHTML = 'No hay entradas cargadas para ' + esc(monthName(month)) + '.';
    if (empty) return;
    const list = changeBranches();
    const total = list.reduce((a, b) => a + b[1], 0);
    const max = Math.max(1, ...list.map(b => b[1]));
    $('chgTotal').textContent = total + ' ' + plural(total, 'equipo en cambio', 'equipos en cambio');
    $('bars').innerHTML = list.map(([b, n]) =>
      '<button class="barrow' + (isGroup(b) ? ' grouped' : '') + '" data-branch="' + esc(b) + '" aria-label="' + esc(b) + ': ' + n + ' ' + plural(n, 'equipo', 'equipos') +
      '. Ver detalle"><span>' + esc(b) + '</span><span class="track"><span class="fill" style="width:' + (n / max * 100) + '%"></span></span><b>' + n + '</b></button>').join('') ||
      '<p class="empty">No hay cambios registrados.</p>';

    const top = list.filter(b => !isGroup(b[0])).sort((a, b) => b[1] - a[1])[0];
    if (top && total) {
      $('chgBig').textContent = Math.round(top[1] / total * 100) + ' %';
      $('chgTop').textContent = 'corresponde a ' + top[0];
    } else { $('chgBig').textContent = '—'; $('chgTop').textContent = ''; }

    const notes = [];
    list.filter(b => GROUPED.includes(b[0])).forEach(([b, n]) =>
      notes.push('<p>' + (n === 1 ? 'El equipo de ' : 'Los ' + n + ' equipos de ') + esc(b) + (n === 1 ? ' se conserva agrupado' : ' se conservan agrupados') + ' (registrados como cambios de celulares).</p>'));
    const other = list.find(b => b[0] === OTHER_ORIGIN);
    if (other) notes.push('<p class="note">' + other[1] + ' ' + plural(other[1], 'equipo no indica', 'equipos no indican') + ' una sucursal de origen reconocible en la columna Referencia.</p>');
    $('chgNotes').innerHTML = notes.join('');

    const sel = $('changeBranch'), cur = sel.value;
    sel.innerHTML = '<option value="all">Todas</option>' + list.map(([b]) => '<option>' + esc(b) + '</option>').join('');
    sel.value = list.some(([b]) => b === cur) ? cur : 'all';
    renderChangeRows();
  }

  function renderChangeRows() {
    const b = $('changeBranch').value;
    const rows = monthEntries().filter(r => category(r) === 'changes' && (b === 'all' || (r.origen || OTHER_ORIGIN) === b));
    $('changeCount').textContent = sum(rows) + ' ' + plural(sum(rows), 'equipo', 'equipos');
    $('changeRows').innerHTML = rows.map(r => '<tr><td>' + esc(r.origen || OTHER_ORIGIN) + '</td><td>' + esc(r.equipo) + '</td><td>' + esc(r.fecha) +
      '</td><td>' + esc(r.recibe) + '</td><td class="num">' + r.cantidad + '</td></tr>').join('') || '<tr><td colspan="5" class="empty">No hay cambios registrados.</td></tr>';
  }

  /* ---------- Render: compras locales ---------- */

  let brandOf = {}; // nombre de producto -> marca (sale del inventario)
  const catLabel = r => category(r) === 'supplies' ? 'Insumos' : titleCase(r.categoria || categoryOf[r.equipo] || 'Sin categoría');
  const provLabel = r => r.proveedor || 'Sin proveedor';
  const brandLabel = r => { const b = brandOf[r.equipo]; return b ? (b === 'IPHONE' ? 'Apple' : titleCase(b)) : 'Sin dato'; };
  const groupSum = (rows, key) => {
    const m = new Map();
    rows.forEach(r => { const k = key(r); m.set(k, (m.get(k) || 0) + r.cantidad); });
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }));
  };
  const barsHtml = (list, attr) => {
    const max = Math.max(1, ...list.map(b => b[1]));
    return list.map(([k, n]) => '<button class="barrow" data-' + attr + '="' + esc(k) + '" aria-label="' + esc(k) + ': ' + n + ' ' + plural(n, 'unidad', 'unidades') +
      '. Ver detalle"><span>' + esc(k) + '</span><span class="track"><span class="fill" style="width:' + (n / max * 100) + '%"></span></span><b>' + n + '</b></button>').join('') ||
      '<p class="empty">Sin compras de dispositivos.</p>';
  };
  const monthPurchases = () => monthEntries().filter(r => /COMPRA/.test(r.tipo));
  function fillPlain(id, values, allLabel) {
    const sel = $(id), cur = sel.value;
    sel.innerHTML = '<option value="all">' + allLabel + '</option>' + values.map(v => '<option>' + esc(v) + '</option>').join('');
    sel.value = values.includes(cur) ? cur : 'all';
  }

  function renderPurchases() {
    $('purEyebrow').textContent = 'COMPRAS LOCALES · ' + monthName(month).toUpperCase();
    const empty = !monthEntries().length;
    $('purEmpty').hidden = !empty; $('purBody').hidden = empty;
    $('purEmpty').innerHTML = 'No hay entradas cargadas para ' + esc(monthName(month)) + '.';
    if (empty) return;
    const all = monthPurchases(), dev = all.filter(r => category(r) === 'purchases');
    $('purCards').innerHTML = [
      ['purchases', sum(dev), 'Dispositivos comprados'],
      ['accessories', sum(all.filter(r => category(r) === 'accessories')), 'Accesorios'],
      ['supplies', sum(all.filter(r => category(r) === 'supplies')), 'Insumos'],
      ['purchases', new Set(dev.map(r => modelOf(r.equipo))).size, 'Modelos distintos']
    ].map(([k, v, l]) => '<button class="card" data-ptype="' + k + '"><strong>' + v + '</strong><span>' + l + '</span></button>').join('');
    $('purCatBars').innerHTML = barsHtml(groupSum(dev, catLabel), 'pcat');
    $('purBrandBars').innerHTML = barsHtml(groupSum(dev, brandLabel), 'pbrand');
    const provs = groupSum(dev, provLabel).sort((a, b) => (a[0] === 'Sin proveedor') - (b[0] === 'Sin proveedor'));
    $('purProvBars').innerHTML = barsHtml(provs.slice(0, 10), 'pprov');
    $('purProvNote').textContent = 'Dispositivos comprados según la columna Referencia.' +
      (provs.length > 10 ? ' Se muestran los 10 con más unidades de ' + provs.length + ' proveedores.' : '');
    const cats = {};
    dev.forEach(r => { cats[modelOf(r.equipo)] = catLabel(r); });
    $('purTop').innerHTML = groupSum(dev, r => modelOf(r.equipo)).slice(0, 10).map(([m, n]) =>
      '<tr><td>' + esc(m) + '</td><td>' + esc(cats[m]) + '</td><td class="num"><b>' + n + '</b></td></tr>').join('') ||
      '<tr><td colspan="3" class="empty">Sin compras de dispositivos.</td></tr>';
    fillPlain('purCat', [...new Set(all.map(catLabel))].sort(), 'Todas');
    fillPlain('purBrand', [...new Set(all.map(brandLabel))].sort(), 'Todas');
    fillPlain('purBranch', [...new Set(all.map(r => r.recibe).filter(Boolean))].sort(), 'Todas');
    fillPlain('purProv', [...new Set(all.map(provLabel))].sort((a, b) => a.localeCompare(b)), 'Todos');
    renderPurchaseRows();
  }

  function renderPurchaseRows() {
    const t = $('purType').value, c = $('purCat').value, b = $('purBrand').value, s = $('purBranch').value, v = $('purProv').value, q = $('purSearch').value.toLowerCase();
    const rows = monthPurchases().filter(r => (t === 'all' || category(r) === t) && (c === 'all' || catLabel(r) === c) &&
      (b === 'all' || brandLabel(r) === b) && (s === 'all' || r.recibe === s) && (v === 'all' || provLabel(r) === v) &&
      (r.equipo.toLowerCase().includes(q) || provLabel(r).toLowerCase().includes(q)));
    $('purCount').textContent = rows.length + ' registros · ' + sum(rows) + ' unidades';
    $('purRows').innerHTML = rows.map(r => '<tr><td>' + esc(r.fecha) + '</td><td>' + esc(r.equipo) + '</td><td>' + esc(catLabel(r)) + '</td><td>' + esc(brandLabel(r)) +
      '</td><td>' + esc(provLabel(r)) + '</td><td>' + esc(r.recibe) + '</td><td class="num">' + r.cantidad + '</td></tr>').join('') ||
      '<tr><td colspan="7" class="empty">No hay resultados con estos filtros.</td></tr>';
  }

  /* ---------- Render: existencias ---------- */

  let shown = [];
  function fillSelect(id, values, allLabel, preferred) {
    const sel = $(id), cur = sel.dataset.touched ? sel.value : preferred;
    sel.innerHTML = '<option value="all">' + allLabel + '</option>' + values.map(v => '<option value="' + esc(v) + '">' + esc(v === 'IPHONE' ? 'iPhone' : titleCase(v)) + '</option>').join('');
    sel.value = values.includes(cur) ? cur : 'all';
    sel.closest('label').hidden = !values.length;
  }
  const distinct = (rows, k) => [...new Set(rows.map(r => r[k]).filter(Boolean))].sort();

  function stockRows(ignore) {
    const f = { marca: $('stockBrand').value, categoria: $('stockCat').value, condicion: $('stockCond').value };
    return DATA.stock.filter(r => Object.keys(f).every(k => k === ignore || f[k] === 'all' || r[k] === f[k]));
  }

  function renderStockFrame() {
    fillSelect('stockBrand', distinct(DATA.stock, 'marca'), 'Todas las marcas', 'IPHONE');
    fillSelect('stockCat', distinct(stockRows('categoria'), 'categoria'), 'Todas las categorías', 'CELULARES');
    fillSelect('stockCond', distinct(stockRows('condicion'), 'condicion'), 'Todas', 'all');
    const branches = distinct(stockRows(), 'sucursal');
    const sel = $('stockBranch'), cur = sel.value;
    sel.innerHTML = '<option value="all">Todas las sucursales</option>' + branches.map(b => '<option>' + esc(b) + '</option>').join('');
    sel.value = branches.includes(cur) ? cur : 'all';

    const c = isoParts(DATA.meta.corteInventario);
    const b = $('stockBrand').value, cat = $('stockCat').value, cond = $('stockCond').value;
    $('stockEyebrow').textContent = 'INVENTARIO' + (b !== 'all' ? ' ' + b : '') + (cat !== 'all' ? ' · ' + cat : '') + (cond !== 'all' ? ' · ' + cond : '') +
      (c ? ' · CORTE ' + pad(c.d) + ' ' + MESES[c.m - 1].toUpperCase() + ' ' + c.y : '');
    renderStock();
  }

  function aggregateStock(branch, byName) {
    const groups = new Map();
    for (const r of stockRows()) {
      if (branch !== 'all' && r.sucursal !== branch) continue;
      const name = byName ? r.equipo : modelOf(r.equipo);
      if (!groups.has(name)) groups.set(name, { name, quantity: 0 });
      groups.get(name).quantity += r.cantidad;
    }
    return [...groups.values()].sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  function renderStock() {
    let all = aggregateStock($('stockBranch').value, $('groupBy').value === 'name');
    if ($('hideZero').checked) all = all.filter(r => r.quantity > 0);
    $('stockCards').innerHTML = [
      ['0', all.filter(r => r.quantity <= 0).length, 'Grupos agotados'],
      ['1to4', all.filter(r => r.quantity > 0 && r.quantity < 5).length, 'Grupos con 1 a 4'],
      ['5to9', all.filter(r => r.quantity >= 5 && r.quantity < 10).length, 'Grupos con 5 a 9'],
      ['all', all.reduce((a, r) => a + r.quantity, 0), 'Unidades en existencia']
    ].map(([k, v, l]) => '<button class="card" data-level="' + k + '"><strong>' + v + '</strong><span>' + l + '</span></button>').join('');
    const t = $('threshold').value, q = $('stockSearch').value.toLowerCase();
    shown = all.filter(r => (t === 'all' || t === '0' && r.quantity <= 0 || t === '1to4' && r.quantity > 0 && r.quantity < 5 ||
      t === '5to9' && r.quantity >= 5 && r.quantity < 10 || t === '5' && r.quantity < 5 || t === '10' && r.quantity < 10) && r.name.toLowerCase().includes(q));
    $('stockCount').textContent = shown.length + ' grupos mostrados de ' + all.length + ' · ' + shown.reduce((a, r) => a + r.quantity, 0) + ' unidades en el resultado';
    $('stockRows').innerHTML = shown.map(r => '<tr><td>' + esc(r.name) + '</td><td class="num"><b>' + r.quantity + '</b></td><td><span class="tag ' +
      (r.quantity <= 0 ? 'red' : r.quantity < 5 ? 'amber' : '') + '">' + (r.quantity <= 0 ? 'Agotado' : r.quantity < 5 ? '1 a 4' : r.quantity < 10 ? '5 a 9' : '10 o más') +
      '</span></td></tr>').join('') || '<tr><td colspan="3" class="empty">No hay resultados con estos filtros.</td></tr>';
  }

  function renderMonthViews() { renderMonths(); renderAdmin(); renderSummary(); renderChanges(); renderPurchases(); }
  function renderAll() {
    categoryOf = {}; brandOf = {};
    DATA.stock.forEach(r => { if (r.categoria) categoryOf[r.equipo] = r.categoria; if (r.marca) brandOf[r.equipo] = r.marca; });
    renderStockFrame(); renderMonthViews();
  }

  /* ---------- Carga de Excel ---------- */

  const noQty = s => s.kind === 'entries' && s.maps.entries.cantidad == null;
  const NO_QTY_WARNING = '<p class="warn"><b>El archivo de entradas no trae la columna Cantidad.</b> Cada fila se cuenta como 1 unidad, así que las compras ' +
    'de varias unidades en una sola línea quedan cortas. Exporta el reporte sin borrar la columna Cantidad y vuelve a cargarlo.</p>';

  function renderReview() {
    const box = $('review');
    if (!sheets.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<h3>Archivo leído</h3><p class="note">Revisa que cada hoja tenga el uso y las columnas correctas. Los cambios se aplican al instante.</p>' +
      sheets.map((s, i) => {
        const issues = sheetIssues(s);
        const count = s.kind === 'ignore' || issues.length ? 0 : parseSheet(s).length;
        const status = s.kind === 'ignore' ? '<span class="tag">No se usa</span>'
          : issues.length ? '<span class="tag red">Falta: ' + esc(issues.join(', ')) + '</span>'
          : '<span class="tag ok">' + KINDS[s.kind].label + ' · ' + count + ' filas leídas</span>' +
            (noQty(s) ? ' <span class="tag amber">Sin columna Cantidad: cada fila cuenta como 1 unidad</span>' : '');
        const fields = s.kind === 'ignore' ? [] : kindFields(s.kind);
        return '<details class="sheet"' + (issues.length || s.kind === 'ignore' ? ' open' : '') + '><summary><b>' + esc(s.fileName) + (s.sheetName ? ' · ' + esc(s.sheetName) : '') +
          '</b> ' + status + '</summary><div class="filters"><label>Usar como<select data-i="' + i + '" data-k="kind">' +
          [['ignore', 'No usar'], ['entries', KINDS.entries.label], ['stock', KINDS.stock.label]].map(([v, l]) => '<option value="' + v + '"' + (s.kind === v ? ' selected' : '') + '>' + l + '</option>').join('') +
          '</select></label>' +
          fields.map(f => '<label>' + FIELDS[f].label + (KINDS[s.kind].required.includes(f) ? ' *' : '') + '<select data-i="' + i + '" data-f="' + f + '"><option value="">— sin columna —</option>' +
            s.headers.map((h, j) => '<option value="' + j + '"' + (s.maps[s.kind][f] === j ? ' selected' : '') + '>' + esc(h) + '</option>').join('') + '</select></label>').join('') +
          '</div></details>';
      }).join('');
  }

  function applySheets() {
    const usable = sheets.filter(s => s.kind !== 'ignore' && !sheetIssues(s).length);
    const entrySheets = usable.filter(s => s.kind === 'entries'), stockSheets = usable.filter(s => s.kind === 'stock');
    if (!usable.length) {
      $('loadMsg').innerHTML = '<span class="tag red">No se reconoció el archivo.</span> Indica abajo qué columna corresponde a cada dato.';
      return;
    }
    const base = baseForUpload;
    const data = { meta: Object.assign({}, base.meta), entries: base.entries, stock: base.stock };
    delete data.meta.fuente; delete data.meta.mes; // campos de versiones anteriores
    const done = [], changes = [];
    let problem = '', warn = '';

    if (stockSheets.length) {
      data.stock = [].concat(...stockSheets.map(parseSheet));
      data.meta.corteInventario = stockSheets.map(s => dateFromFileName(s.fileName)).find(Boolean) || $('corte').value || base.meta.corteInventario || '';
      data.meta.fuenteInventario = [...new Set(stockSheets.map(s => s.fileName))].join(', ');
      done.push('inventario: ' + data.stock.length + ' filas' + (data.meta.corteInventario ? ', corte ' + fmtIso(data.meta.corteInventario) : ''));
      changes.push('inventario');
    }

    if (entrySheets.length) {
      const all = [].concat(...entrySheets.map(parseSheet));
      const inMonth = all.filter(r => monthKey(r.fecha) === uploadMonth);
      const rest = new Map();
      all.filter(r => monthKey(r.fecha) !== uploadMonth).forEach(r => { const k = monthKey(r.fecha) || 'sin fecha'; rest.set(k, (rest.get(k) || 0) + 1); });
      const restText = [...rest].map(([k, n]) => n + ' de ' + (k === 'sin fecha' ? 'filas sin fecha' : monthName(k))).join(', ');
      if (!inMonth.length) {
        problem = '<span class="tag red">El archivo no tiene entradas de ' + esc(monthName(uploadMonth)) + '.</span> ' +
          (rest.size ? 'Trae filas de: ' + esc(restText) + '. Elige ese mes arriba y vuelve a cargarlo.' : '');
      } else {
        const replaced = base.entries.filter(r => monthKey(r.fecha) === uploadMonth).length;
        const cats = {};
        data.stock.forEach(r => { if (r.categoria) cats[r.equipo] = r.categoria; });
        inMonth.forEach(r => { r.categoria = cats[r.equipo] || ''; });
        data.entries = base.entries.filter(r => monthKey(r.fecha) !== uploadMonth).concat(inMonth);
        data.meta.meses = Object.assign({}, base.meta.meses, { [uploadMonth]: { fuente: [...new Set(entrySheets.map(s => s.fileName))].join(', '), cargado: todayIso } });
        done.push('entradas de ' + monthName(uploadMonth) + ': ' + inMonth.length + ' filas' + (replaced ? ' (reemplazan ' + replaced + ' anteriores)' : '') +
          (rest.size ? '; se ignoraron ' + esc(restText) : ''));
        changes.push('entradas de ' + monthName(uploadMonth));
        if (entrySheets.some(noQty)) warn = NO_QTY_WARNING;
      }
    }

    if (stockSheets.length) { // al cambiar el inventario, completa categorías que falten
      const cats = {};
      data.stock.forEach(r => { if (r.categoria) cats[r.equipo] = r.categoria; });
      data.entries = data.entries.map(r => r.categoria || !cats[r.equipo] ? r : Object.assign({}, r, { categoria: cats[r.equipo] }));
    }

    $('loadMsg').innerHTML = (done.length ? '<span class="tag ok">Cargado</span> ' + esc(done.join(' · ')) + '. Revisa el informe y pulsa <b>Guardar cambios</b>.' : '') +
      (problem ? (done.length ? '<br>' : '') + problem : '') + warn;
    if (changes.length) setDraft(data, changes);
  }

  async function loadFiles(files, forced) {
    if (!window.XLSX) { $('loadMsg').innerHTML = '<span class="tag red">No se pudo cargar el lector de Excel.</span>'; return; }
    $('loadMsg').textContent = 'Leyendo archivo…';
    baseForUpload = DATA; uploadKind = forced; uploadMonth = month;
    const fresh = [];
    for (const file of files) {
      try {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        for (const name of wb.SheetNames) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false });
          if (rows.length) fresh.push(analyseSheet(file.name, wb.SheetNames.length > 1 ? name : '', rows));
        }
      } catch (e) {
        $('loadMsg').innerHTML = '<span class="tag red">No se pudo leer ' + esc(file.name) + '.</span> ' + esc(e.message || '');
        return;
      }
    }
    if (forced) { // botón de entradas o de inventario: usa ese tipo en las hojas que lo cumplan
      const fits = fresh.filter(s => complete(forced, s.maps[forced]));
      fresh.forEach(s => { s.kind = fits.length ? (fits.includes(s) ? forced : 'ignore') : forced; });
    }
    sheets = fresh;
    renderReview();
    applySheets();
  }

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- Guardar ---------- */

  function serialize(data) {
    return '// Datos que muestra la página al abrirse. Se actualizan con "Guardar cambios".\nwindow.DATOS_INFORME = ' + JSON.stringify(data) + ';\n';
  }

  function ghRepo() {
    const h = location.hostname;
    if (h.endsWith('.github.io')) return { owner: h.split('.')[0], repo: location.pathname.split('/')[1] || h };
    return GITHUB_REPO;
  }
  function ghError(status, repo) {
    if (status === 401) return 'El token no es válido o ya expiró. Crea uno nuevo y vuelve a conectarlo.';
    if (status === 403) return 'El token no tiene permiso para escribir en ' + repo + ' (Contents: Read and write).';
    if (status === 404) return 'No se encontró ' + repo + ' o el token no tiene acceso a ese repositorio.';
    if (status === 409 || status === 422) return 'datos.js cambió en GitHub mientras tanto. Recarga la página y vuelve a intentarlo.';
    return 'GitHub respondió con un error (' + status + '). Inténtalo de nuevo en un momento.';
  }
  function b64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  async function ghRequest(path, token, opts) {
    const r = ghRepo();
    return fetch('https://api.github.com/repos/' + r.owner + '/' + r.repo + path, Object.assign({ cache: 'no-store' }, opts, {
      headers: Object.assign({ Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json' }, (opts || {}).headers)
    }));
  }
  async function ghPut(content, message) {
    const token = tokenGet(), r = ghRepo(), name = r.owner + '/' + r.repo;
    const cur = await ghRequest('/contents/datos.js', token, { headers: { Accept: 'application/vnd.github.object' } });
    if (!cur.ok && cur.status !== 404) throw new Error(ghError(cur.status, name));
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    const res = await ghRequest('/contents/datos.js', token, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: b64(content), sha })
    });
    if (!res.ok) throw new Error(ghError(res.status, name));
  }

  async function save() {
    if (!draft) return;
    const content = serialize(DATA);
    if (!tokenGet()) {
      download('datos.js', content, 'text/javascript;charset=utf-8');
      $('saveMsg').innerHTML = '<p class="warn">Se descargó <b>datos.js</b>. Súbelo al repositorio en GitHub (<i>Add file → Upload files</i>) reemplazando el anterior. ' +
        'Cuando la página publicada lo muestre, estos cambios dejarán de aparecer como pendientes. Para guardar con un clic, configura la conexión con GitHub.</p>';
      return;
    }
    $('saveBtn').disabled = true;
    $('saveMsg').innerHTML = '<p class="note">Guardando en GitHub…</p>';
    try {
      await ghPut(content, 'Actualizar datos del informe: ' + draft.changes.join(', '));
      PUBLISHED = DATA;
      draft = null; storageSet(null);
      $('saveMsg').innerHTML = '<p><span class="tag ok">Guardado</span> La página pública se actualiza en 1–2 minutos.</p>';
      sheets = []; renderReview(); $('loadMsg').textContent = '';
      renderAll();
    } catch (e) {
      $('saveMsg').innerHTML = '<p class="warn"><b>No se pudo guardar.</b> ' + esc(e.message || 'Error de conexión.') + ' Tus cambios siguen en este navegador.</p>';
    } finally { $('saveBtn').disabled = false; }
  }

  async function connectToken() {
    const token = $('ghToken').value.trim();
    if (!token) return;
    const r = ghRepo(), name = r.owner + '/' + r.repo;
    $('saveMsg').innerHTML = '<p class="note">Comprobando el token…</p>';
    try {
      const res = await ghRequest('', token);
      if (!res.ok) throw new Error(ghError(res.status, name));
      const info = await res.json();
      if (info.permissions && !info.permissions.push) throw new Error(ghError(403, name));
      tokenSet(token); $('ghToken').value = '';
      $('saveMsg').innerHTML = '<p><span class="tag ok">Conectado</span> Ya puedes guardar directamente en ' + esc(name) + '.</p>';
    } catch (e) {
      $('saveMsg').innerHTML = '<p class="warn"><b>No se pudo conectar.</b> ' + esc(e.message || 'Error de conexión.') + '</p>';
    }
    renderAdmin();
  }

  /* ---------- Eventos ---------- */

  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    document.querySelectorAll('main>section[role=tabpanel]').forEach(s => s.hidden = s.id !== b.dataset.tab);
    document.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', x === b));
  });
  document.querySelectorAll('.print').forEach(b => b.onclick = () => window.print());

  $('monthStrip').addEventListener('click', e => {
    const b = e.target.closest('[data-month]'); if (!b) return;
    month = b.dataset.month; renderMonthViews();
  });
  $('year').addEventListener('change', () => { month = $('year').value + '-' + month.slice(5); renderMonthViews(); });
  $('adminToggle').addEventListener('click', () => {
    const open = $('dataPanel').hidden;
    $('dataPanel').hidden = !open; $('adminToggle').setAttribute('aria-expanded', open);
  });

  $('entryCards').addEventListener('click', e => {
    const b = e.target.closest('[data-kind]'); if (!b) return;
    $('entryType').value = b.dataset.kind; renderEntries(); $('entryType').focus();
  });
  ['entryType', 'entrySearch'].forEach(id => $(id).addEventListener('input', renderEntries));

  $('bars').addEventListener('click', e => {
    const b = e.target.closest('[data-branch]'); if (!b) return;
    $('changeBranch').value = b.dataset.branch; renderChangeRows();
  });
  $('changeBranch').addEventListener('change', renderChangeRows);

  const purFilter = (vals) => { Object.keys(vals).forEach(id => { $(id).value = vals[id]; }); renderPurchaseRows(); $('purRows').closest('.panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $('purCards').addEventListener('click', e => { const b = e.target.closest('[data-ptype]'); if (b) purFilter({ purType: b.dataset.ptype, purCat: 'all', purBrand: 'all', purProv: 'all' }); });
  $('purCatBars').addEventListener('click', e => { const b = e.target.closest('[data-pcat]'); if (b) purFilter({ purType: 'purchases', purCat: b.dataset.pcat, purBrand: 'all', purProv: 'all' }); });
  $('purProvBars').addEventListener('click', e => { const b = e.target.closest('[data-pprov]'); if (b) purFilter({ purType: 'purchases', purCat: 'all', purBrand: 'all', purProv: b.dataset.pprov }); });
  $('purBrandBars').addEventListener('click', e => { const b = e.target.closest('[data-pbrand]'); if (b) purFilter({ purType: 'purchases', purCat: 'all', purBrand: b.dataset.pbrand, purProv: 'all' }); });
  ['purType', 'purCat', 'purBrand', 'purBranch', 'purProv', 'purSearch'].forEach(id => $(id).addEventListener('input', renderPurchaseRows));

  $('stockCards').addEventListener('click', e => {
    const b = e.target.closest('[data-level]'); if (!b) return;
    $('threshold').value = b.dataset.level; renderStock();
  });
  ['threshold', 'stockBranch', 'groupBy', 'stockSearch', 'hideZero'].forEach(id => $(id).addEventListener('input', renderStock));
  ['stockBrand', 'stockCat', 'stockCond'].forEach(id => $(id).addEventListener('change', () => {
    $(id).dataset.touched = '1'; renderStockFrame(); renderSummary();
  }));

  $('export').onclick = () => {
    const cell = v => '"' + String(v).replace(/"/g, '""') + '"';
    const csv = '﻿' + [['Equipo', 'Existencias'], ...shown.map(r => [r.name, r.quantity])].map(r => r.map(cell).join(';')).join('\r\n');
    const c = DATA.meta.corteInventario ? '-' + DATA.meta.corteInventario.split('-').reverse().join('-') : '';
    download('existencias' + c + '.csv', csv, 'text/csv;charset=utf-8');
  };

  $('entriesInput').addEventListener('change', e => { if (e.target.files.length) loadFiles([...e.target.files], 'entries'); e.target.value = ''; });
  $('stockInput').addEventListener('change', e => { if (e.target.files.length) loadFiles([...e.target.files], 'stock'); e.target.value = ''; });
  const drop = $('dataPanel');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('dragging'); }));
  drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) loadFiles([...e.dataTransfer.files], null); });

  $('review').addEventListener('change', e => {
    const el = e.target, s = sheets[+el.dataset.i]; if (!s) return;
    if (el.dataset.k === 'kind') s.kind = el.value;
    else if (el.dataset.f) s.maps[s.kind][el.dataset.f] = el.value === '' ? null : +el.value;
    renderReview(); applySheets();
  });

  $('corte').addEventListener('change', () => {
    const meta = Object.assign({}, DATA.meta, { corteInventario: $('corte').value });
    setDraft(Object.assign({}, DATA, { meta }), ['fecha de corte del inventario']);
  });

  $('saveBtn').addEventListener('click', save);
  $('discardBtn').addEventListener('click', () => {
    if (!confirm('¿Descartar los cambios sin guardar? Se volverá a los datos publicados.')) return;
    sheets = []; renderReview(); $('loadMsg').textContent = ''; $('saveMsg').textContent = '';
    clearDraft();
  });
  $('ghSaveToken').addEventListener('click', connectToken);
  $('ghForget').addEventListener('click', () => { tokenSet(''); $('saveMsg').textContent = ''; renderAdmin(); });

  if (draft) { $('dataPanel').hidden = false; $('adminToggle').setAttribute('aria-expanded', 'true'); }
  renderAll();
})();
