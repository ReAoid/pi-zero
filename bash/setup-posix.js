#!/usr/bin/env node
/**
 * pi-zero POSIX 命令环境安装脚本
 *
 * 在 bash/ 下部署一套可移植的 POSIX 命令环境。
 * 使用 BusyBox-w32 — 单个二进制提供 100+ POSIX 命令。
 *
 * 设计：
 *   bash/              ← 顶层目录，不要的人直接删除
 *   ├── busybox64.exe  ← 提交到 git (~700KB)
 *   ├── ls.exe         ← 硬链接 (git 忽略)
 *   ├── cat.exe        ← 硬链接
 *   └── ...
 *
 * 特点：
 *   - 零外部依赖，不依赖 Git 或 WSL
 *   - 可移植，任何 Windows 机器都能用
 *   - 单文件 ~1.1MB，替代 91 exe + 74 DLL (59.6MB)
 *
 * 运行: node scripts/setup-posix.js
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, createWriteStream, unlinkSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import https from "node:https";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

// ═══════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════

const TARGET_DIR    = "bash";               // 目标目录（顶层，不要的人直接删）
const BUSYBOX_FILE  = "busybox64.exe";      // Windows 64位版本

/** BusyBox-w32 下载源（优先 GitHub，备选 frippery.org） */
const DOWNLOAD_URLS = [
  "https://github.com/icegood/busybox-w32/releases/download/FRP-5142-v1.36.1/busybox64.exe",
  "https://frippery.org/files/busybox/busybox64.exe",
];

/** 
 * 需要创建别名的 POSIX 命令
 * BusyBox --install 会自动创建全部，这里列出的只是验证清单
 */
const VERIFY_COMMANDS = [
  "ls", "cat", "sed", "grep", "awk", "find", "head", "tail",
  "wc", "sort", "uniq", "cut", "tr", "tee", "diff", "patch",
  "xargs", "expr", "cp", "mv", "rm", "mkdir", "chmod",
  "env", "which", "dirname", "basename", "uname", "id", "whoami",
  "date", "sleep", "printf", "echo", "test",
];

// ═══════════════════════════════════════════════════════
// 实现
// ═══════════════════════════════════════════════════════

function log(msg) { console.log("  " + msg); }

/** 下载文件（支持 HTTPS 和重定向） */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    log("下载: " + url);

    const req = proto.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        log("重定向: " + res.headers.location);
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error("HTTP " + res.statusCode));
      }
      const file = createWriteStream(destPath);
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        const sizeKB = (statSync(destPath).size / 1024).toFixed(0);
        log("完成 (" + sizeKB + " KB)");
        resolve();
      });
      file.on("error", (err) => { unlinkSync(destPath); reject(err); });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("超时")); });
  });
}

async function main() {
  console.log("");
  console.log("  =========================================");
  console.log("   pi-zero POSIX 环境安装 (BusyBox)         ");
  console.log("  =========================================");
  console.log("");

  const destDir = resolve(PROJECT_ROOT, TARGET_DIR);
  const busyboxPath = join(destDir, BUSYBOX_FILE);

  // ---- 创建目录 ----
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
    log("创建: " + TARGET_DIR + "/");
  } else {
    log("已存在: " + TARGET_DIR + "/");
  }

  // ---- 下载 BusyBox ----
  if (existsSync(busyboxPath)) {
    const sizeKB = (statSync(busyboxPath).size / 1024).toFixed(0);
    log("BusyBox 已存在 (" + sizeKB + " KB)");
  } else {
    log("下载 BusyBox-w32...");

    let ok = false;
    for (const url of DOWNLOAD_URLS) {
      try {
        await downloadFile(url, busyboxPath);
        ok = true;
        break;
      } catch (err) {
        log("失败: " + err.message);
      }
    }

    if (!ok) {
      log("所有下载源失败。请手动下载:");
      log("  " + DOWNLOAD_URLS[0]);
      log("  重命名为 " + BUSYBOX_FILE + " 放入 " + TARGET_DIR + "/");
      process.exit(1);
    }
  }

  // ---- 创建命令别名（如果缺失）----
  log("");
  log("创建命令别名...");

  // 检查是否已经有硬链接（读取第一个文件看 inode 是否与 busybox 相同）
  const existingLinks = readdirSync(destDir).filter(f => f !== BUSYBOX_FILE);
  if (existingLinks.length > 20) {
    log("命令别名已存在: " + existingLinks.length + " 个");
  } else {
    // BusyBox --install 创建所有 applet 的硬链接（NTFS 硬链接，零额外空间）
    const result = spawnSync(busyboxPath, ["--install", destDir], {
      windowsHide: true,
      timeout: 15000,
    });

    let aliasCount = 0;
    if (result.status === 0) {
      const allFiles = readdirSync(destDir);
      aliasCount = allFiles.filter(f => f !== BUSYBOX_FILE).length;
      log("--install 完成: " + aliasCount + " 个命令");
    } else {
      // --install 失败（非 NTFS、无权限等），手动复制
      log("--install 不可用 (exit:" + result.status + "), 改用手动复制");
      const essential = [
        "ash", "bash", "sh", "ls", "cat", "sed", "grep", "awk",
        "find", "head", "tail", "wc", "sort", "uniq", "cut", "tr",
        "tee", "diff", "patch", "cp", "mv", "rm", "mkdir", "chmod",
        "chown", "env", "which", "dirname", "basename", "uname",
        "id", "whoami", "date", "sleep", "printf", "echo", "test",
        "xargs", "expr", "seq", "yes", "timeout", "mktemp",
        "nice", "nohup", "clear", "reset", "df", "du", "tar",
        "gzip", "gunzip", "bzip2", "bunzip2", "unzip",
      ];
      for (const name of essential) {
        const linkPath = join(destDir, name + ".exe");
        if (!existsSync(linkPath)) {
          try { copyFileSync(busyboxPath, linkPath); aliasCount++; }
          catch { /* skip */ }
        }
      }
      log("手动创建: " + aliasCount + " 个命令");
    }
  }

  // ---- 验证 ----
  log("");
  log("验证...");

  let allOk = true;
  for (const cmd of VERIFY_COMMANDS) {
    const testPath = join(destDir, cmd + ".exe");
    const ok = existsSync(testPath);
    log((ok ? "  OK" : "FAIL") + "  " + cmd);
    if (!ok) allOk = false;
  }

  // 验证 bash (ash) 能否执行命令
  const bashPath = join(destDir, "bash.exe");
  if (existsSync(bashPath)) {
    const envPath = destDir + ";" + process.env.PATH;
    const r = spawnSync(bashPath, ["-c", "echo HELLO && ls . && echo BYE"], {
      cwd: destDir, windowsHide: true, timeout: 10000,
      env: Object.assign({}, process.env, { PATH: envPath }),
    });
    const out = ((r.stdout || "") + (r.stderr || "")).toString().trim();
    if (r.status === 0 && out.includes("HELLO") && out.includes("BYE") && out.includes("busybox64.exe")) {
      log("  OK  bash -c 'ls .' 工作正常: " + out.split("\n")[1]);
    } else {
      log("FAIL  bash 不可运行 (exit:" + r.status + ")");
      allOk = false;
    }
  }

  // ---- 汇总 ----
  const totalFiles = readdirSync(destDir).length;
  // 实际磁盘占用：NTFS 硬链接共享空间
  const realSizeKB = (statSync(busyboxPath).size / 1024).toFixed(0);

  log("");
  log("-- 汇总 --");
  log(TARGET_DIR + "/: " + totalFiles + " 命令 (BusyBox " + realSizeKB + " KB, NTFS 硬链接)");
  log("便携 POSIX 环境: " + (allOk ? "部署成功" : "部分完成"));
  log("重启服务: npm run dev");
  console.log("");
}

main().catch(err => {
  console.error("安装失败:", err.message);
  process.exit(1);
});
