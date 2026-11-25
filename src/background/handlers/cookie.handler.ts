export class CookieHandler {
  async getCookiesForDomain(domain: string): Promise<chrome.cookies.Cookie[]> {
    const currentDomain = domain.split(":")[0];
    if (!currentDomain) return [];

    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(currentDomain);
    const parts = currentDomain.split(".");
    const queryDomains =
      !isIp && parts.length > 1 ? parts.slice(0, -1).map((_, i) => parts.slice(i).join(".")) : [currentDomain];

    const stores = await chrome.cookies.getAllCookieStores();
    const seen = new Map<string, chrome.cookies.Cookie>();

    for (const store of stores) {
      for (const queryDomain of queryDomains) {
        const cookies = await chrome.cookies.getAll({ domain: queryDomain, storeId: store.id });
        for (const cookie of cookies) {
          const slicedCookieDomain = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
          const matchesDomain =
            slicedCookieDomain === currentDomain ||
            slicedCookieDomain === `www.${currentDomain}` ||
            currentDomain.endsWith(`.${slicedCookieDomain}`);
          if (!matchesDomain) continue;

          const partitionKey =
            "partitionKey" in cookie && cookie.partitionKey ? JSON.stringify(cookie.partitionKey) : "";
          const key = `${cookie.storeId}|${cookie.name}|${cookie.domain}|${cookie.path}|${partitionKey}`;
          seen.set(key, cookie);
        }
      }
    }

    return Array.from(seen.values());
  }

  async clearCookiesForDomain(domain: string): Promise<void> {
    const cookies = await this.getCookiesForDomain(domain);

    const clearPromises = cookies.map(async (cookie) => {
      try {
        const removeDetails: chrome.cookies.CookieDetails & { partitionKey?: unknown } = {
          url: this.buildCookieUrl(cookie, domain),
          name: cookie.name,
          storeId: cookie.storeId,
        };
        if ("partitionKey" in cookie && cookie.partitionKey) {
          removeDetails.partitionKey = cookie.partitionKey;
        }
        await chrome.cookies.remove(removeDetails);
      } catch (error) {
        console.warn("Failed to remove cookie:", cookie.name, error);
      }
    });

    await Promise.all(clearPromises);
  }

  async restoreCookies(cookies: chrome.cookies.Cookie[], domain: string): Promise<void> {
    const restorePromises = cookies.map(async (cookie) => {
      try {
        const cookieDetails = this.prepareCookieForRestore(cookie, domain);

        await chrome.cookies.set(cookieDetails);
      } catch (error) {
        console.warn("Failed to restore cookie:", cookie.name, error);
      }
    });

    await Promise.all(restorePromises);
  }

  private buildCookieUrl(cookie: chrome.cookies.Cookie, fallbackDomain?: string): string {
    const isSecureCookie = cookie.secure || cookie.name.startsWith("__Host-") || cookie.name.startsWith("__Secure-");
    const protocol = isSecureCookie ? "https" : "http";
    let domain = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;

    if (!domain && fallbackDomain) {
      domain = fallbackDomain.split(":")[0];
    }

    if (!domain) {
      throw new Error(`Invalid domain for cookie ${cookie.name}: ${cookie.domain}`);
    }

    const path = cookie.path || "/";
    return `${protocol}://${domain}${path}`;
  }

  private prepareCookieForRestore(cookie: chrome.cookies.Cookie, fallbackDomain: string): chrome.cookies.SetDetails {
    const url = this.buildCookieUrl(cookie, fallbackDomain);
    const isHostPrefix = cookie.name.startsWith("__Host-");

    const cookieDetails: chrome.cookies.SetDetails = {
      url,
      name: cookie.name,
      value: cookie.value,
      path: isHostPrefix ? "/" : cookie.path,
      secure: isHostPrefix ? true : cookie.secure,
      httpOnly: cookie.httpOnly,
      storeId: cookie.storeId,
    };

    if (!isHostPrefix && !cookie.hostOnly && cookie.domain && cookie.domain.startsWith(".")) {
      cookieDetails.domain = cookie.domain;
    }

    if (!cookie.session && cookie.expirationDate) {
      cookieDetails.expirationDate = cookie.expirationDate;
    }

    if (cookie.sameSite && cookie.sameSite !== "unspecified") {
      cookieDetails.sameSite = cookie.sameSite;
    }

    if ("partitionKey" in cookie && cookie.partitionKey) {
      (cookieDetails as chrome.cookies.SetDetails & { partitionKey?: unknown }).partitionKey = cookie.partitionKey;
    }

    return cookieDetails;
  }
}
