export const copyBrowserText = async (text: string): Promise<void> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* Try the WebView's copy command. */
  }
  const active = document.activeElement as HTMLElement | null;
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("aria-hidden", "true");
  input.style.cssText = "position:fixed;left:-9999px;top:0;";
  document.body.append(input);
  try {
    input.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
  } finally {
    input.remove();
    active?.focus({ preventScroll: true });
  }
};
