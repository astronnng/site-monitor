const REFRESH_MS = Number(document.body.dataset.checkInterval) * 1000;
const historyCache = {};
const sitesByName = new Map();
const modalState = {
  mode: "add",
  originalName: null,
  isSubmitting: false,
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
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem("theme", theme); } catch (_) {}
  if (elements.themeToggle) {
    elements.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
    elements.themeToggle.querySelector(".toolbar-button-icon").textContent = theme === "dark" ? "🌙" : "☀️";
  }
}

function initTheme() {
  const saved = (() => {
    try { return localStorage.getItem("theme"); } catch (_) { return null; }
  })() || "dark";
  applyTheme(saved);
  elements.themeToggle?.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(current === "dark" ? "light" : "dark");
  });
}

function fmt(ms) {
  if (ms == null) return "–";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function timeAgo(iso) {
  const diff = Math.round((Date.now() - new Date(iso)) / 1000);
  if (diff < 5) return "agora mesmo";
  if (diff < 60) return `há ${diff}s`;
  return `há ${Math.round(diff / 60)}m`;
}

function latColor(ms) {
  if (ms == null) return "var(--muted)";
  if (ms < 300) return "var(--green)";
  if (ms < 800) return "var(--yellow)";
  return "var(--red)";
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
    return '<span class="sparkline-label">Sem histórico ainda</span>';
  }

  const maxLat = Math.max(...hist.map((entry) => entry.latency_ms || 0), 1);
  return hist.map((entry) => {
    const pct = entry.latency_ms ? Math.max(12, Math.round((entry.latency_ms / maxLat) * 100)) : 12;
    const cls = entry.status === "UP" ? "up" : "down";
    return `<div class="spark-bar ${cls}" style="height:${pct}%" title="${escapeHtml(entry.status)} | ${escapeHtml(fmt(entry.latency_ms))}"></div>`;
  }).join("");
}

function renderEmptyState() {
  return `
    <div class="empty-state">
      Nenhum site monitorado no momento. Use o botao "Adicionar site" para criar o primeiro card.
    </div>
  `;
}

function renderCard(site, hist) {
  const status = site.status || "PENDING";
  const dotCls = status === "UP" ? "up" : status === "DOWN" ? "down" : "pending";
  const checkedAt = site.checked_at ? timeAgo(site.checked_at) : "pendente";
  const siteName = escapeHtml(site.name);
  const siteUrl = escapeHtml(site.url);
  const errorLine = site.error ? `<div class="site-error">Atencao: ${escapeHtml(site.error)}</div>` : "";
  const httpCode = site.status_code ?? "–";

  return `
    <article class="site-card status-${status}" id="${siteDomId(site.name)}" data-site-name="${siteName}">
      <div class="card-header">
        <div class="card-title-row">
          <div class="site-title-block">
            <h3 class="site-name">
              <span class="pulse-dot ${dotCls}"></span>
              <span>${siteName}</span>
            </h3>
            <div class="site-url">${siteUrl}</div>
          </div>
        </div>

        <div class="card-actions">
          <button class="action-button action-button-edit" type="button" data-action="edit" data-site-name="${siteName}" aria-label="Editar ${siteName}">
            ✏️
          </button>
          <button class="action-button action-button-danger" type="button" data-action="delete" data-site-name="${siteName}" aria-label="Excluir ${siteName}">
            🗑️
          </button>
        </div>
      </div>

      <div class="status-badge badge-${status}">${escapeHtml(status)}</div>

      <div class="meta-row">
        <div class="meta-item">
          <span class="mlabel">Latencia</span>
          <span class="mvalue" style="color:${latColor(site.latency_ms)}">${escapeHtml(fmt(site.latency_ms))}</span>
        </div>
        <div class="meta-item">
          <span class="mlabel">HTTP</span>
          <span class="mvalue">${escapeHtml(String(httpCode))}</span>
        </div>
        <div class="meta-item">
          <span class="mlabel">Ultima verificacao</span>
          <span class="mvalue">${escapeHtml(checkedAt)}</span>
        </div>
      </div>

      ${errorLine}

      <div class="sparkline-wrap">
        <div class="sparkline-label">Ultimas ${hist ? hist.length : 0} verificacoes</div>
        <div class="sparkline">${buildSparkline(hist)}</div>
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
    elements.modalFeedback.textContent = "";
    elements.modalFeedback.className = "modal-feedback";
    return;
  }

  elements.modalFeedback.hidden = false;
  elements.modalFeedback.textContent = message;
  elements.modalFeedback.className = `modal-feedback is-${type}`;
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
    : (modalState.mode === "edit" ? "Salvar alteracoes" : "Adicionar site");
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
  elements.modal.classList.add("is-open");
  elements.modal.setAttribute("aria-hidden", "false");
  setTimeout(() => elements.siteName.focus(), 0);
}

function closeModal() {
  if (modalState.isSubmitting) return;
  elements.modal.classList.remove("is-open");
  elements.modal.setAttribute("aria-hidden", "true");
  elements.siteForm.reset();
  setModalFeedback("");
}

function openAddModal() {
  openModal({
    mode: "add",
    title: "Adicionar site",
    submitLabel: "Adicionar site",
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
    card.classList.toggle("is-busy", isBusy);
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
    updateSummary({
      total: sitesByName.size,
      up: [...sitesByName.values()].filter((entry) => entry.status === "UP").length,
      down: [...sitesByName.values()].filter((entry) => entry.status !== "UP").length,
      avg_latency_ms: (() => {
        const lats = [...sitesByName.values()].map((entry) => entry.latency_ms).filter((value) => value != null);
        return lats.length ? Math.round(lats.reduce((sum, value) => sum + value, 0) / lats.length) : null;
      })(),
    });
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
      if (modalState.originalName !== name) {
        delete historyCache[modalState.originalName];
      }
    } else {
      await fetchJson("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url }),
      });
    }

    setModalFeedback("Alteracoes salvas com sucesso.", "success");
    await refresh();
    setTimeout(closeModal, 220);
  } catch (error) {
    setModalFeedback(error.message || "Erro ao salvar site.");
  } finally {
    setModalSubmitting(false);
  }
}

async function refresh() {
  try {
    const data = await fetchJson("/api/status");
    sitesByName.clear();
    data.sites.forEach((site) => sitesByName.set(site.name, site));

    updateSummary(data.summary);
    elements.lastUpdated.textContent = `Atualizado ${new Date(data.generated_at).toLocaleTimeString()}`;
    elements.refreshBadge.textContent = `A cada ${REFRESH_MS / 1000}s`;

    await Promise.all(data.sites.map((site) => fetchHistory(site.name)));
    renderSites(data.sites);
    elements.loader.classList.add("hide");
  } catch (error) {
    console.error("Erro ao atualizar:", error);
    elements.lastUpdated.textContent = "Falha ao atualizar dados";
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

    if (action === "edit") {
      openEditModal(siteName);
    } else if (action === "delete") {
      handleDelete(siteName);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  bindEvents();
  refresh();
  setInterval(refresh, REFRESH_MS);
});
