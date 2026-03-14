// ─────────────────────────────────────────────
//  Vestlandsarkivet — app.js
// ─────────────────────────────────────────────

const INSTITUTIONS = [
  { id: 'BBA',  name: 'Bergen byarkiv',          short: 'BBA',  description: 'Arkiv frå Bergen kommune og byens historiske forvaltning' },
  { id: 'IKAH', name: 'IKA Hordaland',            short: 'IKAH', description: 'Interkommunalt arkiv for kommunar i Hordaland' },
  { id: 'VLFK', name: 'Fylkesarkivet i Vestland', short: 'VLFK', description: 'Arkiv frå Vestland fylkeskommune og Sogn og Fjordane' },
];

const PAGE_SIZE = 20;

// ─── State ──────────────────────────────────────
const state = {
  view: 'landing',        // landing | results | browse | detail
  query: '',
  filterInstitution: null,
  filterDigitized: false,
  breadcrumbs: [],        // [{id, name, type}]
  results: [],
  currentEntity: null,
  externalLinks: [],
  externalLinksMap: {},   // urn → [{label,link}]
  loading: false,
  totalHits: 0,
};

// ─── API ────────────────────────────────────────
const API = 'https://vestlandsarkivet-production.up.railway.app/api/arkivportalen';

async function apiFetch(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

async function searchQuery(params) {
  const qs = new URLSearchParams();
  qs.set('size', params.size ?? PAGE_SIZE);
  qs.set('from', params.from || 0);
  if (params.text)       qs.set('text', params.text);
  if (params.under)      qs.set('under', params.under);
  // Only add repository filter when NOT drilling (under overrides scope)
  if (!params.under) {
    const repos = params.repository || INSTITUTIONS.map(i => i.id);
    repos.forEach(r => qs.append('repository', r));
  }
  if (params.unitType)   params.unitType.forEach(u => qs.append('unitType', u));
  return apiFetch('/api/search?' + qs.toString());
}

async function fetchEntity(id) {
  return apiFetch(`/api/entity/${id}`);
}

async function fetchExternalLinks(id) {
  try {
    return await apiFetch(`/api/entity/${id}/externalLinks`);
  } catch { return []; }
}

// After results load, fetch externalLinks for all STYKKE/DOKUMENT in background
async function fetchLinksForResults(hits) {
  const physical = hits
    .filter(h => h._index?.includes('archive-unit'))
    .filter(h => {
      const t = h._source?.unitType?.id;
      return t === 1008 || t === 1103;
    });

  await Promise.all(physical.map(async h => {
    const urn = h._source.urn;
    if (state.externalLinksMap[urn] !== undefined) return; // already fetched
    const links = await fetchExternalLinks(urn);
    state.externalLinksMap[urn] = transformLinks(links);
  }));

  render(); // re-render once all links are resolved
}

// ─── Date formatting ────────────────────────────
function formatDate(raw) {
  if (!raw) return '';
  const s = String(raw).replace(/\D/g, ''); // strip non-digits
  if (s.length === 8) {
    // YYYYMMDD
    const y = s.slice(0, 4), m = s.slice(4, 6), d = s.slice(6, 8);
    return `${d}.${m}.${y}`;
  }
  if (s.length === 6) {
    // YYYYMM
    const y = s.slice(0, 4), m = s.slice(4, 6);
    return `${m}.${y}`;
  }
  return s.slice(0, 4); // just year
}

function formatPeriod(period) {
  if (!period) return '';
  const start = formatDate(period.start);
  const end   = formatDate(period.end);
  if (start && end) return `${start} – ${end}`;
  if (start) return `frå ${start}`;
  if (end)   return `til ${end}`;
  return '';
}

// ─── Digitalarkivet URL transform ───────────────
function transformDigitalarkivetUrl(link) {
  // https://www.digitalarkivet.no/source/127068
  // → https://media.digitalarkivet.no/view/127068/1
  const match = link.match(/digitalarkivet\.no\/source\/(\d+)/);
  if (match) return `https://media.digitalarkivet.no/view/${match[1]}/1`;
  return link;
}

function transformLinks(links) {
  if (!Array.isArray(links)) return links;
  return links.map(l => ({ ...l, link: transformDigitalarkivetUrl(l.link) }));
}

// ─── Grouping ───────────────────────────────────
function groupResults(hits) {
  const units = hits.filter(h => h._index?.includes('archive-unit'));
  const groups = {};

  units.forEach(hit => {
    const src = hit._source;
    const parents = src.parents || [];
    const arkiv = parents.find(p => p.unitType?.id === 1000);
    const serie = [...parents].reverse().find(p => p.unitType?.id === 1001);
    const inst  = src.institute?.name || src.institute?.id || '';
    const key   = `${src.institute?.id}__${arkiv?.id || 'root'}__${serie?.id || 'root'}`;

    if (!groups[key]) {
      groups[key] = { institution: inst, institutionId: src.institute?.id, arkiv: arkiv || null, serie: serie || null, items: [] };
    }
    groups[key].items.push(src);
  });

  return Object.values(groups);
}

// ─── Render helpers ─────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function truncate(str, n) {
  if (!str || str.length <= n) return str;
  return str.slice(0, n) + '…';
}

function crumbLabel(crumb) {
  if (crumb.type && crumb.type !== 'institution') {
    return `<span class="crumb-type">${escHtml(crumb.type)}</span> ${escHtml(crumb.name)}`;
  }
  return escHtml(crumb.name);
}

function renderSpinner() {
  return `<div class="spinner-wrap"><div class="spinner"></div></div>`;
}

// ─── Render: Landing ────────────────────────────
function renderLanding() {
  return `
    <div class="landing">
      <header class="site-header">
        <div class="logo-area">
          <span class="logo-mark">V</span>
          <span class="logo-text">Vestlandsarkivet</span>
        </div>
      </header>
      <section class="hero">
        <h1 class="hero-title">Finn arkiv i Vestland</h1>
        <p class="hero-sub">Søk på tvers av Bergen byarkiv, IKA Hordaland og Fylkesarkivet i Vestland</p>
        <div class="search-bar-wrap">
          <input type="text" id="main-search" class="search-input"
            placeholder="Søk etter arkiv, serie eller stykke…" autocomplete="off"
            value="${escHtml(state.query)}" />
          <button class="search-btn" id="do-search">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </button>
        </div>
      </section>
      <section class="institutions">
        <h2 class="section-label">Bla i arkivinstitusjonane</h2>
        <div class="inst-grid">
          ${INSTITUTIONS.map(inst => `
            <button class="inst-card" data-inst="${inst.id}">
              <span class="inst-code">${inst.short}</span>
              <span class="inst-name">${inst.name}</span>
              <span class="inst-desc">${inst.description}</span>
              <span class="inst-arrow">→</span>
            </button>
          `).join('')}
        </div>
      </section>
    </div>`;
}

// ─── Render: Topbar ─────────────────────────────
function renderTopBar() {
  return `
    <header class="topbar">
      <button class="home-btn" id="go-home">
        <span class="logo-mark-sm">V</span>
        <span>Vestlandsarkivet</span>
      </button>
      <div class="topbar-search">
        <input type="text" id="top-search" class="search-input-sm"
          placeholder="Nytt søk…" value="${escHtml(state.query)}" />
        <button class="search-btn-sm" id="do-search-top">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
        </button>
      </div>
    </header>`;
}

// ─── Render: Breadcrumbs ────────────────────────
function renderBreadcrumbs() {
  if (!state.breadcrumbs.length) return '';
  return `
    <nav class="breadcrumbs">
      <button class="crumb-home" id="go-home-crumb">Heim</button>
      ${state.breadcrumbs.map((crumb, i) => `
        <span class="crumb-sep">›</span>
        ${i < state.breadcrumbs.length - 1
          ? `<button class="crumb-link" data-crumb="${i}">${crumbLabel(crumb)}</button>`
          : `<span class="crumb-current">${crumbLabel(crumb)}</span>`}
      `).join('')}
    </nav>`;
}

// ─── Render: Unit card ──────────────────────────
function renderUnitCard(src) {
  const typeId    = src.unitType?.id;
  const isPhysical = typeId === 1008 || typeId === 1103;
  const isDrillable = !isPhysical;
  const period    = formatPeriod(src.period);
  const links     = state.externalLinksMap[src.urn];
  const hasLinks  = Array.isArray(links) && links.length > 0;
  const linksPending = links === undefined && isPhysical;

  // If filtering digitized-only and we know this has no links, hide it
  if (state.filterDigitized && Array.isArray(links) && links.length === 0) return '';

  // For drilling: use path (e.g. BBA/A-0001) as the `under` value — that's what the API expects
  // Keep urn as data-id so we can rebuild breadcrumbs correctly
  const action = isDrillable
    ? `data-drill="${escHtml(src.path || src.urn)}" data-id="${src.urn}" data-name="${escHtml(src.name)}" data-type="${escHtml(src.unitType?.name || '')}"`
    : `data-entity="${src.urn}"`;

  return `
    <button class="unit-card ${isDrillable ? 'drillable' : 'physical'}" ${action}>
      <div class="unit-card-top">
        <div class="unit-card-main">
          <span class="unit-type-label">${src.unitType?.name || ''}</span>
          <span class="unit-id">${escHtml(src.identifier || '')}</span>
        </div>
        <div class="card-badges">
          ${hasLinks ? `<span class="digitized-badge-green">✓ Digitalt tilgjengeleg</span>` : ''}
          ${linksPending ? `<span class="digitized-badge-pending">…</span>` : ''}
          ${isDrillable && src.childCount > 0 ? `<span class="child-count-badge">${src.childCount} einingar</span>` : ''}
        </div>
      </div>
      <h3 class="unit-name">${escHtml(src.name)}</h3>
      ${period ? `<span class="unit-period">${period}</span>` : ''}
      ${src.contents ? `<p class="unit-contents">${escHtml(truncate(src.contents, 220))}</p>` : ''}
    </button>`;
}

// ─── Render: Group (search results) ─────────────
function renderGroup(group) {
  const items = group.items.map(item => renderUnitCard(item)).filter(Boolean);
  if (!items.length && state.filterDigitized) return ''; // hide empty groups when filtering
  return `
    <div class="result-group">
      <div class="group-header">
        <span class="group-inst">${escHtml(group.institution)}</span>
        ${group.arkiv ? `
          <button class="group-label" data-drill="${group.arkiv.id}" data-path="${escHtml(group.arkiv.id)}" data-name="${escHtml(group.arkiv.name)}" data-type="Arkiv">
            <span class="unit-badge">Arkiv</span>
            <span class="group-label-name">${escHtml(group.arkiv.name)}</span>
            <span class="drill-arrow">›</span>
          </button>` : ''}
        ${group.serie ? `
          <button class="group-label" data-drill="${group.serie.id}" data-path="${escHtml(group.serie.id)}" data-name="${escHtml(group.serie.name)}" data-type="Serie">
            <span class="unit-badge serie">Serie</span>
            <span class="group-label-name">${escHtml(group.serie.name)}</span>
            <span class="drill-arrow">›</span>
          </button>` : ''}
      </div>
      <div class="group-items">${items.join('')}</div>
    </div>`;
}

// ─── Render: Results ────────────────────────────
function renderResults() {
  const groups = groupResults(state.results);
  return `
    ${renderTopBar()}
    <div class="page-content">
      ${renderBreadcrumbs()}
      <div class="results-header">
        <div class="results-meta">
          ${state.totalHits > 0
            ? `<span class="hit-count">${state.totalHits.toLocaleString('no')} treff</span> for <em>"${escHtml(state.query)}"</em>`
            : state.loading ? '' : `Ingen treff for <em>"${escHtml(state.query)}"</em>`}
        </div>
        <div class="filters-row">
          <div class="inst-filters">
            <button class="filter-btn ${!state.filterInstitution ? 'active' : ''}" data-filter="">Alle</button>
            ${INSTITUTIONS.map(i => `
              <button class="filter-btn ${state.filterInstitution === i.id ? 'active' : ''}" data-filter="${i.id}">${i.short}</button>
            `).join('')}
          </div>
          <label class="digitized-filter">
            <input type="checkbox" id="filter-digitized" ${state.filterDigitized ? 'checked' : ''} />
            <span>Berre digitalt tilgjengeleg</span>
          </label>
        </div>
      </div>
      ${state.loading ? renderSpinner() : ''}
      <div class="results-list">
        ${groups.length === 0 && !state.loading
          ? `<div class="empty-state"><p>Ingen resultat å vise. Prøv eit anna søk.</p></div>`
          : groups.map(g => renderGroup(g)).join('')}
      </div>
      ${state.totalHits > state.results.length ? `
        <div class="load-more-wrap">
          <button class="load-more-btn" id="load-more">Last fleire</button>
        </div>` : ''}
    </div>`;
}

// ─── Render: Browse ─────────────────────────────
function renderBrowse() {
  const archiveUnits = state.results.filter(h => h._index?.includes('archive-unit'));
  return `
    ${renderTopBar()}
    <div class="page-content">
      ${renderBreadcrumbs()}
      <div class="results-header">
        <div class="results-meta">
          <span class="hit-count">${state.totalHits.toLocaleString('no')}</span> einingar
        </div>
      </div>
      ${state.loading ? renderSpinner() : ''}
      <div class="results-list">
        ${archiveUnits.length === 0 && !state.loading
          ? `<div class="empty-state"><p>Ingen einingar funne.</p></div>`
          : archiveUnits.map(h => renderUnitCard(h._source)).join('')}
      </div>
      ${state.totalHits > archiveUnits.length ? `
        <div class="load-more-wrap">
          <button class="load-more-btn" id="load-more">Last fleire</button>
        </div>` : ''}
    </div>`;
}

// ─── Render: Detail ─────────────────────────────
function renderDetail() {
  const e = state.currentEntity;
  if (!e) return `${renderTopBar()}<div class="page-content">${renderSpinner()}</div>`;

  const period = formatPeriod(e.period);
  const links  = state.externalLinks || [];

  return `
    ${renderTopBar()}
    <div class="page-content">
      ${renderBreadcrumbs()}
      <div class="detail-card">
        <div class="detail-header">
          <div class="detail-badges">
            <span class="unit-type-label large">${e.unitType?.name || ''}</span>
            ${e.identifier ? `<span class="unit-id">${escHtml(e.identifier)}</span>` : ''}
          </div>
          <h1 class="detail-title">${escHtml(e.name)}</h1>
          ${period ? `<span class="detail-period">${period}</span>` : ''}
        </div>

        ${links.length > 0 ? `
          <div class="digitized-banner">
            <span class="digitized-icon">📄</span>
            <div>
              <strong>Digitalisert materiale tilgjengeleg</strong>
              ${links.map(l => `<a href="${l.link}" target="_blank" rel="noopener" class="ext-link">${l.label} →</a>`).join('')}
            </div>
          </div>` : ''}

        <div class="detail-meta">
          ${e.contents ? `
            <div class="meta-block full-width">
              <span class="meta-label">Innhald</span>
              <p class="meta-value">${escHtml(e.contents)}</p>
            </div>` : ''}
          ${e.creator ? `
            <div class="meta-block">
              <span class="meta-label">Arkivskapar</span>
              <p class="meta-value">${escHtml(e.creator.name)}</p>
            </div>` : ''}
          ${e.institute ? `
            <div class="meta-block">
              <span class="meta-label">Institusjon</span>
              <p class="meta-value">${escHtml(e.institute.name)}</p>
            </div>` : ''}
          ${period ? `
            <div class="meta-block">
              <span class="meta-label">Periode</span>
              <p class="meta-value">${period}</p>
            </div>` : ''}
          ${e.scope ? `
            <div class="meta-block">
              <span class="meta-label">Omfang</span>
              <p class="meta-value">${e.scope} ${e.measurementUnit?.title || ''}</p>
            </div>` : ''}
          ${e.clauses?.length ? `
            <div class="meta-block">
              <span class="meta-label">Tilgang</span>
              <p class="meta-value">${escHtml(e.clauses[0].categoryDesc)}</p>
            </div>` : ''}
        </div>

        ${e.childCount > 0 ? `
          <div class="detail-children">
            <button class="browse-children-btn" data-drill="${escHtml(e.path || e.urn)}" data-id="${e.urn}" data-name="${escHtml(e.name)}" data-type="${escHtml(e.unitType?.name || '')}">
              Vis ${e.childCount} underordna einingar →
            </button>
          </div>` : ''}
      </div>
    </div>`;
}

// ─── Render ──────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  switch (state.view) {
    case 'landing': app.innerHTML = renderLanding(); break;
    case 'results': app.innerHTML = renderResults(); break;
    case 'browse':  app.innerHTML = renderBrowse();  break;
    case 'detail':  app.innerHTML = renderDetail();  break;
  }
  bindEvents();
}

// ─── Actions ─────────────────────────────────────
async function doSearch(query, from = 0) {
  if (!query.trim()) return;
  state.query = query;
  state.view = 'results';
  state.loading = true;
  if (from === 0) { state.results = []; state.breadcrumbs = []; }
  render();

  try {
    const repos = state.filterInstitution ? [state.filterInstitution] : INSTITUTIONS.map(i => i.id);
    const data = await searchQuery({ text: query, repository: repos, from });
    state.totalHits = data.hits?.total?.value || 0;
    const newHits = data.hits?.hits || [];
    state.results = from === 0 ? newHits : [...state.results, ...newHits];
    fetchLinksForResults(newHits); // background — will re-render when done
  } catch (err) {
    console.error(err);
  } finally {
    state.loading = false;
    render();
  }
}

async function browseInstitution(instId) {
  const inst = INSTITUTIONS.find(i => i.id === instId);
  state.view = 'browse';
  state.loading = true;
  state.query = '';
  state.breadcrumbs = [{ id: instId, name: inst.name, type: 'institution' }];
  state.results = [];
  render();

  try {
    const data = await searchQuery({ repository: [instId], unitType: [1000], from: 0 });
    state.totalHits = data.hits?.total?.value || 0;
    state.results = data.hits?.hits || [];
  } catch (err) {
    console.error(err);
  } finally {
    state.loading = false;
    render();
  }
}

async function drillInto(id, name, type, uid) {
  // id = path string for API `under` param (e.g. "BBA/A-0001")
  // uid = urn for breadcrumb identity
  state.view = 'browse';
  state.loading = true;
  const crumbId = uid || id;
  const last = state.breadcrumbs[state.breadcrumbs.length - 1];
  if (!last || last.id !== crumbId) {
    state.breadcrumbs.push({ id: crumbId, name, type, path: id });
  }
  state.results = [];
  render();

  try {
    // id is the path value — exactly what `under` needs
    console.log('[drill] under =', id, 'uid =', uid);
    const data = await searchQuery({ under: id, size: 200, from: 0 });
    const allHits = data.hits?.hits || [];
    const archiveHits = allHits.filter(h => h._index?.includes('archive-unit'));

    console.log('[drill] id =', id);
    console.log('[drill] total hits =', allHits.length, 'archive-units =', archiveHits.length);
    if (archiveHits[0]) {
      const s = archiveHits[0]._source;
      console.log('[drill] sample: parentId =', s.parentId, ' unitType =', s.unitType?.name, ' unitRank =', s.unitType?.rank);
    }

    // parentId in records is the URN — match against uid (urn) not id (path)
    const parentUrn = uid || id;
    const directChildren = archiveHits.filter(h => h._source?.parentId === parentUrn);
    console.log('[drill] parentUrn =', parentUrn, 'directChildren:', directChildren.length);

    // Fall back to shallowest rank if parentId matching fails
    let finalHits = directChildren.length ? directChildren : (() => {
      const minRank = Math.min(...archiveHits.map(h => h._source?.unitType?.rank ?? 99));
      console.log('[drill] fallback minRank =', minRank, 'hits =', archiveHits.filter(h => (h._source?.unitType?.rank ?? 99) === minRank).length);
      return archiveHits.filter(h => (h._source?.unitType?.rank ?? 99) === minRank);
    })();

    state.totalHits = finalHits.length;
    state.results = finalHits;
    fetchLinksForResults(finalHits);
  } catch (err) {
    console.error(err);
  } finally {
    state.loading = false;
    render();
  }
}

async function openEntity(id) {
  state.view = 'detail';
  state.loading = true;
  state.currentEntity = null;
  state.externalLinks = [];
  const prevCrumbs = [...state.breadcrumbs];
  render();

  try {
    const [entity, links] = await Promise.all([fetchEntity(id), fetchExternalLinks(id)]);
    state.currentEntity = entity;
    state.externalLinks = transformLinks(links || []);
    // Store in map too
    state.externalLinksMap[id] = transformLinks(links || []);

    // Rebuild breadcrumbs from parents
    const instId = entity.institute?.id;
    const inst = INSTITUTIONS.find(i => i.id === instId);
    state.breadcrumbs = [];
    if (inst) state.breadcrumbs.push({ id: instId, name: inst.name, type: 'institution' });
    const parents = entity.parents || [];
    [...parents].reverse().forEach(p => {
      state.breadcrumbs.push({ id: p.id, name: p.name, type: p.unitType?.name || '', path: p.id });
    });
    state.breadcrumbs.push({ id, name: entity.name, type: entity.unitType?.name || '', path: entity.path || id });
  } catch (err) {
    console.error(err);
    state.breadcrumbs = prevCrumbs;
  } finally {
    state.loading = false;
    render();
  }
}

async function loadMore() {
  const archiveCount = state.results.filter(h => h._index?.includes('archive-unit')).length;
  if (state.view === 'results') await doSearch(state.query, archiveCount);
}

function navigateToCrumb(index) {
  const crumb = state.breadcrumbs[index];
  state.breadcrumbs = state.breadcrumbs.slice(0, index + 1);
  if (crumb.type === 'institution') {
    browseInstitution(crumb.id);
  } else {
    state.breadcrumbs.pop();
    drillInto(crumb.path || crumb.id, crumb.name, crumb.type, crumb.id);
  }
}

// ─── Events ──────────────────────────────────────
function bindEvents() {
  // Home buttons
  document.getElementById('go-home')?.addEventListener('click', () => {
    state.view = 'landing'; state.breadcrumbs = []; render();
  });
  document.getElementById('go-home-crumb')?.addEventListener('click', () => {
    state.view = 'landing'; state.breadcrumbs = []; render();
  });

  // Search — landing
  const mainSearch = document.getElementById('main-search');
  document.getElementById('do-search')?.addEventListener('click', () => doSearch(mainSearch?.value || ''));
  mainSearch?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(mainSearch.value); });
  if (state.view === 'landing') mainSearch?.focus();

  // Search — topbar
  const topSearch = document.getElementById('top-search');
  document.getElementById('do-search-top')?.addEventListener('click', () => doSearch(topSearch?.value || ''));
  topSearch?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(topSearch.value); });

  // Institution cards
  document.querySelectorAll('.inst-card').forEach(btn =>
    btn.addEventListener('click', () => browseInstitution(btn.dataset.inst)));

  // Institution filters
  document.querySelectorAll('.filter-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      state.filterInstitution = btn.dataset.filter || null;
      doSearch(state.query);
    }));

  // Digitized filter checkbox
  document.getElementById('filter-digitized')?.addEventListener('change', e => {
    state.filterDigitized = e.target.checked;
    render();
  });

  // Drill — all [data-drill] elements
  document.querySelectorAll('[data-drill]').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      drillInto(btn.dataset.drill, btn.dataset.name, btn.dataset.type || '', btn.dataset.id || '');
    }));

  // Open entity detail — all [data-entity] elements
  document.querySelectorAll('[data-entity]').forEach(btn =>
    btn.addEventListener('click', () => openEntity(btn.dataset.entity)));

  // Breadcrumb links
  document.querySelectorAll('[data-crumb]').forEach(btn =>
    btn.addEventListener('click', () => navigateToCrumb(parseInt(btn.dataset.crumb))));

  // Load more
  document.getElementById('load-more')?.addEventListener('click', loadMore);
}

// ─── Init ────────────────────────────────────────
render();
