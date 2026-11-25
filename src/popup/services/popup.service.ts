import { MESSAGE_ACTIONS, STORAGE_KEYS } from "@shared/constants";
import {
  ActiveSessions,
  DEFAULT_SETTINGS,
  ExtensionSettings,
  ExtensionStorage,
  PopupState,
  SessionBackup,
  SessionColor,
  SessionData,
  StoredSession,
  ThemePreference,
} from "@shared/types";
import { ExtensionError, generateId, getDomainFromUrl, handleError, validateSessionName } from "@shared/utils";
import { ChromeApiService } from "./chromeApi.service";

export class PopupService {
  private chromeApi = new ChromeApiService();
  private state: PopupState = {
    currentDomain: "",
    currentTab: {} as chrome.tabs.Tab,
    sessions: [],
    activeSessions: {},
    currentRenameSessionId: "",
    currentDeleteSessionId: "",
  };

  async initialize(): Promise<PopupState> {
    try {
      this.state.currentTab = await this.chromeApi.getCurrentTab();
      if (!this.state.currentTab.url) {
        throw new ExtensionError("Unable to get current tab URL");
      }

      this.state.currentDomain = getDomainFromUrl(this.state.currentTab.url);
      await this.loadStorageData();

      return { ...this.state };
    } catch (error) {
      throw new ExtensionError(handleError(error, "PopupService.initialize"));
    }
  }

  async saveCurrentSession(name: string, color?: SessionColor): Promise<SessionData> {
    try {
      const validatedName = validateSessionName(name);

      const response = await this.chromeApi.sendMessage<StoredSession | null>({
        action: MESSAGE_ACTIONS.GET_CURRENT_SESSION,
        domain: this.state.currentDomain,
        tabId: this.state.currentTab.id!,
      });

      if (!response.success) {
        throw new ExtensionError(response.error || "Failed to get current session");
      }

      const storedSession = response.data ?? { cookies: [], localStorage: {}, sessionStorage: {} };

      const domainSessions = this.state.sessions.filter((s) => s.domain === this.state.currentDomain);
      const maxOrder = domainSessions.length > 0 ? Math.max(...domainSessions.map((s) => s.order ?? 0)) : -1;

      const faviconUrl = this.state.currentTab.favIconUrl;
      const newSession: SessionData = {
        ...storedSession,
        id: generateId(),
        name: validatedName,
        domain: this.state.currentDomain,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        order: maxOrder + 1,
        ...(color ? { color } : {}),
        ...(faviconUrl ? { faviconUrl } : {}),
      };

      this.state.sessions.push(newSession);
      this.state.activeSessions[this.state.currentDomain] = newSession.id;
      await this.saveStorageData();

      return newSession;
    } catch (error) {
      throw new ExtensionError(handleError(error, "PopupService.saveCurrentSession"));
    }
  }

  async switchToSession(sessionId: string): Promise<void> {
    try {
      const session = this.state.sessions.find((s) => s.id === sessionId);
      if (!session) {
        throw new ExtensionError("Session not found");
      }

      const response = await this.chromeApi.sendMessage({
        action: MESSAGE_ACTIONS.SWITCH_SESSION,
        sessionData: session,
        tabId: this.state.currentTab.id!,
      });

      if (!response.success) {
        throw new ExtensionError(response.error || "Failed to switch session");
      }

      this.state.activeSessions[this.state.currentDomain] = sessionId;
      session.lastUsed = Date.now();

      await this.saveStorageData();
    } catch (error) {
      throw new ExtensionError(handleError(error, "PopupService.switchToSession"));
    }
  }

  async createNewSession(): Promise<void> {
    try {
      const response = await this.chromeApi.sendMessage({
        action: MESSAGE_ACTIONS.CLEAR_SESSION,
        domain: this.state.currentDomain,
        tabId: this.state.currentTab.id!,
      });

      if (!response.success) {
        throw new ExtensionError(response.error || "Failed to clear session");
      }

      delete this.state.activeSessions[this.state.currentDomain];
      await this.saveStorageData();
    } catch (error) {
      throw new ExtensionError(handleError(error, "PopupService.createNewSession"));
    }
  }

  async renameSession(sessionId: string, newName: string, color?: SessionColor): Promise<void> {
    try {
      const session = this.state.sessions.find((s) => s.id === sessionId);
      if (!session) {
        throw new ExtensionError("Session not found");
      }

      session.name = validateSessionName(newName);
      if (color) {
        session.color = color;
      } else {
        delete session.color;
      }
      await this.saveStorageData();
    } catch (error) {
      throw new ExtensionError(handleError(error, "PopupService.renameSession"));
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      const target = this.state.sessions.find((s) => s.id === sessionId);
      this.state.sessions = this.state.sessions.filter((s) => s.id !== sessionId);

      if (target && this.state.activeSessions[target.domain] === sessionId) {
        delete this.state.activeSessions[target.domain];
      }

      await this.saveStorageData();
    } catch (error) {
      throw new ExtensionError(handleError(error, "PopupService.deleteSession"));
    }
  }

  async reorderSessions(sessionIds: string[]): Promise<void> {
    try {
      const domainSessions = this.state.sessions.filter((s) => s.domain === this.state.currentDomain);

      if (sessionIds.length !== domainSessions.length) {
        throw new ExtensionError("Session count mismatch during reorder operation");
      }

      const sessionIdsSet = new Set(sessionIds);
      const allSessionsPresent = domainSessions.every((session) => sessionIdsSet.has(session.id));

      if (!allSessionsPresent) {
        throw new ExtensionError("Invalid session IDs provided for reorder operation");
      }

      sessionIds.forEach((id, index) => {
        const session = domainSessions.find((s) => s.id === id);
        if (session) {
          session.order = index;
        }
      });

      await this.saveStorageData();
    } catch (error) {
      throw new ExtensionError(handleError(error, "PopupService.reorderSessions"));
    }
  }

  async clearCurrentSiteSessions(): Promise<number> {
    try {
      const before = this.state.sessions.length;
      this.state.sessions = this.state.sessions.filter((s) => s.domain !== this.state.currentDomain);
      delete this.state.activeSessions[this.state.currentDomain];
      await this.saveStorageData();
      return before - this.state.sessions.length;
    } catch (error) {
      throw new ExtensionError(handleError(error, "PopupService.clearCurrentSiteSessions"));
    }
  }

  async getTheme(): Promise<ThemePreference> {
    try {
      const result = await this.chromeApi.getStorageData<ExtensionStorage>([STORAGE_KEYS.THEME]);
      const theme = result[STORAGE_KEYS.THEME];
      return theme === "light" || theme === "dark" || theme === "system" ? theme : "system";
    } catch {
      return "system";
    }
  }

  async setTheme(theme: ThemePreference): Promise<void> {
    await this.chromeApi.setStorageData({ [STORAGE_KEYS.THEME]: theme });
  }

  async getSettings(): Promise<ExtensionSettings> {
    try {
      const result = await this.chromeApi.getStorageData<ExtensionStorage>([STORAGE_KEYS.SETTINGS]);
      return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async updateSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
    const current = await this.getSettings();
    const next = { ...current, ...patch };
    await this.chromeApi.setStorageData({ [STORAGE_KEYS.SETTINGS]: next });
    return next;
  }

  exportBackup(): SessionBackup {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      sessions: this.state.sessions,
      activeSessions: this.state.activeSessions,
    };
  }

  async importBackup(rawJson: string, mode: "merge" | "replace"): Promise<{ imported: number; skipped: number }> {
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        throw new ExtensionError("Invalid JSON backup file");
      }

      if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as SessionBackup).sessions)) {
        throw new ExtensionError("Invalid backup format: missing sessions array");
      }

      const rawBackup = parsed as Partial<SessionBackup>;
      const validSessions = rawBackup.sessions!.filter(isValidSessionRecord).map((s, idx) => ({
        ...s,
        createdAt: typeof s.createdAt === "number" ? s.createdAt : Date.now(),
        lastUsed: typeof s.lastUsed === "number" ? s.lastUsed : Date.now(),
        order: typeof s.order === "number" ? s.order : idx,
      }));

      if (rawBackup.sessions!.length > 0 && validSessions.length === 0) {
        throw new ExtensionError("No valid sessions found in backup file");
      }

      const incomingActive: ActiveSessions =
        rawBackup.activeSessions && typeof rawBackup.activeSessions === "object" ? rawBackup.activeSessions : {};

      let imported = 0;
      let skipped = 0;

      if (mode === "replace") {
        this.state.sessions = validSessions;
        const validIds = new Set(validSessions.map((s) => s.id));
        const nextActive: ActiveSessions = {};
        for (const [domain, id] of Object.entries(incomingActive)) {
          if (typeof id === "string" && validIds.has(id)) {
            nextActive[domain] = id;
          }
        }
        this.state.activeSessions = nextActive;
        imported = validSessions.length;
      } else {
        const existingIds = new Set(this.state.sessions.map((s) => s.id));
        const maxOrderByDomain = new Map<string, number>();
        for (const s of this.state.sessions) {
          maxOrderByDomain.set(s.domain, Math.max(maxOrderByDomain.get(s.domain) ?? -1, s.order ?? 0));
        }

        for (const s of validSessions) {
          if (existingIds.has(s.id)) {
            skipped++;
            continue;
          }
          const nextOrder = (maxOrderByDomain.get(s.domain) ?? -1) + 1;
          maxOrderByDomain.set(s.domain, nextOrder);
          this.state.sessions.push({ ...s, order: nextOrder });
          existingIds.add(s.id);
          imported++;
        }

        for (const [domain, id] of Object.entries(incomingActive)) {
          if (!this.state.activeSessions[domain] && typeof id === "string" && existingIds.has(id)) {
            this.state.activeSessions[domain] = id;
          }
        }
      }

      await this.saveStorageData();
      return { imported, skipped };
    } catch (error) {
      throw new ExtensionError(handleError(error, "PopupService.importBackup"));
    }
  }

  getSession(sessionId: string): SessionData | undefined {
    return this.state.sessions.find((s) => s.id === sessionId);
  }

  getState(): PopupState {
    return { ...this.state };
  }

  setState(newState: Partial<PopupState>): void {
    this.state = { ...this.state, ...newState };
  }

  private async loadStorageData(): Promise<void> {
    try {
      const result = await this.chromeApi.getStorageData<ExtensionStorage>([
        STORAGE_KEYS.SESSIONS,
        STORAGE_KEYS.ACTIVE_SESSIONS,
      ]);

      this.state.sessions = result[STORAGE_KEYS.SESSIONS] || [];
      this.state.activeSessions = result[STORAGE_KEYS.ACTIVE_SESSIONS] || {};

      const migrationNeeded = await this.migrateLegacySessions();
      if (migrationNeeded) {
        await this.saveStorageData();
      }
    } catch (error) {
      console.error("Error loading storage data:", error);
      this.state.sessions = [];
      this.state.activeSessions = {};
    }
  }

  private migrateLegacySessions(): boolean {
    let migrationPerformed = false;
    const sessionsByDomain = new Map<string, SessionData[]>();

    this.state.sessions.forEach((session) => {
      if (!sessionsByDomain.has(session.domain)) {
        sessionsByDomain.set(session.domain, []);
      }
      sessionsByDomain.get(session.domain)!.push(session);
    });

    sessionsByDomain.forEach((sessions) => {
      sessions.forEach((session, index) => {
        if (session.order === undefined) {
          session.order = index;
          migrationPerformed = true;
        }
      });
    });

    return migrationPerformed;
  }

  private async saveStorageData(): Promise<void> {
    await this.chromeApi.setStorageData({
      [STORAGE_KEYS.SESSIONS]: this.state.sessions,
      [STORAGE_KEYS.ACTIVE_SESSIONS]: this.state.activeSessions,
    });
  }
}

function isValidSessionRecord(item: unknown): item is SessionData {
  if (!item || typeof item !== "object") return false;
  const s = item as Partial<SessionData>;
  return (
    typeof s.id === "string" &&
    s.id.length > 0 &&
    typeof s.name === "string" &&
    s.name.trim().length > 0 &&
    typeof s.domain === "string" &&
    s.domain.length > 0 &&
    Array.isArray(s.cookies) &&
    !!s.localStorage &&
    typeof s.localStorage === "object" &&
    !!s.sessionStorage &&
    typeof s.sessionStorage === "object"
  );
}
