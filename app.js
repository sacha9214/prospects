// Prospect finder: local French businesses with no website listed in OpenStreetMap.
// Plain script (no modules, no build) so index.html also works when double-clicked.
(() => {
  'use strict';

  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  const PAGE = 60;
  const STATUSES = [
    ['a-verifier', 'À vérifier'],
    ['a-contacter', 'À contacter'],
    ['contacte', 'Contacté'],
    ['interesse', 'Intéressé'],
    ['pas-interesse', 'Pas intéressé'],
    ['a-un-site', 'A déjà un site'],
    ['stop', 'Ne plus contacter'],
  ];
  const DONE = new Set(['contacte', 'pas-interesse', 'a-un-site', 'stop']);
  const DEFAULT_DEMO = 'https://sacha9214.github.io/artisan-demo/';

  const $ = (sel) => document.querySelector(sel);
  // OSM data is user-contributed: escape everything before it touches innerHTML.
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------- storage ----------
  const store = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(`prospects.${k}`)) ?? d; } catch { return d; } },
    set: (k, v) => localStorage.setItem(`prospects.${k}`, JSON.stringify(v)),
  };
  let settings = { name: 'Sacha', phone: '', page: '', area: '', demos: { batiment: DEFAULT_DEMO }, ...store.get('settings', {}) };
  let marks = store.get('marks', {}); // { "node/123": { status, note, at } }
  const saveMarks = () => store.set('marks', marks);

  // ---------- state ----------
  let town = null;        // { nom, lat, lng, cp }
  let leads = [];         // normalized businesses
  let stats = null;
  let tab = 'all';
  let shown = PAGE;

  // ---------- sector chips ----------
  $('#sector-chips').innerHTML = SECTORS.map((s) =>
    `<label class="chip"><input type="checkbox" value="${s.id}" ${s.default ? 'checked' : ''}/> ${s.icon} ${esc(s.label)}</label>`).join('');
  const selectedSectors = () => [...document.querySelectorAll('#sector-chips input:checked')].map((i) => i.value);

  // ---------- town autocomplete (geo.api.gouv.fr) ----------
  const townInput = $('#town');
  const townList = $('#town-list');
  let suggestions = [];
  let active = -1;
  let debounce;

  async function fetchTowns(q) {
    const url = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(q)}&fields=nom,centre,codesPostaux,population,departement&boost=population&limit=6`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('communes');
    return (await res.json()).filter((c) => c.centre).map((c) => ({
      nom: c.nom, lng: c.centre.coordinates[0], lat: c.centre.coordinates[1],
      cp: c.codesPostaux?.[0] ?? '', dep: c.departement?.nom ?? '', pop: c.population ?? 0,
    }));
  }

  function renderSuggestions() {
    townList.hidden = !suggestions.length;
    townList.innerHTML = suggestions.map((c, i) =>
      `<li role="option" data-i="${i}" aria-selected="${i === active}">${esc(c.nom)}<small>${esc(c.cp)} · ${esc(c.dep)}</small></li>`).join('');
  }
  function pickTown(c) {
    town = c;
    townInput.value = `${c.nom} (${c.cp})`;
    suggestions = []; renderSuggestions();
  }

  townInput.addEventListener('input', () => {
    town = null;
    clearTimeout(debounce);
    const q = townInput.value.trim();
    if (q.length < 2) { suggestions = []; renderSuggestions(); return; }
    debounce = setTimeout(async () => {
      try { suggestions = await fetchTowns(q); active = 0; renderSuggestions(); } catch { /* offline: ignore */ }
    }, 250);
  });
  townInput.addEventListener('keydown', (e) => {
    if (townList.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, suggestions.length - 1); renderSuggestions(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); renderSuggestions(); e.preventDefault(); }
    if (e.key === 'Enter' && suggestions[active]) { pickTown(suggestions[active]); e.preventDefault(); }
    if (e.key === 'Escape') { suggestions = []; renderSuggestions(); }
  });
  townList.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (li) { pickTown(suggestions[Number(li.dataset.i)]); e.preventDefault(); }
  });
  townInput.addEventListener('blur', () => setTimeout(() => { suggestions = []; renderSuggestions(); }, 150));

  // ---------- Overpass ----------
  function bbox({ lat, lng }, radius) {
    const dLat = radius / 111320;
    const dLng = radius / (111320 * Math.cos((lat * Math.PI) / 180));
    return [lat - dLat, lng - dLng, lat + dLat, lng + dLng].map((n) => n.toFixed(5)).join(',');
  }

  function buildQuery(center, radius, sectorIds) {
    const parts = SECTORS.filter((s) => sectorIds.includes(s.id)).flatMap((s) => s.query);
    return `[out:json][timeout:90][bbox:${bbox(center, radius)}];(${parts.map((p) => `${p};`).join('')});out tags center;`;
  }

  async function overpass(query) {
    const cacheKey = `overpass:${query}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
    let lastError;
    for (const endpoint of OVERPASS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: `data=${encodeURIComponent(query)}`,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.remark && /timed out|out of memory|rate/i.test(json.remark)) throw new Error(json.remark);
        try { sessionStorage.setItem(cacheKey, JSON.stringify(json.elements)); } catch { /* quota: skip cache */ }
        return json.elements;
      } catch (err) { lastError = err; }
    }
    throw lastError;
  }

  // ---------- normalisation ----------
  const split = (v) => String(v ?? '').split(/[;,]\s*/).map((s) => s.trim()).filter(Boolean);
  const pickAll = (t, keys) => [...new Set(keys.flatMap((k) => split(t[k])))];
  const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;
  const socialUrl = (v, base) => {
    if (!v) return '';
    const url = /^https?:\/\//i.test(v) ? v : `${base}${v.replace(/^@/, '')}`;
    try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : ''; } catch { return ''; }
  };

  function normalize(el, searchTown, wanted) {
    const t = el.tags || {};
    if (t.website || t['contact:website'] || t.url) return null; // has a website: not a lead
    const sector = SECTORS.find((s) => s.match(t));
    if (!sector || !wanted.includes(sector.id)) return null;
    const kind = t.shop || t.craft || t.amenity || t.healthcare || t.office || t.leisure || '';
    const emails = pickAll(t, ['email', 'contact:email']).filter((e) => EMAIL.test(e));
    const phones = pickAll(t, ['phone', 'contact:phone', 'contact:mobile', 'mobile']);
    const facebook = socialUrl(t['contact:facebook'] || t.facebook, 'https://www.facebook.com/');
    const instagram = socialUrl(t['contact:instagram'] || t.instagram, 'https://www.instagram.com/');
    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    const city = t['addr:city'] || searchTown.nom;
    const id = `${el.type}/${el.id}`;
    return {
      id, name: t.name, sector: sector.id, kind, typeLabel: TYPE_LABELS[kind] || kind.replace(/_/g, ' '),
      street, postcode: t['addr:postcode'] || '', city, emails, phones, facebook, instagram,
      chain: !!(t.brand || t['brand:wikidata'] || t['operator:wikidata']),
      hours: t.opening_hours || '',
      score: (emails.length ? 4 : 0) + (facebook || instagram ? 2 : 0) + (phones.length ? 1 : 0) + (street ? 0.5 : 0),
      osm: `https://www.openstreetmap.org/${id}`,
    };
  }

  // ---------- search ----------
  const statusEl = $('#status');
  const setStatus = (msg, kind = '') => { statusEl.textContent = msg; statusEl.className = `status ${kind}`; };

  $('#search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const wanted = selectedSectors();
    if (!wanted.length) return setStatus('Choisissez au moins un secteur.', 'error');
    const btn = $('#search-btn');
    try {
      if (!town) {
        const q = townInput.value.replace(/\(.*\)/, '').trim();
        const found = q ? await fetchTowns(q) : [];
        if (!found.length) return setStatus('Ville introuvable. Choisissez-la dans la liste.', 'error');
        pickTown(found[0]);
      }
      btn.disabled = true;
      const radius = Number($('#radius').value);
      setStatus(`Recherche autour de ${town.nom} (${radius / 1000} km)… jusqu'à une minute.`, 'loading');
      const elements = await overpass(buildQuery(town, radius, wanted));
      const all = elements.filter((el) => el.tags?.name);
      leads = all.map((el) => normalize(el, town, wanted)).filter(Boolean);
      const indep = leads.filter((l) => !l.chain);
      stats = {
        total: all.length, noSite: leads.length, indep: indep.length,
        email: indep.filter((l) => l.emails.length).length,
        phone: indep.filter((l) => l.phones.length).length,
        social: indep.filter((l) => l.facebook || l.instagram).length,
      };
      tab = 'all'; shown = PAGE;
      setStatus('');
      render();
      $('#results').hidden = false;
    } catch (err) {
      setStatus(`La recherche n'a pas abouti (${err.message}). Réessayez avec un rayon plus petit, ou dans une minute.`, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- rendering ----------
  const filtersEl = ['#only-email', '#only-reachable', '#hide-done', '#show-chains'].map((s) => $(s));
  filtersEl.forEach((el) => el.addEventListener('change', () => { shown = PAGE; render(); }));
  $('#text-filter').addEventListener('input', () => { shown = PAGE; render(); });

  function filtered(ignoreTab = false) {
    const text = $('#text-filter').value.trim().toLowerCase();
    return leads.filter((l) => {
      const st = marks[l.id]?.status || 'a-verifier';
      if (!ignoreTab && tab !== 'all' && l.sector !== tab) return false;
      if (!$('#show-chains').checked && l.chain) return false;
      if ($('#only-email').checked && !l.emails.length) return false;
      if ($('#only-reachable').checked && !(l.emails.length || l.phones.length || l.facebook || l.instagram)) return false;
      if ($('#hide-done').checked && DONE.has(st)) return false;
      if (text && !`${l.name} ${l.typeLabel} ${l.street} ${l.city}`.toLowerCase().includes(text)) return false;
      return true;
    }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'fr'));
  }

  function render() {
    $('#summary').innerHTML = [
      [stats.total, 'entreprises trouvées'], [stats.indep, 'indépendantes sans site'],
      [stats.email, 'avec e-mail'], [stats.phone, 'avec téléphone'], [stats.social, 'avec Facebook / Instagram'],
    ].map(([n, label]) => `<div class="stat"><strong>${n.toLocaleString('fr-FR')}</strong><span>${label}</span></div>`).join('');

    const base = filtered(true);
    const counts = Object.fromEntries(SECTORS.map((s) => [s.id, base.filter((l) => l.sector === s.id).length]));
    $('#tabs').innerHTML = [`<button type="button" class="tab" role="tab" data-tab="all" aria-selected="${tab === 'all'}">Tous<span class="count">${base.length}</span></button>`,
      ...SECTORS.filter((s) => counts[s.id]).map((s) =>
        `<button type="button" class="tab" role="tab" data-tab="${s.id}" aria-selected="${tab === s.id}">${s.icon} ${esc(s.label)}<span class="count">${counts[s.id]}</span></button>`),
    ].join('');

    const list = filtered();
    $('#list').innerHTML = list.length
      ? list.slice(0, shown).map(leadHtml).join('')
      : '<p class="empty">Aucune entreprise avec ces filtres.</p>';
    $('#more').hidden = list.length <= shown;
    $('#more').textContent = `Voir plus (${list.length - shown} restantes)`;
  }

  function leadHtml(l) {
    const mark = marks[l.id] || {};
    const st = mark.status || 'a-verifier';
    const address = [l.street, [l.postcode, l.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const google = `https://www.google.com/search?q=${encodeURIComponent(`"${l.name}" ${l.city}`)}`;
    const contacts = [
      ...l.emails.map((e) => `<span class="pill email">✉️ ${esc(e)}</span>`),
      ...l.phones.map((p) => `<a class="pill" href="tel:${esc(p.replace(/[^\d+]/g, ''))}">📞 ${esc(p)}</a>`),
      l.facebook && `<a class="pill social" href="${esc(l.facebook)}" target="_blank" rel="noopener noreferrer">Facebook</a>`,
      l.instagram && `<a class="pill social" href="${esc(l.instagram)}" target="_blank" rel="noopener noreferrer">Instagram</a>`,
    ].filter(Boolean).join('');
    return `<article class="lead" data-id="${esc(l.id)}" data-status="${st}">
      <div>
        <h3>${esc(l.name)} <span class="type">${esc(l.typeLabel)}</span>${l.chain ? '<span class="chain">chaîne</span>' : ''}</h3>
        <div class="meta">${address ? `<span>📍 ${esc(address)}</span>` : `<span>📍 ${esc(l.city)} (adresse non renseignée)</span>`}${l.hours ? `<span>🕒 ${esc(l.hours)}</span>` : ''}</div>
      </div>
      <div class="lead-side">
        <select data-action="status" aria-label="Statut">${STATUSES.map(([v, label]) => `<option value="${v}" ${v === st ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <div class="lead-actions">
          <a class="button" href="${google}" target="_blank" rel="noopener noreferrer">🔎 Vérifier</a>
          <a class="button" href="${esc(l.osm)}" target="_blank" rel="noopener noreferrer">🗺️</a>
          ${l.emails.length && st !== 'stop' ? '<button type="button" data-action="write">✉️ Écrire</button>' : ''}
        </div>
      </div>
      ${contacts ? `<div class="contacts">${contacts}</div>` : ''}
      <input class="note" type="text" data-action="note" placeholder="Note (ex. : rappeler mardi)" value="${esc(mark.note || '')}" />
    </article>`;
  }

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) { tab = b.dataset.tab; shown = PAGE; render(); }
  });
  $('#more').addEventListener('click', () => { shown += PAGE; render(); });

  const leadOf = (el) => leads.find((l) => l.id === el.closest('.lead')?.dataset.id);
  const setMark = (id, patch) => { marks[id] = { ...marks[id], ...patch, at: new Date().toISOString() }; saveMarks(); };

  $('#list').addEventListener('change', (e) => {
    const l = leadOf(e.target);
    if (!l) return;
    if (e.target.dataset.action === 'status') { setMark(l.id, { status: e.target.value }); render(); }
    if (e.target.dataset.action === 'note') setMark(l.id, { note: e.target.value });
  });
  $('#list').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="write"]')) openComposer(leadOf(e.target));
  });

  // ---------- composer ----------
  // French prepositions with town names: "de Tours", "d'Angers", "du Mans" / "à Tours", "au Mans".
  const deTown = (c) => /^Le /.test(c) ? `du ${c.slice(3)}` : /^Les /.test(c) ? `des ${c.slice(4)}` : /^[aeiouyhâéèêîôû]/i.test(c) ? `d'${c}` : `de ${c}`;
  const aTown = (c) => /^Le /.test(c) ? `au ${c.slice(3)}` : /^Les /.test(c) ? `aux ${c.slice(4)}` : `à ${c}`;
  const queName = (n) => /^[aeiouyhâéèêîôû]/i.test(n) ? `qu'${n}` : `que ${n}`;
  let current = null;
  function draft(l) {
    const sector = SECTORS.find((s) => s.id === l.sector);
    const demo = settings.demos?.[l.sector];
    const area = settings.area ? ` ${settings.area}` : '';
    const lines = [
      'Bonjour,',
      '',
      `Je m'appelle ${settings.name || '[votre nom]'}, je crée des sites internet pour les entreprises locales${area}. En parcourant ${sector.scan} ${deTown(l.city)}, j'ai vu ${queName(l.name)} n'avait pas encore de site.`,
      '',
      `Un site simple aide vos clients à découvrir ${sector.pitch}.`,
    ];
    if (l.facebook || l.instagram) {
      lines.push(`Vous êtes déjà sur ${l.facebook ? 'Facebook' : 'Instagram'} : un site vient en complément, et il vous rend plus facile à trouver sur Google quand quelqu'un cherche votre métier ${aTown(l.city)}.`);
    }
    lines.push('');
    if (demo) lines.push(`Voici un exemple de site que j'ai réalisé : ${demo}`, '');
    else lines.push(`Voici un exemple que j'ai réalisé pour un artisan, pour vous donner une idée : ${DEFAULT_DEMO}`, '');
    lines.push(
      "Si ça vous intéresse, je peux vous préparer une maquette gratuite de votre site, sans engagement. Je peux aussi vous appeler quelques minutes quand ça vous arrange.",
      '',
      'Bonne journée,',
      settings.name || '[votre nom]',
      ...[settings.phone, settings.page].filter(Boolean),
      '',
      '—',
      "J'ai trouvé votre adresse e-mail sur OpenStreetMap, une carte collaborative publique. Si vous ne souhaitez plus recevoir de message de ma part, répondez simplement « stop ».",
    );
    return { subject: `Un site internet pour ${l.name} ?`, body: lines.join('\n') };
  }

  function openComposer(l) {
    if (!l) return;
    current = l;
    const { subject, body } = draft(l);
    $('#composer-title').textContent = `Écrire à ${l.name}`;
    $('#composer-to').textContent = `À : ${l.emails.join(', ')}`;
    $('#mail-subject').value = subject;
    $('#mail-body').value = body;
    updateMailLink();
    $('#composer').showModal();
  }
  function updateMailLink() {
    if (!current) return;
    $('#mail-open').href = `mailto:${current.emails[0]}?subject=${encodeURIComponent($('#mail-subject').value)}&body=${encodeURIComponent($('#mail-body').value)}`;
  }
  $('#mail-subject').addEventListener('input', updateMailLink);
  $('#mail-body').addEventListener('input', updateMailLink);
  $('#mail-copy').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText($('#mail-body').value); e.target.textContent = '✔️ Copié'; }
    catch { $('#mail-body').select(); }
    setTimeout(() => (e.target.textContent = '📋 Copier le message'), 1500);
  });
  $('#mail-done').addEventListener('click', () => {
    if (current) setMark(current.id, { status: 'contacte' });
    $('#composer').close();
    render();
  });

  // ---------- settings & rules ----------
  document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.open;
    if (id === 'settings') fillSettings();
    $(`#${id}`).showModal();
  }));
  function fillSettings() {
    const f = $('#settings-form');
    ['name', 'phone', 'page', 'area'].forEach((k) => (f.elements[k].value = settings[k] || ''));
    $('#demo-fields').innerHTML = SECTORS.map((s) =>
      `<label class="field"><span>${s.icon} ${esc(s.label)}</span><input type="url" data-demo="${s.id}" placeholder="Par défaut : le site artisan" value="${esc(settings.demos?.[s.id] || '')}" /></label>`).join('');
  }
  $('#settings-form').addEventListener('submit', (e) => {
    if (e.submitter?.value !== 'save') return;
    const f = e.target;
    const demos = {};
    f.querySelectorAll('[data-demo]').forEach((i) => { if (i.value.trim()) demos[i.dataset.demo] = i.value.trim(); });
    settings = { name: f.elements.name.value.trim(), phone: f.elements.phone.value.trim(), page: f.elements.page.value.trim(), area: f.elements.area.value.trim(), demos };
    store.set('settings', settings);
  });
  $('#wipe').addEventListener('click', () => {
    if (!confirm('Effacer tous les statuts, notes et réglages enregistrés dans ce navigateur ?')) return;
    ['settings', 'marks'].forEach((k) => localStorage.removeItem(`prospects.${k}`));
    marks = {};
    settings = { name: 'Sacha', phone: '', page: '', area: '', demos: { batiment: DEFAULT_DEMO } };
    $('#rules').close();
    if (leads.length) render();
  });

  // ---------- CSV export ----------
  $('#export').addEventListener('click', () => {
    const rows = filtered();
    const label = (id) => STATUSES.find(([v]) => v === id)?.[1] || 'À vérifier';
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Secteur', 'Type', 'Nom', 'Adresse', 'Code postal', 'Ville', 'Téléphone', 'E-mail', 'Facebook', 'Instagram', 'Statut', 'Note', 'OpenStreetMap'];
    const lines = rows.map((l) => [
      SECTORS.find((s) => s.id === l.sector).label, l.typeLabel, l.name, l.street, l.postcode, l.city,
      l.phones.join(' / '), l.emails.join(' / '), l.facebook, l.instagram, label(marks[l.id]?.status), marks[l.id]?.note || '', l.osm,
    ].map(cell).join(';'));
    // BOM + semicolons: opens correctly in French Excel.
    const csv = `﻿${[head.map(cell).join(';'), ...lines].join('\r\n')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `prospects-${(town?.nom || 'ville').toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // Exposed for testing in the console only.
  window.__prospects = { draft, normalize, buildQuery, deTown, aTown, filtered: () => filtered() };
})();
