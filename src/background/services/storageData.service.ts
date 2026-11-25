import { StorageData } from "@shared/types";

export function extractStorageData(): StorageData {
  try {
    return {
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage },
    };
  } catch (error) {
    console.error("Error extracting storage data:", error);
    return { localStorage: {}, sessionStorage: {} };
  }
}

export function injectStorageData(localData: Record<string, string>, sessionData: Record<string, string>): boolean {
  try {
    localStorage.clear();
    sessionStorage.clear();

    Object.entries(localData).forEach(([key, value]) => {
      localStorage.setItem(key, value);
    });

    Object.entries(sessionData).forEach(([key, value]) => {
      sessionStorage.setItem(key, value);
    });

    return true;
  } catch (error) {
    console.error("Error injecting storage data:", error);
    return false;
  }
}

export function clearStorage(): boolean {
  try {
    localStorage.clear();
    sessionStorage.clear();
    return true;
  } catch (error) {
    console.error("Error clearing storage:", error);
    return false;
  }
}
