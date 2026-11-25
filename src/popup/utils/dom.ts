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
