import { CSS_CLASSES } from "@popup/utils/constants";
import { getElementByIdSafe } from "@popup/utils/dom";
import { SessionColor } from "@shared/types";
import { ModalList, ModalInputs } from "@shared/types/modal.types";

export class ModalManager {
  private modals: ModalList;
  private inputs: ModalInputs;

  constructor() {
    this.modals = {
      save: getElementByIdSafe("saveModal"),
      rename: getElementByIdSafe("renameModal"),
      delete: getElementByIdSafe("deleteModal"),
      error: getElementByIdSafe("errorModal"),
    };

    this.inputs = {
      sessionName: getElementByIdSafe("sessionName"),
      newSessionName: getElementByIdSafe("newSessionName"),
    };

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    const closeButtons = [
      { id: "closeSaveModal", modal: "save" },
      { id: "cancelSave", modal: "save" },
      { id: "closeRenameModal", modal: "rename" },
      { id: "cancelRename", modal: "rename" },
      { id: "closeDeleteModal", modal: "delete" },
      { id: "cancelDelete", modal: "delete" },
      { id: "closeErrorModal", modal: "error" },
      { id: "closeErrorModalBtn", modal: "error" },
    ];

    closeButtons.forEach(({ id, modal }) => {
      getElementByIdSafe(id).addEventListener("click", () => this.hide(modal as keyof ModalList));
    });

    // Enter key handlers
    this.inputs.sessionName.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        getElementByIdSafe("confirmSave").click();
      }
    });

    this.inputs.newSessionName.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        getElementByIdSafe("confirmRename").click();
      }
    });

    // Global event handlers
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.hideVisible();
      }
      if (e.key === "Enter") {
        if (this.isVisible("delete")) {
          e.preventDefault();
          getElementByIdSafe("confirmDelete").click();
        }
        if (this.isVisible("error")) {
          e.preventDefault();
          getElementByIdSafe("closeErrorModal").click();
        }
      }
    });

    // Backdrop click handlers
    Object.entries(this.modals).forEach(([key, modal]) => {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.hide(key as keyof ModalList);
      });
    });

    // Color swatch pickers inside save & rename modals
    document.querySelectorAll<HTMLButtonElement>(".color-swatch").forEach((swatch) => {
      swatch.addEventListener("click", () => {
        const picker = swatch.closest(".color-picker");
        if (!picker) return;
        picker.querySelectorAll<HTMLButtonElement>(".color-swatch").forEach((btn) => {
          btn.setAttribute("aria-checked", String(btn === swatch));
        });
      });
    });
  }

  showSaveModal(defaultName: string = "Unnamed Session"): void {
    this.inputs.sessionName.value = defaultName;
    this.setPickerColor("saveColorPicker");
    this.show("save");
    this.inputs.sessionName.focus();
    this.inputs.sessionName.select();
  }

  showRenameModal(currentName: string, currentColor?: SessionColor): void {
    this.inputs.newSessionName.value = currentName;
    this.setPickerColor("renameColorPicker", currentColor);
    this.show("rename");
    this.inputs.newSessionName.focus();
    this.inputs.newSessionName.select();
  }

  showDeleteModal(sessionName: string): void {
    const deleteSessionNameEl = document.getElementById("deleteSessionName");
    if (deleteSessionNameEl) {
      deleteSessionNameEl.textContent = sessionName;
    }
    this.show("delete");
    this.modals.delete.focus();
  }

  showErrorModal(message: string): void {
    const errorMessageEl = document.getElementById("errorMessage");
    if (errorMessageEl) {
      errorMessageEl.textContent = message;
    }
    this.show("error");
    this.modals.error.focus();
  }

  getSaveModalInput(): string {
    return this.inputs.sessionName.value.trim();
  }

  getSaveModalColor(): SessionColor | undefined {
    return this.getPickerColor("saveColorPicker");
  }

  getRenameModalInput(): string {
    return this.inputs.newSessionName.value.trim();
  }

  getRenameModalColor(): SessionColor | undefined {
    return this.getPickerColor("renameColorPicker");
  }

  private setPickerColor(pickerId: string, color?: SessionColor): void {
    const picker = document.getElementById(pickerId);
    if (!picker) return;
    const targetValue = color ?? "";
    picker.querySelectorAll<HTMLButtonElement>(".color-swatch").forEach((btn) => {
      btn.setAttribute("aria-checked", String((btn.dataset.color ?? "") === targetValue));
    });
  }

  private getPickerColor(pickerId: string): SessionColor | undefined {
    const selected = document.querySelector<HTMLButtonElement>(`#${pickerId} .color-swatch[aria-checked="true"]`);
    const color = selected?.dataset.color;
    return color ? (color as SessionColor) : undefined;
  }

  hideSaveModal(): void {
    this.hide("save");
  }
  hideRenameModal(): void {
    this.hide("rename");
  }
  hideDeleteModal(): void {
    this.hide("delete");
  }
  hideErrorModal(): void {
    this.hide("error");
  }

  hideAllModals(): void {
    this.hideVisible();
    this.inputs.sessionName.value = "";
    this.inputs.newSessionName.value = "";
  }

  private isVisible(modalKey: keyof ModalList): boolean {
    return this.modals[modalKey]?.classList.contains(CSS_CLASSES.SHOW) || false;
  }

  private hideVisible(): void {
    Object.entries(this.modals).forEach(([key, modal]) => {
      if (modal.classList.contains(CSS_CLASSES.SHOW)) {
        this.hide(key as keyof ModalList);
      }
    });
  }

  private show(modalKey: keyof ModalList): void {
    this.modals[modalKey].classList.add(CSS_CLASSES.SHOW);
  }

  private hide(modalKey: keyof ModalList): void {
    this.modals[modalKey].classList.remove(CSS_CLASSES.SHOW);
  }
}
