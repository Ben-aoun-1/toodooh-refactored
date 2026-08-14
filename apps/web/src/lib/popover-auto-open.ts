/**
 * GREEN2 item 9 — the auto-open rule for attention-grabbing popovers (the notification bells):
 * auto-open AT MOST ONCE PER SESSION (SPA lifetime — the flag lives at module scope in each
 * consumer, surviving remounts and dying on reload), manual after that. The old per-mount refs
 * re-armed on every navigation/refetch, so the popovers re-opened on EVERY page load while
 * unread — obscuring content and eating clicks. (The cart consumed this rule until CART-V1
 * made it a permanent docked bar — bells are the remaining consumers.)
 */
export const shouldAutoOpen = (hasContent: boolean, alreadyAutoOpened: boolean): boolean =>
  hasContent && !alreadyAutoOpened;
