import "./styles/global.css";
import { loadTheme } from "./styles/loadTheme";

// Apply the persisted theme before React renders to avoid a flash.
// Note: ES module imports are hoisted, so loadTheme() actually runs after all
// imports resolve. The inline script in index.html handles the very first paint.
// The Zustand store is initialised lazily on first useThemeStore access.
loadTheme();

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
