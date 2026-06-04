/**
 * pi-zero 供应商注册表
 *
 * 参考 pi SDK 的 ModelRegistry 设计，精简为四种模式：
 *   - openai    : OpenAI Responses API
 *   - anthropic : Anthropic Messages API
 *   - deepseek  : DeepSeek Chat API (OpenAI 兼容)
 *   - custom    : 自定义 OpenAI 兼容 API
 *
 * 每种供应商有默认端点、默认模型和 API 格式。
 * 用户可在前端覆盖端点/模型，实现完全的 BYO (Bring Your Own) 模式。
 */

// ── 支持的供应商类型 ──
export type ProviderId = "openai" | "anthropic" | "deepseek" | "custom";

// ── 供应商预设（默认配置） ──
export interface ProviderPreset {
  label: string;                       // 显示名称
  defaultEndpoint: string;             // 默认 API 端点
  defaultModel: string;               // 默认模型
  apiFormat: "openai-completions" | "anthropic-messages";  // API 格式
}

export const PROVIDER_PRESETS: Record<ProviderId, ProviderPreset> = {
  openai: {
    label: "OpenAI",
    defaultEndpoint: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    apiFormat: "openai-completions",
  },
  anthropic: {
    label: "Anthropic",
    defaultEndpoint: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-20250514",
    apiFormat: "anthropic-messages",
  },
  deepseek: {
    label: "DeepSeek",
    defaultEndpoint: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    apiFormat: "openai-completions",
  },
  custom: {
    label: "自定义",
    defaultEndpoint: "",
    defaultModel: "",
    apiFormat: "openai-completions",
  },
};

// ── 用户配置（来自前端或环境变量） ──
export interface ProviderConfig {
  provider: ProviderId;
  apiKey: string;
  endpoint: string;
  model: string;
  enabledModels?: string[];  // 用户手动添加的可用模型列表
}

// ── 供应商注册表（类似 pi 的 ModelRegistry） ──
export class ProviderRegistry {
  private currentConfig: ProviderConfig | null = null;

  /** 设置当前供应商配置（从前端接收或从环境变量读取） */
  setConfig(config: ProviderConfig): void {
    this.currentConfig = { ...config };
  }

  /** 获取当前供应商配置，缺失字段用预设填充 */
  getConfig(): ProviderConfig {
    if (!this.currentConfig) {
      return this.loadFromEnv();
    }
    const preset = PROVIDER_PRESETS[this.currentConfig.provider];
    return {
      provider: this.currentConfig.provider,
      apiKey: this.currentConfig.apiKey || this.resolveApiKey(this.currentConfig.provider),
      endpoint: this.currentConfig.endpoint || preset?.defaultEndpoint || "",
      model: this.currentConfig.model || preset?.defaultModel || "",
    };
  }

  /** 获取当前模型对应的 pi 格式 model 对象 */
  getModelInfo(): { provider: string; modelId: string; apiFormat: string; baseUrl: string } {
    const cfg = this.getConfig();
    return {
      provider: cfg.provider,
      modelId: cfg.model,
      apiFormat: PROVIDER_PRESETS[cfg.provider]?.apiFormat || "openai-completions",
      baseUrl: cfg.endpoint,
    };
  }

  /** 从供应商 API 获取可用模型列表 */
  async fetchModels(config: ProviderConfig): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
    const preset = PROVIDER_PRESETS[config.provider];
    if (!preset) return { ok: false, error: `未知供应商: ${config.provider}` };
    if (!config.apiKey) return { ok: false, error: "API Key 不能为空" };

    const endpoint = config.endpoint || preset.defaultEndpoint;

    try {
      if (preset.apiFormat === "anthropic-messages") {
        const res = await fetch(`${endpoint}/models`, {
          headers: {
            "x-api-key": config.apiKey,
            "anthropic-version": "2023-06-01",
          },
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "未知错误");
          return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
        }
        const data = await res.json() as { data?: Array<{ id: string; name?: string }> };
        const models = (data.data ?? []).map((m) => m.id).sort();
        return { ok: true, models };
      } else {
        // OpenAI 兼容
        const res = await fetch(`${endpoint}/models`, {
          headers: { Authorization: `Bearer ${config.apiKey}` },
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "未知错误");
          return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
        }
        const data = await res.json() as { data?: Array<{ id: string }> };
        const models = (data.data ?? []).map((m) => m.id).sort();
        return { ok: true, models };
      }
    } catch (err) {
      return { ok: false, error: `获取失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /** 测试连接：向供应商 API 发送轻量请求验证可用性 */
  async testConnection(config: ProviderConfig): Promise<{ ok: boolean; model?: string; error?: string }> {
    const preset = PROVIDER_PRESETS[config.provider];
    if (!preset) {
      return { ok: false, error: `未知供应商: ${config.provider}` };
    }
    if (!config.apiKey) {
      return { ok: false, error: "API Key 不能为空" };
    }

    const endpoint = config.endpoint || preset.defaultEndpoint;
    const model = config.model || preset.defaultModel;

    try {
      if (preset.apiFormat === "anthropic-messages") {
        // Anthropic: 用 models 端点验证
        const res = await fetch(`${endpoint}/models`, {
          headers: {
            "x-api-key": config.apiKey,
            "anthropic-version": "2023-06-01",
          },
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "未知错误");
          return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
        }
        return { ok: true, model };
      } else {
        // OpenAI 兼容: 用 models 端点验证
        const res = await fetch(`${endpoint}/models`, {
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
          },
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "未知错误");
          return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
        }
        const data = await res.json() as { data?: Array<{ id: string }> };
        const modelFound = data.data?.find((m: { id: string }) => m.id === model);
        return {
          ok: true,
          model: modelFound ? model : `${model} (未在列表中找到，但仍可尝试)`,
        };
      }
    } catch (err) {
      return { ok: false, error: `连接失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /** 从环境变量推断供应商配置 */
  private loadFromEnv(): ProviderConfig {
    // 优先级: ANTHROPIC_API_KEY > OPENAI_API_KEY > DEEPSEEK_API_KEY
    if (process.env.ANTHROPIC_API_KEY) {
      return {
        provider: "anthropic",
        apiKey: process.env.ANTHROPIC_API_KEY,
        endpoint: PROVIDER_PRESETS.anthropic.defaultEndpoint,
        model: PROVIDER_PRESETS.anthropic.defaultModel,
      };
    }
    if (process.env.OPENAI_API_KEY) {
      return {
        provider: "openai",
        apiKey: process.env.OPENAI_API_KEY,
        endpoint: PROVIDER_PRESETS.openai.defaultEndpoint,
        model: PROVIDER_PRESETS.openai.defaultModel,
      };
    }
    if (process.env.DEEPSEEK_API_KEY) {
      return {
        provider: "deepseek",
        apiKey: process.env.DEEPSEEK_API_KEY,
        endpoint: PROVIDER_PRESETS.deepseek.defaultEndpoint,
        model: PROVIDER_PRESETS.deepseek.defaultModel,
      };
    }
    // 兜底: 无可用供应商
    return {
      provider: "openai",
      apiKey: "",
      endpoint: PROVIDER_PRESETS.openai.defaultEndpoint,
      model: PROVIDER_PRESETS.openai.defaultModel,
    };
  }

  /** 按优先级解析 API Key */
  private resolveApiKey(provider: ProviderId): string {
    switch (provider) {
      case "anthropic":
        return process.env.ANTHROPIC_API_KEY ?? "";
      case "deepseek":
        return process.env.DEEPSEEK_API_KEY ?? "";
      case "openai":
      case "custom":
      default:
        return process.env.OPENAI_API_KEY ?? "";
    }
  }
}

/** 全局单例 */
export const providerRegistry = new ProviderRegistry();
