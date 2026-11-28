import { STORAGE_KEYS } from "@shared/constants";
import { DEFAULT_SETTINGS, ExtensionStorage } from "@shared/types";
import { getDomainFromUrl } from "@shared/utils";
import { MessageService } from "./services/message.service";

const messageService = new MessageService();
let cachedDomainCounts: Map<string, number> | null = null;
let cachedShowBadge = DEFAULT_SETTINGS.showBadge;
let badgeCacheGeneration = 0;

async function ensureBadgeCache(): Promise<void> {
  if (cachedDomainCounts !== null) return;

  const generation = badgeCacheGeneration;
  const storage = (await chrome.storage.local.get([STORAGE_KEYS.SESSIONS, STORAGE_KEYS.SETTINGS])) as ExtensionStorage;
  if (generation !== badgeCacheGeneration) return;

  const counts = new Map<string, number>();
  for (const session of storage.sessions || []) {
    counts.set(session.domain, (counts.get(session.domain) ?? 0) + 1);
  }
  cachedDomainCounts = counts;
  cachedShowBadge = storage.settings?.showBadge ?? DEFAULT_SETTINGS.showBadge;
}

async function updateTabBadge(tabId: number, url?: string): Promise<void> {
  if (!chrome.action?.setBadgeText) return;

  try {
    const domain = url ? getDomainFromUrl(url) : "";
    if (!domain) {
      await chrome.action.setBadgeText({ tabId, text: "" });
      return;
    }

    await ensureBadgeCache();
    if (!cachedShowBadge) {
      await chrome.action.setBadgeText({ tabId, text: "" });
      return;
    }

    const count = cachedDomainCounts?.get(domain) ?? 0;
    await chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : "" });
    if (count > 0 && chrome.action.setBadgeBackgroundColor) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" });
    }
  } catch {
    // Ignore badge errors on closed/restricted tabs
  }
}

async function refreshActiveTabBadge(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) {
      await updateTabBadge(tab.id, tab.url);
    }
  } catch {
    // Ignore if tabs are unavailable
  }
}

// Extension startup
chrome.runtime.onStartup.addListener(() => {
  console.log("SessionSwap extension started");
  void refreshActiveTabBadge();
});

// Extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log("SessionSwap extension installed/updated", details);

  if (details.reason === "install") {
    chrome.storage.local.set({
      [STORAGE_KEYS.SESSIONS]: [],
      [STORAGE_KEYS.ACTIVE_SESSIONS]: {},
    });
  }
  void refreshActiveTabBadge();
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await updateTabBadge(tabId, tab.url);
  } catch {
    // Tab may have closed
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.status === "complete" || changeInfo.url)) {
    void updateTabBadge(tabId, tab.url);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes[STORAGE_KEYS.SESSIONS] || changes[STORAGE_KEYS.SETTINGS])) {
    badgeCacheGeneration += 1;
    cachedDomainCounts = null;
    void refreshActiveTabBadge();
  }
});

// Handle messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  return messageService.handleMessage(message, sender, sendResponse);
});
