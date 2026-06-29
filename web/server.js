// ---------------------------------------------------------------------------
// OpenPathshala — reference web prototype
// ---------------------------------------------------------------------------
// Serves the prototype site (public/) and three Groq-backed API endpoints that
// demonstrate the MVP workflows from the architecture spec:
//   POST /api/grade   -> Module A1: grade a handwritten/typed answer vs a rubric
//   POST /api/paper   -> Module A2: blueprint-constrained question-paper gen
//   POST /api/explain -> Module C4: textbook -> mother-tongue simplified notes
//   GET  /api/router  -> the 3-tier router config (for the UI panel)
//   GET  /healthz     -> health check (App Runner)
//
// The LLM key is read server-side only (never shipped to the browser). A small
// in-memory rate limiter protects the shared demo key from abuse.
// ---------------------------------------------------------------------------

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { complete, routerInfo, hasApiKey, hasAzure } from "./lib/router.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

// 6mb to accept a downscaled camera/scan image (data URL) for OCR + proctoring.
app.use(express.json({ limit: "6mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// --- tiny in-memory rate limiter (per IP) ----------------------------------
const RL_WINDOW_MS = 60_000;
const RL_MAX = Number(process.env.RATE_LIMIT_PER_MIN || 12);
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?")
    .toString()
    .split(",")[0]
    .trim();
  const now = Date.now();
  const rec = hits.get(ip) || { count: 0, reset: now + RL_WINDOW_MS };
  if (now > rec.reset) {
    rec.count = 0;
    rec.reset = now + RL_WINDOW_MS;
  }
  rec.count++;
  hits.set(ip, rec);
  if (rec.count > RL_MAX) {
    return res
      .status(429)
      .json({ error: `Demo rate limit reached (${RL_MAX}/min). Please wait a moment and retry.` });
  }
  next();
}
// occasional cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
}, 5 * RL_WINDOW_MS).unref();

const cap = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");
// Pick the provider for a request: "azure" (enterprise APIM LB) when asked AND
// configured, else the open Groq floor.
const pickProvider = (b) => (b?.provider === "azure" && hasAzure() ? "azure" : "groq");
// Accept a data-URL image and cap its size (defence in depth atop the body limit).
const capImage = (s) => (typeof s === "string" && /^data:image\//.test(s) ? s.slice(0, 7_000_000) : null);

// Deterministic blueprint that provably sums to `total`: long (5m) ~half the
// paper, then short (3m), then MCQ (1m) for the remainder. Bloom levels spread
// across types. Always sums exactly to `total`.
function buildBlueprint(total) {
  const nLong = Math.floor((total * 0.5) / 5);
  let rem = total - nLong * 5;
  const nShort = Math.floor(rem / 3);
  rem -= nShort * 3;
  const nMCQ = rem; // 1 mark each
  const bp = [];
  if (nMCQ > 0) bp.push({ type: "MCQ", marksEach: 1, count: nMCQ, bloom: "remember/understand" });
  if (nShort > 0) bp.push({ type: "Short", marksEach: 3, count: nShort, bloom: "understand/apply" });
  if (nLong > 0) bp.push({ type: "Long", marksEach: 5, count: nLong, bloom: "apply/analyse" });
  return bp;
}

function sendLLMError(res, err) {
  if (err.code === "NO_KEY") {
    return res.status(503).json({
      error:
        "The demo LLM key isn't configured on this server. Set GROQ_API_KEY and restart. (Locally: export GROQ_API_KEY=... && npm start)",
    });
  }
  console.error("LLM error:", err.message);
  return res.status(502).json({ error: "The model service is temporarily unavailable. Please retry." });
}

// ---------------------------------------------------------------------------
// Module A1 — Grade an answer against a rubric
// ---------------------------------------------------------------------------
app.post("/api/grade", rateLimit, async (req, res) => {
  try {
    const grade = cap(req.body?.grade, 40) || "Class 8";
    const subject = cap(req.body?.subject, 60) || "Science";
    const question = cap(req.body?.question, 4000);
    const rubric = cap(req.body?.rubric, 4000);
    const reference = cap(req.body?.reference, 6000);
    const answer = cap(req.body?.answer, 8000);
    const maxMarks = Math.min(100, Math.max(1, Number(req.body?.maxMarks) || 5));
    if (!question || !answer) {
      return res.status(400).json({ error: "Provide at least a question and a student answer." });
    }

    const system =
      "You are an experienced, fair Indian school teacher grading a student's answer. " +
      "You grade STRICTLY against the rubric/marking scheme and the reference (model) answer when provided. " +
      "Award marks for any correct idea that matches the reference answer even if worded differently; " +
      "do not penalise wording or extra correct detail. You are encouraging but honest. " +
      "You return ONLY valid JSON. You never invent marks beyond the maximum. " +
      "If the answer is illegible or empty, say so and assign 0 with low confidence. " +
      "Feedback must be specific, kind, and point to the next learning step.";

    const user = `Grade this ${grade} ${subject} answer out of ${maxMarks} marks.

QUESTION:
${question}

MARKING SCHEME / RUBRIC (grade strictly against this; if none given, infer a reasonable one):
${rubric || "(none provided — infer a fair, standard marking scheme for this question)"}

REFERENCE / MODEL ANSWER (the gold-standard answer; compare the student's answer against this for correctness):
${reference || "(none provided — judge correctness on subject knowledge)"}

STUDENT'S ANSWER:
${answer}

Return JSON with EXACTLY this shape:
{
  "awarded": <number 0..${maxMarks}>,
  "maxMarks": ${maxMarks},
  "confidence": <number 0..1, your confidence in this grade>,
  "criteria": [ { "point": "<rubric point or expected idea>", "marks": <number>, "got": <true|false>, "note": "<one short line>" } ],
  "feedback_en": "<2-3 sentences of specific feedback for the student, in English>",
  "feedback_local": "<the same feedback in simple Hindi>",
  "next_step": "<one concrete thing the student should practise next>",
  "teacher_flag": "<'review' if confidence < 0.6 or answer is ambiguous/illegible, else 'ok'>"
}`;

    const out = await complete({ provider: pickProvider(req.body), tier: "reasoning", system, user, temperature: 0.2, maxTokens: 1200, json: true });
    let parsed;
    try {
      parsed = JSON.parse(out.text);
    } catch {
      parsed = { raw: out.text };
    }
    res.json({ result: parsed, meta: routeMeta(out) });
  } catch (err) {
    sendLLMError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Module A2 — Generate a question paper from a blueprint
// ---------------------------------------------------------------------------
app.post("/api/paper", rateLimit, async (req, res) => {
  try {
    const board = cap(req.body?.board, 40) || "CBSE";
    const grade = cap(req.body?.grade, 40) || "Class 10";
    const subject = cap(req.body?.subject, 60) || "Science";
    const chapter = cap(req.body?.chapter, 200) || "Chemical Reactions and Equations";
    const totalMarks = Math.min(100, Math.max(5, Number(req.body?.totalMarks) || 20));
    const language = cap(req.body?.language, 30) || "English";
    const difficulty = cap(req.body?.difficulty, 20) || "balanced";

    // Spec §6.2 step 2 — "blueprint as constraints, not prose". We compute a
    // deterministic blueprint server-side that PROVABLY sums to the total, then
    // tell the model exactly how many of each item to write. This guarantees a
    // blueprint-compliant paper instead of hoping the model hits the total.
    const blueprint = buildBlueprint(totalMarks); // [{type, marksEach, count, bloom}]
    const bpText = blueprint.map((b) => `${b.count} × ${b.type} (${b.marksEach} mark${b.marksEach > 1 ? "s" : ""} each, Bloom: ${b.bloom})`).join("; ");

    const system =
      "You are an expert Indian school paper-setter. You produce blueprint-compliant question papers " +
      "grounded in the named board, grade, subject and chapter. You follow the EXACT blueprint given — " +
      "the right number of each question type, no more, no less. You ALWAYS produce a matching answer key " +
      "with step-marking. You return ONLY valid JSON.";

    const user = `Create a ${board} ${grade} ${subject} question paper on the chapter "${chapter}", in ${language}, difficulty: ${difficulty}, worth EXACTLY ${totalMarks} marks.

FOLLOW THIS EXACT BLUEPRINT (do not deviate from the counts or marks):
${bpText}

Number the questions sequentially. Every question's marks must match its blueprint slot. Spread Bloom's levels as indicated.

Return JSON with EXACTLY this shape:
{
  "title": "<paper title>",
  "instructions": ["<2-4 general instructions>"],
  "questions": [ { "q": <number>, "text": "<question>", "type": "MCQ|Short|Long", "marks": <n>, "bloom": "<level>", "options": ["A","B","C","D"] (only for MCQ, else omit) } ],
  "answer_key": [ { "q": <number>, "answer": "<model answer with step marking>", "marks": <n> } ],
  "total": ${totalMarks}
}`;

    const out = await complete({ provider: pickProvider(req.body), tier: "reasoning", system, user, temperature: 0.45, maxTokens: 2800, json: true });
    let parsed;
    try {
      parsed = JSON.parse(out.text);
    } catch {
      parsed = { raw: out.text };
    }
    if (parsed.questions) {
      parsed.blueprint = blueprint;
      parsed.marksSum = parsed.questions.reduce((a, q) => a + (Number(q.marks) || 0), 0);
      parsed.total = totalMarks;
    }

    res.json({ result: parsed, meta: routeMeta(out) });
  } catch (err) {
    sendLLMError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Module C4 — Textbook passage -> simplified mother-tongue explainer
// ---------------------------------------------------------------------------
app.post("/api/explain", rateLimit, async (req, res) => {
  try {
    const passage = cap(req.body?.passage, 6000);
    const language = cap(req.body?.language, 30) || "Hindi";
    const grade = cap(req.body?.grade, 40) || "Class 6";
    if (!passage) return res.status(400).json({ error: "Provide a textbook passage to explain." });

    // Mother-tongue script fidelity is the whole point here, so we route to the
    // reasoning tier — the cheap tier romanises Indic scripts. (A clean example
    // of "route by judgment/quality required", spec §7.)
    const system =
      "You are a warm Indian teacher who explains textbook content in a child's mother tongue using simple, " +
      `concrete language and a local everyday example. Write ALL ${language} text in its NATIVE script ` +
      "(e.g. Devanagari for Hindi/Marathi, ગુજરાતી for Gujarati, தமிழ் for Tamil) — never romanised/transliterated. " +
      "You return ONLY valid JSON.";

    const user = `A ${grade} student needs this passage explained in simple ${language}.

PASSAGE:
${passage}

Return JSON:
{
  "summary_local": "<3-4 simple sentences in ${language}>",
  "key_points": ["<3-5 bullet points in ${language}>"],
  "everyday_example": "<one relatable local example in ${language}>",
  "check_questions": ["<2 simple questions in ${language} to check understanding>"]
}`;

    const out = await complete({ provider: pickProvider(req.body), tier: "reasoning", system, user, temperature: 0.5, maxTokens: 1200, json: true });
    let parsed;
    try {
      parsed = JSON.parse(out.text);
    } catch {
      parsed = { raw: out.text };
    }
    res.json({ result: parsed, meta: routeMeta(out) });
  } catch (err) {
    sendLLMError(res, err);
  }
});

function routeMeta(out) {
  return {
    provider: out.provider,
    model: out.model,
    tier: out.tier,
    analogue: out.analogue,
    backend: out.backend, // which Azure region/backend served it (LB visibility)
    latencyMs: out.latencyMs,
    promptTokens: out.usage?.prompt_tokens,
    completionTokens: out.usage?.completion_tokens,
    costUSD: Number(out.costUSD.toFixed(6)),
    costINR: Number((out.costUSD * 84).toFixed(4)),
  };
}

// ---------------------------------------------------------------------------
// Module A1 (vision) — OCR + grade a photographed/scanned handwritten answer
// ---------------------------------------------------------------------------
app.post("/api/ocr-grade", rateLimit, async (req, res) => {
  try {
    const image = capImage(req.body?.image);
    if (!image) return res.status(400).json({ error: "Provide an image (data URL) of the handwritten answer." });
    const grade = cap(req.body?.grade, 40) || "Class 8";
    const subject = cap(req.body?.subject, 60) || "Science";
    const question = cap(req.body?.question, 4000);
    const rubric = cap(req.body?.rubric, 4000);
    const reference = cap(req.body?.reference, 6000);
    const maxMarks = Math.min(100, Math.max(1, Number(req.body?.maxMarks) || 5));

    const system =
      "You are an expert Indian school teacher with excellent handwriting recognition. " +
      "First TRANSCRIBE the student's handwritten answer from the image (handle Indian-language and English " +
      "handwriting; mark anything unreadable as [illegible]). Then GRADE it strictly against the rubric and " +
      "reference answer, crediting correct ideas regardless of wording. Return ONLY valid JSON. " +
      "If the page is blank or unreadable, say so with low confidence.";

    const user = `Transcribe and grade this ${grade} ${subject} handwritten answer out of ${maxMarks} marks.

QUESTION:
${question || "(infer from the page if not given)"}

RUBRIC / MARKING SCHEME:
${rubric || "(infer a fair standard scheme)"}

REFERENCE / MODEL ANSWER:
${reference || "(judge on subject knowledge)"}

Return JSON EXACTLY:
{
  "transcription": "<your best transcription of the handwriting>",
  "ocr_confidence": <0..1>,
  "awarded": <0..${maxMarks}>,
  "maxMarks": ${maxMarks},
  "confidence": <0..1>,
  "criteria": [ { "point": "<expected idea>", "marks": <n>, "got": <true|false>, "note": "<short>" } ],
  "feedback_en": "<2-3 sentences>",
  "feedback_local": "<same in simple Hindi>",
  "teacher_flag": "<'review' if low confidence/illegible else 'ok'>"
}`;

    // Vision => use the configured provider's vision model (Azure GPT-5-mini by
    // default for enterprise; Groq Llama-4-Scout for the open floor).
    const provider = req.body?.provider === "groq" ? "groq" : (hasAzure() ? "azure" : "groq");
    const out = await complete({ provider, tier: "reasoning", system, user, images: [image], maxTokens: 1500, json: true });
    let parsed; try { parsed = JSON.parse(out.text); } catch { parsed = { raw: out.text }; }
    res.json({ result: parsed, meta: routeMeta(out) });
  } catch (err) {
    sendLLMError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Module (new) — Live exam proctoring: analyse a camera frame for integrity
// ---------------------------------------------------------------------------
app.post("/api/proctor", rateLimit, async (req, res) => {
  try {
    const image = capImage(req.body?.image);
    if (!image) return res.status(400).json({ error: "Provide a camera frame (data URL)." });

    const system =
      "You are an AI exam-proctoring assistant analysing ONE webcam frame of a student taking an exam. " +
      "You assist a human invigilator — you never accuse, you only surface observations for human review. " +
      "Be calm and avoid false alarms. Return ONLY valid JSON.";

    const user = `Analyse this exam webcam frame. Report what you observe.

Return JSON EXACTLY:
{
  "students_visible": <integer count of people>,
  "candidate_present": <true|false>,
  "gaze": "<'on-paper' | 'on-screen' | 'looking-away' | 'unknown'>",
  "phone_detected": <true|false>,
  "extra_person": <true|false>,
  "integrity": "<'ok' | 'attention' | 'flag'>",
  "observations": ["<short neutral observation>", "..."],
  "note_for_invigilator": "<one short line; empty if all clear>"
}`;

    const provider = req.body?.provider === "groq" ? "groq" : (hasAzure() ? "azure" : "groq");
    const out = await complete({ provider, tier: "cheap", system, user, images: [image], maxTokens: 700, json: true });
    let parsed; try { parsed = JSON.parse(out.text); } catch { parsed = { raw: out.text }; }
    res.json({ result: parsed, meta: routeMeta(out) });
  } catch (err) {
    sendLLMError(res, err);
  }
});

// --- meta endpoints ---------------------------------------------------------
app.get("/api/router", (_req, res) => res.json(routerInfo()));
app.get("/healthz", (_req, res) => res.json({ ok: true, llm: hasApiKey(), azure: hasAzure() }));

// --- static site ------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// Only bind a port for local/container runs. Under Lambda the app is wrapped by
// lambda.js (serverless-http) and must not call listen().
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  app.listen(PORT, () => {
    console.log(`OpenPathshala prototype listening on :${PORT} (LLM configured: ${hasApiKey()})`);
  });
}

export { app };
