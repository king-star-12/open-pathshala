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
let PROVIDER = "groq"; // toggled by the provider switch
function formData(form) {
  const o = {};
  new FormData(form).forEach((v, k) => (o[k] = v));
  o.provider = PROVIDER;
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
  const engine = meta.provider === "azure"
    ? `<span class="chip" style="background:#fff4e8;border-color:#f3d4b0;color:#c95a18">🚀 <b>Scale engine</b></span>`
    : `<span class="chip" style="background:#eef7f0;border-color:#bfe0cc;color:#1f7a52">⚡ <b>Fast &amp; free</b></span>`;
  return `<div class="meta-bar">
    ${engine}
    <span class="chip">⏱ graded in <b>${(meta.latencyMs / 1000).toFixed(1)}s</b></span>
    <span class="chip chip-cost">cost ≈ <b>₹${meta.costINR}</b></span>
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

// ---------------------------------------------------------------------------
// "See it in action" animated showcase — tab switcher + captions + autoplay
// ---------------------------------------------------------------------------
const SCENE_CAPTIONS = {
  scan: ['A1', 'Photograph a stack of scripts, AI transcribes the handwriting, grades each answer against the marking scheme, and flags low-confidence ones for the teacher.'],
  photo: ['A1', 'Snap one answer on any phone — even offline. The image is graded against the answer key with per-criterion feedback in the student’s mother tongue.'],
  paper: ['A2', 'Point it at an online or scanned textbook chapter. A server-side blueprint fixes the marks split; the AI fills it and writes a matching answer key.'],
  proctor: ['New', 'A single camera watches the hall. AI tracks who is present and on-task and surfaces flags for the teacher to confirm — faces tokenised on-device, nothing uploaded.'],
  attendance: ['D2', 'A photo of the paper register becomes a structured digital roster in seconds — no manual tallying, instant present/absent counts.'],
  tutor: ['E4', 'A doubt-solving tutor that answers strictly from the prescribed textbook — citing the chapter, never guessing from the open web.'],
};
function initHowto() {
  const tabs = $$('#howtoTabs .htab');
  const scenes = $$('#howtoStage .scene');
  const caption = $('#howtoCaption');
  if (!tabs.length) return;
  let timer;
  const show = (name) => {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.scene === name));
    // toggle scene: removing/re-adding 'active' restarts the CSS animations
    scenes.forEach((s) => {
      const on = s.dataset.scene === name;
      s.classList.remove('active');
      if (on) { void s.offsetWidth; s.classList.add('active'); }
    });
    const c = SCENE_CAPTIONS[name];
    if (c && caption) caption.innerHTML = `<span class="pill">${esc(c[0])}</span> ${esc(c[1])}`;
  };
  const order = tabs.map((t) => t.dataset.scene);
  let idx = 0;
  const autoplay = () => {
    clearInterval(timer);
    timer = setInterval(() => { idx = (idx + 1) % order.length; show(order[idx]); }, 7000);
  };
  tabs.forEach((t) =>
    t.addEventListener('click', () => {
      idx = order.indexOf(t.dataset.scene);
      show(t.dataset.scene);
      autoplay(); // reset the timer on manual interaction
    })
  );
  // start autoplay only once the section scrolls into view
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => { if (e.isIntersecting) { autoplay(); } else { clearInterval(timer); } }),
    { threshold: 0.25 }
  );
  io.observe($('#howto'));
}

// ---------------------------------------------------------------------------
// Provider switch (Open Groq vs Enterprise Azure LB)
// ---------------------------------------------------------------------------
function initProviderSwitch() {
  const opts = $$("#providerSwitch .ps-opt");
  if (!opts.length) return;
  // disable Azure if the server reports it isn't configured
  fetch("/api/router").then((r) => r.json()).then((info) => {
    if (!info.azureEnabled) {
      const az = opts.find((o) => o.dataset.provider === "azure");
      if (az) { az.disabled = true; az.style.opacity = .5; az.title = "Enterprise plane not configured on this server"; }
    }
  }).catch(() => {});
  opts.forEach((o) =>
    o.addEventListener("click", () => {
      if (o.disabled) return;
      PROVIDER = o.dataset.provider;
      opts.forEach((x) => x.classList.toggle("active", x === o));
    })
  );
}

// ---------------------------------------------------------------------------
// Image helpers — downscale a File/video frame to a compact JPEG data URL
// ---------------------------------------------------------------------------
function canvasToDataURL(source, w, h, max = 1024) {
  const scale = Math.min(1, max / Math.max(w, h));
  const cw = Math.round(w * scale), ch = Math.round(h * scale);
  const c = document.createElement("canvas");
  c.width = cw; c.height = ch;
  c.getContext("2d").drawImage(source, 0, 0, cw, ch);
  return c.toDataURL("image/jpeg", 0.72);
}
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(canvasToDataURL(img, img.naturalWidth, img.naturalHeight));
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ---------------------------------------------------------------------------
// Vision tabs
// ---------------------------------------------------------------------------
function initVisionTabs() {
  $$("[data-vtab]").forEach((tab) =>
    tab.addEventListener("click", () => {
      $$("[data-vtab]").forEach((t) => t.classList.remove("active"));
      $$("[data-vpanel]").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      $(`[data-vpanel="${tab.dataset.vtab}"]`).classList.add("active");
    })
  );
}

// ---------------------------------------------------------------------------
// OCR — scan & grade a handwritten answer (vision)
// ---------------------------------------------------------------------------
function initOCR() {
  const form = $("#form-ocr"); if (!form) return;
  const file = $("#ocrFile"), preview = $("#ocrPreview"), hint = $("#ocrHint"),
        cam = $("#ocrCam"), zone = $("#ocrDrop"), go = $("#ocrGo");
  let dataUrl = null, stream = null;

  const setImage = (url) => {
    dataUrl = url; stopCam();
    preview.src = url; preview.hidden = false; cam.hidden = true; hint.hidden = true;
    zone.classList.add("has-img"); go.disabled = false;
  };
  const stopCam = () => { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } cam.hidden = true; };

  $("#ocrPick").addEventListener("click", () => file.click());
  file.addEventListener("change", async () => { if (file.files[0]) setImage(await fileToDataURL(file.files[0])); });

  $("#ocrCamBtn").addEventListener("click", async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      cam.srcObject = stream; await cam.play();
      preview.hidden = true; hint.hidden = true; cam.hidden = false; zone.classList.add("has-img");
      go.disabled = false; go.textContent = "📸 Capture & grade";
    } catch (e) { alert("Camera unavailable: " + e.message); }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (stream) { dataUrl = canvasToDataURL(cam, cam.videoWidth, cam.videoHeight); setImage(dataUrl); go.textContent = "Scan & grade"; }
    if (!dataUrl) return;
    const host = $("#out-ocr"); loading(host);
    try {
      const fd = formData(form); delete fd.provider; // OCR defaults to enterprise vision
      const { result: r, meta } = await callApi("/api/ocr-grade", { ...fd, image: dataUrl, provider: PROVIDER });
      if (r.raw) return (host.innerHTML = metaBar(meta) + `<pre>${esc(r.raw)}</pre>`);
      const pct = r.maxMarks ? Math.round((r.awarded / r.maxMarks) * 100) : 0;
      const crits = (r.criteria || []).map((c) => `<div class="crit"><span class="${c.got ? "ok" : "no"}">${c.got ? "✓" : "✗"}</span><span>${esc(c.point)}<br><span class="cm">${esc(c.note || "")}</span></span><span class="q-m">${esc(c.marks)} m</span></div>`).join("");
      host.innerHTML = metaBar(meta) +
        `<h5 style="margin:.2rem 0 .3rem;text-transform:uppercase;font-size:.72rem;letter-spacing:.05em;color:var(--muted)">OCR transcription · confidence ${Math.round((r.ocr_confidence || 0) * 100)}%</h5>
         <div class="ocr-trans">${esc(r.transcription || "")}</div>
         <div style="display:flex;align-items:baseline;gap:1rem;flex-wrap:wrap">
           <div class="score-big">${esc(r.awarded)}<small>/${esc(r.maxMarks)} (${pct}%)</small></div>
           ${r.teacher_flag === "review" ? `<span class="flag-review">⚑ Needs teacher review</span>` : ""}
         </div>
         <div style="margin-top:.8rem">${crits}</div>
         ${r.feedback_en ? `<div class="fb"><h5>Feedback</h5>${esc(r.feedback_en)}</div>` : ""}
         ${r.feedback_local ? `<div class="fb"><h5>Mother tongue</h5>${esc(r.feedback_local)}</div>` : ""}`;
    } catch (err) { showError(host, err.message); }
  });
}

// ---------------------------------------------------------------------------
// Live exam proctor — webcam frames -> integrity analysis
// ---------------------------------------------------------------------------
function initProctor() {
  const cam = $("#proctorCam"); if (!cam) return;
  const overlay = $("#proctorOverlay"), out = $("#out-proctor");
  const startB = $("#proctorStart"), scanB = $("#proctorScan"), stopB = $("#proctorStop"), auto = $("#proctorAuto");
  let stream = null, busy = false, timer = null;
  const rows = [];

  const setBadge = (integrity, label) => {
    overlay.innerHTML = integrity ? `<span class="proctor-badge pb-${integrity}">${esc(label || integrity)}</span>` : `<span class="po-idle">live</span>`;
  };

  startB.addEventListener("click", async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      cam.srcObject = stream; await cam.play();
      setBadge(null); scanB.disabled = false; stopB.disabled = false; startB.disabled = true;
      out.innerHTML = `<div class="output-empty">Camera live. Click “Analyse frame”, or enable auto.</div>`;
    } catch (e) { alert("Camera unavailable: " + e.message); }
  });

  const stop = () => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; clearInterval(timer); timer = null; auto.checked = false;
    scanB.disabled = true; stopB.disabled = true; startB.disabled = false; setBadge(null);
  };
  stopB.addEventListener("click", stop);

  const analyse = async () => {
    if (!stream || busy) return; busy = true; scanB.disabled = true;
    try {
      const img = canvasToDataURL(cam, cam.videoWidth, cam.videoHeight, 768);
      const { result: r, meta } = await callApi("/api/proctor", { image: img, provider: PROVIDER });
      const integ = r.integrity || "ok";
      setBadge(integ, integ === "ok" ? "✓ OK" : integ === "flag" ? "⚑ FLAG" : "● attention");
      const region = meta.backend ? (meta.backend.match(/op-aoai-(\w+)/) || [, ""])[1] : (meta.provider || "");
      const ts = new Date().toLocaleTimeString();
      const obs = (r.observations || []).slice(0, 2).join("; ");
      rows.unshift(`<div class="plog-row ${esc(integ)}"><span class="plog-t">${ts}</span><span>${esc(r.note_for_invigilator || obs || "All clear")}<br><span class="cm" style="color:var(--muted);font-size:.76rem">${esc(r.students_visible)} present · gaze ${esc(r.gaze)} · phone ${r.phone_detected ? "yes" : "no"}</span></span><span class="plog-be">${esc(region)}</span></div>`);
      out.innerHTML = `<div class="plog">${rows.slice(0, 8).join("")}</div>`;
    } catch (err) { showError(out, err.message); }
    finally { busy = false; if (stream) scanB.disabled = false; }
  };
  scanB.addEventListener("click", analyse);
  auto.addEventListener("change", () => {
    clearInterval(timer); timer = null;
    if (auto.checked && stream) { analyse(); timer = setInterval(analyse, 10000); }
  });
  // stop camera when navigating away from the section
  window.addEventListener("pagehide", stop);
}

// init
renderBars();
renderRouter();
renderCatalogue();
initHowto();
initProviderSwitch();
initVisionTabs();
initOCR();
initProctor();
