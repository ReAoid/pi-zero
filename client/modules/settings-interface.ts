/* ═════════════════════════════════════════════════════
   pi-zero · 界面设置
   ═════════════════════════════════════════════════════ */

// ── 设置弹框 ──
const settingToggle = document.getElementById("setting-toggle") as HTMLElement;
const settingsModal = document.getElementById("settings-modal") as HTMLElement;
const modalClose = document.getElementById("modal-close") as HTMLElement;

function openSettings(): void {
  settingsModal.classList.add("open");
}

function closeSettings(): void {
  settingsModal.classList.remove("open");
}

settingToggle.addEventListener("click", openSettings);
modalClose.addEventListener("click", closeSettings);

settingsModal.addEventListener("click", (e: MouseEvent) => {
  if (e.target === settingsModal) closeSettings();
});

document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (
    e.key === "Escape" &&
    settingsModal.classList.contains("open")
  ) {
    closeSettings();
  }
});

// ── 设置面板 Tab 切换 ──
const navItems = document.querySelectorAll<HTMLElement>(".settings-nav__item");
const panes = document.querySelectorAll<HTMLElement>(".settings-pane");

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    navItems.forEach((n) => n.classList.remove("active"));
    item.classList.add("active");
    const tab = item.dataset.tab;
    panes.forEach((p) => p.classList.remove("active"));
    const targetPane = document.getElementById("pane-" + tab);
    if (targetPane) targetPane.classList.add("active");
  });
});

// ── 界面标签：主题包 & 亮暗切换 ──
const settingsPackSelect = document.getElementById("settings-pack-select") as HTMLSelectElement;
const settingsThemeBtn = document.getElementById("settings-theme-toggle") as HTMLElement;
const settingsThemeIcon = document.getElementById("settings-theme-icon") as HTMLElement;
const settingsThemeLabel = document.getElementById("settings-theme-label") as HTMLElement;

function syncSettingsThemeUI(): void {
  const html = document.documentElement;
  const isDark = html.getAttribute("data-theme") === "dark";
  settingsThemeIcon.textContent = isDark ? "☀" : "○";
  settingsThemeLabel.textContent = isDark ? "昼" : "墨";
}

const savedPack = localStorage.getItem("pi-zero-pack") || "ink-wash";
settingsPackSelect.value = savedPack;
syncSettingsThemeUI();

settingsPackSelect.addEventListener("change", () => {
  window.__loadPack(settingsPackSelect.value);
});

settingsThemeBtn.addEventListener("click", () => {
  window.toggleTheme();
  syncSettingsThemeUI();
});
