export class ToastController {
  constructor(node) {
    this.node = node;
    this.timer = null;
  }

  hide() {
    const node = this.node;
    if (!node) return;

    if (typeof node.hidePopover === 'function' && node.matches(':popover-open')) {
      node.hidePopover();
    } else {
      node.hidden = true;
    }
  }

  show(text, ms = 4500) {
    const node = this.node;
    if (!node) return;

    node.textContent = text;
    clearTimeout(this.timer);

    if (typeof node.showPopover === 'function') {
      if (node.matches(':popover-open')) {
        node.hidePopover();
      }
      node.hidden = false;
      node.showPopover();
    } else {
      node.hidden = false;
    }

    this.timer = setTimeout(() => this.hide(), ms);
  }
}
