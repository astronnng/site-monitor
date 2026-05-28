const MONITOR_INTERVAL_MS = (() => {
  try {
    return Number(document.body.dataset.checkInterval) * 1000;
  } catch (_) {
    return 30000;
  }
})();
const UI_REFRESH_MS = Math.max(5000, MONITOR_INTERVAL_MS || 30000);

const historyCache = {};
const sitesByName = new Map();
const modalState = {
  mode: "add",
  originalName: null,
  isSubmitting: false,
};

const refreshState = {
  inFlight: false,
  queued: false,
  timerId: null,
};

// ── Error State for Persistent Display ──────────────────────────────────────────
const errorState = {
  lastRefreshError: null,
  lastRefreshTime: null,
  acknowledgeError: function(source = null) {
    if (source === "refresh" || !source) {
      this.lastRefreshError = null;
    }
  }
};

const elements = {
  loader: document.getElementById("loader"),
  sitesGrid: document.getElementById("sites-grid"),
  lastUpdated: document.getElementById("last-updated"),
  lastUpdatedMeta: document.getElementById("last-updated-meta"),
  refreshBadge: document.getElementById("refresh-badge"),
  themeToggle: document.getElementById("theme-toggle"),
  addSiteBtn: document.getElementById("add-site-btn"),
  total: document.getElementById("s-total"),
  up: document.getElementById("s-up"),
  down: document.getElementById("s-down"),
  lat: document.getElementById("s-lat"),
  donut: document.getElementById("summary-donut"),
  legend: document.getElementById("summary-legend"),
  modal: document.getElementById("site-modal"),
  modalTitle: document.getElementById("modal-title"),
  modalClose: document.getElementById("modal-close"),
  modalCancel: document.getElementById("modal-cancel"),
  modalSubmit: document.getElementById("modal-submit"),
  modalFeedback: document.getElementById("modal-feedback"),
  siteForm: document.getElementById("site-form"),
  siteName: document.getElementById("site-name"),
  siteUrl: document.getElementById("site-url"),
};

const ELEMENT_IDS = {
  loader: "loader",
  sitesGrid: "sites-grid",
  lastUpdated: "last-updated",
  lastUpdatedMeta: "last-updated-meta",
  refreshBadge: "refresh-badge",
  themeToggle: "theme-toggle",
  addSiteBtn: "add-site-btn",
  total: "s-total",
  up: "s-up",
  down: "s-down",
  lat: "s-lat",
  donut: "summary-donut",
  legend: "summary-legend",
  modal: "site-modal",
  modalTitle: "modal-title",
  modalClose: "modal-close",
  modalCancel: "modal-cancel",
  modalSubmit: "modal-submit",
  modalFeedback: "modal-feedback",
  siteForm: "site-form",
  siteName: "site-name",
  siteUrl: "site-url",
};

function ensureElements() {
  Object.keys(ELEMENT_IDS).forEach((key) => {
    if (!elements[key]) {
      elements[key] = document.getElementById(ELEMENT_IDS[key]);
    }
  });
}

function applyTheme(theme) {
  ensureElements();
  document.documentElement.setAttribute("data-theme", theme);
  if (document.body) document.body.setAttribute("data-theme", theme);
  try { localStorage.setItem("theme", theme); } catch (_) {}
  if (elements.themeToggle) {
    elements.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
    const icon = elements.themeToggle.querySelector(".toolbar-button-icon");
    const label = elements.themeToggle.querySelector(".toolbar-button-label");
    if (icon) icon.textContent = theme === "dark" ? "☾" : "☀";
    if (label) label.textContent = theme === "dark" ? "Tema escuro" : "Tema claro";
    elements.themeToggle.setAttribute("aria-label", theme === "dark" ? "Alternar para tema claro" : "Alternar para tema escuro");
    elements.themeToggle.classList.toggle("border-sky-300", theme === "light");
    elements.themeToggle.classList.toggle("bg-sky-50", theme === "light");
    elements.themeToggle.classList.toggle("ring-2", theme === "dark");
    elements.themeToggle.classList.toggle("ring-sky-400/20", theme === "dark");
  }
}

function initTheme() {
  const saved = (() => {
    try { return localStorage.getItem("theme"); } catch (_) { return null; }
  })() || "dark";
  ensureElements();
  applyTheme(saved);
  const toggleEl = elements.themeToggle || document.getElementById("theme-toggle");
  if (toggleEl) {
    toggleEl.addEventListener("click", () => {
      const current = document.body.getAttribute("data-theme") || "dark";
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
    });
  }
}

function fmt(ms) {
  if (ms == null) return "–";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function timeAgo(iso) {
  if (!iso) return "aguardando primeira checagem";
  const diff = Math.round((Date.now() - new Date(iso)) / 1000);
  if (diff < 5) return "agora mesmo";
  if (diff < 60) return `há ${diff}s`;
  return `há ${Math.round(diff / 60)}m`;
}

function formatLastUpdated(iso) {
  if (!iso) {
    return {
      headline: "Aguardando dados...",
      meta: "Sincronizacao inicial em andamento",
    };
  }

  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return {
    headline: sameDay
      ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
    meta: `Sincronizado ${timeAgo(iso)}`,
  };
}

function latColorClass(ms) {
  if (ms == null) return "text-shell-500 dark:text-slate-400";
  if (ms < 300) return "text-emerald-400";
  if (ms < 800) return "text-amber-300";
  return "text-rose-400";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function siteDomId(name) {
  return `card-${name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function statusBadge(status) {
  if (status === "UP") return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
  if (status === "DOWN") return "border-rose-400/20 bg-rose-400/10 text-rose-300";
  return "border-amber-400/20 bg-amber-400/10 text-amber-300";
}

function cardBorder(status) {
  if (status === "UP") return "border-emerald-400/15";
  if (status === "DOWN") return "border-rose-400/15";
  return "border-amber-400/15";
}

function pulseClass(status) {
  if (status === "UP") return "bg-emerald-400";
  if (status === "DOWN") return "bg-rose-400";
  return "bg-amber-300";
}

function renderEmptyState() {
  return `
    <div class="col-span-full grid gap-2 rounded-[1.75rem] border border-dashed border-shell-300 bg-white/80 px-6 py-10 text-center text-shell-700 shadow-card dark:border-white/15 dark:bg-slate-900/60 dark:text-slate-300">
      <strong class="text-lg text-shell-900 dark:text-white">Nenhum site monitorado.</strong>
      <span class="text-sm text-shell-500 dark:text-slate-400">Adicione um novo alvo para ver o painel ser atualizado automaticamente.</span>
    </div>
  `;
}

function buildStatusTimeline(hist) {
  if (!hist || hist.length === 0) {
    return '<span class="text-xs text-shell-500 dark:text-slate-400">Sem historico ainda</span>';
  }

  return hist.map((entry) => {
    let colorClass = "bg-amber-300/70";
    if (entry.status === "UP") colorClass = "bg-emerald-400";
    if (entry.status === "DOWN") colorClass = "bg-rose-400";
    const title = `${entry.status} | ${entry.checked_at ? new Date(entry.checked_at).toLocaleTimeString() : "sem horario"} | ${fmt(entry.latency_ms)}`;
    return `<div class="h-6 flex-1 rounded-md ${colorClass}" title="${escapeHtml(title)}"></div>`;
  }).join("");
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

function renderSummaryDonut(summary, sites) {
  const total = summary.total || 0;
  if (!total) {
    elements.donut.innerHTML = '<div class="flex h-full items-center justify-center text-sm text-shell-500 dark:text-slate-400">Sem dados</div>';
    elements.legend.innerHTML = "";
    return;
  }

  const pending = Math.max(0, sites.filter((site) => (site.status || "PENDING") === "PENDING").length);
  const segments = [
    { label: "Online", value: summary.up, color: "#34d399", textClass: "text-emerald-300", bgClass: "bg-emerald-400" },
    { label: "Offline", value: summary.down, color: "#fb7185", textClass: "text-rose-300", bgClass: "bg-rose-400" },
    { label: "Pendente", value: pending, color: "#fbbf24", textClass: "text-amber-300", bgClass: "bg-amber-300" },
  ].filter((segment) => segment.value > 0);

  let currentAngle = 0;
  const paths = segments.map((segment) => {
    const sweep = (segment.value / total) * 360;
    const path = describeArc(60, 60, 42, currentAngle, currentAngle + sweep);
    currentAngle += sweep;
    return `<path d="${path}" stroke="${segment.color}" stroke-width="14" fill="none" stroke-linecap="round"></path>`;
  }).join("");

  elements.donut.innerHTML = `
    <svg viewBox="0 0 120 120" class="h-full w-full" aria-hidden="true">
      <circle cx="60" cy="60" r="42" fill="none" stroke="rgba(148,163,184,0.18)" stroke-width="14"></circle>
      ${paths}
      <text x="60" y="56" text-anchor="middle" class="fill-shell-900 dark:fill-white text-[14px] font-semibold">${total}</text>
      <text x="60" y="74" text-anchor="middle" class="fill-shell-500 dark:fill-slate-400 text-[8px] uppercase tracking-[0.24em]">sites</text>
    </svg>
  `;

  elements.legend.innerHTML = segments.map((segment) => `
    <div class="flex items-center justify-between gap-3 rounded-2xl border border-shell-200 bg-shell-50 px-4 py-3 dark:border-white/10 dark:bg-slate-950/30">
      <div class="flex items-center gap-3">
        <span class="h-2.5 w-2.5 rounded-full ${segment.bgClass}"></span>
        <span class="text-sm text-shell-700 dark:text-slate-300">${segment.label}</span>
      </div>
      <strong class="text-sm font-semibold ${segment.textClass}">${segment.value}</strong>
    </div>
  `).join("");
}

function renderCard(site, hist) {
  const status = site.status || "PENDING";
  const checkedAt = timeAgo(site.checked_at);
  const siteName = escapeHtml(site.name);
  const siteUrl = escapeHtml(site.url);
  const errorLine = site.error
    ? `<div class="rounded-2xl border border-rose-400/20 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700 dark:border-rose-400/15 dark:bg-rose-400/10 dark:text-rose-200">Atencao: ${escapeHtml(site.error)}</div>`
    : "";
  const httpCode = site.status_code ?? "–";

  return `
    <article class="site-card rounded-[1.75rem] border border-shell-200 ${cardBorder(status)} bg-white p-5 shadow-card dark:bg-slate-900" id="${siteDomId(site.name)}" data-site-name="${siteName}">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <span class="text-[11px] font-semibold uppercase tracking-[0.24em] text-shell-500 dark:text-slate-400">${status === "UP" ? "Saudavel" : status === "DOWN" ? "Instavel" : "Pendente"}</span>
          <h3 class="mt-3 flex items-center gap-3 text-2xl font-semibold tracking-tight text-shell-900 dark:text-white">
            <span class="h-3 w-3 rounded-full ${pulseClass(status)}"></span>
            <span class="truncate">${siteName}</span>
          </h3>
          <div class="mt-2 truncate text-sm text-shell-500 dark:text-slate-400">${siteUrl}</div>
        </div>

        <div class="flex flex-wrap justify-end gap-2">
          <button class="inline-flex min-h-10 items-center justify-center rounded-full border border-shell-200 bg-shell-50 px-4 text-sm font-medium text-shell-800 hover:bg-shell-100 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10" type="button" data-action="edit" data-site-name="${siteName}" aria-label="Editar ${siteName}">
            Editar
          </button>
          <button class="inline-flex min-h-10 items-center justify-center rounded-full border border-rose-300/40 bg-rose-50 px-4 text-sm font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-400/15 dark:bg-rose-400/10 dark:text-rose-200 dark:hover:bg-rose-400/20" type="button" data-action="delete" data-site-name="${siteName}" aria-label="Excluir ${siteName}">
            Excluir
          </button>
        </div>
      </div>

      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] ${statusBadge(status)}">${escapeHtml(status)}</div>
        <span class="text-sm text-shell-500 dark:text-slate-400">${escapeHtml(checkedAt)}</span>
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <div class="rounded-2xl border border-shell-200 bg-shell-50 p-4 dark:border-white/10 dark:bg-slate-950/30">
          <span class="text-[11px] font-semibold uppercase tracking-[0.24em] text-shell-500 dark:text-slate-500">Latencia</span>
          <span class="mt-3 block text-lg font-semibold ${latColorClass(site.latency_ms)}">${escapeHtml(fmt(site.latency_ms))}</span>
        </div>
        <div class="rounded-2xl border border-shell-200 bg-shell-50 p-4 dark:border-white/10 dark:bg-slate-950/30">
          <span class="text-[11px] font-semibold uppercase tracking-[0.24em] text-shell-500 dark:text-slate-500">HTTP</span>
          <span class="mt-3 block text-lg font-semibold text-shell-900 dark:text-white">${escapeHtml(String(httpCode))}</span>
        </div>
        <div class="rounded-2xl border border-shell-200 bg-shell-50 p-4 dark:border-white/10 dark:bg-slate-950/30">
          <span class="text-[11px] font-semibold uppercase tracking-[0.24em] text-shell-500 dark:text-slate-500">Sincronia</span>
          <span class="mt-3 block text-lg font-semibold text-shell-900 dark:text-white">${status === "PENDING" ? "Aguardando" : "Em dia"}</span>
        </div>
      </div>

      ${errorLine}

      <div class="grid gap-3">
        <div class="flex items-center justify-between gap-3">
          <span class="text-[11px] font-semibold uppercase tracking-[0.24em] text-shell-500 dark:text-slate-400">Timeline recente</span>
          <span class="text-xs text-shell-500 dark:text-slate-500">${hist ? hist.length : 0} checks</span>
        </div>
        <div class="flex min-h-[24px] items-center gap-1.5">
          ${buildStatusTimeline(hist)}
        </div>
      </div>
    </article>
  `;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new Error(payload?.error || "Erro inesperado");
  }

  return payload;
}

// ── Retry Logic with Exponential Backoff ────────────────────────────────────────
async function fetchWithRetry(url, options = {}, maxAttempts = 3) {
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchJson(url, options);
    } catch (error) {
      lastError = error;
      
      if (attempt < maxAttempts) {
        // Exponential backoff: 1s, 2s, 4s
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        console.warn(`Tentativa ${attempt}/${maxAttempts} falhou (${error.message}). Tentando novamente em ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  throw lastError || new Error("Falha permanente após todas as tentativas");
}

function setModalFeedback(message, type = "error") {
  if (!message) {
    elements.modalFeedback.hidden = true;
    elements.modalFeedback.className = "hidden rounded-2xl border px-4 py-3 text-sm";
    elements.modalFeedback.textContent = "";
    return;
  }

  elements.modalFeedback.hidden = false;
  elements.modalFeedback.className = type === "success"
    ? "rounded-2xl border border-emerald-400/20 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200"
    : "rounded-2xl border border-rose-400/20 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-400/10 dark:text-rose-200";
  elements.modalFeedback.textContent = message;
}

function setModalSubmitting(isSubmitting) {
  modalState.isSubmitting = isSubmitting;
  elements.modalSubmit.disabled = isSubmitting;
  elements.modalCancel.disabled = isSubmitting;
  elements.modalClose.disabled = isSubmitting;
  elements.siteName.disabled = isSubmitting;
  elements.siteUrl.disabled = isSubmitting;
  elements.modalSubmit.textContent = isSubmitting
    ? (modalState.mode === "edit" ? "Salvando..." : "Adicionando...")
    : (modalState.mode === "edit" ? "Salvar alteracoes" : "Adicionar");
}

function openModal({ mode, title, submitLabel, site = null }) {
  modalState.mode = mode;
  modalState.originalName = site?.name || null;
  elements.modalTitle.textContent = title;
  elements.modalSubmit.textContent = submitLabel;
  elements.siteName.value = site?.name || "";
  elements.siteUrl.value = site?.url || "";
  setModalFeedback("");
  setModalSubmitting(false);
  elements.modal.classList.remove("hidden");
  elements.modal.classList.add("flex");
  elements.modal.setAttribute("aria-hidden", "false");
  setTimeout(() => elements.siteName.focus(), 0);
}

function closeModal() {
  if (modalState.isSubmitting) return;
  elements.modal.classList.add("hidden");
  elements.modal.classList.remove("flex");
  elements.modal.setAttribute("aria-hidden", "true");
  elements.siteForm.reset();
  setModalFeedback("");
}

function openAddModal() {
  openModal({
    mode: "add",
    title: "Adicionar site",
    submitLabel: "Adicionar",
  });
}

function openEditModal(siteName) {
  const site = sitesByName.get(siteName);
  if (!site) return;
  openModal({
    mode: "edit",
    title: "Editar site",
    submitLabel: "Salvar alteracoes",
    site,
  });
}

function renderSites(sites) {
  if (!sites.length) {
    elements.sitesGrid.innerHTML = renderEmptyState();
    return;
  }
  elements.sitesGrid.innerHTML = sites.map((site) => renderCard(site, historyCache[site.name] || [])).join("");
}

function updateSummary(summary) {
  elements.total.textContent = summary.total;
  elements.up.textContent = summary.up;
  elements.down.textContent = summary.down;
  elements.lat.textContent = summary.avg_latency_ms != null ? `${summary.avg_latency_ms} ms` : "–";
}

function markCardBusy(siteName, isBusy) {
  const card = document.getElementById(siteDomId(siteName));
  if (card) {
    card.classList.toggle("opacity-60", isBusy);
  }
}

function scheduleRefresh(delay = UI_REFRESH_MS) {
  if (refreshState.timerId) clearTimeout(refreshState.timerId);
  refreshState.timerId = setTimeout(() => {
    refreshState.timerId = null;
    refresh();
  }, delay);
}

async function applySnapshot(data) {
  sitesByName.clear();
  data.sites.forEach((site) => {
    sitesByName.set(site.name, site);
    historyCache[site.name] = site.history || [];
  });

  Object.keys(historyCache).forEach((siteName) => {
    if (!sitesByName.has(siteName)) delete historyCache[siteName];
  });

  updateSummary(data.summary);
  renderSummaryDonut(data.summary, data.sites);
  const updateCopy = formatLastUpdated(data.generated_at);
  elements.lastUpdated.textContent = updateCopy.headline;
  if (elements.lastUpdatedMeta) {
    elements.lastUpdatedMeta.textContent = updateCopy.meta;
  }
  elements.refreshBadge.textContent = `Interface ${UI_REFRESH_MS / 1000}s • Monitor ${MONITOR_INTERVAL_MS / 1000}s`;

  renderSites(data.sites);
  elements.loader.classList.add("opacity-0", "pointer-events-none");
  setTimeout(() => elements.loader.classList.add("hidden"), 280);
}

async function refresh() {
  if (refreshState.inFlight) {
    refreshState.queued = true;
    return;
  }

  refreshState.inFlight = true;
  refreshState.queued = false;

  try {
    const data = await fetchWithRetry("/api/status");
    await applySnapshot(data);
    errorState.acknowledgeError("refresh");
    errorState.lastRefreshTime = new Date().toLocaleTimeString("pt-BR");
  } catch (error) {
    console.error("Erro ao atualizar (após retentativas):", error);
    errorState.lastRefreshError = error.message || "Falha ao sincronizar";
    errorState.lastRefreshTime = new Date().toLocaleTimeString("pt-BR");
    
    // Display persistent error
    elements.lastUpdated.textContent = "❌ Falha ao sincronizar";
    if (elements.lastUpdatedMeta) {
      elements.lastUpdatedMeta.textContent = `${errorState.lastRefreshError} às ${errorState.lastRefreshTime}. Clique para limpar ou aguarde a próxima tentativa.`;
      elements.lastUpdatedMeta.style.cursor = "pointer";
      elements.lastUpdatedMeta.onclick = () => {
        errorState.acknowledgeError("refresh");
        elements.lastUpdatedMeta.textContent = "Sincronizando...";
        elements.lastUpdatedMeta.style.cursor = "default";
        elements.lastUpdatedMeta.onclick = null;
      };
    }
  } finally {
    refreshState.inFlight = false;
    if (refreshState.queued) {
      refreshState.queued = false;
      refresh();
    } else {
      scheduleRefresh();
    }
  }
}

async function handleDelete(siteName) {
  const site = sitesByName.get(siteName);
  if (!site) return;
  if (!confirm(`Remover o site "${site.name}"?`)) return;

  markCardBusy(siteName, true);
  try {
    await fetchWithRetry(`/api/sites/${encodeURIComponent(siteName)}`, { method: "DELETE" });
    sitesByName.delete(siteName);
    delete historyCache[siteName];
    renderSites([...sitesByName.values()]);
    await refresh();
  } catch (error) {
    alert(`Erro ao excluir site (após retentativas): ${error.message || "Erro inesperado"}`);
    markCardBusy(siteName, false);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (modalState.isSubmitting) return;

  const name = elements.siteName.value.trim();
  const url = elements.siteUrl.value.trim();

  if (!name || !url) {
    setModalFeedback("Nome e URL sao obrigatorios.");
    return;
  }

  setModalSubmitting(true);
  setModalFeedback("");

  try {
    if (modalState.mode === "edit" && modalState.originalName) {
      await fetchWithRetry(`/api/sites/${encodeURIComponent(modalState.originalName)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url }),
      });
      if (modalState.originalName !== name) delete historyCache[modalState.originalName];
    } else {
      await fetchWithRetry("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url }),
      });
    }

    await refresh();
    setModalFeedback("Painel atualizado com sucesso.", "success");
    setTimeout(closeModal, 220);
  } catch (error) {
    setModalFeedback(`${error.message || "Erro ao salvar site"} (após retentativas).`);
  } finally {
    setModalSubmitting(false);
  }
}

function bindEvents() {
  elements.addSiteBtn?.addEventListener("click", openAddModal);
  elements.modalCancel?.addEventListener("click", closeModal);
  elements.modalClose?.addEventListener("click", closeModal);
  elements.siteForm?.addEventListener("submit", handleSubmit);

  elements.modal?.addEventListener("click", (event) => {
    const shouldClose = event.target instanceof HTMLElement && event.target.dataset.closeModal === "true";
    if (shouldClose) closeModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });

  elements.sitesGrid?.addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("[data-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    const siteName = target.dataset.siteName;
    if (!action || !siteName) return;

    if (action === "edit") openEditModal(siteName);
    if (action === "delete") handleDelete(siteName);
  });
}

function startup() {
  ensureElements();
  initTheme();
  bindEvents();
  refresh();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startup);
} else {
  // DOM already parsed — run startup immediately
  startup();
}
