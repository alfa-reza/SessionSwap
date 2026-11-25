import { SessionHandler } from "@background/handlers/session.handler";
import { MESSAGE_ACTIONS } from "@shared/constants";
import { MessageType, SendResponseType, StoredSession } from "@shared/types";
import { handleError } from "@shared/utils";

export class MessageService {
  private sessionHandler = new SessionHandler();

  handleMessage(message: MessageType, _: chrome.runtime.MessageSender, sendResponse: SendResponseType): boolean {
    this.checkOriginPermissions()
      .then(() => {
        return this.processMessage(message, sendResponse);
      })
      .catch((error) => {
        const errorMessage = handleError(error, "MessageService.handleMessage");
        sendResponse({ success: false, error: errorMessage });
      });

    return true;
  }

  private async checkOriginPermissions(): Promise<void> {
    const { origins = [] } = await chrome.permissions.getAll();
    const hasBroadAccess = origins.some(
      (origin) => origin === "<all_urls>" || origin === "*://*/*" || origin === "http://*/*" || origin === "https://*/*"
    );

    if (!hasBroadAccess) {
      throw new Error("Data access permission is required.");
    }
  }

  private async processMessage(message: MessageType, sendResponse: SendResponseType): Promise<void> {
    switch (message.action) {
      case MESSAGE_ACTIONS.GET_CURRENT_SESSION:
        await this.handleGetCurrentSession(message, sendResponse);
        break;

      case MESSAGE_ACTIONS.SWITCH_SESSION:
        await this.handleSwitchSession(message, sendResponse);
        break;

      case MESSAGE_ACTIONS.CLEAR_SESSION:
        await this.handleClearSession(message, sendResponse);
        break;

      default:
        sendResponse({ success: false, error: "Unknown action" });
    }
  }

  private async handleGetCurrentSession(
    message: Extract<MessageType, { action: "getCurrentSession" }>,
    sendResponse: SendResponseType<StoredSession | null>
  ): Promise<void> {
    const sessionData = await this.sessionHandler.getCurrentSession(message.domain, message.tabId);
    sendResponse({ success: true, data: sessionData });
  }

  private async handleSwitchSession(
    message: Extract<MessageType, { action: "switchSession" }>,
    sendResponse: SendResponseType
  ): Promise<void> {
    await this.sessionHandler.switchToSession(message.sessionData, message.tabId);
    sendResponse({ success: true });
  }

  private async handleClearSession(
    message: Extract<MessageType, { action: "clearSession" }>,
    sendResponse: SendResponseType
  ): Promise<void> {
    await this.sessionHandler.clearSession(message.domain, message.tabId);
    sendResponse({ success: true });
  }
}
