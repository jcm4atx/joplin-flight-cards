// Toasts: inside Scute they go to Scute's own toaster; in Joplin the bundled one.
import { toast as coreToast, useToast as useCoreToast } from "./toast-core";

export interface ToastInput {
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
}
let impl: ((t: ToastInput) => void) | null = null;
export function setToastImpl(fn: (t: ToastInput) => void) {
  impl = fn;
}
export function toast(t: ToastInput) {
  if (impl) impl(t);
  else coreToast(t as any);
}
export function useToast() {
  return { toast };
}
export { useCoreToast };
