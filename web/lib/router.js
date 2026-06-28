// ---------------------------------------------------------------------------
// OpenPathshala — 3-tier model router
// ---------------------------------------------------------------------------
// This is the reference implementation of §7 of the architecture spec: route
// each request to the cheapest model that can do the job well, escalating only
// when judgment demands it. The same shape targets Claude (Haiku/Sonnet/Opus)
// in production; here it targets Groq-hosted open models so the prototype runs
// with zero proprietary lock-in and demonstrates the "open floor" story.
//
// Provider-agnostic: it speaks the OpenAI-compatible /chat/completions schema,
// so LLM_BASE_URL can point at Groq (default), a local Ollama/vLLM server (the
// T0/T1 offline story), or any compatible gateway.
// ---------------------------------------------------------------------------

const BASE_URL = process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1";

// Key resolution order:
//   1. LLM_API_KEY / GROQ_API_KEY env var (local dev, containers)
//   2. SSM Parameter Store SecureString named by GROQ_SSM_PARAM (serverless prod)
// The key is NEVER baked into the image or stored as a plaintext env var in prod.
let cachedKey = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || "";
const SSM_PARAM = process.env.GROQ_SSM_PARAM || "";

async function getApiKey() {
  if (cachedKey) return cachedKey;
  if (SSM_PARAM) {
    // @aws-sdk/client-ssm ships in the Lambda Node runtime; imported lazily so
    // local/container runs never need the dependency.
    const { SSMClient, GetParameterCommand } = await import("@aws-sdk/client-ssm");
    const ssm = new SSMClient({});
    const out = await ssm.send(new GetParameterCommand({ Name: SSM_PARAM, WithDecryption: true }));
    cachedKey = out.Parameter?.Value || "";
  }
  return cachedKey;
}

// The three tiers, mapped to their Claude-production analogues.
// Each is overridable by env so a deployment can swap models without code edits.
export const TIERS = {
  cheap: {
    id: "cheap",
    model: process.env.LLM_MODEL_CHEAP || "llama-3.1-8b-instant",
    analogue: "Haiku-tier",
    label: "Cheap / fast",
    desc: "Extraction, structuring, transcription clean-up, short generation. ~70% of traffic.",
  },
  reasoning: {
    id: "reasoning",
    model: process.env.LLM_MODEL_REASONING || "llama-3.3-70b-versatile",
    analogue: "Sonnet-tier",
    label: "Reasoning",
    desc: "Grading against a rubric, question-paper generation, fairness-sensitive judgment. ~20%.",
  },
  hard: {
    id: "hard",
    model: process.env.LLM_MODEL_HARD || "openai/gpt-oss-120b",
    analogue: "Opus-tier",
    label: "Hard reasoning",
    desc: "Ambiguous scripts, misconception analysis, low-confidence escalation. ~10%, used sparingly.",
  },
};

// Indicative blended $/MTok used purely to render an honest cost estimate in the
// UI. These are open-model (Groq) reference rates and are clearly labelled as
// illustrative — production Claude rates live in README §8.
const TIER_RATES = {
  cheap: { in: 0.05, out: 0.08 },
  reasoning: { in: 0.59, out: 0.79 },
  hard: { in: 0.15, out: 0.6 },
};

export function hasApiKey() {
  return Boolean(cachedKey || SSM_PARAM);
}

// Rough token estimate (chars/4) — good enough for a demo cost readout.
export function estimateTokens(text) {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

export function estimateCostUSD(tier, inTokens, outTokens) {
  const r = TIER_RATES[tier] || TIER_RATES.reasoning;
  return (inTokens * r.in + outTokens * r.out) / 1e6;
}

// Core call. Returns { text, model, tier, usage, costUSD, latencyMs }.
export async function complete({
  tier = "reasoning",
  system,
  user,
  temperature = 0.4,
  maxTokens = 1500,
  json = false,
}) {
  const API_KEY = await getApiKey();
  if (!API_KEY) {
    const err = new Error("LLM API key not configured (set GROQ_API_KEY / LLM_API_KEY or GROQ_SSM_PARAM).");
    err.code = "NO_KEY";
    throw err;
  }
  const t = TIERS[tier] || TIERS.reasoning;
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });

  const body = {
    model: t.model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (json) body.response_format = { type: "json_object" };

  const started = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - started;

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`Upstream LLM error ${res.status}: ${detail.slice(0, 300)}`);
    err.code = "UPSTREAM";
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  const usage = data?.usage || {
    prompt_tokens: estimateTokens(system + user),
    completion_tokens: estimateTokens(text),
  };
  const costUSD = estimateCostUSD(
    t.id,
    usage.prompt_tokens || 0,
    usage.completion_tokens || 0
  );

  return {
    text,
    model: t.model,
    tier: t.id,
    analogue: t.analogue,
    usage,
    costUSD,
    latencyMs,
  };
}

// Public summary for the UI's "model router" panel.
export function routerInfo() {
  return {
    provider: BASE_URL.includes("groq") ? "Groq (open models)" : BASE_URL,
    configured: hasApiKey(),
    tiers: Object.values(TIERS).map((t) => ({
      id: t.id,
      model: t.model,
      analogue: t.analogue,
      label: t.label,
      desc: t.desc,
    })),
  };
}
