/* ═════════════════════════════════════════════════════
   pi-zero · Workplace 文件系统管理
   ═════════════════════════════════════════════════════ */

import { safeSetText } from "./utils.js";
import type { WorkFileItem } from "../../types.js";

// ── DOM 引用 ──
const fileListEl = document.getElementById("wp-file-list")!;
const pathBarEl = document.getElementById("wp-path-bar")!;
const dropZoneEl = document.getElementById("wp-drop-zone")!;

// ── Workplace 对象类型 ──
interface WorkplaceState {
  currentPath: string;
  refresh(path?: string): Promise<void>;
  renderItems(items: WorkFileItem[]): void;
  handleOpen(el: HTMLElement): void;
  navigateTo(path: string): void;
  openFile(path: string): Promise<void>;
  showFilePreview(path: string, content: string): void;
  openEditor(path: string, content: string): void;
  downloadFile(path: string, base64Content: string): void;
  renderPathBar(pathStr: string): void;
  showContextMenu(x: number, y: number, path: string, isDir: boolean): void;
  deleteItem(path: string, isDir: boolean): Promise<void>;
  renameItem(path: string, isDir: boolean): Promise<void>;
  createFile(): Promise<void>;
  createDir(): Promise<void>;
  uploadFile(file: File): Promise<void>;
  initDragDrop(): void;
}

// ── Workplace 对象 ──
export const workplace: WorkplaceState = {
  currentPath: "",

  // ── 刷新文件列表 ──
  async refresh(path?: string): Promise<void> {
    if (path !== undefined) this.currentPath = path || "";
    fileListEl.innerHTML = '<div class="workplace-loading">加载中...</div>';
    try {
      const res = await fetch(
        `/api/workplace/list?path=${encodeURIComponent(this.currentPath)}`
      );
      const data = await res.json();
      if (data.ok) {
        this.renderItems(data.items);
        this.renderPathBar(data.path);
      } else {
        fileListEl.innerHTML = `<div class="workplace-error">❌ 加载失败: ${safeSetText(data.error)}</div>`;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      fileListEl.innerHTML = `<div class="workplace-error">❌ 请求失败: ${msg}</div>`;
    }
  },

  // ── 渲染文件项 ──
  renderItems(items: WorkFileItem[]): void {
    if (items.length === 0) {
      fileListEl.innerHTML = '<div class="workplace-empty">📂 空目录</div>';
      return;
    }
    fileListEl.innerHTML = items
      .map((item) => {
        const icon = item.isDirectory ? "📁" : item.isText ? "📄" : "📎";
        const sizeHtml = item.isDirectory
          ? ""
          : `<span class="wp-file-size">${safeSetText(item.sizeFormatted || "")}</span>`;
        return `
          <div class="wp-file-item ${item.isDirectory ? "wp-dir" : "wp-file"}"
               data-path="${safeSetText(item.path)}"
               data-isdir="${item.isDirectory}"
               data-istext="${item.isText}">
            <span class="wp-file-icon">${icon}</span>
            <span class="wp-file-name">${safeSetText(item.name)}</span>
            ${sizeHtml}
          </div>
        `;
      })
      .join("");

    // ── 单击/双击逻辑 ──
    fileListEl.querySelectorAll(".wp-file-item").forEach((el) => {
      let clickTimer: ReturnType<typeof setTimeout> | null = null;
      el.addEventListener("click", (e: Event) => {
        if (clickTimer) {
          clearTimeout(clickTimer);
          clickTimer = null;
          this.handleOpen(el as HTMLElement);
        } else {
          clickTimer = setTimeout(() => {
            clickTimer = null;
            fileListEl
              .querySelectorAll(".wp-file-item.selected")
              .forEach((s) => s.classList.remove("selected"));
            el.classList.add("selected");
          }, 250);
        }
      });

      (el as HTMLElement).addEventListener("contextmenu", (e: MouseEvent) => {
        e.preventDefault();
        const target = el as HTMLElement;
        this.showContextMenu(
          e.clientX,
          e.clientY,
          target.dataset.path || "",
          target.dataset.isdir === "true"
        );
      });
    });
  },

  // ── 打开文件/目录 ──
  handleOpen(el: HTMLElement): void {
    const path = el.dataset.path || "";
    const isDir = el.dataset.isdir === "true";
    if (isDir) {
      this.navigateTo(path);
    } else {
      this.openFile(path);
    }
  },

  // ── 进入目录 ──
  navigateTo(path: string): void {
    this.currentPath = path;
    this.refresh(path);
  },

  // ── 打开文件预览 ──
  async openFile(path: string): Promise<void> {
    try {
      const res = await fetch(
        `/api/workplace/read?path=${encodeURIComponent(path)}`
      );
      const data = await res.json();
      if (data.ok) {
        if (data.isText) {
          this.showFilePreview(path, data.content);
        } else {
          if (
            confirm(
              `二进制文件 "${path}" 无法预览。要下载吗？`
            )
          ) {
            this.downloadFile(path, data.content);
          }
        }
      } else {
        alert("❌ " + data.error);
      }
    } catch (err: unknown) {
      alert("❌ 读取失败: " + (err instanceof Error ? err.message : String(err)));
    }
  },

  // ── 文件预览弹框 ──
  showFilePreview(path: string, content: string): void {
    const old = document.querySelector(".workplace-preview-overlay");
    if (old) old.remove();

    const overlay = document.createElement("div");
    overlay.className = "workplace-preview-overlay";

    const header = document.createElement("div");
    header.className = "workplace-preview-header";
    header.innerHTML = `
      <span class="workplace-preview-title">${safeSetText(path)}</span>
      <div class="workplace-preview-actions">
        <button class="wp-preview-btn wp-preview-copy" title="复制内容">📋</button>
        <button class="wp-preview-btn wp-preview-download" title="下载">⬇</button>
        <button class="wp-preview-btn wp-preview-edit" title="编辑">✏</button>
        <button class="wp-preview-btn wp-preview-close" title="关闭">✕</button>
      </div>
    `;

    const body = document.createElement("div");
    body.className = "workplace-preview-body";
    body.innerHTML = `<pre class="workplace-preview-content"><code>${safeSetText(content)}</code></pre>`;

    overlay.appendChild(header);
    overlay.appendChild(body);
    document.body.appendChild(overlay);

    header.querySelector(".wp-preview-close")!.addEventListener("click", () => overlay.remove());
    header.querySelector(".wp-preview-copy")!.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(content);
        alert("✅ 已复制到剪贴板");
      } catch {
        alert("❌ 复制失败");
      }
    });
    header.querySelector(".wp-preview-download")!.addEventListener("click", () => {
      const a = document.createElement("a");
      const blob = new Blob([content], { type: "text/plain" });
      a.href = URL.createObjectURL(blob);
      a.download = path.split("/").pop() || "file";
      a.click();
      URL.revokeObjectURL(a.href);
    });
    header.querySelector(".wp-preview-edit")!.addEventListener("click", () => {
      this.openEditor(path, content);
      overlay.remove();
    });

    overlay.addEventListener("click", (e: MouseEvent) => {
      if (e.target === overlay) overlay.remove();
    });

    const escHandler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        overlay.remove();
        document.removeEventListener("keydown", escHandler);
      }
    };
    document.addEventListener("keydown", escHandler);
  },

  // ── 内联编辑器 ──
  openEditor(path: string, content: string): void {
    const overlay = document.createElement("div");
    overlay.className = "workplace-preview-overlay";

    const header = document.createElement("div");
    header.className = "workplace-preview-header";
    header.innerHTML = `
      <span class="workplace-preview-title">✏️ ${safeSetText(path)}</span>
      <div class="workplace-preview-actions">
        <button class="wp-preview-btn wp-preview-save" title="保存" style="color: var(--color-success, #4caf50);">💾 保存</button>
        <button class="wp-preview-btn wp-preview-close" title="取消">✕</button>
      </div>
    `;

    const body = document.createElement("div");
    body.className = "workplace-preview-body";
    body.style.padding = "0";
    const textarea = document.createElement("textarea");
    textarea.className = "workplace-editor-textarea";
    textarea.value = content;
    body.appendChild(textarea);

    overlay.appendChild(header);
    overlay.appendChild(body);
    document.body.appendChild(overlay);

    const closeBtn = header.querySelector(".wp-preview-close") as HTMLElement;
    const saveBtn = header.querySelector(".wp-preview-save") as HTMLElement;

    closeBtn.addEventListener("click", () => {
      if (textarea.value !== content) {
        if (confirm("有未保存的更改，确定放弃吗？")) overlay.remove();
      } else {
        overlay.remove();
      }
    });

    saveBtn.addEventListener("click", async () => {
      try {
        const res = await fetch("/api/workplace/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, content: textarea.value }),
        });
        const data = await res.json();
        if (data.ok) {
          alert("✅ 已保存");
          overlay.remove();
          this.refresh();
        } else {
          alert("❌ " + data.error);
        }
      } catch (err: unknown) {
        alert("❌ 保存失败: " + (err instanceof Error ? err.message : String(err)));
      }
    });

    textarea.addEventListener("keydown", (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveBtn.click();
      }
    });

    const escHandler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        closeBtn.click();
        document.removeEventListener("keydown", escHandler);
      }
    };
    document.addEventListener("keydown", escHandler);

    textarea.focus();
  },

  // ── 下载二进制文件 ──
  downloadFile(path: string, base64Content: string): void {
    const a = document.createElement("a");
    a.href = "data:application/octet-stream;base64," + base64Content;
    a.download = path.split("/").pop() || "file";
    a.click();
    URL.revokeObjectURL(a.href);
  },

  // ── 渲染面包屑路径 ──
  renderPathBar(pathStr: string): void {
    const parts =
      pathStr === "/" || !pathStr ? [] : pathStr.split("/");
    let html =
      '<span class="wp-path-item wp-path-root" data-path="">🏠</span>';
    let accumulated = "";
    parts.forEach((part, i) => {
      accumulated = accumulated ? accumulated + "/" + part : part;
      const isLast = i === parts.length - 1;
      html += `<span class="wp-path-sep">/</span>`;
      html += `<span class="wp-path-item ${isLast ? "wp-path-current" : ""}" data-path="${safeSetText(accumulated)}">${safeSetText(part)}</span>`;
    });
    pathBarEl.innerHTML = html;

    pathBarEl.querySelectorAll(".wp-path-item").forEach((el) => {
      el.addEventListener("click", () => {
        this.navigateTo((el as HTMLElement).dataset.path || "");
      });
    });
  },

  // ── 右键菜单 ──
  showContextMenu(x: number, y: number, path: string, isDir: boolean): void {
    const old = document.querySelector(".workplace-context-menu");
    if (old) old.remove();

    const menu = document.createElement("div");
    menu.className = "workplace-context-menu";
    menu.style.left = x + "px";
    menu.style.top = y + "px";

    const actions: { label: string; action: () => void; danger?: boolean }[] = [
      {
        label: isDir ? "📂 打开" : "📄 打开",
        action: () => {
          if (isDir) this.navigateTo(path);
          else this.openFile(path);
        },
      },
      { label: "✏️ 重命名", action: () => this.renameItem(path, isDir) },
      {
        label: "📋 复制路径",
        action: () => {
          navigator.clipboard.writeText(path);
          alert("已复制: " + path);
        },
      },
      { label: "🗑 删除", action: () => this.deleteItem(path, isDir), danger: true },
    ];

    menu.innerHTML = actions
      .map(
        (a) =>
          `<div class="wp-context-item ${a.danger ? "wp-context-danger" : ""}">${safeSetText(a.label)}</div>`
      )
      .join("");

    document.body.appendChild(menu);

    menu.querySelectorAll(".wp-context-item").forEach((el, i) => {
      el.addEventListener("click", () => {
        actions[i].action();
        menu.remove();
      });
    });

    const close = (e: MouseEvent): void => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener("click", close);
      }
    };
    setTimeout(() => document.addEventListener("click", close), 0);
  },

  // ── 删除 ──
  async deleteItem(path: string, isDir: boolean): Promise<void> {
    const type = isDir ? "文件夹" : "文件";
    if (!confirm(`确定删除${type} "${path}" 吗？`)) return;
    try {
      const res = await fetch("/api/workplace/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      if (data.ok) {
        this.refresh();
      } else {
        alert("❌ " + data.error);
      }
    } catch (err: unknown) {
      alert("❌ " + (err instanceof Error ? err.message : String(err)));
    }
  },

  // ── 重命名 ──
  async renameItem(path: string, isDir: boolean): Promise<void> {
    const oldName = path.split("/").pop();
    const newName = prompt(
      `重命名${isDir ? "文件夹" : "文件"}:`,
      oldName
    );
    if (!newName || newName === oldName) return;

    try {
      const res = await fetch("/api/workplace/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, newName }),
      });
      const data = await res.json();
      if (data.ok) {
        this.refresh();
      } else {
        alert("❌ " + data.error);
      }
    } catch (err: unknown) {
      alert("❌ 重命名失败: " + (err instanceof Error ? err.message : String(err)));
    }
  },

  // ── 新建文件 ──
  async createFile(): Promise<void> {
    const name = prompt("输入文件名:");
    if (!name) return;
    const fullPath = this.currentPath
      ? this.currentPath + "/" + name
      : name;
    try {
      const res = await fetch("/api/workplace/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: fullPath, content: "" }),
      });
      const data = await res.json();
      if (data.ok) {
        this.openEditor(fullPath, "");
        this.refresh();
      } else {
        alert("❌ " + data.error);
      }
    } catch (err: unknown) {
      alert("❌ " + (err instanceof Error ? err.message : String(err)));
    }
  },

  // ── 新建文件夹 ──
  async createDir(): Promise<void> {
    const name = prompt("输入文件夹名称:");
    if (!name) return;
    const fullPath = this.currentPath
      ? this.currentPath + "/" + name
      : name;
    try {
      const res = await fetch("/api/workplace/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: fullPath }),
      });
      const data = await res.json();
      if (data.ok) {
        this.refresh();
      } else {
        alert("❌ " + data.error);
      }
    } catch (err: unknown) {
      alert("❌ " + (err instanceof Error ? err.message : String(err)));
    }
  },

  // ── 上传文件 ──
  async uploadFile(file: File): Promise<void> {
    const formData = new FormData();
    const fullPath = this.currentPath
      ? this.currentPath + "/" + file.name
      : file.name;
    formData.append("file", file);
    formData.append("path", fullPath);
    const res = await fetch("/api/workplace/upload", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (data.ok) {
      this.refresh();
    } else {
      throw new Error(data.error);
    }
  },

  // ── 初始化拖放 ──
  initDragDrop(): void {
    const aside = document.getElementById("right-aside")!;

    aside.addEventListener("dragenter", (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dropZoneEl.classList.add("active");
    });

    aside.addEventListener("dragover", (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dropZoneEl.classList.add("active");
    });

    aside.addEventListener("dragleave", (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.relatedTarget && aside.contains(e.relatedTarget as Node)) return;
      dropZoneEl.classList.remove("active");
    });

    aside.addEventListener("drop", async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dropZoneEl.classList.remove("active");

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      dropZoneEl.classList.add("uploading");
      dropZoneEl.querySelector(".workplace-drop-zone-content")!.innerHTML =
        `<span class="workplace-drop-icon">⏳</span><span>上传中 ${files.length} 个文件...</span>`;

      let success = 0;
      let failed = 0;
      for (let i = 0; i < files.length; i++) {
        try {
          await this.uploadFile(files[i]);
          success++;
        } catch (err) {
          console.error("上传失败:", files[i].name, err);
          failed++;
        }
      }

      dropZoneEl.classList.remove("uploading");
      dropZoneEl.querySelector(".workplace-drop-zone-content")!.innerHTML =
        `<span class="workplace-drop-icon">📂</span><span>${success} 个文件上传成功${failed ? ", " + failed + " 个失败" : ""}</span>`;

      setTimeout(() => {
        dropZoneEl.querySelector(
          ".workplace-drop-zone-content"
        )!.innerHTML = `<span class="workplace-drop-icon">📂</span><span>拖放文件到此处上传</span>`;
      }, 2000);
    });
  },
};

// ── 绑定 Workplace 按钮 ──
document.getElementById("wp-refresh")!.addEventListener("click", () =>
  workplace.refresh()
);
document.getElementById("wp-open-folder")!.addEventListener("click", () => {
  fetch("/api/workplace/open", { method: "POST" })
    .then((res) => res.json())
    .then((data) => {
      if (!data.ok) alert("❌ " + data.error);
    })
    .catch((err: unknown) =>
      alert("❌ 打开文件管理器失败: " + (err instanceof Error ? err.message : String(err)))
    );
});

// ── 监听 workplace 文件变更（来自 WebSocket 自定义事件） ──
window.addEventListener("ws:workplace_changed", () => {
  if ((window as unknown as Record<string, unknown>)._wpDebounceTimer) clearTimeout((window as unknown as Record<string, ReturnType<typeof setTimeout>>)._wpDebounceTimer);
  (window as unknown as Record<string, ReturnType<typeof setTimeout>>)._wpDebounceTimer = setTimeout(() => {
    workplace.refresh();
  }, 500);
});

// ── 初始化 Workplace ──
(async function initWorkplace(): Promise<void> {
  // 优先从服务端加载存储配置
  try {
    const res = await fetch("/api/storage/config");
    const data = await res.json();
    if (!data.ok || !data.config) throw new Error("no config");
  } catch {
    // 降级：从 localStorage 加载
    const stored = localStorage.getItem("pi-zero-storage");
    if (stored) {
      try {
        const cfg = JSON.parse(stored) as { workplace?: string };
        if (cfg.workplace) {
          fetch("/api/workplace/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: cfg.workplace }),
          }).catch(() => {});
        }
      } catch (e) { /* ignore */ }
    }
  }
  workplace.refresh();
  workplace.initDragDrop();
})();
