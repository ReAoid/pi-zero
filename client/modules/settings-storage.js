/* ═════════════════════════════════════════════════════
   pi-zero · 存储设置
   ═════════════════════════════════════════════════════ */

import { workplace } from "./workplace.js";

// ── DOM 引用 ──
const sessionPathInput = document.getElementById(
  "settings-session-path"
);
const knowledgePathInput = document.getElementById(
  "settings-knowledge-path"
);
const logPathInput = document.getElementById("settings-log-path");
const workplacePathInput = document.getElementById(
  "settings-workplace-path"
);
const storageSaveBtn = document.getElementById(
  "settings-storage-save"
);

function loadStorageConfig() {
  const saved = localStorage.getItem("pi-zero-storage");
  if (saved) {
    try {
      const cfg = JSON.parse(saved);
      sessionPathInput.value = cfg.sessions || "";
      knowledgePathInput.value = cfg.knowledge || "";
      logPathInput.value = cfg.logs || "";
      workplacePathInput.value = cfg.workplace || "";
    } catch (e) {}
  }
}

loadStorageConfig();

storageSaveBtn.addEventListener("click", () => {
  const config = {
    sessions: sessionPathInput.value,
    knowledge: knowledgePathInput.value,
    logs: logPathInput.value,
    workplace: workplacePathInput.value,
  };
  localStorage.setItem("pi-zero-storage", JSON.stringify(config));

  fetch("/api/workplace/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: workplacePathInput.value || "./workplace",
    }),
  }).catch(() => {});

  alert("存储配置已保存");
  workplace.refresh();
});
