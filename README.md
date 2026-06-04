# pi-zero

基于 pi SDK 的聊天界面，融合 Self-Modifying Code 与 Introspective Self-Specifying 思想。

## 快速开始

```bash
# 1. 安装依赖（自动部署 POSIX 命令环境）
npm install

# 2. 启动服务
npm run dev
```

## POSIX 命令环境

项目内置了 [BusyBox-w32](https://frippery.org/busybox/)（`bash/busybox64.exe`）,
提供 ls、cat、sed、grep、find 等 179 个 POSIX 命令，零外部依赖。

- `npm install` 自动运行 `bash/setup-posix.js` 创建命令硬链接
- 直接克隆即可使用，无需安装 Git、WSL 或任何其他工具
- **不要的人可以直接删除 `bash/` 目录**，系统会回退到默认 shell
