import { create } from "zustand";

interface DialogOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}

interface DialogState {
  open: boolean;
  options: DialogOptions | null;
  /** Internal resolver — called by confirm() / cancel() */
  _resolve: ((value: boolean) => void) | null;

  /**
   * Show a dialog imperatively. Returns a Promise<boolean>:
   * true = user confirmed, false = user cancelled.
   */
  show: (options: DialogOptions) => Promise<boolean>;
  confirm: () => void;
  cancel: () => void;
}

export const useDialogStore = create<DialogState>()((set, get) => ({
  open: false,
  options: null,
  _resolve: null,

  show: (options) =>
    new Promise<boolean>((resolve) => {
      set({ open: true, options, _resolve: resolve });
    }),

  confirm: () => {
    const { _resolve } = get();
    set({ open: false, options: null, _resolve: null });
    _resolve?.(true);
  },

  cancel: () => {
    const { _resolve } = get();
    set({ open: false, options: null, _resolve: null });
    _resolve?.(false);
  },
}));
