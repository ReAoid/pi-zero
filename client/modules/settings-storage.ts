/* ═════════════════════════════════════════════════════
   pi-zero · 存储设置
   ═════════════════════════════════════════════════════ */

import { workplace } from "./workplace.js";

// ── DOM 引用 ──
const sessionPathInput = document.getElementById("settings-session-path") as HTMLInputElement;
const workplacePathInput = document.getElementById("settings-workplace-path") as HTMLInputElement;

// ── 从服务端加载存储配置 ──
async function loadStorageConfig(): Promise<void> {
  try {
    const res = await fetch("/api/storage/config");
    const data = await res.json() as { ok: boolean; config?: { sessions?: string; workplace?: string } };
    if (data.ok && data.config) {
      sessionPathInput.value = data.config.sessions || "";
      workplacePathInput.value = data.config.workplace || "";
    }
  } catch (e) {
    // 降级：从 localStorage 读取
    const saved = localStorage.getItem("pi-zero-storage");
    if (saved) {
      try {
        const cfg = JSON.parse(saved) as { sessions?: string; workplace?: string };
        sessionPathInput.value = cfg.sessions || "";
        workplacePathInput.value = cfg.workplace || "";
      } catch (e2) { /* ignore */ }
    }
  }
}

loadStorageConfig();

// ── 自动保存存储配置 ──
let _storageSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleStorageSave(): void {
  if (_storageSaveTimer) clearTimeout(_storageSaveTimer);
  _storageSaveTimer = setTimeout(() => {
    doSaveStorageConfig();
    _storageSaveTimer = null;
  }, 400);
}

async function doSaveStorageConfig(): Promise<void> {
  const config = {
    sessions: sessionPathInput.value || "./data/sessions",
    workplace: workplacePathInput.value || "./workplace",
  };

  // 保存到 localStorage（前端缓存）
  localStorage.setItem("pi-zero-storage", JSON.stringify(config));

  // 发送到服务端统一存储 API
  try {
    await fetch("/api/storage/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    // 静默保存，不弹 alert
  } catch (err) {
    // 降级：至少保存到 localStorage
  }
  workplace.refresh();
}

// ── 事件绑定：输入时自动保存 ──
sessionPathInput.addEventListener("input", scheduleStorageSave);
workplacePathInput.addEventListener("input", scheduleStorageSave);
