/* ═════════════════════════════════════════════════════
   pi-zero · 主题系统
   ═════════════════════════════════════════════════════
   此脚本为常规 <script defer>（非 module），
   确保在 DOM 解析后、任何模块脚本之前执行。
   ═════════════════════════════════════════════════════ */

(function initTheme(): void {
  const html = document.documentElement;

  // ── 主题包（pack）加载 ──
  window.__loadPack = function (slug: string): void {
    document.querySelectorAll('link[id^="theme-stylesheet-"]').forEach((link) => {
      (link as HTMLLinkElement).disabled = true;
    });
    const target = document.getElementById("theme-stylesheet-" + slug) as HTMLLinkElement | null;
    if (target) target.disabled = false;
    localStorage.setItem("pi-zero-pack", slug);
  };

  const savedPack = localStorage.getItem("pi-zero-pack") || "ink-wash";
  window.__loadPack(savedPack);

  // ── 亮暗模式初始化 ──
  const saved = localStorage.getItem("pi-zero-theme") || "dark";
  html.setAttribute("data-theme", saved);
})();

/**
 * 全局亮暗切换函数（供模块脚本调用）
 */
function toggleTheme(): void {
  const html = document.documentElement;
  const current = html.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  html.setAttribute("data-theme", next);
  localStorage.setItem("pi-zero-theme", next);
}
