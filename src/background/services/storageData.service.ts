import { StorageData } from "@shared/types";

export function extractStorageData(): StorageData {
  return {
    localStorage: { ...localStorage },
    sessionStorage: { ...sessionStorage },
  };
}

export function injectStorageData(localData: Record<string, string>, sessionData: Record<string, string>): boolean {
  localStorage.clear();
  sessionStorage.clear();

  Object.entries(localData).forEach(([key, value]) => {
    localStorage.setItem(key, value);
  });

  Object.entries(sessionData).forEach(([key, value]) => {
    sessionStorage.setItem(key, value);
  });

  return true;
}

export function clearStorage(): boolean {
  localStorage.clear();
  sessionStorage.clear();
  return true;
}
