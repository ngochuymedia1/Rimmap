type DialogTone = 'default' | 'danger';
type DialogButtonStyle = 'primary' | 'secondary' | 'danger';

const DIALOG_TONE_CLASS: Record<DialogTone, string> = {
  default: 'rimmap-dialog-default',
  danger: 'rimmap-dialog-danger',
};
const DIALOG_BUTTON_CLASS: Record<DialogButtonStyle, string> = {
  primary: 'rimmap-dialog-button-primary',
  secondary: 'rimmap-dialog-button-secondary',
  danger: 'rimmap-dialog-button-danger',
};
const TOAST_TONE_CLASS: Record<DialogTone, string> = {
  default: 'rimmap-toast-default',
  danger: 'rimmap-toast-danger',
};

export type DialogButton<T extends string> = {
  value: T;
  label: string;
  style?: DialogButtonStyle;
};

type AppDialogOptions<T extends string> = {
  title: string;
  message: string;
  buttons: DialogButton<T>[];
  cancelValue: T;
  tone?: DialogTone;
  input?: {
    value?: string;
    placeholder?: string;
    inputMode?: HTMLInputElement['inputMode'];
    selectOnOpen?: boolean;
  };
};

let dialogQueue: Promise<void> = Promise.resolve();

function queueDialog<T>(task: () => Promise<T>): Promise<T> {
  const result = dialogQueue.then(task, task);
  dialogQueue = result.then(() => undefined, () => undefined);
  return result;
}

function createDialogShell(tone: DialogTone) {
  const overlay = document.createElement('div');
  overlay.className = 'rimmap-dialog-overlay';
  overlay.setAttribute('role', 'presentation');

  const dialog = document.createElement('section');
  dialog.className = `rimmap-dialog ${DIALOG_TONE_CLASS[tone]}`;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  const header = document.createElement('div');
  header.className = 'rimmap-dialog-header';

  const mark = document.createElement('span');
  mark.className = 'rimmap-dialog-mark';
  mark.setAttribute('aria-hidden', 'true');

  const title = document.createElement('h2');
  title.className = 'rimmap-dialog-title';

  header.append(mark, title);

  const message = document.createElement('p');
  message.className = 'rimmap-dialog-message';

  const actions = document.createElement('div');
  actions.className = 'rimmap-dialog-actions';

  dialog.append(header, message);
  overlay.append(dialog);
  document.body.append(overlay);
  return { overlay, dialog, title, message, actions };
}

export function showAppDialog<T extends string>(options: AppDialogOptions<T>): Promise<T> {
  return queueDialog(() => new Promise<T>(resolve => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const { overlay, dialog, title, message, actions } = createDialogShell(options.tone ?? 'default');
    const titleId = `rimmap-dialog-title-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    title.id = titleId;
    dialog.setAttribute('aria-labelledby', titleId);
    title.textContent = options.title;
    message.textContent = options.message;

    let input: HTMLInputElement | null = null;
    if (options.input) {
      input = document.createElement('input');
      input.className = 'rimmap-dialog-input';
      input.type = 'text';
      input.value = options.input.value ?? '';
      input.placeholder = options.input.placeholder ?? '';
      if (options.input.inputMode) input.inputMode = options.input.inputMode;
      dialog.append(input);
    }

    dialog.append(actions);

    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      previousFocus?.focus({ preventScroll: true });
      resolve(value);
    };

    const buttons = options.buttons.map(spec => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `rimmap-dialog-button ${DIALOG_BUTTON_CLASS[spec.style ?? 'secondary']}`;
      button.textContent = spec.label;
      button.dataset.dialogValue = spec.value;
      button.addEventListener('click', () => finish(spec.value));
      actions.append(button);
      return { spec, button };
    });

    const primary = buttons.find(item => item.spec.style === 'primary')?.button ?? buttons[buttons.length - 1]?.button;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(options.cancelValue);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        primary?.click();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    overlay.addEventListener('pointerdown', event => {
      if (event.target === overlay) finish(options.cancelValue);
    });

    requestAnimationFrame(() => {
      if (input) {
        input.focus({ preventScroll: true });
        if (options.input?.selectOnOpen !== false) input.select();
      } else {
        primary?.focus({ preventScroll: true });
      }
    });
  }));
}

export async function confirmDialog(options: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
  confirmStyle?: DialogButtonStyle;
}): Promise<boolean> {
  return (await showAppDialog({
    title: options.title,
    message: options.message,
    tone: options.tone,
    cancelValue: 'cancel',
    buttons: [
      { value: 'cancel', label: options.cancelLabel ?? 'Cancel', style: 'secondary' },
      { value: 'confirm', label: options.confirmLabel ?? 'Continue', style: options.confirmStyle ?? 'primary' },
    ],
  })) === 'confirm';
}

export async function alertDialog(options: {
  title: string;
  message: string;
  tone?: DialogTone;
  buttonLabel?: string;
}): Promise<void> {
  await showAppDialog({
    title: options.title,
    message: options.message,
    tone: options.tone,
    cancelValue: 'ok',
    buttons: [{ value: 'ok', label: options.buttonLabel ?? 'OK', style: 'primary' }],
  });
}

export async function promptDialog(options: {
  title: string;
  message: string;
  value?: string;
  placeholder?: string;
  inputMode?: HTMLInputElement['inputMode'];
  confirmLabel?: string;
}): Promise<string | null> {
  const value = await queueDialog(() => new Promise<string | null>(resolve => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const { overlay, dialog, title, message, actions } = createDialogShell('default');
    const titleId = `rimmap-dialog-title-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    title.id = titleId;
    dialog.setAttribute('aria-labelledby', titleId);
    title.textContent = options.title;
    message.textContent = options.message;

    const input = document.createElement('input');
    input.className = 'rimmap-dialog-input';
    input.type = 'text';
    input.value = options.value ?? '';
    input.placeholder = options.placeholder ?? '';
    if (options.inputMode) input.inputMode = options.inputMode;
    dialog.append(input, actions);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'rimmap-dialog-button rimmap-dialog-button-secondary';
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'rimmap-dialog-button rimmap-dialog-button-primary';
    confirm.textContent = options.confirmLabel ?? 'Continue';
    actions.append(cancel, confirm);

    let settled = false;
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      previousFocus?.focus({ preventScroll: true });
      resolve(result);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); finish(null);
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault(); event.stopPropagation(); finish(input.value);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    cancel.addEventListener('click', () => finish(null));
    confirm.addEventListener('click', () => finish(input.value));
    overlay.addEventListener('pointerdown', event => { if (event.target === overlay) finish(null); });
    requestAnimationFrame(() => { input.focus({ preventScroll: true }); input.select(); });
  }));
  return value;
}

export async function unsavedExitDialog(): Promise<'save' | 'discard' | 'cancel'> {
  return showAppDialog({
    title: 'Unsaved changes',
    message: 'You have changes that have not been saved to a project file. Save before closing Rimmap?',
    tone: 'default',
    cancelValue: 'cancel',
    buttons: [
      { value: 'cancel', label: 'Cancel', style: 'secondary' },
      { value: 'discard', label: 'Exit without saving', style: 'danger' },
      { value: 'save', label: 'Save & exit', style: 'primary' },
    ],
  });
}

export function showToast(message: string, tone: DialogTone = 'default', duration = 2200): void {
  let host = document.querySelector<HTMLDivElement>('.rimmap-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'rimmap-toast-host';
    document.body.append(host);
  }
  const toast = document.createElement('div');
  toast.className = `rimmap-toast ${TOAST_TONE_CLASS[tone]}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  host.append(toast);
  window.setTimeout(() => toast.remove(), duration);
}
