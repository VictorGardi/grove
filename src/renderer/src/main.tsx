import "./styles/global.css";
import { applyTheme, loadThemeFromConfig } from "./styles/loadTheme";
import { useThemeStore } from "./stores/useThemeStore";

loadThemeFromConfig().then((theme) => {
  applyTheme(theme);
  useThemeStore.getState().setTheme(theme);
});

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
