/* ═════════════════════════════════════════════════════
   pi-zero · 存储设置
   ═════════════════════════════════════════════════════ */

import { workplace } from "./workplace.js";

// ── DOM 引用 ──
const sessionPathInput = document.getElementById(
  "settings-session-path"
);
const workplacePathInput = document.getElementById(
  "settings-workplace-path"
);
const storageSaveBtn = document.getElementById(
  "settings-storage-save"
);

// ── 从服务端加载存储配置 ──
async function loadStorageConfig() {
  try {
    const res = await fetch("/api/storage/config");
    const data = await res.json();
    if (data.ok && data.config) {
      sessionPathInput.value = data.config.sessions || "";
      workplacePathInput.value = data.config.workplace || "";
    }
  } catch (e) {
    // 降级：从 localStorage 读取
    const saved = localStorage.getItem("pi-zero-storage");
    if (saved) {
      try {
        const cfg = JSON.parse(saved);
        sessionPathInput.value = cfg.sessions || "";
        workplacePathInput.value = cfg.workplace || "";
      } catch (e2) { /* ignore */ }
    }
  }
}

loadStorageConfig();

// ── 保存存储配置 ──
storageSaveBtn.addEventListener("click", async () => {
  const config = {
    sessions: sessionPathInput.value || "./data/sessions",
    workplace: workplacePathInput.value || "./workplace",
  };

  // 保存到 localStorage（前端缓存）
  localStorage.setItem("pi-zero-storage", JSON.stringify(config));

  // 发送到服务端统一存储 API
  try {
    const res = await fetch("/api/storage/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const data = await res.json();
    if (data.ok) {
      alert("✅ 存储配置已保存");
      workplace.refresh();
    } else {
      alert("❌ 保存失败: " + (data.error || "未知错误"));
    }
  } catch (err) {
    // 降级：至少保存到 localStorage
    alert("✅ 已保存到本地（服务端通信失败）");
    workplace.refresh();
  }
});
