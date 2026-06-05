/* ═════════════════════════════════════════════════════
   pi-zero · 聊天界面
   ═════════════════════════════════════════════════════ */

import { $ } from "./utils.js";
import { send } from "./websocket.js";
import { sessionManager } from "./session-manager.js";

// ── DOM 引用 ──
const statusDot = $("#status-dot") as HTMLElement;
const messages = $("#messages") as HTMLElement;
const input = $("#input") as HTMLTextAreaElement;
const sendBtn = $("#send-btn") as HTMLElement;
const modelSelectBtn = $("#model-select-btn") as HTMLElement;
const modelSelectList = $("#model-select-list") as HTMLElement;
const cmdBtn = $("#cmd-btn") as HTMLElement;
const cmdList = $("#cmd-list") as HTMLElement;

let currentAssistantMsg: HTMLElement | null = null;
let busy = false;
let selectedModel = "";

// ═══════════════════════════════════════════════════════
//  模型选择下拉
// ═══════════════════════════════════════════════════════

function refreshModelSelect(): void {
  const enabled: string[] = (() => {
    try {
      const raw = localStorage.getItem("pi-zero-enabled-models");
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  })();

  // 用户手动选择的模型（最高优先级）
  const userSelected: string = (() => {
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
    li.addEventListener("click", (e: Event) => {
      e.stopPropagation();
      selectModel(m);
      closeModelList();
    });
    modelSelectList.appendChild(li);
  });

  modelSelectBtn.textContent = targetModel;
}

function selectModel(modelId: string): void {
  selectedModel = modelId;
  modelSelectBtn.textContent = modelId;
  // 保存用户手动选择的模型，防止被轮询覆盖
  localStorage.setItem("pi-zero-selected-model", modelId);
  Array.from(modelSelectList.children).forEach((li) => {
    li.classList.toggle("active", (li as HTMLElement).dataset.value === modelId);
  });
}

function openModelList(): void {
  modelSelectList.classList.add("open");
  modelSelectBtn.classList.add("open");
}

function closeModelList(): void {
  modelSelectList.classList.remove("open");
  modelSelectBtn.classList.remove("open");
}

function toggleModelList(): void {
  if (modelSelectList.classList.contains("open")) {
    closeModelList();
  } else {
    openModelList();
  }
}

modelSelectBtn.addEventListener("click", (e: Event) => {
  e.stopPropagation();
  toggleModelList();
});

// ── 点击外部关闭下拉 ──
document.addEventListener("click", (e: MouseEvent) => {
  const modelWrapper = modelSelectBtn.closest(
    ".input-model-select-wrapper"
  );
  if (modelWrapper && !modelWrapper.contains(e.target as Node)) {
    closeModelList();
  }
  const cmdWrapper = cmdBtn.closest(".input-cmd-wrapper");
  if (cmdWrapper && !cmdWrapper.contains(e.target as Node)) {
    closeCmdList();
  }
});

// ── ESC 关闭下拉 ──
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    closeModelList();
    closeCmdList();
  }
});

refreshModelSelect();

// ── 跨标签页同步模型列表 ──
window.addEventListener("storage", (e: StorageEvent) => {
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

interface CommandDef {
  cmd: string;
  desc: string;
}

const COMMANDS: CommandDef[] = [
  { cmd: "/help", desc: "显示帮助信息" },
  { cmd: "/clear", desc: "清空当前对话" },
  { cmd: "/settings", desc: "打开设置面板" },
  { cmd: "/model", desc: "切换当前模型（后跟模型名）" },
  { cmd: "/export", desc: "导出当前对话" },
];

function populateCmdList(): void {
  cmdList.innerHTML = "";
  COMMANDS.forEach((c) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="cmd-key">${c.cmd}</span><span class="cmd-desc">${c.desc}</span>`;
    li.addEventListener("click", (e: Event) => {
      e.stopPropagation();
      input.value = c.cmd + " ";
      input.focus();
      input.dispatchEvent(new Event("input"));
      closeCmdList();
    });
    cmdList.appendChild(li);
  });
}

function openCmdList(): void {
  cmdList.classList.add("open");
}

function closeCmdList(): void {
  cmdList.classList.remove("open");
}

function toggleCmdList(): void {
  if (cmdList.classList.contains("open")) {
    closeCmdList();
  } else {
    openCmdList();
  }
}

cmdBtn.addEventListener("click", (e: Event) => {
  e.stopPropagation();
  toggleCmdList();
});

populateCmdList();

// ═══════════════════════════════════════════════════════
//  UI 操作
// ═══════════════════════════════════════════════════════

function addMessage(role: string): HTMLElement {
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

function scrollToBottom(): void {
  requestAnimationFrame(() => {
    messages.scrollTop = messages.scrollHeight;
  });
}

// ═══════════════════════════════════════════════════════
//  发送消息
// ═══════════════════════════════════════════════════════

function sendMessage(): void {
  const text = input.value.trim();
  if (!text || busy) return;

  addMessage("user").querySelector(".text")!.textContent = text;
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

input.addEventListener("keydown", (e: KeyboardEvent) => {
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

interface MessageUpdateEvent {
  type: string;
  assistantMessageEvent?: {
    type: string;
    delta?: string;
  };
}

interface ToolExecutionEvent {
  type: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

interface SessionInfoEvent {
  type: string;
  model?: {
    modelId?: string;
    id?: string;
  };
}

function handleWsEvent(event: MessageUpdateEvent | ToolExecutionEvent | SessionInfoEvent | Record<string, unknown>): void {
  switch (event.type) {
    case "message_update": {
      const ev = (event as MessageUpdateEvent).assistantMessageEvent;
      if (!ev) break;

      if (ev.type === "text_delta") {
        if (!currentAssistantMsg) {
          currentAssistantMsg = addMessage("assistant");
        }
        currentAssistantMsg.querySelector(".text")!.textContent +=
          ev.delta || "";
        scrollToBottom();
      }
      break;
    }

    case "tool_execution_start": {
      const toolEvent = event as ToolExecutionEvent;
      const el = document.createElement("div");
      el.className = "tool-call";
      el.dataset.toolCallId = toolEvent.toolCallId || "";
      el.innerHTML = `<span class="spinner"></span> 正在执行: ${toolEvent.toolName}`;
      messages.appendChild(el);
      scrollToBottom();
      break;
    }

    case "tool_execution_end": {
      const toolEvent = event as ToolExecutionEvent;
      const el = messages.querySelector(
        `[data-tool-call-id="${toolEvent.toolCallId}"]`
      ) as HTMLElement | null;
      if (el) {
        el.innerHTML = `✅ 执行完成: ${toolEvent.toolName}`;
        if (toolEvent.isError) {
          el.innerHTML = `❌ 执行出错: ${toolEvent.toolName}`;
        }
      }
      break;
    }

    case "agent_start": {
      statusDot.className = "thinking";
      busy = true;
      (sendBtn as HTMLButtonElement).disabled = true;
      break;
    }

    case "agent_end": {
      statusDot.className = "connected";
      if (currentAssistantMsg) {
        const textEl = currentAssistantMsg.querySelector(".text");
        if (textEl) {
          const fullText = (textEl.textContent || "").replace(
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
      (sendBtn as HTMLButtonElement).disabled = false;
      input.focus();
      break;
    }

    case "hot_reload": {
      console.log("♻️  检测到前端文件变更，刷新页面...");
      location.reload();
      break;
    }

    case "session_info": {
      const infoEvent = event as SessionInfoEvent;
      if (infoEvent.model) {
        const modelId = infoEvent.model.modelId || infoEvent.model.id;
        if (modelId) {
          selectedModel = modelId;
          modelSelectBtn.textContent = modelId;
        }
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
  window.addEventListener("ws:" + type, (e: Event) => {
    handleWsEvent((e as CustomEvent).detail);
  });
});

// ═══════════════════════════════════════════════════════
//  侧栏折叠切换
// ═══════════════════════════════════════════════════════

const navToggle = document.getElementById("nav-toggle") as HTMLElement;
const asideToggle = document.getElementById("aside-toggle") as HTMLElement;
const leftNav = document.getElementById("left-nav") as HTMLElement;
const rightAside = document.getElementById("right-aside") as HTMLElement;
const navIcon = document.getElementById("nav-icon") as HTMLElement;
const asideIcon = document.getElementById("aside-icon") as HTMLElement;

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
