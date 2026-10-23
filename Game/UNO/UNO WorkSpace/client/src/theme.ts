export type ThemeMode = "auto" | "light" | "dark";

const THEME_KEY = "uno.theme";

export function readThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "auto";
  } catch {
    return "auto";
  }
}

function applyTheme(mode: ThemeMode): void {
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = mode === "auto" ? (systemDark ? "dark" : "light") : mode;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content", resolved === "dark" ? "#101112" : "#f6f7f9"
  );
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    if (mode === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch {
    // The in-memory choice still works when storage is unavailable.
  }
  applyTheme(mode);
}

export function initializeTheme(): void {
  applyTheme(readThemeMode());
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener(
    "change", () => {
      if (readThemeMode() === "auto") applyTheme("auto");
    }
  );
  window.addEventListener("storage", (event) => {
    if (event.key === THEME_KEY) applyTheme(readThemeMode());
  });
}
