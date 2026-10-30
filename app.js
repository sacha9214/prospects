// Prospect finder: local French businesses with no website listed in OpenStreetMap.
// Plain script (no modules, no build) so index.html also works when double-clicked.
(() => {
  'use strict';

  // Public OpenStreetMap servers. They are free and sometimes overloaded, so every attempt has a
  // time limit, and the main server gets a second chance after the backup.
  const MAIN = 'https://overpass-api.de/api/interpreter';
  const BACKUP = 'https://overpass.private.coffee/api/interpreter';
  const ATTEMPTS = [
    { url: MAIN, timeout: 60000 },
    { url: BACKUP, timeout: 30000, note: 'Serveur principal indisponible, essai d\u2019un serveur de secours…' },
    { url: MAIN, timeout: 60000, wait: 5000, note: 'Nouvel essai sur le serveur principal…' },
  ];
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
  const { deTown } = window.Drafts;
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

  async function overpass(query, onNote) {
    const cacheKey = `overpass:${query}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
    let lastError;
    for (const attempt of ATTEMPTS) {
      if (attempt.note) onNote?.(attempt.note);
      if (attempt.wait) await new Promise((r) => setTimeout(r, attempt.wait));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), attempt.timeout);
      try {
        const res = await fetch(attempt.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: `data=${encodeURIComponent(query)}`,
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.remark && /timed out|out of memory|rate/i.test(json.remark)) throw new Error('requête trop lourde');
        try { sessionStorage.setItem(cacheKey, JSON.stringify(json.elements)); } catch { /* quota: skip cache */ }
        return json.elements;
      } catch (err) {
        lastError = err.name === 'AbortError' ? new Error('pas de réponse') : err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  // ---------- normalisation ----------
  const split = (v) => String(v ?? '').split(/[;,]\s*/).map((s) => s.trim()).filter(Boolean);
  const pickAll = (t, keys) => [...new Set(keys.flatMap((k) => split(t[k])))];
  const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;
  // Free mailbox providers. Any other email domain usually means the business owns a website there.
  const WEBMAIL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|gmx|protonmail|proton|orange|wanadoo|free|sfr|neuf|club-internet|bbox|laposte|numericable|noos|cegetel|aliceadsl|libertysurf|tiscali|voila|9online|mailo|netcourrier)\./i;
  const socialUrl = (v, base) => {
    if (!v) return '';
    const url = /^https?:\/\//i.test(v) ? v : `${base}${v.replace(/^@/, '')}`;
    try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : ''; } catch { return ''; }
  };

  function normalize(el, searchTown, wanted) {
    const t = el.tags || {};
    if (t.website || t['contact:website'] || t.url) return null; // has a website: not a lead
    // Planity already serves these: hairdressers, barbers, beauty institutes, nail salons.
    if (/^(hairdresser|hairdresser_supply|beauty|nails|nail_salon)$/.test(t.shop) || t.craft === 'hairdresser' || t.beauty) return null;
    const sector = SECTORS.find((s) => s.match(t));
    if (!sector || !wanted.includes(sector.id)) return null;
    const kind = t.shop || t.craft || t.amenity || t.healthcare || t.office || t.leisure || '';
    const emails = pickAll(t, ['email', 'contact:email']).filter((e) => EMAIL.test(e));
    const likelySite = emails.map((e) => e.split('@')[1].toLowerCase()).find((d) => !WEBMAIL.test(d)) || '';
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
      likelySite,
      // A business emailing from its own domain very probably has a site there: push it down.
      score: (emails.length ? 4 : 0) + (facebook || instagram ? 2 : 0) + (phones.length ? 1 : 0) + (street ? 0.5 : 0) - (likelySite ? 6 : 0),
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
      setStatus(`Recherche autour ${deTown(town.nom)} (${radius / 1000} km)… jusqu'à une minute.`, 'loading');
      const elements = await overpass(buildQuery(town, radius, wanted), (note) => setStatus(note, 'loading'));
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
      setStatus(`Les serveurs OpenStreetMap ne répondent pas pour le moment (${err.message}). Ils sont gratuits et parfois surchargés : réessayez dans quelques minutes, ou avec un rayon plus petit.`, 'error');
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
      l.likelySite && `<a class="pill site" href="https://${esc(l.likelySite)}" target="_blank" rel="noopener noreferrer" title="Son e-mail utilise ce domaine : il a sûrement un site">🌐 Site probable : ${esc(l.likelySite)}</a>`,
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
          ${st !== 'stop' && Drafts.kindsFor(l).length ? `<button type="button" data-action="draft" aria-expanded="${drafts.has(l.id)}">✍️ ${drafts.has(l.id) ? 'Fermer' : 'Générer'}</button>` : ''}
        </div>
      </div>
      ${contacts ? `<div class="contacts">${contacts}</div>` : ''}
      ${drafts.has(l.id) && st !== 'stop' ? draftHtml(l) : ''}
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
  // ---------- message generator (inline, under each business) ----------
  // Open drafts survive re-renders, including what you typed in them.
  const drafts = new Map(); // id -> { kind, variant, subject, body }

  function freshDraft(l, kind, variant) {
    const { subject, body } = Drafts.generate(l, kind, variant, settings, SECTORS, DEFAULT_DEMO);
    return { kind, variant, subject, body };
  }

  function draftHtml(l) {
    const d = drafts.get(l.id);
    const kinds = Drafts.kindsFor(l);
    const social = l.facebook || l.instagram;
    const rows = Math.min(18, d.body.split('\n').length + 2);
    return `<div class="draft">
      <div class="draft-tabs" role="tablist">${Drafts.KINDS.filter(([k]) => kinds.includes(k)).map(([k, label]) =>
        `<button type="button" role="tab" data-action="kind" data-kind="${k}" aria-selected="${k === d.kind}">${label}</button>`).join('')}</div>
      ${d.kind === 'email' ? `
        <div class="draft-row"><span>À</span><code>${esc(l.emails[0])}</code><button type="button" data-copy="to">📋 Copier</button></div>
        <div class="draft-row"><span>Objet</span><input type="text" data-draft="subject" value="${esc(d.subject)}" /><button type="button" data-copy="subject">📋 Copier</button></div>` : ''}
      <textarea data-draft="body" rows="${rows}" aria-label="Message">${esc(d.body)}</textarea>
      <div class="draft-actions">
        ${d.kind === 'email' ? '<button type="button" class="primary" data-action="gmail">📨 Envoyer avec Gmail</button>' : ''}
        <button type="button" class="${d.kind === 'email' ? '' : 'primary'}" data-copy="body">📋 Copier le message</button>
        ${d.kind === 'email' || d.kind === 'dm' ? '<button type="button" data-action="variant">🔄 Autre version</button>' : ''}
        ${d.kind === 'email' ? '<button type="button" data-action="mailto">✉️ Autre messagerie</button>' : ''}
        ${d.kind === 'dm' && social ? `<a class="button" href="${esc(social)}" target="_blank" rel="noopener noreferrer">Ouvrir la page</a>` : ''}
        <button type="button" data-action="sent">✔️ Marquer « contacté »</button>
      </div>
      ${(d.kind === 'email' || d.kind === 'dm') && signatureIncomplete() ? `<p class="sig-warn">⚠️ Signature incomplète : ajoutez votre <strong>nom complet</strong> et votre <strong>téléphone</strong> dans <button type="button" data-action="settings">⚙️ Mes infos</button>. Un message signé d'un vrai nom et d'un numéro inspire beaucoup plus confiance.</p>` : ''}
      <p class="hint">${d.kind === 'email' || d.kind === 'dm' ? 'Ajoutez une phrase à vous (ce que vous avez aimé chez eux) : c’est ce qui fait répondre.' : 'Un script, pas un texte à lire mot pour mot : restez naturel.'}</p>
    </div>`;
  }

  // A first name alone, with no phone number, reads like spam.
  const signatureIncomplete = () => !/\S\s+\S/.test(settings.name || '') || !settings.phone;

  // Gmail's own "new message" page, pre-filled. Nothing is sent until you press Send in Gmail.
  function gmailComposeUrl(to, subject, body) {
    const params = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body });
    if (settings.gmail) params.set('authuser', settings.gmail); // pick the right account if several are signed in
    return `https://mail.google.com/mail/?${params}`;
  }

  async function copy(text, button) {
    const label = button.textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers / no permission: fall back to a hidden textarea.
      const t = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
    }
    button.textContent = '✔️ Copié';
    setTimeout(() => (button.textContent = label), 1500);
  }

  $('#list').addEventListener('click', (e) => {
    const l = leadOf(e.target);
    if (!l) return;
    const action = e.target.closest('[data-action]')?.dataset.action;
    const copyWhat = e.target.closest('[data-copy]')?.dataset.copy;
    if (action === 'draft') {
      if (drafts.has(l.id)) drafts.delete(l.id);
      else drafts.set(l.id, freshDraft(l, Drafts.kindsFor(l)[0], 0));
      render();
    } else if (action === 'kind') {
      drafts.set(l.id, freshDraft(l, e.target.closest('[data-kind]').dataset.kind, 0));
      render();
    } else if (action === 'variant') {
      const d = drafts.get(l.id);
      drafts.set(l.id, freshDraft(l, d.kind, d.variant + 1));
      render();
    } else if (action === 'gmail' || action === 'mailto') {
      // Built now, not at render time, so your last edits are included.
      const d = drafts.get(l.id);
      const url = action === 'gmail' ? gmailComposeUrl(l.emails[0], d.subject, d.body) : `mailto:${l.emails[0]}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
      if (action === 'gmail') window.open(url, '_blank', 'noopener');
      else location.href = url;
    } else if (action === 'settings') {
      fillSettings();
      $('#settings').showModal();
    } else if (action === 'sent') {
      setMark(l.id, { status: 'contacte' });
      drafts.delete(l.id);
      render();
    } else if (copyWhat) {
      const d = drafts.get(l.id);
      copy(copyWhat === 'to' ? l.emails[0] : d[copyWhat], e.target.closest('[data-copy]'));
    }
  });
  // Keep edits when the list re-renders.
  $('#list').addEventListener('input', (e) => {
    const field = e.target.dataset.draft;
    const l = field && leadOf(e.target);
    if (l && drafts.has(l.id)) drafts.get(l.id)[field] = e.target.value;
  });

  // ---------- settings & rules ----------
  document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.open;
    if (id === 'settings') fillSettings();
    $(`#${id}`).showModal();
  }));
  function fillSettings() {
    const f = $('#settings-form');
    ['name', 'phone', 'page', 'area', 'gmail'].forEach((k) => (f.elements[k].value = settings[k] || ''));
    $('#demo-fields').innerHTML = SECTORS.map((s) =>
      `<label class="field"><span>${s.icon} ${esc(s.label)}</span><input type="url" data-demo="${s.id}" placeholder="Par défaut : le site artisan" value="${esc(settings.demos?.[s.id] || '')}" /></label>`).join('');
  }
  $('#settings-form').addEventListener('submit', (e) => {
    if (e.submitter?.value !== 'save') return;
    const f = e.target;
    const demos = {};
    f.querySelectorAll('[data-demo]').forEach((i) => { if (i.value.trim()) demos[i.dataset.demo] = i.value.trim(); });
    settings = { name: f.elements.name.value.trim(), phone: f.elements.phone.value.trim(), page: f.elements.page.value.trim(), area: f.elements.area.value.trim(), gmail: f.elements.gmail.value.trim(), demos };
    store.set('settings', settings);
    drafts.forEach((d, id) => {
      const l = leads.find((x) => x.id === id);
      if (l) drafts.set(id, freshDraft(l, d.kind, d.variant));
    });
    if (leads.length) render();
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
  window.__prospects = { normalize, buildQuery, drafts, filtered: () => filtered() };
})();
