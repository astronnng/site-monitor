// UI behavior extracted from templates/index.html
// Handles data refresh and theme toggle

// Theme helpers
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('theme', theme); } catch (e) {}
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '🌙' : '☀️';
  if (btn) btn.setAttribute('aria-pressed', theme === 'dark');
}

function initTheme() {
  const saved = (function(){ try { return localStorage.getItem('theme'); } catch(e){ return null; } })() || 'dark';
  applyTheme(saved);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
}

// --- existing page JS (refactored) ---
const REFRESH_MS = Number(document.body.dataset.checkInterval) * 1000;
const historyCache = {};

function fmt(ms) {
  if (ms == null) return '–';
  if (ms < 1000) return ms + ' ms';
  return (ms/1000).toFixed(1) + ' s';
}

function timeAgo(iso) {
  const diff = Math.round((Date.now() - new Date(iso)) / 1000);
  if (diff < 5)  return 'agora mesmo';
  if (diff < 60) return 'há ' + diff + 's';
  return 'há ' + Math.round(diff/60) + 'm';
}

function latColor(ms) {
  if (ms == null) return 'var(--muted)';
  if (ms < 300)  return 'var(--green)';
  if (ms < 800)  return 'var(--yellow)';
  return 'var(--red)';
}

function buildSparkline(hist) {
  if (!hist || hist.length === 0) return '<span style="color:var(--muted);font-size:.7rem">Sem histórico</span>';
  const maxLat = Math.max(...hist.map(h => h.latency_ms || 0), 1);
  return hist.map(h => {
    const pct = h.latency_ms ? Math.max(10, Math.round((h.latency_ms / maxLat) * 100)) : 10;
    const cls = h.status === 'UP' ? 'up' : 'down';
    return `<div class="spark-bar ${cls}" style="height:${pct}%" title="${h.status} | ${fmt(h.latency_ms)}"></div>`;
  }).join('');
}

function renderCard(site, hist) {
  const st    = site.status || 'PENDING';
  const dotCls = st === 'UP' ? 'up' : 'down';
  const code   = site.status_code ? `<span style="color:var(--muted);font-size:.8rem">(${site.status_code})</span>` : '';
  const errLine = site.error ? `<div style="color:var(--red);font-size:.75rem;margin-top:4px">⚠ ${site.error}</div>` : '';
  const checkedAt = site.checked_at ? timeAgo(site.checked_at) : 'pendente…';
  const spark = buildSparkline(hist);

  return `
      <div class="site-card status-${st}" id="card-${site.name.replace(/\s/g,'_')}">
        <div class="card-header">
          <span style="display:flex;align-items:center;gap:12px">
            <span class="site-name"><span class="pulse-dot ${dotCls}"></span>${site.name}</span>
            <button onclick="openEditModal('${site.name.replace(/'/g,"\\'") }')" style="background:transparent;border:0;color:var(--muted);cursor:pointer">✏️</button>
            <button onclick="deleteSite('${site.name.replace(/'/g,"\\'") }')" style="background:transparent;border:0;color:var(--muted);cursor:pointer">🗑️</button>
          </span>
          <span class="badge badge-${st}">${st}</span>
        </div>
        <div class="site-url">${site.url}</div>
        <div class="meta-row">
          <div class="meta-item">
            <span class="mlabel">Latência</span>
            <span class="mvalue" style="color:${latColor(site.latency_ms)}">${fmt(site.latency_ms)}</span>
          </div>
          <div class="meta-item">
            <span class="mlabel">HTTP</span>
            <span class="mvalue">${site.status_code ?? '–'}</span>
          </div>
          <div class="meta-item">
            <span class="mlabel">Última verificação</span>
            <span class="mvalue" style="color:var(--muted)">${checkedAt}</span>
          </div>
        </div>
        ${errLine}
        <div class="sparkline-wrap">
          <div class="sparkline-label">Últimas ${hist ? hist.length : 0} verificações</div>
          <div class="sparkline">${spark}</div>
        </div>
      </div>`;
}

async function fetchHistory(siteName) {
  try {
    const r = await fetch(`/api/history/${encodeURIComponent(siteName)}`);
    const d = await r.json();
    historyCache[siteName] = d.history || [];
  } catch (_) {}
}

// Modal / CRUD functions
function showModal(title, submitLabel, name = '', url = '', onSubmit=null) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('site-name').value = name;
  document.getElementById('site-url').value = url;
  document.getElementById('modal-submit').textContent = submitLabel;
  document.getElementById('modal-feedback').style.display = 'none';
  document.getElementById('site-modal').style.display = 'flex';
  const submit = async () => {
    const n = document.getElementById('site-name').value.trim();
    const u = document.getElementById('site-url').value.trim();
    if (!n || !u) {
      const fb = document.getElementById('modal-feedback'); fb.textContent = 'Nome e URL são obrigatórios'; fb.style.display = 'block'; return;
    }
    try {
      await onSubmit(n,u);
      document.getElementById('site-modal').style.display = 'none';
      refresh();
    } catch (err) {
      const fb = document.getElementById('modal-feedback'); fb.textContent = err.message || 'Erro'; fb.style.display = 'block';
    }
  };
  document.getElementById('modal-submit').onclick = submit;
  document.getElementById('modal-cancel').onclick = () => { document.getElementById('site-modal').style.display = 'none'; };
}

async function openAddModal(){
  showModal('Adicionar site','Adicionar','', '', async (n,u)=>{
    const r = await fetch('/api/sites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,url:u})});
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
  });
}

async function openEditModal(name){
  // fetch existing url
  const card = document.getElementById('card-'+name.replace(/\s/g,'_'));
  const url = card ? card.querySelector('.site-url').textContent.trim() : '';
  showModal('Editar site','Salvar', name, url, async (n,u)=>{
    const r = await fetch('/api/sites/'+encodeURIComponent(name),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,url:u})});
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
  });
}

async function deleteSite(name){
  if (!confirm('Remover site "'+name+'"?')) return;
  const r = await fetch('/api/sites/'+encodeURIComponent(name),{method:'DELETE'});
  if (!r.ok) { alert((await r.json()).error || 'Erro'); return; }
  refresh();
}

async function refresh() {
  try {
    const r = await fetch('/api/status');
    const d = await r.json();

    // summary
    document.getElementById('s-total').textContent = d.summary.total;
    document.getElementById('s-up').textContent    = d.summary.up;
    document.getElementById('s-down').textContent  = d.summary.down;
    document.getElementById('s-lat').textContent   = d.summary.avg_latency_ms != null
      ? d.summary.avg_latency_ms + ' ms' : '–';

    const ts = new Date(d.generated_at);
    document.getElementById('last-updated').textContent =
      'Última atualização: ' + ts.toLocaleTimeString();

    // fetch histories in parallel
    await Promise.all(d.sites.map(s => fetchHistory(s.name)));

    // render cards
    const grid = document.getElementById('sites-grid');
    grid.innerHTML = d.sites.map(s => renderCard(s, historyCache[s.name] || [])).join('');

    // hide loader
    document.getElementById('loader').classList.add('hide');
  } catch (e) {
    console.error('Erro ao atualizar:', e);
  }
}

// attach UI handlers + init
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  const addBtn = document.getElementById('add-site-btn');
  if (addBtn) addBtn.addEventListener('click', openAddModal);

  // initial + interval
  refresh();
  setInterval(refresh, REFRESH_MS);
});
