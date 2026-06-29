// ---------------------------------------------------------------------------
// OpenPathshala — multi-provider model router
// ---------------------------------------------------------------------------
// Routes each request to the cheapest model that can do the job (spec §7), and
// chooses between two PROVIDERS:
//
//   • "groq"  — the open-weights FLOOR. OpenAI-compatible, zero lock-in, runs
//                even with no enterprise contract. Default for the public demo.
//   • "azure" — the ENTERPRISE plane: Azure OpenAI behind an Azure API
//                Management gateway that load-balances across multiple regional
//                backends (priority/weight pool + circuit breaker + retry) and
//                authenticates to OpenAI with a managed identity (no keys).
//                This is what makes the product horizontally scalable & SLA-able.
//
// Both speak the OpenAI chat-completions schema, so the same call shape targets
// either. Vision (image inputs) is supported for OCR + camera proctoring.
// ---------------------------------------------------------------------------

import { getSecret } from "./secrets.js";

// ---- Groq (open floor) -----------------------------------------------------
const GROQ_BASE = process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1";

// ---- Azure OpenAI via APIM load balancer (enterprise plane) ----------------
const AZURE_ENDPOINT = (process.env.AZURE_APIM_ENDPOINT || "").replace(/\/$/, "");
const AZURE_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5-mini";
const AZURE_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview";

// Per-provider, per-tier model map. Azure routes every tier to its deployment
// (the APIM pool already spreads load across regions); Groq varies by tier.
const PROVIDERS = {
  groq: {
    id: "groq",
    label: "Open (Groq)",
    blurb: "Open-weights floor — no lock-in, runs anywhere, cheapest path.",
    tiers: {
      cheap: { model: process.env.LLM_MODEL_CHEAP || "llama-3.1-8b-instant", analogue: "Haiku-tier" },
      reasoning: { model: process.env.LLM_MODEL_REASONING || "llama-3.3-70b-versatile", analogue: "Sonnet-tier" },
      hard: { model: process.env.LLM_MODEL_HARD || "openai/gpt-oss-120b", analogue: "Opus-tier" },
    },
    visionModel: process.env.LLM_MODEL_VISION || "meta-llama/llama-4-scout-17b-16e-instruct",
    rates: { cheap: { in: 0.05, out: 0.08 }, reasoning: { in: 0.59, out: 0.79 }, hard: { in: 0.15, out: 0.6 } },
  },
  azure: {
    id: "azure",
    label: "Enterprise (Azure OpenAI · APIM LB)",
    blurb: "Azure OpenAI behind an APIM gateway: multi-region load balancing, circuit breaker, managed-identity auth, SLA.",
    tiers: {
      cheap: { model: AZURE_DEPLOYMENT, analogue: "GPT-5-mini" },
      reasoning: { model: AZURE_DEPLOYMENT, analogue: "GPT-5-mini" },
      hard: { model: AZURE_DEPLOYMENT, analogue: "GPT-5-mini" },
    },
    visionModel: AZURE_DEPLOYMENT,
    rates: { cheap: { in: 0.25, out: 2 }, reasoning: { in: 0.25, out: 2 }, hard: { in: 0.25, out: 2 } },
  },
};

export const TIER_META = {
  cheap: { label: "Cheap / fast", desc: "Extraction, structuring, transcription clean-up, short generation. ~70% of traffic." },
  reasoning: { label: "Reasoning", desc: "Grading against a rubric, question-paper generation, fairness-sensitive judgment. ~20%." },
  hard: { label: "Hard reasoning", desc: "Ambiguous scripts, misconception analysis, low-confidence escalation. ~10%." },
};

// Back-compat export used elsewhere.
export const TIERS = {
  cheap: { id: "cheap", model: PROVIDERS.groq.tiers.cheap.model, analogue: "Haiku-tier", ...TIER_META.cheap },
  reasoning: { id: "reasoning", model: PROVIDERS.groq.tiers.reasoning.model, analogue: "Sonnet-tier", ...TIER_META.reasoning },
  hard: { id: "hard", model: PROVIDERS.groq.tiers.hard.model, analogue: "Opus-tier", ...TIER_META.hard },
};

export function estimateTokens(text) {
  return Math.max(1, Math.ceil((text || "").length / 4));
}
function rate(provider, tier) {
  return PROVIDERS[provider]?.rates[tier] || PROVIDERS.groq.rates.reasoning;
}
export function estimateCostUSD(provider, tier, inTokens, outTokens) {
  const r = rate(provider, tier);
  return (inTokens * r.in + outTokens * r.out) / 1e6;
}

// --- credentials ------------------------------------------------------------
async function groqKey() {
  return (
    process.env.LLM_API_KEY ||
    process.env.GROQ_API_KEY ||
    (await getSecret(process.env.GROQ_SSM_PARAM))
  );
}
async function azureKey() {
  return process.env.AZURE_APIM_KEY || (await getSecret(process.env.AZURE_APIM_SSM_PARAM));
}

export function hasGroq() {
  return Boolean(process.env.LLM_API_KEY || process.env.GROQ_API_KEY || process.env.GROQ_SSM_PARAM);
}
export function hasAzure() {
  return Boolean(AZURE_ENDPOINT && (process.env.AZURE_APIM_KEY || process.env.AZURE_APIM_SSM_PARAM));
}
// legacy
export function hasApiKey() {
  return hasGroq();
}

// Build the user message content — string, or multimodal (text + images).
function buildContent(user, images) {
  if (!images || !images.length) return user;
  const parts = [{ type: "text", text: user }];
  for (const url of images) parts.push({ type: "image_url", image_url: { url } });
  return parts;
}

// ---------------------------------------------------------------------------
// Core call. provider: "groq" | "azure". Returns a normalized result.
// ---------------------------------------------------------------------------
export async function complete({
  provider = "groq",
  tier = "reasoning",
  system,
  user,
  images = null,
  temperature = 0.4,
  maxTokens = 1500,
  json = false,
}) {
  if (provider === "azure" && !hasAzure()) provider = "groq"; // graceful fallback
  const cfg = PROVIDERS[provider] || PROVIDERS.groq;
  const model = images ? cfg.visionModel : (cfg.tiers[tier]?.model || cfg.tiers.reasoning.model);

  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: buildContent(user, images) });

  let url, headers, body;
  if (provider === "azure") {
    const key = await azureKey();
    if (!key) { const e = new Error("Azure APIM key not configured"); e.code = "NO_KEY"; throw e; }
    url = `${AZURE_ENDPOINT}/openai/deployments/${model}/chat/completions?api-version=${AZURE_API_VERSION}`;
    headers = { "Content-Type": "application/json", "api-key": key };
    // GPT-5 family: max_completion_tokens (not max_tokens); reasoning consumes
    // tokens, so give generous headroom. Temperature is fixed at default.
    // reasoning_effort keeps latency under API Gateway's 30s cap and cuts cost —
    // these classroom tasks don't need deep chain-of-thought.
    const effort = tier === "cheap" ? "minimal" : tier === "hard" ? "medium" : "low";
    body = { messages, max_completion_tokens: Math.max(maxTokens + 1500, 3500), reasoning_effort: effort };
    if (json) body.response_format = { type: "json_object" };
  } else {
    const key = await groqKey();
    if (!key) { const e = new Error("Groq key not configured"); e.code = "NO_KEY"; throw e; }
    url = `${GROQ_BASE}/chat/completions`;
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
    body = { model, messages, temperature, max_tokens: maxTokens };
    if (json) body.response_format = { type: "json_object" };
  }

  const started = Date.now();
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const latencyMs = Date.now() - started;
  const backend = res.headers.get("x-openpathshala-backend") || null; // which AOAI region served it

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`Upstream ${provider} error ${res.status}: ${detail.slice(0, 300)}`);
    err.code = "UPSTREAM";
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  const usage = data?.usage || { prompt_tokens: estimateTokens(system + user), completion_tokens: estimateTokens(text) };
  const costUSD = estimateCostUSD(provider, tier, usage.prompt_tokens || 0, usage.completion_tokens || 0);

  return {
    text,
    provider,
    model,
    tier,
    analogue: cfg.tiers[tier]?.analogue || "",
    backend,
    usage,
    costUSD,
    latencyMs,
  };
}

// Public summary for the UI's "model router" panel.
export function routerInfo() {
  const providers = {};
  for (const p of Object.values(PROVIDERS)) {
    providers[p.id] = {
      id: p.id,
      label: p.label,
      blurb: p.blurb,
      configured: p.id === "azure" ? hasAzure() : hasGroq(),
      tiers: Object.entries(p.tiers).map(([id, t]) => ({ id, model: t.model, analogue: t.analogue, ...TIER_META[id] })),
    };
  }
  return {
    defaultProvider: hasGroq() ? "groq" : "azure",
    azureEnabled: hasAzure(),
    azureGateway: AZURE_ENDPOINT || null,
    providers,
    // legacy flat fields
    provider: "Groq (open models)",
    configured: hasGroq(),
    tiers: providers.groq.tiers,
  };
}
