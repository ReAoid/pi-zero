/* ═════════════════════════════════════════════════════
   pi-zero · 模型管理
   ═════════════════════════════════════════════════════ */

import { escapeHtml } from "./utils.js";

// ── DOM 引用 ──
const providerSelect = document.getElementById("settings-provider") as HTMLSelectElement;
const customModelField = document.getElementById("custom-model-field") as HTMLElement;
const remoteModelList = document.getElementById("remote-model-list") as HTMLElement;
const enabledModelList = document.getElementById("enabled-model-list") as HTMLElement;
const fetchModelsBtn = document.getElementById("settings-fetch-models") as HTMLElement;
const addAllBtn = document.getElementById("models-add-all") as HTMLElement;
const removeAllBtn = document.getElementById("models-remove-all") as HTMLElement;

let cachedRemoteModels: string[] = [];

// ── 已启用模型持久化 ──
export function getEnabledModels(): string[] {
  try {
    const raw = localStorage.getItem("pi-zero-enabled-models");
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function saveEnabledModels(models: string[]): void {
  localStorage.setItem("pi-zero-enabled-models", JSON.stringify(models));
}

// ── 渲染远程模型列表 ──
function renderRemoteModels(remoteModels: string[], enabledModels: string[]): void {
  const enabled = new Set(enabledModels);
  const notEnabled = remoteModels.filter((m) => !enabled.has(m));

  if (notEnabled.length === 0) {
    remoteModelList.innerHTML = `
      <div class="model-list-empty" style="color: var(--muted, #888); padding: 1rem; text-align: center; font-size: 0.85rem;">
        所有模型均已添加 ✓
      </div>`;
    return;
  }

  remoteModelList.innerHTML = notEnabled
    .map(
      (m) => `
      <div class="model-item"
           style="display: flex; align-items: center; justify-content: space-between; padding: 0.3rem 0.5rem; border-radius: 4px; cursor: pointer;"
           onmouseenter="this.style.background='var(--hover-bg, rgba(255,255,255,0.05))'"
           onmouseleave="this.style.background='transparent'"
           onclick="window.addSingleModel('${escapeHtml(m)}')">
        <span style="font-size: 0.85rem; font-family: monospace;">${escapeHtml(m)}</span>
        <span style="color: var(--accent, #4a9eff); font-size: 0.8rem;">＋ 添加</span>
      </div>`
    )
    .join("");
}

// ── 渲染已启用模型列表 ──
function renderEnabledModels(enabledModels: string[]): void {
  if (enabledModels.length === 0) {
    enabledModelList.innerHTML = `
      <div class="model-list-empty" style="color: var(--muted, #888); padding: 1rem; text-align: center; font-size: 0.85rem;">
        暂无已启用的模型
      </div>`;
    return;
  }

  enabledModelList.innerHTML = enabledModels
    .map(
      (m) => `
      <div class="model-item"
           style="display: flex; align-items: center; justify-content: space-between; padding: 0.3rem 0.5rem; border-radius: 4px;"
           onmouseenter="this.style.background='var(--hover-bg, rgba(255,255,255,0.05))'"
           onmouseleave="this.style.background='transparent'">
        <span style="font-size: 0.85rem; font-family: monospace; color: var(--success, #4caf50);">${escapeHtml(m)}</span>
        <span style="color: var(--error, #f44336); font-size: 0.8rem; cursor: pointer;"
              onclick="window.removeSingleModel('${escapeHtml(m)}')">✕ 删除</span>
      </div>`
    )
    .join("");
}

// ── 刷新全部 UI ──
export function refreshModelUI(): void {
  const enabled = getEnabledModels();
  renderRemoteModels(cachedRemoteModels, enabled);
  renderEnabledModels(enabled);
  // 通知聊天区刷新模型下拉
  window.dispatchEvent(new CustomEvent("models-changed"));
}

// ── 全局函数（供 onclick 使用） ──
function notifyModelsChanged(): void {
  refreshModelUI();
  // 模型列表变更时也触发供应商配置自动保存
  if (window.__scheduleProviderSave) {
    window.__scheduleProviderSave();
  }
}

window.addSingleModel = function (modelId: string): void {
  const enabled = getEnabledModels();
  if (!enabled.includes(modelId)) {
    enabled.push(modelId);
    saveEnabledModels(enabled);
  }
  notifyModelsChanged();
};

window.removeSingleModel = function (modelId: string): void {
  const enabled = getEnabledModels().filter((m) => m !== modelId);
  saveEnabledModels(enabled);
  notifyModelsChanged();
};

// ── 获取可用模型 ──
fetchModelsBtn.addEventListener("click", async () => {
  const apiKeyInput = document.getElementById("settings-api-key") as HTMLInputElement;
  const apiEndpointInput = document.getElementById("settings-api-endpoint") as HTMLInputElement;

  const config: Record<string, string> = {
    provider: providerSelect.value,
    apiKey: apiKeyInput.value,
    endpoint:
      apiEndpointInput.value ||
      window.PROVIDER_PRESETS[providerSelect.value]?.endpoint ||
      "",
    model: "",
  };

  if (!config.apiKey) {
    alert("请先填写 API Key");
    return;
  }

  fetchModelsBtn.textContent = "⏳ 获取中...";
  (fetchModelsBtn as HTMLButtonElement).disabled = true;

  try {
    const res = await fetch("/api/provider/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const result = await res.json() as { ok: boolean; models?: string[]; error?: string };

    if (result.ok) {
      cachedRemoteModels = result.models || [];
      refreshModelUI();
      console.log(`📦 获取到 ${result.models?.length || 0} 个模型`);
    } else {
      alert(`❌ 获取失败: ${result.error}`);
    }
  } catch (err: unknown) {
    alert(`❌ 请求失败: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    fetchModelsBtn.textContent = "📦 获取可用模型";
    (fetchModelsBtn as HTMLButtonElement).disabled = false;
  }
});

// ── 全部添加 ──
addAllBtn.addEventListener("click", () => {
  const enabled = getEnabledModels();
  const enabledSet = new Set(enabled);
  const toAdd = cachedRemoteModels.filter(
    (m) => !enabledSet.has(m)
  );
  if (toAdd.length === 0) {
    alert("没有可添加的新模型");
    return;
  }
  saveEnabledModels([...enabled, ...toAdd]);
  notifyModelsChanged();
});

// ── 全部删除 ──
removeAllBtn.addEventListener("click", () => {
  if (getEnabledModels().length === 0) {
    alert("已启用列表为空");
    return;
  }
  if (confirm("确定要删除所有已启用的模型吗？")) {
    saveEnabledModels([]);
    notifyModelsChanged();
  }
});

// ── 切换供应商时清空远程模型列表 ──
providerSelect.addEventListener("change", () => {
  cachedRemoteModels = [];
  renderRemoteModels([], getEnabledModels());
});

// ── 初始加载 ──
(function initModelManagement(): void {
  // PROVIDER_PRESETS 在 settings-provider.js 中定义，
  // 这里只做初始状态渲染
  customModelField.style.display =
    providerSelect.value === "custom" ? "block" : "none";
  renderEnabledModels(getEnabledModels());
})();
