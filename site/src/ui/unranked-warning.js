export class UnrankedWarningDialog {
  constructor({ dialog, getElement, clearInput, resetClock } = {}) {
    this.dialog = dialog;
    this.$ = getElement || (id => document.getElementById(id));
    this.clearInput = clearInput;
    this.resetClock = resetClock;
    this.resolver = null;

    this.#bind();
  }

  ask(message) {
    if (this.resolver) this.#settle(false);

    this.$('unranked-warning-message').textContent = message;
    this.clearInput?.();
    this.resetClock?.();

    return new Promise(resolve => {
      this.resolver = resolve;
      this.dialog.showModal();
      this.$('unranked-continue').focus();
    });
  }

  #bind() {
    if (!this.dialog) return;

    this.$('unranked-continue').onclick = () => this.#settle(true);
    this.$('unranked-cancel').onclick = () => this.#settle(false);
    this.dialog.addEventListener('cancel', event => {
      event.preventDefault();
      this.#settle(false);
    });
  }

  #settle(continueLocally) {
    const resolve = this.resolver;
    this.resolver = null;
    if (this.dialog?.open) this.dialog.close();
    resolve?.(continueLocally);
  }
}
