// OpenPathshala prototype — front-end logic (vanilla, no build step)
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------------------------------------------------------------------
// Digital-divide bars (UDISE+ 2024-25)
// ---------------------------------------------------------------------------
const DIVIDE = [
  { label: "Drinking water", val: 99.0, cls: "" },
  { label: "Girls' toilets", val: 95.3, cls: "" },
  { label: "Electricity", val: 92.0, cls: "" },
  { label: "Computers", val: 58.0, cls: "mid" },
  { label: "Internet", val: 63.5, cls: "mid" },
  { label: "Solar power", val: 10.9, cls: "low" },
];
function renderBars() {
  const host = $("#divideBars");
  host.innerHTML = DIVIDE.map(
    (d) => `
    <div class="bar-row">
      <div class="bar-label">${d.label}</div>
      <div class="bar-track"><div class="bar-fill ${d.cls}" data-w="${d.val}"></div></div>
      <div class="bar-val">${d.val}%</div>
    </div>`
  ).join("");
  // animate on scroll into view
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          $$(".bar-fill", host).forEach((f) => (f.style.width = f.dataset.w + "%"));
          io.disconnect();
        }
      });
    },
    { threshold: 0.3 }
  );
  io.observe(host);
}

// ---------------------------------------------------------------------------
// Model router panel
// ---------------------------------------------------------------------------
const SHARES = { cheap: "~70%", reasoning: "~20%", hard: "~10%" };
async function renderRouter() {
  const host = $("#routerGrid");
  try {
    const info = await fetch("/api/router").then((r) => r.json());
    host.innerHTML = info.tiers
      .map(
        (t) => `
      <div class="rt-card rt-${t.id}">
        <div class="rt-share">${SHARES[t.id] || ""}</div>
        <h4>${esc(t.label)}</h4>
        <div class="rt-analogue">Production analogue: <b>${esc(t.analogue)}</b></div>
        <div class="rt-model">${esc(t.model)}</div>
        <p class="rt-desc">${esc(t.desc)}</p>
      </div>`
      )
      .join("");
  } catch {
    host.innerHTML = `<p class="rt-desc">Router config unavailable.</p>`;
  }
}

// ---------------------------------------------------------------------------
// Workflow catalogue
// ---------------------------------------------------------------------------
const CATALOGUE = [
  { id: "A1", t: "Grade handwritten exams", d: "Hours of marking → minutes, with consistent rubrics.", tiers: ["t0", "t1", "t2"], mvp: true },
  { id: "A2", t: "Question papers from textbooks", d: "Blueprint-compliant papers + answer keys in seconds.", tiers: ["t1", "t2"], mvp: true },
  { id: "A3", t: "Rubric-aligned feedback", d: "Not just a mark — the why and the next step.", tiers: ["t1", "t2"] },
  { id: "A4", t: "FLN assessment", d: "Early-grade reading fluency & arithmetic (NIPUN).", tiers: ["t0", "t1"] },
  { id: "A5", t: "Misconception detection", d: "Cluster wrong answers to see class-wide gaps.", tiers: ["t1", "t2"] },
  { id: "C4", t: "Mother-tongue explainer", d: "Chapter → simplified notes in the home language.", tiers: ["t1", "t2"], mvp: true },
  { id: "D1", t: "UDISE+ / APAAR data entry", d: "Extract from registers, pre-fill, validate.", tiers: ["t0", "t1"] },
  { id: "D3", t: "Report-card generation", d: "Marks + comments in the parent's language.", tiers: ["t1", "t2"] },
  { id: "E3", t: "WhatsApp parent bot", d: "Local-language updates over the de-facto rural channel.", tiers: ["t1", "t2"] },
  { id: "E4", t: "Textbook-grounded tutor", d: "After-hours doubts, no open-web hallucination.", tiers: ["t2"] },
];
function renderCatalogue() {
  $("#catGrid").innerHTML = CATALOGUE.map(
    (c) => `
    <div class="cat ${c.mvp ? "mvp" : ""}">
      <div class="cat-top">
        <span class="cat-id">${c.id}</span>
        ${c.mvp ? `<span class="cat-mvp-tag">● Live MVP</span>` : ""}
      </div>
      <h4>${esc(c.t)}</h4>
      <p>${esc(c.d)}</p>
      <div class="cat-tiers">${c.tiers
        .map((t) => `<span class="tier-tag ${t}" style="margin:0">${t.toUpperCase()}</span>`)
        .join("")}</div>
    </div>`
  ).join("");
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.remove("active"));
    $$(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $(`.panel[data-panel="${tab.dataset.tab}"]`).classList.add("active");
  });
});

// ---------------------------------------------------------------------------
// Demo plumbing
// ---------------------------------------------------------------------------
function formData(form) {
  const o = {};
  new FormData(form).forEach((v, k) => (o[k] = v));
  return o;
}
function loading(host) {
  host.innerHTML = `<div class="loading"><div class="spinner"></div><span>Routing to the right model…</span></div>`;
}
function showError(host, msg) {
  host.innerHTML = `<div class="err">⚠️ ${esc(msg)}</div>`;
}
function metaBar(meta) {
  if (!meta) return "";
  return `<div class="meta-bar">
    <span class="chip chip-tier">tier: <b>${esc(meta.tier)}</b> (${esc(meta.analogue || "")})</span>
    <span class="chip">model: <b>${esc(meta.model)}</b></span>
    <span class="chip">⏱ <b>${(meta.latencyMs / 1000).toFixed(1)}s</b></span>
    <span class="chip">tokens: <b>${(meta.promptTokens || 0) + (meta.completionTokens || 0)}</b></span>
    <span class="chip chip-cost">≈ <b>₹${meta.costINR}</b> ($${meta.costUSD})</span>
  </div>`;
}
async function callApi(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---- Grade ----
$("#form-grade").addEventListener("submit", async (e) => {
  e.preventDefault();
  const host = $("#out-grade");
  loading(host);
  try {
    const { result: r, meta } = await callApi("/api/grade", formData(e.target));
    if (r.raw) return (host.innerHTML = metaBar(meta) + `<pre>${esc(r.raw)}</pre>`);
    const pct = r.maxMarks ? Math.round((r.awarded / r.maxMarks) * 100) : 0;
    const crits = (r.criteria || [])
      .map(
        (c) => `<div class="crit">
        <span class="${c.got ? "ok" : "no"}">${c.got ? "✓" : "✗"}</span>
        <span>${esc(c.point)}<br><span class="cm">${esc(c.note || "")}</span></span>
        <span class="q-m">${esc(c.marks)} m</span>
      </div>`
      )
      .join("");
    host.innerHTML =
      metaBar(meta) +
      `<div style="display:flex;align-items:baseline;gap:1rem;flex-wrap:wrap">
        <div class="score-big">${esc(r.awarded)}<small>/${esc(r.maxMarks)} (${pct}%)</small></div>
        ${r.teacher_flag === "review" ? `<span class="flag-review">⚑ Flagged for teacher review</span>` : ""}
      </div>
      <div class="conf">Model confidence: ${Math.round((r.confidence || 0) * 100)}%</div>
      <div style="margin-top:1rem">${crits}</div>
      <div class="fb"><h5>Feedback (English)</h5>${esc(r.feedback_en)}</div>
      ${r.feedback_local ? `<div class="fb"><h5>Feedback (mother tongue)</h5>${esc(r.feedback_local)}</div>` : ""}
      ${r.next_step ? `<div class="fb"><h5>Next step</h5>${esc(r.next_step)}</div>` : ""}`;
  } catch (err) {
    showError(host, err.message);
  }
});

// ---- Paper ----
$("#form-paper").addEventListener("submit", async (e) => {
  e.preventDefault();
  const host = $("#out-paper");
  loading(host);
  try {
    const { result: r, meta } = await callApi("/api/paper", formData(e.target));
    if (r.raw) return (host.innerHTML = metaBar(meta) + `<pre>${esc(r.raw)}</pre>`);
    const bp = (r.blueprint || [])
      .map((b) => `<span class="chip">${esc(b.count)} × ${esc(b.type)} <b>(${esc(b.marksEach)}m)</b></span>`)
      .join("");
    const instr = (r.instructions || []).map((i) => `<li>${esc(i)}</li>`).join("");
    const qs = (r.questions || [])
      .map((q) => {
        const opts = q.options
          ? `<div class="q-opts">${q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${esc(o)}`).join("&nbsp;&nbsp; ")}</div>`
          : "";
        return `<div class="q"><div class="q-h"><span class="q-n">Q${esc(q.q)}.</span><span>${esc(q.text)}</span><span class="q-m">${esc(q.marks)} m</span></div>${opts}<span class="q-bloom">${esc(q.bloom || "")} · ${esc(q.type || "")}</span></div>`;
      })
      .join("");
    const akey = (r.answer_key || [])
      .map((a) => `<div class="q"><b>Q${esc(a.q)}</b> (${esc(a.marks)} m): ${esc(a.answer)}</div>`)
      .join("");
    host.innerHTML =
      metaBar(meta) +
      `<h3 style="margin:.2rem 0">${esc(r.title || "Question Paper")}</h3>
      <div style="font-size:.85rem;color:var(--muted)">Total: ${esc(r.total)} marks${
        r.marksSum === r.total ? ` · <span style="color:var(--green)">blueprint verified ✓</span>` : ""
      }</div>
      ${bp ? `<div style="margin:.6rem 0;display:flex;gap:.35rem;flex-wrap:wrap">${bp}</div>` : ""}
      ${instr ? `<ul style="font-size:.85rem;color:var(--ink-soft);margin:.6rem 0">${instr}</ul>` : ""}
      <div style="margin-top:.6rem">${qs}</div>
      ${akey ? `<details class="akey"><summary>📋 Answer key with step-marking</summary>${akey}</details>` : ""}`;
  } catch (err) {
    showError(host, err.message);
  }
});

// ---- Explain ----
$("#form-explain").addEventListener("submit", async (e) => {
  e.preventDefault();
  const host = $("#out-explain");
  loading(host);
  try {
    const { result: r, meta } = await callApi("/api/explain", formData(e.target));
    if (r.raw) return (host.innerHTML = metaBar(meta) + `<pre>${esc(r.raw)}</pre>`);
    const kp = (r.key_points || []).map((p) => `<li>${esc(p)}</li>`).join("");
    const cq = (r.check_questions || []).map((p) => `<li>${esc(p)}</li>`).join("");
    host.innerHTML =
      metaBar(meta) +
      `<div class="exp-block"><h5>Simple explanation</h5><p>${esc(r.summary_local)}</p></div>
      ${kp ? `<div class="exp-block"><h5>Key points</h5><ul>${kp}</ul></div>` : ""}
      ${r.everyday_example ? `<div class="exp-block"><h5>Everyday example</h5><p>${esc(r.everyday_example)}</p></div>` : ""}
      ${cq ? `<div class="exp-block"><h5>Check your understanding</h5><ul>${cq}</ul></div>` : ""}`;
  } catch (err) {
    showError(host, err.message);
  }
});

// init
renderBars();
renderRouter();
renderCatalogue();
