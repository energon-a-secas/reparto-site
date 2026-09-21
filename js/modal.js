// ── Modals ───────────────────────────────────────────────────
// The template's blocking-overlay helpers: open/close with focus return,
// Esc to close, and a Tab trap inside the dialog.

/** @param {HTMLElement} root */
function getFocusable(root) {
  const sel = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  return Array.from(root.querySelectorAll(sel)).filter((el) => {
    if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
    return el.getClientRects().length > 0;
  });
}

let _modalLastFocus = null;

/** @param {string} id */
export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  _modalLastFocus = /** @type {HTMLElement} */ (document.activeElement);
  modal.removeAttribute('hidden');
  document.body.classList.add('modal-open');
  const dialog = modal.querySelector('.modal__dialog');
  const list = dialog ? getFocusable(dialog) : [];
  const closeBtn = modal.querySelector('.modal__header [data-modal-close]');
  const toFocus = closeBtn && list.includes(closeBtn) ? closeBtn : list[0];
  if (toFocus) toFocus.focus();
}

/** @param {string} id */
export function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.setAttribute('hidden', '');
  document.body.classList.remove('modal-open');
  // Opened from a menu item: the menu has closed since, so the item is hidden and cannot take
  // focus. Give it to the menu's button (Plans, Export, or the kit's ⋯) instead.
  let back = _modalLastFocus;
  const menu = back?.closest?.('.header-menu');
  if (back && menu && !back.getClientRects().length) back = document.querySelector(`[aria-controls="${menu.id}"]`) || back;
  if (back && typeof back.focus === 'function') {
    back.focus();
  }
  _modalLastFocus = null;
}

export function getOpenModal() {
  return document.querySelector('.modal:not([hidden])');
}

/** Esc and the Tab trap for whichever modal is open. True while a modal is open, so page shortcuts stand down. */
export function modalKeydown(e) {
  const modal = getOpenModal();
  if (!modal || !modal.id) return false;

  if (e.key === 'Escape') {
    e.preventDefault();
    closeModal(modal.id);
    return true;
  }

  if (e.key !== 'Tab') return true;
  const dialog = modal.querySelector('.modal__dialog');
  const list = dialog ? getFocusable(dialog) : [];
  if (list.length === 0) return true;
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
  return true;
}

/** Clicks on backdrop / [data-modal-close] close the modal. */
export function modalClick(e) {
  const modal = /** @type {HTMLElement | null} */ (e.target.closest('.modal'));
  if (!modal || modal.hasAttribute('hidden')) return;
  const t = /** @type {HTMLElement} */ (e.target);
  if (t.closest('[data-modal-close]')) closeModal(modal.id);
}
