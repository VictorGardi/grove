import { useState, useEffect } from "react";
import { useThemeStore } from "../../stores/useThemeStore";
import {
  THEMES,
  THEME_LABELS,
  THEME_COLORS,
  type ThemeName,
} from "../../styles/loadTheme";
import styles from "./Settings.module.css";
import { WorkspaceDefaultsForm } from "./WorkspaceDefaultsForm";

export function Settings(): React.JSX.Element {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [opacity, setOpacity] = useState(1.0);

  useEffect(() => {
    window.api.app.getWindowOpacity().then((result) => {
      if (result.ok) {
        setOpacity(result.data);
      }
    });
  }, []);

  function handleThemeChange(name: ThemeName): void {
    setTheme(name);
    const colors = THEME_COLORS[name];
    window.api.app
      .setTitleBarColor({
        color: colors.titleBarColor,
        symbolColor: colors.titleBarSymbolColor,
      })
      .catch(() => {});
  }

  function handleOpacityChange(value: number): void {
    setOpacity(value);
    window.api.app.setWindowOpacity(value).catch(() => {});
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
      </div>

      <div className={styles.content}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Appearance</h2>
          <p className={styles.sectionDesc}>
            Choose a color theme. Applied app-wide across all workspaces.
          </p>

          <div className={styles.themeGrid}>
            {THEMES.map((name) => {
              const colors = THEME_COLORS[name];
              const isActive = theme === name;
              return (
                <button
                  key={name}
                  className={`${styles.themeCard} ${isActive ? styles.themeCardActive : ""}`}
                  onClick={() => handleThemeChange(name)}
                  aria-pressed={isActive}
                  aria-label={`Select ${THEME_LABELS[name]} theme`}
                >
                  {/* Mini preview swatch */}
                  <div
                    className={styles.swatch}
                    style={{ background: colors.bgBase }}
                  >
                    <div
                      className={styles.swatchSidebar}
                      style={{
                        background: colors.bgSurface,
                        borderRight: `1px solid ${colors.border}`,
                      }}
                    />
                    <div className={styles.swatchContent}>
                      <div
                        className={styles.swatchLine}
                        style={{ background: colors.accent, width: "60%" }}
                      />
                      <div
                        className={styles.swatchLine}
                        style={{
                          background: colors.textSecondary,
                          width: "80%",
                        }}
                      />
                      <div
                        className={styles.swatchLine}
                        style={{
                          background: colors.textSecondary,
                          width: "45%",
                        }}
                      />
                    </div>
                  </div>

                  <div className={styles.themeLabel}>{THEME_LABELS[name]}</div>

                  {isActive && (
                    <div className={styles.checkmark} aria-hidden="true">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M2 6L5 9L10 3"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Window</h2>
          <p className={styles.sectionDesc}>
            Adjust window transparency. Native controls remain fully visible.
          </p>

          <div className={styles.opacityRow}>
            <label className={styles.opacityLabel} htmlFor="opacity-slider">
              Opacity
            </label>
            <input
              id="opacity-slider"
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={opacity}
              onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
              className={styles.opacitySlider}
            />
            <span className={styles.opacityValue}>
              {Math.round(opacity * 100)}%
            </span>
          </div>
        </section>

        <WorkspaceDefaultsForm />
      </div>
    </div>
  );
}
