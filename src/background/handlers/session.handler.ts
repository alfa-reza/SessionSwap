import { STORAGE_KEYS } from "@shared/constants";
import { DEFAULT_SETTINGS, ExtensionStorage, SessionData, StoredSession } from "@shared/types";
import { ExtensionError } from "@shared/utils";
import { CookieHandler } from "./cookie.handler";
import { StorageHandler } from "./storage.handler";

export class SessionHandler {
  private cookieHandler = new CookieHandler();
  private storageHandler = new StorageHandler();

  private async shouldAutoReload(): Promise<boolean> {
    try {
      const result = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS]);
      const settings = (result as ExtensionStorage).settings;
      return settings?.autoReload ?? DEFAULT_SETTINGS.autoReload;
    } catch {
      return DEFAULT_SETTINGS.autoReload;
    }
  }

  async getCurrentSession(domain: string, tabId: number): Promise<StoredSession> {
    try {
      const [cookies, storageData] = await Promise.all([
        this.cookieHandler.getCookiesForDomain(domain),
        this.storageHandler.getStorageData(tabId),
      ]);

      return {
        cookies,
        localStorage: storageData.localStorage,
        sessionStorage: storageData.sessionStorage,
      };
    } catch (error) {
      throw new ExtensionError(`Failed to get current session: ${error}`);
    }
  }

  async switchToSession(sessionData: SessionData, tabId: number): Promise<void> {
    const { domain, cookies, localStorage, sessionStorage } = sessionData;

    try {
      await this.cookieHandler.clearCookiesForDomain(domain);

      await Promise.all([
        this.cookieHandler.restoreCookies(cookies, domain),
        this.storageHandler.restoreStorageData(tabId, {
          localStorage,
          sessionStorage,
        }),
      ]);

      if (await this.shouldAutoReload()) {
        await chrome.tabs.reload(tabId);
      }
    } catch (error) {
      throw new ExtensionError(`Failed to switch session: ${error}`);
    }
  }

  async clearSession(domain: string, tabId: number): Promise<void> {
    try {
      await Promise.all([
        this.cookieHandler.clearCookiesForDomain(domain),
        this.storageHandler.clearStorageData(tabId),
      ]);

      if (await this.shouldAutoReload()) {
        await chrome.tabs.reload(tabId);
      }
    } catch (error) {
      throw new ExtensionError(`Failed to clear session: ${error}`);
    }
  }
}
