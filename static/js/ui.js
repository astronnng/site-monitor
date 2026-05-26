const MONITOR_INTERVAL_MS = Number(document.body.dataset.checkInterval) * 1000;
const UI_REFRESH_MS = Math.min(5000, Math.max(2000, Math.floor(MONITOR_INTERVAL_MS / 3) || 3000));

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

const elements = {
  loader: document.getElementById("loader"),
  sitesGrid: document.getElementById("sites-grid"),
  lastUpdated: document.getElementById("last-updated"),
  refreshBadge: document.getElementById("refresh-badge"),
  themeToggle: document.getElementById("theme-toggle"),
  addSiteBtn: document.getElementById("add-site-btn"),
  total: document.getElementById("s-total"),
  up: document.getElementById("s-up"),
  down: document.getElementById("s-down"),
  lat: document.getElementById("s-lat"),
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

function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  try { localStorage.setItem("theme", theme); } catch (_) {}
  if (elements.themeToggle) {
    elements.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
    const icon = elements.themeToggle.querySelector(".toolbar-button-icon");
    if (icon) icon.textContent = theme === "dark" ? "◐" : "◑";
  }
}

function initTheme() {
  const saved = (() => {
    try { return localStorage.getItem("theme"); } catch (_) { return null; }
  })() || "dark";
  applyTheme(saved);
  elements.themeToggle?.addEventListener("click", () => {
    const current = document.body.getAttribute("data-theme") || "dark";
    applyTheme(current === "dark" ? "light" : "dark");
  });
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

function latColorClass(ms) {
  if (ms == null) return "text-slate-400";
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

function buildSparkline(hist) {
  if (!hist || hist.length === 0) {
    return '<span class="text-xs text-slate-400">Sem historico ainda</span>';
  }

  const maxLat = Math.max(...hist.map((entry) => entry.latency_ms || 0), 1);
  return hist.map((entry) => {
    const pct = entry.latency_ms ? Math.max(12, Math.round((entry.latency_ms / maxLat) * 100)) : 12;
    const cls = entry.status === "UP"
      ? "from-emerald-300 to-emerald-500"
      : "from-rose-300 to-rose-500";
    return `<div class="flex-1 rounded-t-full rounded-b-sm bg-gradient-to-b ${cls}" style="height:${pct}%" title="${escapeHtml(entry.status)} | ${escapeHtml(fmt(entry.latency_ms))}"></div>`;
  }).join("");
}

function renderEmptyState() {
  return `
    <div class="col-span-full grid gap-2 rounded-[1.75rem] border border-dashed border-white/15 bg-slate-900/60 px-6 py-10 text-center text-slate-300">
      <strong class="text-lg text-white">Nenhum site monitorado.</strong>
      <span class="text-sm text-slate-400">Adicione um novo alvo para ver o painel ser atualizado automaticamente.</span>
    </div>
  `;
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
  if (status === "UP") return "bg-emerald-400 shadow-[0_0_0_0_rgba(52,211,153,0.45)] animate-pulse";
  if (status === "DOWN") return "bg-rose-400";
  return "bg-amber-300";
}

function renderCard(site, hist) {
  const status = site.status || "PENDING";
  const checkedAt = timeAgo(site.checked_at);
  const siteName = escapeHtml(site.name);
  const siteUrl = escapeHtml(site.url);
  const errorLine = site.error
    ? `<div class="rounded-2xl border border-rose-400/15 bg-rose-400/10 px-4 py-3 text-sm leading-6 text-rose-200">Atencao: ${escapeHtml(site.error)}</div>`
    : "";
  const httpCode = site.status_code ?? "–";

  return `
    <article class="site-card rounded-[1.75rem] border ${cardBorder(status)} bg-slate-900/75 p-5 shadow-card backdrop-blur transition hover:-translate-y-1 hover:bg-slate-900/90" id="${siteDomId(site.name)}" data-site-name="${siteName}">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <span class="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">${status === "UP" ? "Saudavel" : status === "DOWN" ? "Instavel" : "Pendente"}</span>
          <h3 class="mt-3 flex items-center gap-3 text-2xl font-semibold tracking-tight text-white">
            <span class="h-3 w-3 rounded-full ${pulseClass(status)}"></span>
            <span class="truncate">${siteName}</span>
          </h3>
          <div class="mt-2 truncate text-sm text-slate-400">${siteUrl}</div>
        </div>

        <div class="flex flex-wrap justify-end gap-2">
          <button class="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 text-sm font-medium text-slate-100 transition hover:bg-white/10" type="button" data-action="edit" data-site-name="${siteName}" aria-label="Editar ${siteName}">
            Editar
          </button>
          <button class="inline-flex min-h-10 items-center justify-center rounded-full border border-rose-400/15 bg-rose-400/10 px-4 text-sm font-medium text-rose-200 transition hover:bg-rose-400/20" type="button" data-action="delete" data-site-name="${siteName}" aria-label="Excluir ${siteName}">
            Excluir
          </button>
        </div>
      </div>

      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] ${statusBadge(status)}">${escapeHtml(status)}</div>
        <span class="text-sm text-slate-400">${escapeHtml(checkedAt)}</span>
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <div class="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
          <span class="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Latencia</span>
          <span class="mt-3 block text-lg font-semibold ${latColorClass(site.latency_ms)}">${escapeHtml(fmt(site.latency_ms))}</span>
        </div>
        <div class="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
          <span class="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">HTTP</span>
          <span class="mt-3 block text-lg font-semibold text-white">${escapeHtml(String(httpCode))}</span>
        </div>
        <div class="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
          <span class="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Sincronia</span>
          <span class="mt-3 block text-lg font-semibold text-white">${status === "PENDING" ? "Aguardando" : "Em dia"}</span>
        </div>
      </div>

      ${errorLine}

      <div class="grid gap-3">
        <div class="flex items-center justify-between gap-3">
          <span class="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Historico recente</span>
          <span class="text-xs text-slate-500">${hist ? hist.length : 0} pontos</span>
        </div>
        <div class="flex min-h-[46px] items-end gap-1.5">
          ${buildSparkline(hist)}
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

async function fetchHistory(siteName) {
  try {
    const data = await fetchJson(`/api/history/${encodeURIComponent(siteName)}`);
    historyCache[siteName] = data.history || [];
  } catch (_) {}
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
    ? "rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200"
    : "rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200";
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
  data.sites.forEach((site) => sitesByName.set(site.name, site));

  updateSummary(data.summary);
  elements.lastUpdated.textContent = `Atualizado ${new Date(data.generated_at).toLocaleTimeString()}`;
  elements.refreshBadge.textContent = `Interface ${UI_REFRESH_MS / 1000}s • Monitor ${MONITOR_INTERVAL_MS / 1000}s`;

  await Promise.all(data.sites.map((site) => fetchHistory(site.name)));
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
    const data = await fetchJson("/api/status");
    await applySnapshot(data);
  } catch (error) {
    console.error("Erro ao atualizar:", error);
    elements.lastUpdated.textContent = "Falha ao sincronizar";
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
    await fetchJson(`/api/sites/${encodeURIComponent(siteName)}`, { method: "DELETE" });
    sitesByName.delete(siteName);
    delete historyCache[siteName];
    renderSites([...sitesByName.values()]);
    await refresh();
  } catch (error) {
    alert(error.message || "Erro ao excluir site");
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
      await fetchJson(`/api/sites/${encodeURIComponent(modalState.originalName)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url }),
      });
      if (modalState.originalName !== name) delete historyCache[modalState.originalName];
    } else {
      await fetchJson("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url }),
      });
    }

    await refresh();
    setModalFeedback("Painel atualizado com sucesso.", "success");
    setTimeout(closeModal, 220);
  } catch (error) {
    setModalFeedback(error.message || "Erro ao salvar site.");
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

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  bindEvents();
  refresh();
});
