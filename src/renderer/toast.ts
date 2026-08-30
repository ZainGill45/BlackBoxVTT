interface Toast {
  content: string;
  type: "info" | "warning" | "error";
}

export const toastDuration = 5000;
export const toasts: Toast[] = [];

export const toast = (content: string, type: "info" | "warning" | "error" = "info"): void => {
  toasts.push({ content: content, type: type });
  setTimeout(() => { toasts.shift(); }, toastDuration);
};
