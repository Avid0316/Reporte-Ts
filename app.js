/*
 * Informe de inventario — lógica de la página.
 *
 * - Muestra los datos de datos.js (window.DATOS_INFORME).
 * - Permite cargar uno o varios Excel/CSV: detecta solo qué hoja son las
 *   entradas del mes y cuál el inventario, y qué columna es cada dato.
 * - Todas las cifras y los textos del informe se calculan de los datos.
 *
 * Formato de los datos:
 *   meta:    { fuente, corteInventario: "AAAA-MM-DD" }
 *   entries: [{ fecha: "dd/mm/aaaa", documento, tipo, equipo, cantidad, sucursal, accesorio, alias? }]
 *   stock:   [{ equipo, sucursal, cantidad }]
 */
(function () {
  'use strict';

  /* ---------- Configuración que se puede ajustar ---------- */

  // Nombres de sucursal que deben contarse como otra sucursal.
  const BRANCH_ALIASES = {
    nathan: 'Novaprisa',
    technologysales: 'Novaprisa'
  };

  // Palabras que identifican un accesorio cuando el Excel no trae columna "Accesorio".
  const ACCESSORY_WORDS = ['CABLE', 'CUBO', 'CARGADOR', 'ADAPTADOR', 'PENCIL', 'KEYBOARD', 'TECLADO',
    'FUNDA', 'CASE ', 'PROTECTOR', 'MICA', 'CORREA', 'MOUSE', 'AUDIFONO', 'POWER BANK'];

  // Cómo se nombran los "otros ingresos" en el texto del resumen: [singular, plural].
  const TYPE_LABELS = {
    'ENTRADA POR CAMBIO': ['entrada por cambio', 'entradas por cambio'],
    'INVENTARIO INICIAL': ['de inventario inicial', 'de inventario inicial'],
    'REINGRESO': ['reingreso', 'reingresos'],
    'REINGRESOS': ['reingreso', 'reingresos'],
    'RESAGADO': ['resagado', 'resagados'],
    'RESAGADOS': ['resagado', 'resagados']
  };

  // Posibles nombres de columna (se comparan sin acentos, espacios ni mayúsculas).
  const FIELDS = {
    fecha: { label: 'Fecha', syn: ['fecha', 'fechadocumento', 'fechamovimiento', 'fechaingreso', 'fechaentrada', 'date'] },
    documento: { label: 'Documento', syn: ['documento', 'nodocumento', 'numdocumento', 'numerodocumento', 'nodoc', 'numdoc', 'doc', 'correlativo', 'numero', 'no'] },
    tipo: { label: 'Tipo de ingreso', syn: ['tipo', 'tipomovimiento', 'tipodeingreso', 'tipoingreso', 'tipoentrada', 'concepto', 'movimiento', 'motivo', 'tipodocumento'] },
    equipo: { label: 'Equipo / producto', syn: ['equipo', 'producto', 'nombreproducto', 'descripcion', 'descripcionproducto', 'articulo', 'nombre', 'item', 'modelo'] },
    cantidad: { label: 'Cantidad / existencia', syn: ['cantidad', 'unidades', 'cant', 'qty', 'existencia', 'existencias', 'stock', 'disponible', 'saldo'] },
    sucursal: { label: 'Sucursal / origen', syn: ['sucursalorigen', 'origen', 'nombresucursal', 'sucursal', 'tienda', 'bodega', 'almacen'] },
    accesorio: { label: 'Accesorio (sí/no)', syn: ['accesorio', 'esaccesorio', 'categoria', 'tipoproducto'] }
  };
  const KINDS = {
    entries: { label: 'Entradas del mes', required: ['equipo', 'cantidad', 'tipo'], optional: ['fecha', 'documento', 'sucursal', 'accesorio'] },
    stock: { label: 'Inventario (existencias)', required: ['equipo', 'cantidad', 'sucursal'], optional: [] }
  };

  const STORE_KEY = 'informe-inventario-datos-v1';
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
    if (v instanceof Date && !isNaN(v)) return pad(v.getDate()) + '/' + pad(v.getMonth() + 1) + '/' + v.getFullYear();
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
    if (m) return pad(m[1]) + '/' + pad(m[2]) + '/' + (m[3].length === 2 ? '20' + m[3] : m[3]);
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return pad(m[3]) + '/' + pad(m[2]) + '/' + m[1];
    return s;
  }
  function parseDmy(s) {
    const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? { d: +m[1], m: +m[2], y: +m[3], key: m[3] + m[2] + m[1] } : null;
  }
  function longDate(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? { d: +m[3], m: +m[2], y: +m[1] } : null;
  }

  function titleCase(s) { return s.toLowerCase().replace(/(^|[\s\/-])\p{L}/gu, c => c.toUpperCase()); }
  function canonBranch(v) {
    let s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
    if (!s) return { name: '', alias: null };
    const alias = BRANCH_ALIASES[norm(s)];
    if (alias) return { name: alias, alias: s === s.toUpperCase() ? titleCase(s) : s };
    if (s === s.toUpperCase()) s = titleCase(s);
    return { name: s, alias: null };
  }

  function isAccessoryName(name) { const n = ' ' + name + ' '; return ACCESSORY_WORDS.some(w => n.includes(w)); }
  function isAccessoryValue(v) {
    const n = norm(v);
    return ['si', 'true', '1', 'x', 'yes'].includes(n) || n.includes('accesorio');
  }

  // "13 PRO MAX 128GB VERDE" -> "13 PRO MAX 128GB"
  function modelOf(name) { const m = name.match(/^(.*?\d+\s*(GB|TB))\b/); return m ? m[1] : name; }
  // iPhone: el nombre empieza con el número de generación ("13 PRO MAX…", "IPHONE 15…").
  function isIphone(name) { return /^(IPHONE\s*)?\d{1,2}\s/.test(name); }

  const category = r => /COMPRA/.test(r.tipo) ? (r.accesorio ? 'accessories' : 'purchases')
    : (r.tipo === 'CAMBIOS' || r.tipo === 'CAMBIO') ? 'changes' : 'others';

  /* ---------- Lectura de Excel ---------- */

  function detectColumns(headers) {
    const keys = headers.map(norm);
    const used = new Set(), map = {};
    for (const f of Object.keys(FIELDS)) {
      map[f] = null;
      const syn = FIELDS[f].syn;
      let idx = -1;
      for (const s of syn) { idx = keys.findIndex((k, i) => k && k === s && !used.has(i)); if (idx >= 0) break; }
      if (idx < 0) for (const s of syn) { if (s.length < 4) continue; idx = keys.findIndex((k, i) => k && k.startsWith(s) && !used.has(i)); if (idx >= 0) break; }
      if (idx >= 0) { map[f] = idx; used.add(idx); }
    }
    return map;
  }

  function guessKind(sheetName, map) {
    const ok = k => KINDS[k].required.every(f => map[f] != null);
    const n = norm(sheetName);
    if (/inv|exist|stock|corte/.test(n) && ok('stock')) return 'stock';
    if (/entrada|ingreso|mov|compra/.test(n) && ok('entries')) return 'entries';
    if (ok('entries')) return 'entries';
    if (ok('stock')) return 'stock';
    return 'ignore';
  }

  function analyseSheet(fileName, sheetName, rows) {
    let best = { row: 0, map: detectColumns(rows[0] || []), score: -1 };
    for (let r = 0; r < Math.min(25, rows.length); r++) {
      const map = detectColumns(rows[r] || []);
      const score = Object.values(map).filter(v => v != null).length;
      if (score > best.score) best = { row: r, map, score };
    }
    const headers = (rows[best.row] || []).map((h, i) => String(h).trim() || ('Columna ' + (i + 1)));
    return { fileName, sheetName, rows, headerRow: best.row, headers, map: best.map, kind: guessKind(sheetName, best.map) };
  }

  function sheetIssues(s) {
    if (s.kind === 'ignore') return [];
    return KINDS[s.kind].required.filter(f => s.map[f] == null).map(f => FIELDS[f].label);
  }

  function parseSheet(s) {
    const m = s.map, out = [];
    const cell = (row, f) => m[f] == null ? '' : row[m[f]];
    for (let i = s.headerRow + 1; i < s.rows.length; i++) {
      const row = s.rows[i] || [];
      const equipo = up(cell(row, 'equipo'));
      const cantidad = toNumber(cell(row, 'cantidad'));
      if (!equipo || isNaN(cantidad)) continue;
      if (s.kind === 'entries') {
        if (cantidad <= 0) continue;
        const b = canonBranch(cell(row, 'sucursal'));
        const r = {
          fecha: toDate(cell(row, 'fecha')),
          documento: String(cell(row, 'documento') == null ? '' : cell(row, 'documento')).trim(),
          tipo: up(cell(row, 'tipo')),
          equipo, cantidad,
          sucursal: b.name,
          accesorio: m.accesorio != null ? isAccessoryValue(cell(row, 'accesorio')) : isAccessoryName(equipo)
        };
        if (b.alias) r.alias = b.alias;
        out.push(r);
      } else {
        if (cantidad < 0) continue;
        out.push({ equipo, sucursal: canonBranch(cell(row, 'sucursal')).name, cantidad });
      }
    }
    return out;
  }

  /* ---------- Estado ---------- */

  const PUBLISHED = window.DATOS_INFORME || { meta: {}, entries: [], stock: [] };
  let DATA = PUBLISHED, fromExcel = false;
  let sheets = [], baseForUpload = PUBLISHED;

  const saved = storageGet();
  if (saved && saved.data && Array.isArray(saved.data.entries)) { DATA = saved.data; fromExcel = true; }

  function setData(data, excel) {
    DATA = data; fromExcel = excel;
    storageSet(excel ? { data, savedAt: new Date().toISOString() } : null);
    renderAll();
  }

  /* ---------- Textos derivados ---------- */

  function period(entries) {
    const ds = entries.map(r => parseDmy(r.fecha)).filter(Boolean).sort((a, b) => a.key < b.key ? -1 : 1);
    if (!ds.length) return { eyebrow: '', month: null, label: 'del período' };
    const a = ds[0], b = ds[ds.length - 1];
    if (a.y === b.y && a.m === b.m) {
      return { eyebrow: a.d + '–' + b.d + ' ' + MESES[a.m - 1].toUpperCase() + ' ' + a.y, month: MESES[a.m - 1] + ' ' + a.y, label: 'de ' + MESES[a.m - 1] };
    }
    return {
      eyebrow: a.d + ' ' + MESES[a.m - 1].toUpperCase() + ' ' + a.y + ' – ' + b.d + ' ' + MESES[b.m - 1].toUpperCase() + ' ' + b.y,
      month: null, label: 'del período'
    };
  }

  /* ---------- Render ---------- */

  function renderSource() {
    const n = DATA.entries.length, s = DATA.stock.length;
    $('srcState').innerHTML = fromExcel
      ? '<b>Datos cargados desde Excel</b> (' + esc(DATA.meta.fuente || 'archivo') + ') · ' + n + ' entradas · ' + s + ' filas de inventario. ' +
        '<span class="note">Solo se ven en este navegador hasta que publiques el archivo datos.js.</span>'
      : '<b>Datos publicados</b> · ' + n + ' entradas · ' + s + ' filas de inventario.';
    $('downloadData').hidden = !fromExcel;
    $('resetData').hidden = !fromExcel;
    $('corte').value = DATA.meta.corteInventario || '';
  }

  function renderSummary() {
    const p = period(DATA.entries);
    const subtitle = 'Entradas ' + p.label + ' y seguimiento de existencias' + ($('onlyIphone').checked ? ' de iPhone' : '');
    $('subtitle').textContent = subtitle;
    $('sumEyebrow').textContent = 'ENTRADAS REGISTRADAS' + (p.eyebrow ? ' · ' + p.eyebrow : '');
    document.title = 'TechnologySales — Informe de inventario' + (p.month ? ' · ' + p.month : '');

    const metrics = [['purchases', 'Dispositivos comprados'], ['changes', 'Equipos en cambio'], ['others', 'Otros ingresos'], ['accessories', 'Accesorios comprados']];
    $('entryCards').innerHTML = metrics.map(([k, l]) =>
      '<button class="card" data-kind="' + k + '"><strong>' + sum(DATA.entries.filter(r => category(r) === k)) + '</strong><span>' + l + '</span></button>').join('');
    $('entryTotal').textContent = sum(DATA.entries);

    const c = longDate(DATA.meta.corteInventario);
    $('sumText').textContent = 'Las entradas registradas describen los movimientos ' + (p.month ? 'de ' + p.month.split(' ')[0] : 'del período') + '. ' +
      (c ? 'Las existencias disponibles se consultan en el corte de inventario del ' + c.d + ' de ' + MESES[c.m - 1] + ' de ' + c.y + '.'
         : 'Las existencias disponibles se consultan en la pestaña de existencias.');

    const others = new Map();
    DATA.entries.filter(r => category(r) === 'others').forEach(r => others.set(r.tipo, (others.get(r.tipo) || 0) + r.cantidad));
    const parts = [...others].sort((a, b) => b[1] - a[1]).map(([t, n]) => {
      const lbl = TYPE_LABELS[t] || [t.toLowerCase(), t.toLowerCase()];
      return n + ' ' + plural(n, lbl[0], lbl[1]);
    });
    const acc = new Map();
    DATA.entries.filter(r => category(r) === 'accessories').forEach(r => acc.set(r.equipo, (acc.get(r.equipo) || 0) + r.cantidad));
    const accParts = [...acc].map(([name, n]) => n > 1 ? name + ' (' + n + ')' : name);
    let note = '';
    if (parts.length) note += 'Otros ingresos: ' + listJoin(parts) + '. ';
    if (accParts.length) note += 'Accesorios comprados: ' + listJoin(accParts) + '.';
    $('sumNote').textContent = note;
    $('sumNote').hidden = !note;

    const types = [...new Set(DATA.entries.map(category))];
    [...$('entryType').options].forEach(o => { o.hidden = o.value !== 'all' && !types.includes(o.value); });
    renderEntries();
  }

  function renderEntries() {
    const t = $('entryType').value, q = $('entrySearch').value.toLowerCase();
    const rows = DATA.entries.filter(r => (t === 'all' || category(r) === t) && r.equipo.toLowerCase().includes(q));
    $('entryCount').textContent = rows.length + ' registros · ' + sum(rows) + ' unidades';
    $('entryRows').innerHTML = rows.map(r => '<tr><td>' + esc(r.fecha) + '</td><td>' + esc(r.documento) + '</td><td>' + esc(r.equipo) + '</td><td>' + esc(r.tipo) +
      '</td><td class="num">' + r.cantidad + '</td></tr>').join('') || '<tr><td colspan="5" class="empty">No hay resultados con estos filtros.</td></tr>';
  }

  function changeBranches() {
    const counts = new Map();
    DATA.entries.filter(r => category(r) === 'changes').forEach(r => {
      const b = r.sucursal || 'Sin sucursal';
      counts.set(b, (counts.get(b) || 0) + r.cantidad);
    });
    return [...counts].sort((a, b) => (a[0].includes('/') - b[0].includes('/')) || b[1] - a[1]);
  }

  function renderChanges() {
    const p = period(DATA.entries);
    $('chgEyebrow').textContent = 'CAMBIOS REGISTRADOS' + (p.month ? ' · ' + p.month.toUpperCase() : p.eyebrow ? ' · ' + p.eyebrow : '');
    const list = changeBranches();
    const total = list.reduce((a, b) => a + b[1], 0);
    const max = Math.max(1, ...list.map(b => b[1]));
    $('chgTotal').textContent = total + ' ' + plural(total, 'equipo en cambio', 'equipos en cambio');
    $('bars').innerHTML = list.map(([b, n]) =>
      '<button class="barrow' + (b.includes('/') ? ' grouped' : '') + '" data-branch="' + esc(b) + '" aria-label="' + esc(b) + ': ' + n + ' ' + plural(n, 'equipo', 'equipos') + '. Ver detalle"><span>' + esc(b) +
      '</span><span class="track"><span class="fill" style="width:' + (n / max * 100) + '%"></span></span><b>' + n + '</b></button>').join('') ||
      '<p class="empty">No hay cambios registrados.</p>';

    const top = list.filter(b => !b[0].includes('/')).sort((a, b) => b[1] - a[1])[0];
    if (top && total) {
      $('chgBig').textContent = Math.round(top[1] / total * 100) + ' %';
      $('chgTop').textContent = 'corresponde a ' + top[0];
    } else { $('chgBig').textContent = '—'; $('chgTop').textContent = ''; }

    const notes = [];
    list.filter(b => b[0].includes('/')).forEach(([b, n]) => notes.push('<p>Los ' + n + ' equipos de ' + esc(b) + ' se conservan agrupados.</p>'));
    const aliases = new Map();
    DATA.entries.filter(r => category(r) === 'changes' && r.alias).forEach(r => {
      const k = r.alias + '→' + r.sucursal; aliases.set(k, (aliases.get(k) || 0) + r.cantidad);
    });
    aliases.forEach((n, k) => {
      const [from, to] = k.split('→');
      notes.push('<p class="note">' + (n === 1 ? 'El equipo identificado como ' + esc(from) + ' está incluido en ' : 'Los ' + n + ' equipos identificados como ' + esc(from) + ' están incluidos en ') + esc(to) + '.</p>');
    });
    $('chgNotes').innerHTML = notes.join('');

    const sel = $('changeBranch'), cur = sel.value;
    sel.innerHTML = '<option value="all">Todas</option>' + list.map(([b]) => '<option>' + esc(b) + '</option>').join('');
    sel.value = list.some(([b]) => b === cur) ? cur : 'all';
    renderChangeRows();
  }

  function renderChangeRows() {
    const b = $('changeBranch').value;
    const rows = DATA.entries.filter(r => category(r) === 'changes' && (b === 'all' || (r.sucursal || 'Sin sucursal') === b));
    $('changeCount').textContent = sum(rows) + ' equipos';
    $('changeRows').innerHTML = rows.map(r => '<tr><td>' + esc(r.sucursal || 'Sin sucursal') + '</td><td>' + esc(r.equipo) + '</td><td>' + esc(r.documento) +
      '</td><td class="num">' + r.cantidad + '</td></tr>').join('') || '<tr><td colspan="4" class="empty">No hay cambios registrados.</td></tr>';
  }

  let shown = [];
  function stockRows() { return DATA.stock.filter(r => !$('onlyIphone').checked || isIphone(r.equipo)); }

  function renderStockFrame() {
    const c = longDate(DATA.meta.corteInventario);
    const kind = $('onlyIphone').checked ? 'INVENTARIO IPHONE' : 'INVENTARIO';
    $('stockEyebrow').textContent = kind + (c ? ' · CORTE ' + pad(c.d) + ' ' + MESES[c.m - 1].toUpperCase() + ' ' + c.y : '');
    const branches = [...new Set(stockRows().map(r => r.sucursal).filter(Boolean))].sort();
    const sel = $('stockBranch'), cur = sel.value;
    sel.innerHTML = '<option value="all">Todas las sucursales</option>' + branches.map(b => '<option>' + esc(b) + '</option>').join('');
    sel.value = branches.includes(cur) ? cur : 'all';
    const aliasNames = Object.keys(BRANCH_ALIASES).length ? 'Los nombres de sucursal alternativos se agrupan con su sucursal (por ejemplo, TechnologySales se cuenta como Novaprisa).' : '';
    $('aliasNote').textContent = aliasNames;
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
    const all = aggregateStock($('stockBranch').value, $('groupBy').value === 'name');
    $('stockCards').innerHTML = [
      ['0', all.filter(r => r.quantity === 0).length, 'Grupos agotados'],
      ['1to4', all.filter(r => r.quantity > 0 && r.quantity < 5).length, 'Grupos con 1 a 4'],
      ['5to9', all.filter(r => r.quantity >= 5 && r.quantity < 10).length, 'Grupos con 5 a 9'],
      ['all', all.reduce((a, r) => a + r.quantity, 0), 'Unidades en existencia']
    ].map(([k, v, l]) => '<button class="card" data-level="' + k + '"><strong>' + v + '</strong><span>' + l + '</span></button>').join('');
    const t = $('threshold').value, q = $('stockSearch').value.toLowerCase();
    shown = all.filter(r => (t === 'all' || t === '0' && r.quantity === 0 || t === '1to4' && r.quantity > 0 && r.quantity < 5 ||
      t === '5to9' && r.quantity >= 5 && r.quantity < 10 || t === '5' && r.quantity < 5 || t === '10' && r.quantity < 10) && r.name.toLowerCase().includes(q));
    $('stockCount').textContent = shown.length + ' grupos mostrados de ' + all.length + ' · ' + shown.reduce((a, r) => a + r.quantity, 0) + ' unidades en el resultado';
    $('stockRows').innerHTML = shown.map(r => '<tr><td>' + esc(r.name) + '</td><td class="num"><b>' + r.quantity + '</b></td><td><span class="tag ' +
      (r.quantity === 0 ? 'red' : r.quantity < 5 ? 'amber' : '') + '">' + (r.quantity === 0 ? 'Agotado' : r.quantity < 5 ? '1 a 4' : r.quantity < 10 ? '5 a 9' : '10 o más') +
      '</span></td></tr>').join('') || '<tr><td colspan="3" class="empty">No hay resultados con estos filtros.</td></tr>';
  }

  function renderAll() { renderSource(); renderSummary(); renderChanges(); renderStockFrame(); }

  /* ---------- Carga de Excel ---------- */

  function renderReview() {
    const box = $('review');
    if (!sheets.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<h3>Hojas encontradas</h3><p class="note">Revisa que cada hoja tenga el uso y las columnas correctas. Los cambios se aplican al instante.</p>' +
      sheets.map((s, i) => {
        const issues = sheetIssues(s);
        const count = s.kind === 'ignore' || issues.length ? 0 : parseSheet(s).length;
        const status = s.kind === 'ignore' ? '<span class="tag">No se usa</span>'
          : issues.length ? '<span class="tag red">Falta: ' + esc(issues.join(', ')) + '</span>'
          : '<span class="tag ok">' + count + ' filas leídas</span>';
        const fields = s.kind === 'ignore' ? [] : KINDS[s.kind].required.concat(KINDS[s.kind].optional);
        return '<div class="sheet"><div class="sheet-head"><b>' + esc(s.fileName) + (s.sheetName ? ' · ' + esc(s.sheetName) : '') + '</b> ' + status + '</div>' +
          '<div class="filters"><label>Usar como<select data-i="' + i + '" data-k="kind">' +
          [['ignore', 'No usar'], ['entries', KINDS.entries.label], ['stock', KINDS.stock.label]].map(([v, l]) => '<option value="' + v + '"' + (s.kind === v ? ' selected' : '') + '>' + l + '</option>').join('') +
          '</select></label>' +
          fields.map(f => '<label>' + FIELDS[f].label + (KINDS[s.kind].required.includes(f) ? ' *' : '') + '<select data-i="' + i + '" data-f="' + f + '"><option value="">— sin columna —</option>' +
            s.headers.map((h, j) => '<option value="' + j + '"' + (s.map[f] === j ? ' selected' : '') + '>' + esc(h) + '</option>').join('') + '</select></label>').join('') +
          '</div></div>';
      }).join('');
  }

  function applySheets() {
    const usable = sheets.filter(s => s.kind !== 'ignore' && !sheetIssues(s).length);
    const entrySheets = usable.filter(s => s.kind === 'entries'), stockSheets = usable.filter(s => s.kind === 'stock');
    const msg = [];
    if (!usable.length) {
      $('loadMsg').innerHTML = '<span class="tag red">No se encontró una hoja de entradas ni de inventario.</span> Indica abajo qué columna corresponde a cada dato.';
      return;
    }
    const data = {
      meta: Object.assign({}, baseForUpload.meta, {
        fuente: [...new Set(sheets.map(s => s.fileName))].join(', '),
        corteInventario: $('corte').value || baseForUpload.meta.corteInventario || ''
      }),
      entries: entrySheets.length ? [].concat(...entrySheets.map(parseSheet)) : baseForUpload.entries,
      stock: stockSheets.length ? [].concat(...stockSheets.map(parseSheet)) : baseForUpload.stock
    };
    msg.push(entrySheets.length ? data.entries.length + ' entradas leídas' : 'no se cargaron entradas (se mantienen las anteriores)');
    msg.push(stockSheets.length ? data.stock.length + ' filas de inventario leídas' : 'no se cargó inventario (se mantiene el anterior)');
    $('loadMsg').innerHTML = '<span class="tag ok">Informe actualizado</span> ' + esc(msg.join(' · ')) + '.' +
      (stockSheets.length ? ' <b>Revisa la fecha de corte del inventario.</b>' : '');
    setData(data, true);
  }

  async function loadFiles(files) {
    if (!window.XLSX) { $('loadMsg').innerHTML = '<span class="tag red">No se pudo cargar el lector de Excel.</span>'; return; }
    $('loadMsg').textContent = 'Leyendo archivo…';
    baseForUpload = fromExcel ? DATA : PUBLISHED;
    sheets = [];
    let stockFile = null;
    for (const file of files) {
      try {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        for (const name of wb.SheetNames) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false });
          if (!rows.length) continue;
          const s = analyseSheet(file.name, wb.SheetNames.length > 1 ? name : '', rows);
          sheets.push(s);
          if (s.kind === 'stock') stockFile = file;
        }
      } catch (e) {
        $('loadMsg').innerHTML = '<span class="tag red">No se pudo leer ' + esc(file.name) + '.</span> ' + esc(e.message || '');
        return;
      }
    }
    if (stockFile && stockFile.lastModified) {
      const d = new Date(stockFile.lastModified);
      $('corte').value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    renderReview();
    applySheets();
  }

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadTemplate() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Fecha', 'Documento', 'Tipo', 'Equipo', 'Cantidad', 'Sucursal origen', 'Accesorio'],
      ['01/09/2026', '641', 'COMPRAS LOCALES', '17 PRO MAX 256GB NARANJA ESIM', 1, '', 'No'],
      ['01/09/2026', '642', 'CAMBIOS', '14 PRO MAX 256GB NEGRO ESIM', 1, 'Town Center', 'No'],
      ['12/09/2026', '705', 'COMPRAS LOCALES', 'CUBO 20W ORIGINAL', 1, '', 'Sí'],
      ['07/09/2026', '672', 'REINGRESO', '15 PRO MAX 256GB AZUL ESIM', 1, '', 'No']
    ]), 'Entradas');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Equipo', 'NombreSucursal', 'Existencia'],
      ['13 PRO MAX 128GB VERDE', 'Novaprisa', 5],
      ['13 PRO MAX 128GB VERDE', 'Town Center', 1],
      ['15 PRO 128GB AZUL ESIM', 'Novaprisa', 0]
    ]), 'Inventario');
    XLSX.writeFile(wb, 'plantilla-informe-inventario.xlsx');
  }

  /* ---------- Eventos ---------- */

  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    document.querySelectorAll('main>section[role=tabpanel]').forEach(s => s.hidden = s.id !== b.dataset.tab);
    document.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', x === b));
  });
  document.querySelectorAll('.print').forEach(b => b.onclick = () => window.print());

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

  $('stockCards').addEventListener('click', e => {
    const b = e.target.closest('[data-level]'); if (!b) return;
    $('threshold').value = b.dataset.level; renderStock();
  });
  ['threshold', 'stockBranch', 'groupBy', 'stockSearch'].forEach(id => $(id).addEventListener('input', renderStock));
  $('onlyIphone').addEventListener('change', () => { renderSummary(); renderStockFrame(); });

  $('export').onclick = () => {
    const cell = v => '"' + String(v).replace(/"/g, '""') + '"';
    const csv = '﻿' + [['Equipo', 'Existencias'], ...shown.map(r => [r.name, r.quantity])].map(r => r.map(cell).join(';')).join('\r\n');
    const c = DATA.meta.corteInventario ? '-' + DATA.meta.corteInventario.split('-').reverse().join('-') : '';
    download('existencias' + ($('onlyIphone').checked ? '-iphone' : '') + c + '.csv', csv, 'text/csv;charset=utf-8');
  };

  $('fileInput').addEventListener('change', e => { if (e.target.files.length) loadFiles([...e.target.files]); e.target.value = ''; });
  const drop = $('dataPanel');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('dragging'); }));
  drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) loadFiles([...e.dataTransfer.files]); });

  $('review').addEventListener('change', e => {
    const el = e.target, s = sheets[+el.dataset.i]; if (!s) return;
    if (el.dataset.k === 'kind') s.kind = el.value;
    else if (el.dataset.f) s.map[el.dataset.f] = el.value === '' ? null : +el.value;
    renderReview(); applySheets();
  });

  $('corte').addEventListener('change', () => {
    const data = Object.assign({}, DATA, { meta: Object.assign({}, DATA.meta, { corteInventario: $('corte').value }) });
    setData(data, true);
  });

  $('template').onclick = downloadTemplate;
  $('downloadData').onclick = () => download('datos.js',
    '// Datos que muestra la página al abrirse.\n// Se generan con el botón "Descargar datos.js" después de cargar un Excel.\nwindow.DATOS_INFORME = ' + JSON.stringify(DATA, null, 1) + ';\n',
    'text/javascript;charset=utf-8');
  $('resetData').onclick = () => { sheets = []; renderReview(); $('loadMsg').textContent = ''; setData(PUBLISHED, false); };

  renderAll();
})();
