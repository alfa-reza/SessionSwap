import { CSS_CLASSES, UI_TEXT } from "@popup/utils/constants";
import { escapeHtml } from "@popup/utils/dom";
import { ActiveSessions, SessionData } from "@shared/types";
import { formatDate } from "@shared/utils";

export class SessionList {
  private container: HTMLElement;
  private onSessionClick?: (sessionId: string) => void;
  private onRenameClick?: (sessionId: string) => void;
  private onDeleteClick?: (sessionId: string) => void;
  private onReorder?: (sessionIds: string[]) => void;
  private draggedElement: HTMLElement | null = null;
  private draggedOverElement: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.addEventListener("click", this.handleClick.bind(this));
    this.container.addEventListener("dragstart", this.handleDragStart.bind(this));
    this.container.addEventListener("dragover", this.handleDragOver.bind(this));
    this.container.addEventListener("drop", this.handleDrop.bind(this));
    this.container.addEventListener("dragend", this.handleDragEnd.bind(this));
    this.container.addEventListener("dragenter", this.handleDragEnter.bind(this));
    this.container.addEventListener("dragleave", this.handleDragLeave.bind(this));
  }

  setEventHandlers(handlers: {
    onSessionClick?: (sessionId: string) => void;
    onRenameClick?: (sessionId: string) => void;
    onDeleteClick?: (sessionId: string) => void;
    onReorder?: (sessionIds: string[]) => void;
  }): void {
    this.onSessionClick = handlers.onSessionClick;
    this.onRenameClick = handlers.onRenameClick;
    this.onDeleteClick = handlers.onDeleteClick;
    this.onReorder = handlers.onReorder;
  }

  render(sessions: SessionData[], activeSessions: ActiveSessions, currentDomain: string): void {
    const domainSessions = sessions
      .filter((s) => s.domain === currentDomain)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const activeSessionId = activeSessions[currentDomain];

    if (domainSessions.length === 0) {
      this.renderEmptyState();
      return;
    }

    this.renderSessions(domainSessions, activeSessionId);
  }

  private renderEmptyState(): void {
    this.container.innerHTML = `<div class="${CSS_CLASSES.NO_SESSIONS}">${UI_TEXT.NO_SESSIONS}</div>`;
  }

  private renderSessions(sessions: SessionData[], activeSessionId?: string): void {
    const sessionsHtml = sessions
      .map((session) => {
        const isActive = session.id === activeSessionId;
        const lastUsed = formatDate(session.lastUsed);

        return `
        <div class="${CSS_CLASSES.SESSION_ITEM} ${isActive ? CSS_CLASSES.ACTIVE : ""}"
             data-session-id="${session.id}"
             draggable="true">
          <div class="drag-handle" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.5" />
              <circle cx="15" cy="6" r="1.5" />
              <circle cx="9" cy="12" r="1.5" />
              <circle cx="15" cy="12" r="1.5" />
              <circle cx="9" cy="18" r="1.5" />
              <circle cx="15" cy="18" r="1.5" />
            </svg>
          </div>
          <div class="session-info">
            <div class="session-name-row">
              <span class="active-badge" aria-hidden="true"></span>
              <span class="session-name">${escapeHtml(session.name)}</span>
            </div>
            <div class="session-meta">${UI_TEXT.LAST_USED} ${lastUsed}</div>
          </div>
          <div class="session-actions">
            <button class="${CSS_CLASSES.SESSION_BTN} rename-btn" type="button" data-action="rename" data-session-id="${session.id}" aria-label="Rename session" title="Rename">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            <button class="${CSS_CLASSES.SESSION_BTN} delete-btn" type="button" data-action="delete" data-session-id="${session.id}" aria-label="Delete session" title="Delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
              </svg>
            </button>
          </div>
        </div>
      `;
      })
      .join("");

    this.container.innerHTML = sessionsHtml;
  }

  private handleClick(e: Event): void {
    const target = e.target as HTMLElement;
    const actionBtn = target.closest(`.${CSS_CLASSES.SESSION_BTN}`) as HTMLElement | null;

    if (actionBtn) {
      e.stopPropagation();
      const action = actionBtn.dataset.action;
      const sessionId = actionBtn.dataset.sessionId;

      if (!sessionId) return;

      if (action === "rename" && this.onRenameClick) {
        this.onRenameClick(sessionId);
      } else if (action === "delete" && this.onDeleteClick) {
        this.onDeleteClick(sessionId);
      }
      return;
    }

    if (target.closest(".drag-handle")) {
      return;
    }

    // Handle session switching
    const sessionItem = target.closest(`.${CSS_CLASSES.SESSION_ITEM}`) as HTMLElement;
    if (sessionItem && this.onSessionClick) {
      const sessionId = sessionItem.dataset.sessionId;
      if (sessionId) {
        this.onSessionClick(sessionId);
      }
    }
  }

  private handleDragStart(e: DragEvent): void {
    const target = e.target as HTMLElement;
    if (target.classList.contains(CSS_CLASSES.SESSION_ITEM)) {
      this.draggedElement = target;
      target.classList.add("dragging");
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/html", target.innerHTML);
    }
  }

  private handleDragOver(e: DragEvent): void {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
  }

  private handleDragEnter(e: DragEvent): void {
    const target = (e.target as HTMLElement).closest(`.${CSS_CLASSES.SESSION_ITEM}`) as HTMLElement;
    if (target && target !== this.draggedElement) {
      if (this.draggedOverElement && this.draggedOverElement !== target) {
        this.draggedOverElement.classList.remove("drag-over");
      }
      target.classList.add("drag-over");
      this.draggedOverElement = target;
    }
  }

  private handleDragLeave(e: DragEvent): void {
    const target = (e.target as HTMLElement).closest(`.${CSS_CLASSES.SESSION_ITEM}`) as HTMLElement;
    const relatedTarget = e.relatedTarget as HTMLElement;

    if (target && relatedTarget) {
      const leavingToOutside = !target.contains(relatedTarget);
      if (leavingToOutside && target === this.draggedOverElement) {
        target.classList.remove("drag-over");
        this.draggedOverElement = null;
      }
    }
  }

  private handleDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();

    const target = (e.target as HTMLElement).closest(`.${CSS_CLASSES.SESSION_ITEM}`) as HTMLElement;

    if (target && this.draggedElement && target !== this.draggedElement) {
      const allItems = Array.from(this.container.querySelectorAll(`.${CSS_CLASSES.SESSION_ITEM}`)) as HTMLElement[];
      const draggedIndex = allItems.indexOf(this.draggedElement);
      const targetIndex = allItems.indexOf(target);

      if (draggedIndex < targetIndex) {
        target.after(this.draggedElement);
      } else {
        target.before(this.draggedElement);
      }

      const reorderedIds = Array.from(this.container.querySelectorAll(`.${CSS_CLASSES.SESSION_ITEM}`)).map(
        (item) => (item as HTMLElement).dataset.sessionId!
      );

      if (this.onReorder) {
        this.onReorder(reorderedIds);
      }
    }
  }

  private handleDragEnd(e: DragEvent): void {
    const target = e.target as HTMLElement;
    if (target.classList.contains(CSS_CLASSES.SESSION_ITEM)) {
      target.classList.remove("dragging");
    }

    const allItems = this.container.querySelectorAll(`.${CSS_CLASSES.SESSION_ITEM}`);
    allItems.forEach((item) => item.classList.remove("drag-over"));

    this.draggedElement = null;
    this.draggedOverElement = null;
  }
}
