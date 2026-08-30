import { ref } from "vue";
import { log } from "./logger";

export interface Toast {
  id: number;
  title: string;
  content: string;
  type: "info" | "warning" | "error";
}

export const toastDuration = 5000;
export const toasts = ref<Toast[]>([]);

let toastID = 0;

export const toast = (title: string, content: string, type: "info" | "warning" | "error" = "info"): void => {
  if (toasts.value.length > 2) {
    toasts.value.shift();
    log(`Toast: dismissed array length ${toasts.value.length}`);
  }

  log(`New toast added with ID ${toastID} array length is now ${toasts.value.length}`);

  const newToast: Toast = {
    id: toastID++,
    title: title,
    content: content,
    type: type,
  }
  toasts.value.push(newToast);

  setTimeout(() => dismissToast(newToast.id), toastDuration);
};

const dismissToast = (id: number): void => {
  const index = toasts.value.findIndex(toast => toast.id === id);

  if (index === -1) {
    log(`No toast with id = ${id} found returning`)
    return;
  }

  toasts.value.splice(index, 1);
  log(`Toast with id = ${id} removed array length is now ${toasts.value.length}`)
};
