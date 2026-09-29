/** Where dialogs and pop-ups render. Scute: a scoped container; Joplin: the panel body. */
let root: HTMLElement | null = null;
export function setPortalRoot(el: HTMLElement) {
  root = el;
}
export const portalRoot = () => root || document.body;

/** Clears a stale `pointer-events: none` on <body> once no modal layer is open. */
export function releaseBody() {
  if (document.body.style.pointerEvents !== "none") return;
  if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [role="alertdialog"][data-state="open"], [role="listbox"][data-state="open"]')) return;
  document.body.style.pointerEvents = "";
}
