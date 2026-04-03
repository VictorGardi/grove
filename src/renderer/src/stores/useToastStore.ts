import { create } from "zustand";

export type ToastVariant = "success" | "warning" | "error";

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastState {
  toasts: Toast[];
  addToast: (message: string, variant: ToastVariant) => void;
  removeToast: (id: string) => void;
}

let _nextId = 0;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],

  addToast: (message, variant) => {
    const id = String(++_nextId);
    set((state) => ({ toasts: [...state.toasts, { id, message, variant }] }));

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, 5000);
  },

  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience helper — call from anywhere without hooks */
export function showToast(message: string, variant: ToastVariant): void {
  useToastStore.getState().addToast(message, variant);
}
