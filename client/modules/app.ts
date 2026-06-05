/* ═════════════════════════════════════════════════════
   pi-zero · 应用入口
   ═════════════════════════════════════════════════════
   导入所有模块以触发各模块的初始化代码。
   ES Module 保证每个模块只执行一次。
   ═════════════════════════════════════════════════════ */

// 工具函数（被其他模块依赖，此处显式导入确保可用）
import "./utils.js";

// Workplace 文件系统（初始化文件列表、拖放上传）
import "./workplace.js";

// 会话管理（初始化会话列表、消息存储）
import "./session-manager.js";

// WebSocket 连接（被 chat.js 依赖，此处显式导入确保连接建立）
import "./websocket.js";

// 聊天界面（模型选择、消息发送、命令列表、WebSocket 事件处理）
import "./chat.js";

// 模型管理（远程/已启用模型列表）
import "./model-manager.js";

// 供应商配置
import "./settings-provider.js";

// 界面设置（设置弹框、Tab 切换、主题/亮暗控制）
import "./settings-interface.js";

// 存储设置
import "./settings-storage.js";
