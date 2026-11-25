import { SessionData } from "@shared/types";
import { formatDate } from "@shared/utils";

export function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function getElementByIdSafe<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id) as T;
  if (!element) {
    throw new Error(`Element not found with id: ${id}`);
  }
  return element;
}

export function renderSessionRow(options: {
  session: SessionData;
  isActive: boolean;
  itemClass: string;
  lastUsedLabel: string;
  draggable?: boolean;
  showDragHandle?: boolean;
}): string {
  const { session, isActive, itemClass, lastUsedLabel, draggable = false, showDragHandle = false } = options;
  const safeId = escapeHtml(session.id);
  const safeName = escapeHtml(session.name);
  const colorAttr = session.color ? ` data-color="${escapeHtml(session.color)}"` : "";
  const dragHandle = showDragHandle
    ? `<div class="drag-handle" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="6" r="1.5" />
          <circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" />
          <circle cx="15" cy="18" r="1.5" />
        </svg>
      </div>`
    : "";

  return `
    <div class="${itemClass} ${isActive ? "active" : ""}" data-session-id="${safeId}" draggable="${draggable ? "true" : "false"}">
      ${dragHandle}
      <div class="session-info">
        <div class="session-name-row">
          <span class="active-badge" aria-hidden="true"></span>
          <span class="session-name"${colorAttr}>${safeName}</span>
        </div>
        <div class="session-meta">${lastUsedLabel} ${formatDate(session.lastUsed)}</div>
      </div>
      <div class="session-actions">
        <button class="session-btn rename-btn" type="button" data-action="rename" data-session-id="${safeId}" aria-label="Rename session ${safeName}" title="Rename">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
        <button class="session-btn delete-btn" type="button" data-action="delete" data-session-id="${safeId}" aria-label="Delete session ${safeName}" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6l-1 14H6L5 6" />
          </svg>
        </button>
      </div>
    </div>
  `;
}
