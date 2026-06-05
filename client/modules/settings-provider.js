/* ═════════════════════════════════════════════════════
   pi-zero · 供应商配置
   ═════════════════════════════════════════════════════ */

import { getEnabledModels } from "./model-manager.js";

// ── DOM 引用 ──
const providerSelect = document.getElementById("settings-provider");
const apiKeyInput = document.getElementById("settings-api-key");
const apiEndpointInput = document.getElementById("settings-api-endpoint");
const modelInput = document.getElementById("settings-model");
const customModelField = document.getElementById("custom-model-field");
const providerSaveBtn = document.getElementById("settings-provider-save");
const providerTestBtn = document.getElementById("settings-provider-test");
const keyToggleBtn = document.getElementById("settings-key-toggle");
const endpointHint = document.getElementById("endpoint-hint");
const modelHint = document.getElementById("model-hint");

// ── 四种供应商的默认配置 ──
const PROVIDER_PRESETS = {
  openai: {
    endpoint: "https://api.openai.com/v1",
    model: "gpt-4o",
    hint: "OpenAI: https://api.openai.com/v1",
    modelHint: "gpt-4o / gpt-4o-mini / gpt-5.4 / o3-mini ...",
  },
  anthropic: {
    endpoint: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
    hint: "Anthropic: https://api.anthropic.com/v1",
    modelHint:
      "claude-sonnet-4-20250514 / claude-opus-4-8 / claude-haiku-4-5 ...",
  },
  deepseek: {
    endpoint: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    hint: "DeepSeek: https://api.deepseek.com/v1",
    modelHint: "deepseek-chat / deepseek-reasoner ...",
  },
  custom: {
    endpoint: "https://",
    model: "",
    hint: "填入兼容 OpenAI 格式的自定义端点 URL",
    modelHint: "输入你的自定义模型名称",
  },
};

// 暴露给 model-manager.js 使用
window.PROVIDER_PRESETS = PROVIDER_PRESETS;

// ── 切换供应商时更新端点和模型的默认提示 ──
function updateProviderHints() {
  const preset =
    PROVIDER_PRESETS[providerSelect.value] || PROVIDER_PRESETS.custom;
  endpointHint.textContent = preset.hint;
  modelHint.textContent = preset.modelHint;

  const saved = localStorage.getItem("pi-zero-provider");
  const cfg = saved ? JSON.parse(saved) : {};
  if (!cfg.endpoint || cfg.provider !== providerSelect.value) {
    apiEndpointInput.placeholder = preset.endpoint;
  }
  if (!cfg.model || cfg.provider !== providerSelect.value) {
    modelInput.placeholder = preset.model;
  }

  // 显示/隐藏自定义模型字段
  customModelField.style.display =
    providerSelect.value === "custom" ? "block" : "none";
}

// ── 加载已保存的供应商配置 ──
function loadProviderConfig() {
  const saved = localStorage.getItem("pi-zero-provider");
  if (saved) {
    try {
      const cfg = JSON.parse(saved);
      providerSelect.value = cfg.provider || "openai";
      apiKeyInput.value = cfg.apiKey || "";
      apiEndpointInput.value = cfg.endpoint || "";
      apiEndpointInput.placeholder =
        PROVIDER_PRESETS[cfg.provider]?.endpoint || "https://";
      modelInput.value = cfg.model || "";
      modelInput.placeholder =
        PROVIDER_PRESETS[cfg.provider]?.model || "";
    } catch (e) {}
  }
  updateProviderHints();
}

loadProviderConfig();

// ── 事件绑定 ──
providerSelect.addEventListener("change", updateProviderHints);

providerSaveBtn.addEventListener("click", () => {
  const provider = providerSelect.value;
  const enabledModels = getEnabledModels();
  const defaultModel =
    provider === "custom"
      ? modelInput.value || PROVIDER_PRESETS.custom?.model || ""
      : enabledModels[0] || PROVIDER_PRESETS[provider]?.model || "";
  const config = {
    provider: provider,
    apiKey: apiKeyInput.value,
    endpoint:
      apiEndpointInput.value ||
      PROVIDER_PRESETS[provider]?.endpoint ||
      "",
    model: defaultModel,
    enabledModels,
  };
  localStorage.setItem("pi-zero-provider", JSON.stringify(config));

  fetch("/api/provider/switch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  })
    .then((res) => res.json())
    .then((result) => {
      if (result.ok) {
        alert("✅ 配置已保存并切换");
      } else {
        alert(
          "⚠️ 配置已保存，但切换失败: " +
            (result.error || "未知错误")
        );
      }
    })
    .catch((err) => {
      alert(
        "✅ 配置已保存（后端切换失败: " + err.message + "）"
      );
    });
});

// ── 测试连接 ──
providerTestBtn.addEventListener("click", async () => {
  const provider = providerSelect.value;
  const enabledModels = getEnabledModels();
  const testModel =
    provider === "custom"
      ? modelInput.value || PROVIDER_PRESETS.custom?.model || ""
      : enabledModels[0] || PROVIDER_PRESETS[provider]?.model || "";
  const config = {
    provider,
    apiKey: apiKeyInput.value,
    endpoint:
      apiEndpointInput.value ||
      PROVIDER_PRESETS[provider]?.endpoint ||
      "",
    model: testModel,
  };

  providerTestBtn.textContent = "⏳ 测试中...";
  providerTestBtn.disabled = true;

  try {
    const res = await fetch("/api/provider/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const result = await res.json();
    if (result.ok) {
      alert(`✅ 连接成功！模型: ${result.model ?? "未知"}`);
    } else {
      alert(`❌ 连接失败: ${result.error}`);
    }
  } catch (err) {
    alert(`❌ 请求失败: ${err.message}`);
  } finally {
    providerTestBtn.textContent = "测试连接";
    providerTestBtn.disabled = false;
  }
});

// ── API Key 显示/隐藏 ──
keyToggleBtn.addEventListener("click", () => {
  const t = apiKeyInput.type;
  apiKeyInput.type = t === "password" ? "text" : "password";
  keyToggleBtn.textContent = t === "password" ? "🙈" : "👁";
});
