import { STORAGE_KEYS } from "@shared/constants";
import { DEFAULT_SETTINGS, ExtensionStorage, SessionData, StoredSession } from "@shared/types";
import { ExtensionError, getDomainFromUrl } from "@shared/utils";
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
        this.cookieHandler.getCookiesForDomain(domain, tabId),
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
      if (typeof chrome.tabs?.get === "function") {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.url && getDomainFromUrl(tab.url) !== domain) {
          throw new ExtensionError("Active tab domain no longer matches the selected session");
        }
      }

      // Restore page storage first so restricted pages fail before clearing cookies
      await this.storageHandler.restoreStorageData(tabId, {
        localStorage,
        sessionStorage,
      });

      await this.cookieHandler.clearCookiesForDomain(domain, tabId);
      await this.cookieHandler.restoreCookies(cookies, domain, tabId);

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
        this.cookieHandler.clearCookiesForDomain(domain, tabId),
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
