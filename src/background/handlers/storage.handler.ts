import { clearStorage, extractStorageData, injectStorageData } from "@background/services/storageData.service";
import { StorageData } from "@shared/types";
import { ExtensionError } from "@shared/utils";

export class StorageHandler {
  async getStorageData(tabId: number): Promise<StorageData> {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractStorageData,
      });

      if (!results?.[0]?.result) {
        throw new ExtensionError("Unable to read storage from this page");
      }

      return results[0].result;
    } catch (error) {
      if (error instanceof ExtensionError) throw error;
      throw new ExtensionError(`Failed to get storage data: ${error}`);
    }
  }

  async restoreStorageData(tabId: number, data: StorageData): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: injectStorageData,
        args: [data.localStorage, data.sessionStorage],
      });
    } catch (error) {
      throw new ExtensionError(`Failed to restore storage data: ${error}`);
    }
  }

  async clearStorageData(tabId: number): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: clearStorage,
      });
    } catch (error) {
      throw new ExtensionError(`Failed to clear storage data: ${error}`);
    }
  }
}
