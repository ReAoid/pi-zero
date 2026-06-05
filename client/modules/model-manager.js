/* ═════════════════════════════════════════════════════
   pi-zero · 模型管理
   ═════════════════════════════════════════════════════ */

import { escapeHtml } from "./utils.js";

// ── DOM 引用 ──
const providerSelect = document.getElementById("settings-provider");
const customModelField = document.getElementById("custom-model-field");
const remoteModelList = document.getElementById("remote-model-list");
const enabledModelList = document.getElementById("enabled-model-list");
const fetchModelsBtn = document.getElementById("settings-fetch-models");
const addAllBtn = document.getElementById("models-add-all");
const removeAllBtn = document.getElementById("models-remove-all");

let cachedRemoteModels = [];

// ── 已启用模型持久化 ──
export function getEnabledModels() {
  try {
    const raw = localStorage.getItem("pi-zero-enabled-models");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveEnabledModels(models) {
  localStorage.setItem("pi-zero-enabled-models", JSON.stringify(models));
}

// ── 渲染远程模型列表 ──
function renderRemoteModels(remoteModels, enabledModels) {
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
function renderEnabledModels(enabledModels) {
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
export function refreshModelUI() {
  const enabled = getEnabledModels();
  renderRemoteModels(cachedRemoteModels, enabled);
  renderEnabledModels(enabled);
  // 通知聊天区刷新模型下拉
  window.dispatchEvent(new CustomEvent("models-changed"));
}

// ── 全局函数（供 onclick 使用） ──
window.addSingleModel = function (modelId) {
  const enabled = getEnabledModels();
  if (!enabled.includes(modelId)) {
    enabled.push(modelId);
    saveEnabledModels(enabled);
  }
  refreshModelUI();
};

window.removeSingleModel = function (modelId) {
  const enabled = getEnabledModels().filter((m) => m !== modelId);
  saveEnabledModels(enabled);
  refreshModelUI();
};

// ── 获取可用模型 ──
fetchModelsBtn.addEventListener("click", async () => {
  const apiKeyInput = document.getElementById("settings-api-key");
  const apiEndpointInput = document.getElementById(
    "settings-api-endpoint"
  );

  const config = {
    provider: providerSelect.value,
    apiKey: apiKeyInput.value,
    endpoint:
      apiEndpointInput.value ||
      PROVIDER_PRESETS[providerSelect.value]?.endpoint ||
      "",
    model: "",
  };

  if (!config.apiKey) {
    alert("请先填写 API Key");
    return;
  }

  fetchModelsBtn.textContent = "⏳ 获取中...";
  fetchModelsBtn.disabled = true;

  try {
    const res = await fetch("/api/provider/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const result = await res.json();

    if (result.ok) {
      cachedRemoteModels = result.models;
      refreshModelUI();
      console.log(`📦 获取到 ${result.models.length} 个模型`);
    } else {
      alert(`❌ 获取失败: ${result.error}`);
    }
  } catch (err) {
    alert(`❌ 请求失败: ${err.message}`);
  } finally {
    fetchModelsBtn.textContent = "📦 获取可用模型";
    fetchModelsBtn.disabled = false;
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
  refreshModelUI();
});

// ── 全部删除 ──
removeAllBtn.addEventListener("click", () => {
  if (getEnabledModels().length === 0) {
    alert("已启用列表为空");
    return;
  }
  if (confirm("确定要删除所有已启用的模型吗？")) {
    saveEnabledModels([]);
    refreshModelUI();
  }
});

// ── 切换供应商时清空远程模型列表 ──
providerSelect.addEventListener("change", () => {
  cachedRemoteModels = [];
  renderRemoteModels([], getEnabledModels());
});

// ── 初始加载 ──
(function initModelManagement() {
  // PROVIDER_PRESETS 在 settings-provider.js 中定义，
  // 这里只做初始状态渲染
  customModelField.style.display =
    providerSelect.value === "custom" ? "block" : "none";
  renderEnabledModels(getEnabledModels());
})();
