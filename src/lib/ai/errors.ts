/**
 * 上游模型调用失败的归因。
 *
 * 用户自带 API Key 与 Base URL，配置出错（地址少了 /v1、key 失效、模型名不存在）
 * 是最常见的失败来源。若统一返回"生成失败，请重试"，用户既看不出问题在配置，
 * 也无从修正。这里按上游返回的状态码分类，给出可操作的提示。
 */

interface ClassifiedError {
  /** 面向用户的可操作提示 */
  message: string;
  /** 是否为配置问题，是则引导用户去改配置而非重试 */
  needConfig: boolean;
}

/** OpenAI SDK 的错误对象带 status 字段，但类型未导出，故在此做窄化 */
function getStatus(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null && "status" in e) {
    const status = (e as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

function getMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 摘要长度上限，避免把上游的长堆栈整段抛给用户 */
const DETAIL_MAX_LENGTH = 120;

/**
 * 从上游错误文本中提取可读摘要。
 * SDK 的 message 通常形如 `500 {"error":{"message":"..."}}`，优先取内层 message。
 */
function extractUpstreamDetail(raw: string): string {
  const jsonStart = raw.indexOf("{");
  if (jsonStart !== -1) {
    try {
      const parsed: unknown = JSON.parse(raw.slice(jsonStart));
      const message = findMessageField(parsed);
      if (message) return message.slice(0, DETAIL_MAX_LENGTH);
    } catch {
      // 非 JSON，退回下方的纯文本处理
    }
  }

  // 去掉开头重复的状态码，只留描述
  const text = raw.replace(/^\d{3}\s*/, "").trim();
  return text.slice(0, DETAIL_MAX_LENGTH);
}

/** 在嵌套对象中查找 message 字段，兼容 {error:{message}} 与 {message} 两种形状 */
function findMessageField(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;

  const obj = value as Record<string, unknown>;
  if (typeof obj.message === "string" && obj.message) return obj.message;
  if (typeof obj.error === "string" && obj.error) return obj.error;
  if (obj.error) return findMessageField(obj.error);

  return null;
}

/**
 * 将上游异常翻译为面向用户的提示。
 * @param fallback 无法归因时的兜底提示，由调用方按场景提供
 */
export function classifyAIError(e: unknown, fallback: string): ClassifiedError {
  const status = getStatus(e);
  const raw = getMessage(e);

  switch (status) {
    case 401:
    case 403:
      return { message: "API Key 无效或无权限，请检查配置中的 Key", needConfig: true };

    case 404:
      // 网关地址错误时最典型的表现：路径不存在
      return {
        message: "接口地址不存在（404）。请检查 Base URL 是否正确，多数中转网关需要带 /v1 后缀",
        needConfig: true,
      };

    case 429:
      return { message: "上游限流或额度不足，请稍后再试或检查账户余额", needConfig: false };

    case 400:
      // 400 多为模型名不被支持，或请求体不合上游预期
      return { message: `上游拒绝了请求（400）。请检查模型名是否正确：${raw.slice(0, 80)}`, needConfig: true };

    default:
      break;
  }

  if (status !== undefined && status >= 500) {
    // 中转网关常把"模型不存在""额度不足"也报成 5xx，原始信息是排查的唯一线索，
    // 因此带上摘要而非仅提示"稍后重试"
    const detail = extractUpstreamDetail(raw);
    return {
      message: detail ? `上游服务异常（${status}）：${detail}` : `上游服务异常（${status}），请稍后重试`,
      needConfig: false,
    };
  }

  // 无状态码通常是网络层问题：地址不可达、DNS 失败、超时
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|Connection error/i.test(raw)) {
    return { message: "无法连接到接口地址，请检查 Base URL 是否可访问", needConfig: true };
  }

  if (/timeout|aborted/i.test(raw)) {
    return { message: "上游响应超时，请稍后重试", needConfig: false };
  }

  return { message: fallback, needConfig: false };
}
