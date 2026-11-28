export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString();
}

export function getDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
      return "";
    }

    const domain = urlObj.hostname.replace(/^www\./, "");
    const isLocalhost = domain === "localhost" || domain.startsWith("127.");

    if (isLocalhost && urlObj.port) {
      return `${domain}:${urlObj.port}`;
    }

    return domain;
  } catch (_) {
    return "";
  }
}

export class ExtensionError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "ExtensionError";
  }
}

export function handleError(error: unknown, context: string): string {
  console.error(`Error in ${context}:`, error);

  if (error instanceof ExtensionError || error instanceof Error) {
    return error.message;
  }

  return "An unexpected error occurred";
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function validateSessionName(name: string): string {
  return name.trim() || "Unnamed Session";
}
