import { DEFAULT_SETTINGS, ExtensionSettings, ThemePreference } from "@shared/types";
import { formatDate, getDomainFromUrl, handleError } from "@shared/utils";
import { LoadingManager } from "./components/loadingManager";
import { ModalManager } from "./components/modalManager";
import { SessionList } from "./components/sessionList";
import { PopupService } from "./services/popup.service";
import { escapeHtml, getElementByIdSafe } from "./utils/dom";

const CLEAR_SITE_SENTINEL = "__CLEAR_CURRENT_SITE__";

class PopupController {
  private loadingManager = new LoadingManager();
  private modalManager = new ModalManager();
  private sessionList: SessionList;
  private popupService = new PopupService();

  private currentSiteElement: HTMLElement;
  private siteBar: HTMLElement;
  private mainContent: HTMLElement;
  private settingsView: HTMLElement;
  private allSessionsView: HTMLElement;
  private allSessionsList: HTMLElement;
  private allSessionsSummary: HTMLElement;
  private settingsBtn: HTMLButtonElement;
  private allSessionsBtn: HTMLButtonElement;
  private saveBtn: HTMLButtonElement;
  private newSessionBtn: HTMLButtonElement;
  private clearSiteSessionsBtn: HTMLButtonElement;
  private settingsStatusEl: HTMLElement;
  private importBackupInput: HTMLInputElement;
  private mainSearchInput: HTMLInputElement;
  private allSessionsSearchWrap: HTMLElement;
  private allSessionsSearchInput: HTMLInputElement;
  private settingAutoReload: HTMLInputElement;
  private settingShowBadge: HTMLInputElement;
  private settingAutoClose: HTMLInputElement;
  private restoreMode: "merge" | "replace" = "merge";
  private settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
  private tabFavicons = new Map<string, string>();
  private collapsedDomains = new Set<string>();

  constructor() {
    // Get DOM elements
    this.currentSiteElement = getElementByIdSafe("currentSite");
    this.siteBar = getElementByIdSafe("siteBar");
    this.mainContent = getElementByIdSafe("mainContent");
    this.settingsView = getElementByIdSafe("settingsView");
    this.allSessionsView = getElementByIdSafe("allSessionsView");
    this.allSessionsList = getElementByIdSafe("allSessionsList");
    this.allSessionsSummary = getElementByIdSafe("allSessionsSummary");
    this.settingsBtn = getElementByIdSafe("settingsBtn");
    this.allSessionsBtn = getElementByIdSafe("allSessionsBtn");
    this.saveBtn = getElementByIdSafe("saveBtn");
    this.newSessionBtn = getElementByIdSafe("newSessionBtn");
    this.clearSiteSessionsBtn = getElementByIdSafe("clearSiteSessionsBtn");
    this.settingsStatusEl = getElementByIdSafe("settingsStatus");
    this.importBackupInput = getElementByIdSafe("importBackupInput");
    this.mainSearchInput = getElementByIdSafe("mainSearchInput");
    this.allSessionsSearchWrap = getElementByIdSafe("allSessionsSearchWrap");
    this.allSessionsSearchInput = getElementByIdSafe("allSessionsSearchInput");
    this.settingAutoReload = getElementByIdSafe("settingAutoReload");
    this.settingShowBadge = getElementByIdSafe("settingShowBadge");
    this.settingAutoClose = getElementByIdSafe("settingAutoClose");

    // Initialize session list
    this.sessionList = new SessionList(getElementByIdSafe("sessionsList"));
    this.setupSessionListHandlers();
    this.setupEventListeners();
  }

  async initialize(): Promise<void> {
    try {
      this.modalManager.hideAllModals();
      this.setActiveView("main");
      const [theme, settings, state] = await Promise.all([
        this.popupService.getTheme(),
        this.popupService.getSettings(),
        this.loadingManager.withLoading(async () => {
          return await this.popupService.initialize();
        }),
      ]);

      this.applyTheme(theme);
      this.applySettings(settings);

      const hasValidDomain = state.currentDomain.length > 0;
      this.currentSiteElement.textContent = hasValidDomain ? state.currentDomain : "Unsupported page";
      this.currentSiteElement.parentElement?.classList.toggle("unsupported", !hasValidDomain);
      this.saveBtn.disabled = !hasValidDomain;
      this.newSessionBtn.disabled = !hasValidDomain;
      this.renderSessionsList();
    } catch (error) {
      this.showError(handleError(error, "PopupController.initialize"));
    }
  }

  getServiceInstance(): PopupService {
    return this.popupService;
  }

  private setupEventListeners(): void {
    this.saveBtn.addEventListener("click", () => this.handleSaveClick());
    this.newSessionBtn.addEventListener("click", () => this.handleNewSessionClick());

    // Modal event listeners
    getElementByIdSafe("confirmSave").addEventListener("click", () => this.handleConfirmSave());
    getElementByIdSafe("confirmRename").addEventListener("click", () => this.handleConfirmRename());
    getElementByIdSafe("confirmDelete").addEventListener("click", () => this.handleConfirmDelete());

    // Subview event listeners
    this.settingsBtn.addEventListener("click", () => {
      this.setActiveView(this.settingsView.hidden ? "settings" : "main");
    });
    this.allSessionsBtn.addEventListener("click", () => {
      void this.toggleAllSessions(this.allSessionsView.hidden);
    });
    getElementByIdSafe("settingsBackBtn").addEventListener("click", () => this.setActiveView("main"));
    getElementByIdSafe("allSessionsBackBtn").addEventListener("click", () => this.setActiveView("main"));
    this.allSessionsList.addEventListener("click", (e) => this.handleAllSessionsClick(e));
    getElementByIdSafe("exportBackupBtn").addEventListener("click", () => this.handleExportBackup());
    getElementByIdSafe("importBackupBtn").addEventListener("click", () => this.importBackupInput.click());
    this.importBackupInput.addEventListener("change", () => this.handleImportBackup());
    this.clearSiteSessionsBtn.addEventListener("click", () => this.handleClearSiteClick());

    document.querySelectorAll<HTMLButtonElement>("[data-theme-option]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const theme = btn.dataset.themeOption as ThemePreference;
        this.handleThemeChange(theme);
      });
    });

    document.querySelectorAll<HTMLButtonElement>("[data-restore-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.restoreMode = btn.dataset.restoreMode === "replace" ? "replace" : "merge";
        this.updateSegmentedState("[data-restore-mode]", "restoreMode", this.restoreMode);
      });
    });

    this.mainSearchInput.addEventListener("input", () => this.renderSessionsList());
    this.allSessionsSearchInput.addEventListener("input", () => this.renderAllSessionsList());

    const bindToggle = (el: HTMLInputElement, key: keyof ExtensionSettings) => {
      el.addEventListener("change", async () => {
        this.settings = await this.popupService.updateSettings({ [key]: el.checked });
      });
    };
    bindToggle(this.settingAutoReload, "autoReload");
    bindToggle(this.settingShowBadge, "showBadge");
    bindToggle(this.settingAutoClose, "autoClosePopup");
  }

  private setupSessionListHandlers(): void {
    this.sessionList.setEventHandlers({
      onSessionClick: (sessionId) => this.handleSessionSwitch(sessionId),
      onRenameClick: (sessionId) => this.handleRenameClick(sessionId),
      onDeleteClick: (sessionId) => this.handleDeleteClick(sessionId),
      onReorder: (sessionIds) => this.handleReorder(sessionIds),
    });
  }

  private async handleSaveClick(): Promise<void> {
    this.modalManager.showSaveModal();
  }

  private async handleConfirmSave(): Promise<void> {
    try {
      const name = this.modalManager.getSaveModalInput();
      const color = this.modalManager.getSaveModalColor();

      await this.loadingManager.withLoading(async () => {
        await this.popupService.saveCurrentSession(name, color);
      });

      this.modalManager.hideSaveModal();
      this.renderSessionsList();
    } catch (error) {
      this.showError(handleError(error, "save session"));
    }
  }

  private async handleNewSessionClick(): Promise<void> {
    try {
      await this.loadingManager.withLoading(async () => {
        await this.popupService.createNewSession();
      });

      this.renderSessionsList();
    } catch (error) {
      this.showError(handleError(error, "create new session"));
    }
  }

  private async handleSessionSwitch(sessionId: string): Promise<void> {
    try {
      await this.loadingManager.withLoading(async () => {
        await this.popupService.switchToSession(sessionId);
      });

      this.renderSessionsList();
      if (this.settings.autoClosePopup) {
        window.close();
      }
    } catch (error) {
      this.showError(handleError(error, "switch session"));
    }
  }

  private handleRenameClick(sessionId: string): void {
    const session = this.popupService.getSession(sessionId);
    if (session) {
      this.popupService.setState({ currentRenameSessionId: sessionId });
      this.modalManager.showRenameModal(session.name, session.color);
    }
  }

  private async handleConfirmRename(): Promise<void> {
    try {
      const newName = this.modalManager.getRenameModalInput();
      const color = this.modalManager.getRenameModalColor();
      const sessionId = this.popupService.getState().currentRenameSessionId;

      if (newName && sessionId) {
        await this.popupService.renameSession(sessionId, newName, color);
        this.renderSessionsList();
        if (!this.allSessionsView.hidden) {
          this.renderAllSessionsList();
        }
      }

      this.modalManager.hideRenameModal();
    } catch (error) {
      this.showError(handleError(error, "rename session"));
    }
  }

  private handleDeleteClick(sessionId: string): void {
    const session = this.popupService.getSession(sessionId);
    if (session) {
      this.popupService.setState({ currentDeleteSessionId: sessionId });
      this.modalManager.showDeleteModal(session.name);
    }
  }

  private async handleConfirmDelete(): Promise<void> {
    try {
      const sessionId = this.popupService.getState().currentDeleteSessionId;

      if (sessionId === CLEAR_SITE_SENTINEL) {
        await this.popupService.clearCurrentSiteSessions();
        this.renderSessionsList();
      } else if (sessionId) {
        await this.popupService.deleteSession(sessionId);
        this.renderSessionsList();
        if (!this.allSessionsView.hidden) {
          this.renderAllSessionsList();
        }
      }

      this.modalManager.hideDeleteModal();
    } catch (error) {
      this.showError(handleError(error, "delete session"));
    }
  }

  private setActiveView(view: "main" | "settings" | "allSessions"): void {
    const helpDetails = document.getElementById("helpDetails") as HTMLDetailsElement | null;
    if (view !== "main" && helpDetails) helpDetails.open = false;

    this.siteBar.hidden = view !== "main";
    this.mainContent.hidden = view !== "main";
    this.settingsView.hidden = view !== "settings";
    this.allSessionsView.hidden = view !== "allSessions";
    this.settingsBtn.setAttribute("aria-expanded", String(view === "settings"));
    this.allSessionsBtn.setAttribute("aria-expanded", String(view === "allSessions"));

    if (view === "settings") {
      this.setSettingsStatus("");
      this.updateClearSiteButtonState();
      getElementByIdSafe("settingsBackBtn").focus();
    } else if (view === "allSessions") {
      this.renderAllSessionsList();
      getElementByIdSafe("allSessionsBackBtn").focus();
    }
  }

  private async toggleAllSessions(open: boolean): Promise<void> {
    if (!open) {
      this.setActiveView("main");
      return;
    }

    await this.loadOpenTabFavicons();
    this.setActiveView("allSessions");
  }

  private async loadOpenTabFavicons(): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({});
      this.tabFavicons.clear();
      for (const tab of tabs) {
        if (tab.url && tab.favIconUrl && !this.tabFavicons.has(getDomainFromUrl(tab.url))) {
          const domain = getDomainFromUrl(tab.url);
          if (domain) this.tabFavicons.set(domain, tab.favIconUrl);
        }
      }
    } catch {
      // Ignore if tabs query fails; fallback icon will be shown
    }
  }

  private getFaviconUrl(domain: string): string | null {
    const tabIcon = this.tabFavicons.get(domain);
    if (tabIcon) return tabIcon;

    const isLocalOrIp = domain === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(domain);
    if (!isLocalOrIp && domain.includes(".")) {
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
    }
    return null;
  }

  private renderAllSessionsList(): void {
    const { sessions, activeSessions, currentDomain } = this.popupService.getState();

    this.allSessionsSearchWrap.hidden = sessions.length === 0;
    if (sessions.length === 0) {
      this.allSessionsSearchInput.value = "";
      this.allSessionsSummary.textContent = "";
      const emptyEl = document.createElement("div");
      emptyEl.className = "no-sessions";
      emptyEl.textContent = "No sessions saved yet";
      this.allSessionsList.replaceChildren(emptyEl);
      return;
    }

    const query = this.allSessionsSearchInput.value.trim().toLowerCase();
    const filteredSessions = query
      ? sessions.filter((s) => s.name.toLowerCase().includes(query) || s.domain.toLowerCase().includes(query))
      : sessions;

    if (filteredSessions.length === 0) {
      this.allSessionsSummary.textContent = "0 matches";
      const noMatchEl = document.createElement("div");
      noMatchEl.className = "no-sessions";
      noMatchEl.textContent = "No matching sessions";
      this.allSessionsList.replaceChildren(noMatchEl);
      return;
    }

    const grouped = new Map<string, typeof sessions>();
    for (const session of filteredSessions) {
      const list = grouped.get(session.domain) ?? [];
      list.push(session);
      grouped.set(session.domain, list);
    }

    const domains = Array.from(grouped.keys()).sort((a, b) => {
      if (a === currentDomain) return -1;
      if (b === currentDomain) return 1;
      return a.localeCompare(b);
    });

    this.allSessionsSummary.textContent = `${domains.length} site${domains.length === 1 ? "" : "s"} · ${filteredSessions.length}`;

    this.allSessionsList.innerHTML = domains
      .map((domain) => {
        const domainSessions = grouped
          .get(domain)!
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const activeId = activeSessions[domain];
        const faviconUrl = this.getFaviconUrl(domain);
        const safeDomain = escapeHtml(domain);
        const currentLabel = domain === currentDomain ? "Current" : "";

        const rowsHtml = domainSessions
          .map((session) => {
            const isActive = session.id === activeId;
            return `
              <div class="all-session-row ${isActive ? "active" : ""}" data-session-id="${escapeHtml(session.id)}">
                <div class="session-info">
                  <div class="session-name-row">
                    <span class="active-badge" aria-hidden="true"></span>
                    <span class="session-name"${session.color ? ` data-color="${escapeHtml(session.color)}"` : ""}>${escapeHtml(session.name)}</span>
                  </div>
                  <div class="session-meta">Last used ${formatDate(session.lastUsed)}</div>
                </div>
                <div class="session-actions">
                  <button
                    class="session-btn rename-btn"
                    type="button"
                    data-action="rename"
                    data-session-id="${escapeHtml(session.id)}"
                    aria-label="Rename session ${escapeHtml(session.name)}"
                    title="Rename"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                  <button
                    class="session-btn delete-btn"
                    type="button"
                    data-action="delete"
                    data-session-id="${escapeHtml(session.id)}"
                    aria-label="Delete session ${escapeHtml(session.name)}"
                    title="Delete"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M3 6h18" />
                      <path d="M8 6V4h8v2" />
                      <path d="M19 6l-1 14H6L5 6" />
                    </svg>
                  </button>
                </div>
              </div>
            `;
          })
          .join("");

        const openAttr = this.collapsedDomains.has(domain) ? "" : "open";
        return `
          <details class="site-group" data-domain="${safeDomain}" ${openAttr}>
            <summary class="site-group-header">
              <svg class="site-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M9 18l6-6-6-6" />
              </svg>
              <span class="site-favicon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                ${faviconUrl ? `<img class="site-favicon-img" src="${escapeHtml(faviconUrl)}" alt="" width="16" height="16" />` : ""}
              </span>
              <span class="site-group-domain" title="${safeDomain}">${safeDomain}</span>
              ${currentLabel ? `<span class="site-group-badge">${currentLabel}</span>` : ""}
              <span class="site-group-count">${domainSessions.length}</span>
            </summary>
            <div class="site-group-sessions">${rowsHtml}</div>
          </details>
        `;
      })
      .join("");

    this.allSessionsList.querySelectorAll<HTMLImageElement>(".site-favicon-img").forEach((img) => {
      img.addEventListener("error", () => img.remove(), { once: true });
    });

    this.allSessionsList.querySelectorAll<HTMLDetailsElement>(".site-group").forEach((group) => {
      group.addEventListener("toggle", () => {
        const domain = group.dataset.domain;
        if (!domain) return;
        if (group.open) {
          this.collapsedDomains.delete(domain);
        } else {
          this.collapsedDomains.add(domain);
        }
      });
    });
  }

  private handleAllSessionsClick(e: Event): void {
    const target = e.target as HTMLElement;
    const actionBtn = target.closest<HTMLButtonElement>("[data-action]");
    const sessionId = actionBtn?.dataset.sessionId;
    if (!sessionId) return;

    if (actionBtn.dataset.action === "rename") {
      this.handleRenameClick(sessionId);
    } else if (actionBtn.dataset.action === "delete") {
      this.handleDeleteClick(sessionId);
    }
  }

  private async handleThemeChange(theme: ThemePreference): Promise<void> {
    this.applyTheme(theme);
    await this.popupService.setTheme(theme);
  }

  private applyTheme(theme: ThemePreference): void {
    if (theme === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
    this.updateSegmentedState("[data-theme-option]", "themeOption", theme);
  }

  private updateSegmentedState(selector: string, datasetKey: string, value: string): void {
    document.querySelectorAll<HTMLButtonElement>(selector).forEach((btn) => {
      btn.setAttribute("aria-checked", String(btn.dataset[datasetKey] === value));
    });
  }

  private handleExportBackup(): void {
    const backup = this.popupService.exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sessionswap-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.setSettingsStatus(`Exported ${backup.sessions.length} session(s)`);
  }

  private async handleImportBackup(): Promise<void> {
    const file = this.importBackupInput.files?.[0];
    this.importBackupInput.value = "";
    if (!file) return;

    try {
      const content = await file.text();
      const { imported, skipped } = await this.popupService.importBackup(content, this.restoreMode);
      this.renderSessionsList();
      this.updateClearSiteButtonState();
      const suffix = skipped > 0 ? ` (${skipped} skipped)` : "";
      this.setSettingsStatus(`Restored ${imported} session(s)${suffix}`);
    } catch (error) {
      this.setSettingsStatus(handleError(error, "restore backup"), true);
    }
  }

  private handleClearSiteClick(): void {
    const { currentDomain } = this.popupService.getState();
    if (!currentDomain) return;
    this.popupService.setState({ currentDeleteSessionId: CLEAR_SITE_SENTINEL });
    this.modalManager.showDeleteModal(`all sessions for ${currentDomain}`);
  }

  private setSettingsStatus(message: string, isError = false): void {
    this.settingsStatusEl.textContent = message;
    this.settingsStatusEl.classList.toggle("is-error", isError);
  }

  private updateClearSiteButtonState(): void {
    const { currentDomain, sessions } = this.popupService.getState();
    const hasSiteSessions = Boolean(currentDomain) && sessions.some((s) => s.domain === currentDomain);
    this.clearSiteSessionsBtn.disabled = !hasSiteSessions;
  }

  private async handleReorder(sessionIds: string[]): Promise<void> {
    try {
      await this.popupService.reorderSessions(sessionIds);
    } catch (error) {
      this.showError(handleError(error, "reorder sessions"));
    }
  }

  private applySettings(settings: ExtensionSettings): void {
    this.settings = settings;
    this.settingAutoReload.checked = settings.autoReload;
    this.settingShowBadge.checked = settings.showBadge;
    this.settingAutoClose.checked = settings.autoClosePopup;
  }

  private renderSessionsList(): void {
    const state = this.popupService.getState();
    const siteSessionCount = state.sessions.filter((s) => s.domain === state.currentDomain).length;
    this.mainSearchInput.hidden = siteSessionCount < 4;
    if (siteSessionCount < 4) {
      this.mainSearchInput.value = "";
    }
    this.sessionList.render(state.sessions, state.activeSessions, state.currentDomain, this.mainSearchInput.value);
  }

  private showError(message: string): void {
    console.error("Popup error:", message);

    this.modalManager.showErrorModal(message);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  console.log("SessionSwap popup loaded");
  const controller = new PopupController();
  await controller.initialize();

  const service = controller.getServiceInstance();
  const state = service.getState();

  let currentDomain = state.currentDomain;

  const tabActivatedListener = async (activeInfo: { tabId: number }) => {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      const newDomain = getDomainFromUrl(tab.url);
      if (newDomain !== currentDomain) {
        currentDomain = newDomain;
        await controller.initialize();
      }
    }
  };

  const tabUpdatedListener = async (_: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
    if (!tab.active || changeInfo.status !== "complete" || !tab.url) return;

    const newDomain = getDomainFromUrl(tab.url);
    if (newDomain !== currentDomain) {
      currentDomain = newDomain;
      await controller.initialize();
    }
  };

  chrome.tabs.onActivated.addListener(tabActivatedListener);
  chrome.tabs.onUpdated.addListener(tabUpdatedListener);

  const cleanup = () => {
    chrome.tabs.onActivated.removeListener(tabActivatedListener);
    chrome.tabs.onUpdated.removeListener(tabUpdatedListener);
  };

  window.addEventListener("beforeunload", cleanup);
  window.addEventListener("unload", cleanup);
});
