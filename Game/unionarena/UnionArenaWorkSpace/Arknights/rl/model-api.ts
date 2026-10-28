/** OpenAI-compatible chat endpoints. Credentials never leave this module except in the provider's Authorization header. */
export interface ModelConfig { baseUrl: string; apiKey: string; model: string; label: string }
export interface ModelDecision {
  index: number; reason: string; attempts: number; elapsedMs: number; model: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export function parseDecision(text: string, legal: readonly number[]): { index: number; reason: string } {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || !("index" in parsed) || !Number.isInteger(parsed.index) || !legal.includes(parsed.index as number)) {
    throw new Error("必须返回合法动作编号，格式为 {\"index\":整数,\"reason\":\"简短理由\"}");
  }
  return { index: parsed.index as number, reason: "reason" in parsed && typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "" };
}

export async function requestDecision(config: ModelConfig, rules: string, prompt: string, legal: readonly number[], signal?: AbortSignal): Promise<ModelDecision> {
  if (!legal.length) throw new Error("NO_LEGAL_DECISION");
  const started = Date.now();
  const messages = [{ role: "system", content: rules }, { role: "user", content: prompt }];
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  let maxTokens = 8192;
  const redact = (text: string): string => text.split(config.apiKey).join("[redacted]").slice(0, 500);
  let failure = "模型没有返回动作";
  for (let attempts = 1; attempts <= 3; attempts++) {
    signal?.throwIfAborted();
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, messages, max_tokens: maxTokens, stream: false }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000)
      });
      if (!response.ok) {
        failure = `HTTP ${response.status}: ${redact(await response.text())}`;
        if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) throw new ProviderError(failure);
        throw new Error(failure);
      }
      const body = await response.json() as { model?: string; choices?: Array<{ finish_reason?: string; message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      usage.prompt_tokens += body.usage?.prompt_tokens ?? 0;
      usage.completion_tokens += body.usage?.completion_tokens ?? 0;
      if (body.choices?.[0]?.finish_reason === "length") {
        failure = `模型输出因 ${maxTokens} tokens 上限被截断，未获得完整动作`;
        maxTokens = Math.min(32768, maxTokens * 2);
        // Reasoning can consume the entire budget before any final content is emitted.
        // Retry the original decision with more room; an empty/truncated assistant turn is not a format error.
        continue;
      }
      const text = body.choices?.[0]?.message?.content ?? "";
      try {
        return { ...parseDecision(text, legal), attempts, elapsedMs: Date.now() - started, model: body.model ?? config.model, usage };
      } catch {
        failure = "模型返回了无效 JSON 或非法动作编号";
        messages.push({ role: "assistant", content: text.slice(0, 2000) }, { role: "user", content: `上次输出无效。只返回 JSON，index 必须是以下编号之一：${legal.join(",")}。不要输出 Markdown。` });
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof ProviderError) throw error;
      failure = redact(error instanceof Error ? error.message : String(error));
      if (attempts < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
    }
  }
  throw new Error(`${config.label}：3 次尝试后停止，${failure}`);
}

class ProviderError extends Error {}
