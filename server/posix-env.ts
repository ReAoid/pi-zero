/**
 * pi-zero POSIX 命令环境注入
 *
 * 在 pi SDK 初始化之前，将项目内的 BusyBox POSIX 环境加入 PATH，
 * 使 pi 的 bash 工具能找到 ls、cat、sed、grep 等命令。
 *
 * 可移植性：
 *   BusyBox-w32 单文件 ~700KB，零外部依赖。
 *   任何 Windows 机器运行 npm run setup:posix 即可使用。
 *   不需要预装 Git、WSL 或任何其他工具。
 *
 * 目录结构：
 *   bash/              ← 顶层 POSIX 命令环境，不要的人可直接删除
 *   ├── busybox64.exe  ← 提交到 git
 *   ├── ls.exe         ← 硬链接 (git 忽略)
 *   ├── cat.exe        ← 硬链接
 *   └── ...
 */

import { existsSync } from "node:fs";
import { resolve, delimiter, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

export function injectPosixPath(): void {
  const injected: string[] = [];

  // 1. 项目自带 BusyBox 环境（bash/ 目录，不要的人直接删）
  const projectBin = resolve(PROJECT_ROOT, "bash");
  if (existsSync(projectBin)) {
    addToPath(projectBin);
    injected.push(projectBin);
  }

  // 2. Git for Windows MSYS2 工具（后备，仅开发机有）
  const gitUsrBin = "E:/DevelopmentEnvironment/Git/Git/usr/bin";
  if (existsSync(gitUsrBin)) {
    addToPath(gitUsrBin);
    injected.push(gitUsrBin);
  }

  if (injected.length > 0) {
    console.log("  POSIX 环境已注入 PATH:");
    for (const dir of injected) {
      console.log("    - " + dir);
    }
  }
}

function addToPath(dir: string): void {
  const pathKey = Object.keys(process.env).find(
    (k) => k.toLowerCase() === "path"
  ) ?? "PATH";
  const current = process.env[pathKey] ?? "";
  if (!current.includes(dir)) {
    process.env[pathKey] = dir + delimiter + current;
  }
}
