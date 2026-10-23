import { useEffect, useState } from "react";
import { readThemeMode, setThemeMode, type ThemeMode } from "../theme.ts";

export function ThemeControl() {
  const [mode, setMode] = useState<ThemeMode>(readThemeMode);

  useEffect(() => {
    const sync = () => setMode(readThemeMode());
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  return (
    <select
      className="theme-control"
      aria-label="主题"
      title="切换主题"
      value={mode}
      onChange={(event) => {
        const next = event.target.value as ThemeMode;
        setMode(next);
        setThemeMode(next);
      }}
    >
      <option value="auto">跟随系统</option>
      <option value="light">浅色</option>
      <option value="dark">深色</option>
    </select>
  );
}
