import { ThemePreference } from "@shared/types";
import { getDomainFromUrl, handleError } from "@shared/utils";
import { LoadingManager } from "./components/loadingManager";
import { ModalManager } from "./components/modalManager";
import { SessionList } from "./components/sessionList";
import { PopupService } from "./services/popup.service";
import { getElementByIdSafe } from "./utils/dom";

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
  private settingsBtn: HTMLButtonElement;
  private saveBtn: HTMLButtonElement;
  private newSessionBtn: HTMLButtonElement;
  private clearSiteSessionsBtn: HTMLButtonElement;
  private settingsStatusEl: HTMLElement;
  private importBackupInput: HTMLInputElement;
  private restoreMode: "merge" | "replace" = "merge";

  constructor() {
    // Get DOM elements
    this.currentSiteElement = getElementByIdSafe("currentSite");
    this.siteBar = getElementByIdSafe("siteBar");
    this.mainContent = getElementByIdSafe("mainContent");
    this.settingsView = getElementByIdSafe("settingsView");
    this.settingsBtn = getElementByIdSafe("settingsBtn");
    this.saveBtn = getElementByIdSafe("saveBtn");
    this.newSessionBtn = getElementByIdSafe("newSessionBtn");
    this.clearSiteSessionsBtn = getElementByIdSafe("clearSiteSessionsBtn");
    this.settingsStatusEl = getElementByIdSafe("settingsStatus");
    this.importBackupInput = getElementByIdSafe("importBackupInput");

    // Initialize session list
    this.sessionList = new SessionList(getElementByIdSafe("sessionsList"));
    this.setupSessionListHandlers();
    this.setupEventListeners();
  }

  async initialize(): Promise<void> {
    try {
      this.modalManager.hideAllModals();
      this.toggleSettings(false);
      const [theme, state] = await Promise.all([
        this.popupService.getTheme(),
        this.loadingManager.withLoading(async () => {
          return await this.popupService.initialize();
        }),
      ]);

      this.applyTheme(theme);

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

    // Settings event listeners
    this.settingsBtn.addEventListener("click", () => this.toggleSettings(this.settingsView.hidden));
    getElementByIdSafe("settingsBackBtn").addEventListener("click", () => this.toggleSettings(false));
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

      await this.loadingManager.withLoading(async () => {
        await this.popupService.saveCurrentSession(name);
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
    } catch (error) {
      this.showError(handleError(error, "switch session"));
    }
  }

  private handleRenameClick(sessionId: string): void {
    const session = this.popupService.getSession(sessionId);
    if (session) {
      this.popupService.setState({ currentRenameSessionId: sessionId });
      this.modalManager.showRenameModal(session.name);
    }
  }

  private async handleConfirmRename(): Promise<void> {
    try {
      const newName = this.modalManager.getRenameModalInput();
      const sessionId = this.popupService.getState().currentRenameSessionId;

      if (newName && sessionId) {
        await this.popupService.renameSession(sessionId, newName);
        this.renderSessionsList();
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
      }

      this.modalManager.hideDeleteModal();
    } catch (error) {
      this.showError(handleError(error, "delete session"));
    }
  }

  private toggleSettings(open: boolean): void {
    const helpDetails = document.getElementById("helpDetails") as HTMLDetailsElement | null;
    if (open && helpDetails) helpDetails.open = false;

    this.siteBar.hidden = open;
    this.mainContent.hidden = open;
    this.settingsView.hidden = !open;
    this.settingsBtn.setAttribute("aria-expanded", String(open));

    if (open) {
      this.setSettingsStatus("");
      this.updateClearSiteButtonState();
      getElementByIdSafe("settingsBackBtn").focus();
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

  private renderSessionsList(): void {
    const state = this.popupService.getState();
    this.sessionList.render(state.sessions, state.activeSessions, state.currentDomain);
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
