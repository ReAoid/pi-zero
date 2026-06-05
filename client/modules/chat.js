/* ═════════════════════════════════════════════════════
   pi-zero · 聊天界面
   ═════════════════════════════════════════════════════ */

import { $ } from "./utils.js";
import { send } from "./websocket.js";
import { sessionManager } from "./session-manager.js";

// ── DOM 引用 ──
const statusDot = $("#status-dot");
const messages = $("#messages");
const input = $("#input");
const sendBtn = $("#send-btn");
const modelSelectBtn = $("#model-select-btn");
const modelSelectList = $("#model-select-list");
const cmdBtn = $("#cmd-btn");
const cmdList = $("#cmd-list");

let currentAssistantMsg = null;
let busy = false;
let selectedModel = "";

// ═══════════════════════════════════════════════════════
//  模型选择下拉
// ═══════════════════════════════════════════════════════

function refreshModelSelect() {
  const enabled = (() => {
    try {
      const raw = localStorage.getItem("pi-zero-enabled-models");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  })();

  // 用户手动选择的模型（最高优先级）
  const userSelected = (() => {
    try {
      return localStorage.getItem("pi-zero-selected-model") || "";
    } catch {
      return "";
    }
  })();

  modelSelectList.innerHTML = "";

  if (enabled.length === 0) {
    modelSelectBtn.textContent = "无可用模型";
    selectedModel = "";
    return;
  }

  // 优先级：用户手动选择 > 已启用列表第一个
  let targetModel =
    userSelected && enabled.includes(userSelected)
      ? userSelected
      : enabled[0];
  selectedModel = targetModel;

  enabled.forEach((m) => {
    const li = document.createElement("li");
    li.textContent = m;
    li.dataset.value = m;
    if (m === targetModel) {
      li.classList.add("active");
    }
    li.addEventListener("click", (e) => {
      e.stopPropagation();
      selectModel(m);
      closeModelList();
    });
    modelSelectList.appendChild(li);
  });

  modelSelectBtn.textContent = targetModel;
}

function selectModel(modelId) {
  selectedModel = modelId;
  modelSelectBtn.textContent = modelId;
  // 保存用户手动选择的模型，防止被轮询覆盖
  localStorage.setItem("pi-zero-selected-model", modelId);
  Array.from(modelSelectList.children).forEach((li) => {
    li.classList.toggle("active", li.dataset.value === modelId);
  });
}

function openModelList() {
  modelSelectList.classList.add("open");
  modelSelectBtn.classList.add("open");
}

function closeModelList() {
  modelSelectList.classList.remove("open");
  modelSelectBtn.classList.remove("open");
}

function toggleModelList() {
  if (modelSelectList.classList.contains("open")) {
    closeModelList();
  } else {
    openModelList();
  }
}

modelSelectBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleModelList();
});

// ── 点击外部关闭下拉 ──
document.addEventListener("click", (e) => {
  const modelWrapper = modelSelectBtn.closest(
    ".input-model-select-wrapper"
  );
  if (modelWrapper && !modelWrapper.contains(e.target)) {
    closeModelList();
  }
  const cmdWrapper = cmdBtn.closest(".input-cmd-wrapper");
  if (cmdWrapper && !cmdWrapper.contains(e.target)) {
    closeCmdList();
  }
});

// ── ESC 关闭下拉 ──
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModelList();
    closeCmdList();
  }
});

refreshModelSelect();

// ── 跨标签页同步模型列表 ──
window.addEventListener("storage", (e) => {
  if (
    e.key === "pi-zero-enabled-models" ||
    e.key === "pi-zero-provider"
  ) {
    refreshModelSelect();
  }
});

// 轮询兼容
setInterval(() => {
  refreshModelSelect();
}, 3000);

// ── 监听模型变更自定义事件 ──
window.addEventListener("models-changed", () => {
  refreshModelSelect();
});

// ═══════════════════════════════════════════════════════
//  命令列表
// ═══════════════════════════════════════════════════════

const COMMANDS = [
  { cmd: "/help", desc: "显示帮助信息" },
  { cmd: "/clear", desc: "清空当前对话" },
  { cmd: "/settings", desc: "打开设置面板" },
  { cmd: "/model", desc: "切换当前模型（后跟模型名）" },
  { cmd: "/export", desc: "导出当前对话" },
];

function populateCmdList() {
  cmdList.innerHTML = "";
  COMMANDS.forEach((c) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="cmd-key">${c.cmd}</span><span class="cmd-desc">${c.desc}</span>`;
    li.addEventListener("click", (e) => {
      e.stopPropagation();
      input.value = c.cmd + " ";
      input.focus();
      input.dispatchEvent(new Event("input"));
      closeCmdList();
    });
    cmdList.appendChild(li);
  });
}

function openCmdList() {
  cmdList.classList.add("open");
}

function closeCmdList() {
  cmdList.classList.remove("open");
}

function toggleCmdList() {
  if (cmdList.classList.contains("open")) {
    closeCmdList();
  } else {
    openCmdList();
  }
}

cmdBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleCmdList();
});

populateCmdList();

// ═══════════════════════════════════════════════════════
//  UI 操作
// ═══════════════════════════════════════════════════════

function addMessage(role) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;

  const sender = document.createElement("div");
  sender.className = "sender";
  sender.textContent = role === "user" ? "你" : "AI";

  const text = document.createElement("div");
  text.className = "text";

  div.appendChild(sender);
  div.appendChild(text);

  if (role === "assistant") {
    const cursor = document.createElement("span");
    cursor.className = "cursor";
    text.appendChild(cursor);
  }

  messages.appendChild(div);
  scrollToBottom();
  return div;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messages.scrollTop = messages.scrollHeight;
  });
}

// ═══════════════════════════════════════════════════════
//  发送消息
// ═══════════════════════════════════════════════════════

function sendMessage() {
  const text = input.value.trim();
  if (!text || busy) return;

  addMessage("user").querySelector(".text").textContent = text;
  input.value = "";
  input.style.height = "auto";

  currentAssistantMsg = null;

  sessionManager.saveMessage("user", text);

  const currentModel = selectedModel;
  send({
    type: "prompt",
    text,
    model: currentModel || undefined,
  });
}

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 120) + "px";
});

sendBtn.addEventListener("click", sendMessage);

setTimeout(() => input.focus(), 300);

// ═══════════════════════════════════════════════════════
//  WebSocket 事件处理
// ═══════════════════════════════════════════════════════

function handleWsEvent(event) {
  switch (event.type) {
    case "message_update": {
      const ev = event.assistantMessageEvent;
      if (!ev) break;

      if (ev.type === "text_delta") {
        if (!currentAssistantMsg) {
          currentAssistantMsg = addMessage("assistant");
        }
        currentAssistantMsg.querySelector(".text").textContent +=
          ev.delta;
        scrollToBottom();
      }
      break;
    }

    case "tool_execution_start": {
      const el = document.createElement("div");
      el.className = "tool-call";
      el.dataset.toolCallId = event.toolCallId;
      el.innerHTML = `<span class="spinner"></span> 正在执行: ${event.toolName}`;
      messages.appendChild(el);
      scrollToBottom();
      break;
    }

    case "tool_execution_end": {
      const el = messages.querySelector(
        `[data-tool-call-id="${event.toolCallId}"]`
      );
      if (el) {
        el.innerHTML = `✅ 执行完成: ${event.toolName}`;
        if (event.isError) {
          el.innerHTML = `❌ 执行出错: ${event.toolName}`;
        }
      }
      break;
    }

    case "agent_start": {
      statusDot.className = "thinking";
      busy = true;
      sendBtn.disabled = true;
      break;
    }

    case "agent_end": {
      statusDot.className = "connected";
      if (currentAssistantMsg) {
        const textEl = currentAssistantMsg.querySelector(".text");
        if (textEl) {
          const fullText = textEl.textContent.replace(
            /[\s\n]+$/,
            ""
          );
          if (fullText) {
            sessionManager.saveMessage("assistant", fullText);
          }
        }
      }
      currentAssistantMsg = null;
      busy = false;
      sendBtn.disabled = false;
      input.focus();
      break;
    }

    case "hot_reload": {
      console.log("♻️  检测到前端文件变更，刷新页面...");
      location.reload();
      break;
    }

    case "session_info": {
      if (event.model) {
        const modelId = event.model.modelId || event.model.id;
        selectedModel = modelId;
        modelSelectBtn.textContent = modelId;
      }
      break;
    }
  }
}

// 注册 WebSocket 事件监听
const wsEventTypes = [
  "message_update",
  "tool_execution_start",
  "tool_execution_end",
  "agent_start",
  "agent_end",
  "hot_reload",
  "session_info",
];

wsEventTypes.forEach((type) => {
  window.addEventListener("ws:" + type, (e) => {
    handleWsEvent(e.detail);
  });
});

// ═══════════════════════════════════════════════════════
//  侧栏折叠切换
// ═══════════════════════════════════════════════════════

const navToggle = document.getElementById("nav-toggle");
const asideToggle = document.getElementById("aside-toggle");
const leftNav = document.getElementById("left-nav");
const rightAside = document.getElementById("right-aside");
const navIcon = document.getElementById("nav-icon");
const asideIcon = document.getElementById("aside-icon");

navToggle.addEventListener("click", () => {
  const collapsed = leftNav.classList.toggle("collapsed");
  navIcon.textContent = collapsed ? "▶" : "◀";
  navToggle.title = collapsed
    ? "展开左侧导航"
    : "收起左侧导航";
});

asideToggle.addEventListener("click", () => {
  const collapsed = rightAside.classList.toggle("collapsed");
  asideIcon.textContent = collapsed ? "◀" : "▶";
  asideToggle.title = collapsed
    ? "展开右侧边栏"
    : "收起右侧边栏";
});
