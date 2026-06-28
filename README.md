# OpenPathshala — An Open-Source AI Workflow Toolkit for Indian Schools

> **Working title.** *OpenPathshala* (पाठशाला, "place of learning") is a placeholder — rename freely. The name matters less than the framing: this is the founding architecture document for a **genuine, public, permissively-licensed open-source project**, not a product pitch.

**One-line description:** A modular, offline-first, multilingual toolkit that automates the highest-friction, lowest-judgment workflows in Indian schools — assessment, content generation, administration, accessibility — designed to run across the full spectrum of Indian school infrastructure, from no-electricity rural schools to fully-connected urban ones, at a cost measured in single-digit rupees per task.

**Status:** Architecture / vision (v0.1)
**License intent:** Apache-2.0 (code) + CC BY-SA-4.0 (content/curricula) — see §10
**Author:** Dhrumil — Clustral AI Labs (architecture), released as an independent OSS public good

> 🌐 **Live prototype:** https://pathshala.distillai.in — a working demo of the two MVP workflows (handwritten-answer grading & blueprint-constrained question-paper generation), powered by a real 3-tier model router (Groq LLMs). See [`/web`](./web).

---

## 0. How to read this document

This document does three things, in order of importance:

1. **Researches the real problem.** Section 2 is grounded in the most recent official data (UDISE+ 2024-25, NEP 2020, DPDP Act 2023). The architecture only earns trust if the problem statement is accurate, so the numbers are cited and dated.
2. **Specifies a buildable system.** Sections 4–8 are an implementable architecture with module boundaries, model-routing logic, a defensible cost model, and a privacy/child-safety design — not hand-waving.
3. **Positions honestly for funding/credibility** (§11), including the Claude for OSS reality and the Anthropic Startup Program alternative.

A reader from Anthropic, a school administrator, or a contributing engineer should each find the section they need without wading through the others.

---

## 1. The honest qualification note (read this first)

The **Claude for Open Source** program eligibility, as published, is:

- **Primary maintainer or core team member of a public repo with 5,000+ GitHub stars OR 1M+ monthly NPM downloads**, with commits/releases/PR reviews in the last 3 months; **or**
- the discretionary path: *"if you maintain something the ecosystem quietly depends on, apply anyway and tell us about it."*

The reward is **6 months of Claude Max 20x** — a *subscription for building*, not API credits for running inference in production.

**Implications for this project:**

- A document does not confer eligibility. **Public adoption** (stars, real deployments, contributors) does. This doc exists to make that adoption *possible and fast*, by being a credible founding spec.
- The Max benefit accelerates **your development velocity** (via Claude Code / Cowork). The **running costs** of a deployed school system are separate and API-metered (or self-hosted open models) — covered in §8.
- For Clustral AI Labs' **commercial** work, the **Anthropic Startup Program** (and standard API credits) is the appropriate channel. Keep the open-source toolkit and the commercial entity cleanly separated: the OSS project is a public good; Clustral may offer paid hosting/support/integration on top of it (an "open core" posture), which is legitimate and does not contaminate the OSS project's standing.

The strategically correct move is therefore: **ship the toolkit publicly, get it adopted by even 5–10 real schools, document the impact, then apply via the discretionary path** with this architecture and real deployment evidence behind you.

---

## 2. Research foundation — the Indian school landscape

### 2.1 Scale

| Metric | Value | Source/year |
|---|---|---|
| Total schools | ~14.71 lakh (1,471,473) | UDISE+ 2024-25 |
| Total students enrolled | ~24.8 crore | UDISE+ 2023-24 |
| Total teachers | ~1.01 crore (1,01,22,420 — crossed 1 crore for the first time) | UDISE+ 2024-25 |
| Government schools | ~10.17 lakh | UDISE+ 2023-24 |
| Private/aided/other schools | ~4.54 lakh | UDISE+ 2023-24 |
| Secondary-stage dropout rate | ~10.9% | UDISE+ 2023-24 |

This is not one market. It is at least three, separated by infrastructure, and the design must treat that separation as a first-class constraint rather than an afterthought.

### 2.2 The digital divide — the central design constraint

UDISE+ 2024-25 national infrastructure coverage:

| Facility | % of schools | Functional % | Notes |
|---|---|---|---|
| Drinking water | 99.3% | 99.0% | Near-universal |
| Toilets (girls) | 96.8% | 95.3% | Near-universal |
| Electricity | 93.7% | 92.0% | ~1.2 lakh schools still lack functional power |
| **Computers** | **64.7%** | **58.0%** | One-third have none; many "have" but non-functional |
| **Internet** | **63.5%** | — | One-third have no connectivity at all |
| Functional solar panels | 10.9% | — | Power resilience is rare |

**State-level disparity is severe.** Internet connectivity ranges from ~100% (Delhi, Andhra Pradesh, Gujarat) down to ~36–46% (Uttar Pradesh, Jharkhand) and below 20% historically in West Bengal and Bihar. North-eastern states (Meghalaya ~20% computers, Manipur ~37%) lag furthest. **A national tool that assumes connectivity excludes the schools that need help most.**

A practical, evidence-backed mitigation already used in the field: **tablet/Chromebook ICT labs charged on a single power strip** — devices charge in 3–4 hours and run 7–8 hours, covering a full school day without continuous electricity. This validates an **offline-first, intermittently-syncing** design over a cloud-streaming one.

### 2.3 Structural realities the architecture must respect

- **Multilingualism is not optional.** Instruction spans 22+ scheduled languages; NEP 2020 mandates mother-tongue / home-language instruction in early grades. The government's own platforms reflect this: **DIKSHA supports 36 Indian languages**, and **Bhashini** (the national language-AI mission, via its *Anuvaad* engine) provides translation across 22 languages. Any grading/content tool must handle code-mixed, regional-script, and English-medium inputs.
- **Board and curriculum fragmentation.** CBSE, CISCE (ICSE/ISC), NIOS, and ~30 distinct state boards each define their own syllabi, marking schemes, and question patterns. Content generation must be **curriculum-pluggable**, not hard-coded to one board.
- **NEP 2020 four-stage structure.** Foundational (pre-primary + Grades 1–2), Preparatory (3–5), Middle (6–8), Secondary (9–12). Workflows and rubrics differ sharply by stage (FLN assessment ≠ board-exam grading).
- **Existing open public infrastructure to interoperate with, not replace.** DIKSHA is built on the open-source **Sunbird / NDEAR** building blocks; NCERT content is openly licensed (textbooks CC BY-NC-ND; resources CC BY-NC-SA); **QR-coded "energized textbooks"** already link print to digital. *Building on these is both technically smart and the heart of the "ecosystem the community depends on" OSS narrative.*
- **Teacher load.** With ~1 crore teachers for ~24.8 crore students, the binding constraint on quality is **teacher time**, not teacher will. Every workflow below is chosen because it returns hours to a teacher, not because it is technically interesting.
- **Data protection & minors.** The **DPDP Act, 2023** governs personal data; children's data requires verifiable parental consent and heightened safeguards. Student work, faces, and identifiers are sensitive. Privacy is a hard requirement (§9), and it maps directly onto Clustral's existing **Redact** competency.

---

## 3. The workflow problem catalogue

The two you named are the right entry points. Below they sit inside a wider catalogue, each scored for who it helps, the pain it removes, and which infrastructure tier it can realistically serve.

**Tier key:** T0 = no electricity/connectivity (paper + intermittent device), T1 = some shared devices / intermittent internet, T2 = connected (1:1 or lab + broadband).

### 3.1 Assessment & grading

| # | Workflow | Pain removed | Tiers |
|---|---|---|---|
| A1 | **Grade handwritten assignments & exams** *(your #1)* | Hours of manual marking; inconsistent rubrics; slow feedback | T0¹/T1/T2 |
| A2 | **Generate question papers from textbooks** *(your #2)* — online + scanned | Days of paper-setting; blueprint compliance; difficulty balance | T1/T2 |
| A3 | **Rubric-aligned feedback generation** — not just a mark, but *why* + next step | Marks without learning; no individualized feedback at scale | T1/T2 |
| A4 | **Foundational literacy & numeracy (FLN) assessment** — oral reading fluency, basic arithmetic (NIPUN Bharat aligned) | No scalable way to assess early-grade reading/math | T0¹/T1 |
| A5 | **Diagnostic mis-conception detection** — cluster wrong answers to find *what* a class doesn't understand | Teacher can't see class-wide gaps from a stack of papers | T1/T2 |
| A6 | **Plagiarism / AI-text & copying detection** (cohort-level similarity, not punitive surveillance) | Cannot detect mass copying in large sections | T2 |

¹ *T0 grading works asynchronously: scan/photograph on a phone when a device is briefly available, queue, sync, grade in batch overnight, print/return.*

### 3.2 Content & curriculum generation

| # | Workflow | Pain removed | Tiers |
|---|---|---|---|
| C1 | **Question-paper generation with blueprint constraints** (marks distribution, Bloom's levels, board pattern) | Manual blueprint balancing | T1/T2 |
| C2 | **Worksheet & practice-set generation** (differentiated: remedial / on-level / advanced) | No time to make tiered material | T1/T2 |
| C3 | **Lesson-plan drafting** mapped to learning outcomes & local context | Lesson planning eats prep time | T1/T2 |
| C4 | **Textbook → multilingual explainer** (chapter to mother-tongue simplified notes) | Mother-tongue material scarce for many languages | T1/T2 |
| C5 | **Answer-key & model-answer generation** with step marking | Marking schemes are slow to build | T1/T2 |
| C6 | **Energized-textbook augmentation** — generate the digital layer behind a QR code, interoperable with DIKSHA | Most chapters lack rich digital companions | T2 |

### 3.3 Administrative automation

| # | Workflow | Pain removed | Tiers |
|---|---|---|---|
| D1 | **UDISE+ / SDMIS / APAAR data-entry assistance** — extract from registers, pre-fill, validate | HMs travel to cyber-cafés to file mandatory data | T0/T1 |
| D2 | **Attendance digitization** from paper registers (photo → structured) | Manual tallying; no analytics | T0/T1 |
| D3 | **Report-card generation** — marks + qualitative comments in the parent's language | Hand-writing 40+ report cards per class | T1/T2 |
| D4 | **Circular / notice drafting & translation** for parents | Repetitive admin writing | T1/T2 |
| D5 | **Timetable & substitution drafting** under constraints | Daily scheduling churn | T1/T2 |

### 3.4 Accessibility, inclusion & communication

| # | Workflow | Pain removed | Tiers |
|---|---|---|---|
| E1 | **Read-aloud / text-to-speech** of notes in regional languages (CWSN support) | Print-disabled & low-literacy learners excluded | T1/T2 |
| E2 | **Image/diagram description** for visually-impaired students | No alt-text for visual material | T2 |
| E3 | **Parent communication bot** over WhatsApp (the de-facto rural channel) in local language | Parents can't engage with school portals | T1/T2 |
| E4 | **Doubt-solving tutor** grounded strictly in the prescribed textbook (no open-web hallucination) | No after-hours academic support | T2 |

This catalogue is deliberately broad so the *toolkit* (not a single app) can grow module by module. The **MVP is A1 + A2** — the two you named — because they remove the most teacher-hours per rupee.

---

## 4. Design philosophy

Five principles, each derived from §2, that the whole architecture obeys:

1. **Offline-first, paper-first.** Paper is the universal interface in Indian schools. The system must work when capture happens on paper and a phone, and processing happens later, possibly elsewhere. Connectivity is an optimization, never a precondition.
2. **Tiered degradation, not feature gating.** The same workflow runs at all three tiers with *graceful degradation* in model quality/latency — not "premium schools get features, poor schools get nothing."
3. **Teacher-in-the-loop, always.** AI proposes; a human disposes. Especially for grading, the output is a *defensible draft* a teacher reviews and overrides — never an unaccountable final mark on a child's record.
4. **Route by judgment required, not by default to the biggest model.** Most tasks are extraction/classification (cheap). A minority need reasoning (mid). A small fraction need deep reasoning (expensive). Cost discipline comes from honest routing (§7).
5. **Interoperate with public infrastructure.** Speak DIKSHA/Sunbird, Bhashini, NCERT-licensed content, and APAAR/UDISE schemas. Don't rebuild the commons; extend it. This is simultaneously the right engineering choice and the OSS-credibility moat.

---

## 5. System architecture (high level)

```
                        ┌──────────────────────────────────────────────┐
                        │                CAPTURE LAYER                   │
                        │  Android app (Kotlin) · PWA · WhatsApp bot ·   │
                        │  scanner/printer bridge · register photos      │
                        └───────────────┬──────────────────────────────┘
                                        │  (queue locally; sync when online)
                        ┌───────────────▼──────────────────────────────┐
                        │              SYNC / GATEWAY                     │
                        │  Offline queue (SQLite) ⇄ CRDT/last-write sync  │
                        │  Edge node (BRC/school server) optional         │
                        └───────────────┬──────────────────────────────┘
                                        │
            ┌───────────────────────────▼───────────────────────────────┐
            │                      PROCESSING CORE                        │
            │                                                             │
            │  ┌────────────┐   ┌──────────────┐   ┌──────────────────┐  │
            │  │ INGEST/OCR  │→ │  AI REASONING │→ │  OUTPUT/RENDER    │  │
            │  │ handwriting │  │  (router →    │  │  papers, marks,   │  │
            │  │ + layout    │  │   Haiku/      │  │  feedback, report │  │
            │  │ + language  │  │   Sonnet/     │  │  cards, TTS,      │  │
            │  │ detect      │  │   Opus / OSS) │  │  translations     │  │
            │  └────────────┘   └──────────────┘   └──────────────────┘  │
            │         │                 │                    │           │
            │  ┌──────▼─────────────────▼────────────────────▼────────┐  │
            │  │   KNOWLEDGE / GROUNDING (RAG over curriculum)         │  │
            │  │   NCERT + state-board textbooks, blueprints, rubrics  │  │
            │  │   (vector store; prompt-cached per board/grade)       │  │
            │  └──────────────────────────────────────────────────────┘  │
            └───────────────────────────┬───────────────────────────────┘
                                        │
                        ┌───────────────▼──────────────────────────────┐
                        │           DATA & GOVERNANCE LAYER              │
                        │  PII redaction · consent ledger (DPDP) ·       │
                        │  audit log · role-based access · retention     │
                        └───────────────────────────────────────────────┘
                                        │
                        ┌───────────────▼──────────────────────────────┐
                        │      INTEGRATIONS: DIKSHA/Sunbird · Bhashini · │
                        │      UDISE+/APAAR schemas · WhatsApp Business   │
                        └───────────────────────────────────────────────┘
```

The processing core is **stateless and deployable three ways**: (a) **cloud** for T2, (b) a **school/block edge node** (a single mini-PC at a Block Resource Centre serving nearby schools) for T1, (c) **on-device** with small open models for T0/T1 offline windows.

---

## 6. Module deep-dives (the two MVP workflows)

### 6.1 Module A1 — Grading handwritten assignments & exams

**Pipeline:**

1. **Capture.** Teacher photographs or scans answer scripts (phone camera is the realistic device). The app auto-detects page boundaries, deskews, and groups pages per student via a roll-number cover sheet or a printed QR/OMR header.
2. **Pre-process (cheap, local where possible).** Image cleanup, orientation, and a **language/script detector** (Devanagari, Gujarati, Tamil, Latin, code-mixed). This routes downstream choices.
3. **Handwriting transcription (HTR).** Vision model converts handwriting → text *with spatial structure preserved* (which answer maps to which question). This is the hardest step for Indian-language handwriting; the design keeps it **swappable**: a frontier vision model (Claude/other) for accuracy at T2, an on-device open HTR model (e.g. TrOCR-family / Bhashini OCR) at T0/T1, with confidence scores.
4. **Rubric grounding.** The relevant **marking scheme / model answer** is retrieved from the curriculum store and **prompt-cached** (it's reused across an entire class set — large caching win).
5. **Grade + justify.** A reasoning model scores each answer *against the rubric*, returns per-criterion marks, a short justification, a confidence, and flags low-confidence items for mandatory human review.
6. **Teacher review UI.** Marks render over the original script image; teacher accepts/overrides with one tap; overrides are logged and become **fine-tuning / few-shot signal** for that teacher's style.
7. **Output.** Marks to gradebook, **feedback to the student in their language**, and **class-level misconception cluster** (Module A5) for the teacher.

**Why this is safe:** the teacher always sees the original script beside the proposed mark; low-confidence and high-stakes (board-pattern) items are never auto-finalized; the audit log makes every machine-proposed mark traceable.

**Quality guardrails:** double-pass on disagreement (if two cheap passes disagree beyond a threshold, escalate to a stronger model); numeric-answer verification via a calculator tool rather than the model's arithmetic; explicit "illegible" handling instead of guessing.

### 6.2 Module A2 — Question-paper generation from textbooks

**Inputs:** (a) source = online textbook (NCERT/state, openly licensed) or a **scanned** copy; (b) a **blueprint** — marks distribution, question types (MCQ/short/long), Bloom's-taxonomy spread, chapter weightage, board pattern, difficulty mix, language.

**Pipeline:**

1. **Ingest source.** If scanned, OCR with layout reconstruction (tables, diagrams, equations). Chunk by chapter/learning-outcome and embed into the curriculum store.
2. **Blueprint as constraints.** The blueprint is a structured constraint object, not prose — the generator must satisfy it (e.g., exactly 5 marks of "apply"-level questions from Chapter 3).
3. **Generate candidate items**, each tagged with chapter, outcome, Bloom's level, marks, and a generated **answer key with step marking**.
4. **Constraint-satisfaction assembly.** A solver/validator assembles items into a paper that *provably* meets the blueprint; if the model under/over-produces a category, it regenerates only that slice (cheap, targeted).
5. **Render** to print-ready PDF (with school header, instructions, marks in margins) **and** a separate answer key — in the chosen language, with a parallel translation if needed (Bhashini or model).
6. **Anti-leakage & freshness.** Seeded variation so two sections get equivalent-but-different papers; a similarity check against previously generated papers to avoid repetition.

**Scanned-textbook nuance:** Indian classrooms heavily use photocopied/scanned material. Robust ingest of *poor-quality scans* (skew, marginalia, bleed-through) is a genuine differentiator.

---

## 7. The AI reasoning layer — model routing

The single most important cost-and-quality decision is **which model does which step.** Default-to-Opus is the most common and most expensive mistake.

| Step | Judgment required | Default model | Fallback (offline/T0) |
|---|---|---|---|
| Language/script detect | Trivial | On-device classifier | rules |
| Handwriting transcription | Perceptual, medium | Vision: Haiku 4.5 → escalate to Sonnet 4.6 on low confidence | open HTR (TrOCR/Bhashini OCR) |
| Extraction / structuring | Low | **Haiku 4.5** | small open LLM |
| Worksheet/notice generation | Low–medium | **Haiku 4.5 / Sonnet 4.6** | small open LLM |
| **Grading against rubric** | Medium (reasoning + fairness) | **Sonnet 4.6** | open mid LLM + human review |
| Question-paper generation | Medium–high | **Sonnet 4.6** | — |
| Misconception analysis, hard reasoning, ambiguous scripts | High | **Opus 4.8** (sparingly) | escalate-to-cloud-only |

**Routing logic:** a lightweight classifier scores each request; ~70% to Haiku-tier, ~20% to Sonnet-tier, ~10% to Opus-tier. Anthropic's own guidance notes a **70/20/10 split can cut total API cost by more than half** versus all-Sonnet, with negligible quality loss because cheap tasks don't benefit from bigger models.

**Three structural cost levers, all applicable here:**

- **Prompt caching** (up to **90%** off cached input): the rubric/marking-scheme, board blueprint, and textbook chapter are *identical across an entire class set* — cache once, reuse for 40+ scripts.
- **Batch API** (**50%** off): grading and overnight paper-generation are not latency-sensitive — queue and process in batch.
- **Tier routing:** reserve frontier models for genuinely hard or low-confidence cases.

**On open models (the T0/T1 and OSS-purity story):** every step has a swappable open-weights fallback so the toolkit is *never hard-locked to one vendor*. This is correct engineering (resilience, sovereignty, offline) and correct OSS posture (the project must be usable with no paid API at all). Claude is the **quality ceiling** the project routes to when available and affordable; open models are the **floor** that guarantees the toolkit always runs.

> **The live prototype** at https://pathshala.distillai.in implements exactly this router against **Groq-hosted open models** — `llama-3.1-8b-instant` (cheap tier) → `llama-3.3-70b-versatile` (reasoning tier) → `openai/gpt-oss-120b` (hard tier) — to demonstrate the architecture end-to-end with zero proprietary lock-in. Swap the provider adapter and the same router targets Claude.

---

## 8. Cost model

Current published Claude API rates (per million tokens, MTok), June 2026: **Haiku 4.5 = \$1 / \$5**, **Sonnet 4.6 = \$3 / \$15**, **Opus 4.8 = \$5 / \$25**. (Verify at claude.com/pricing before budgeting.) Batch = 50% off; cached input up to 90% off. ₹ figures use ≈ ₹84/USD.

### 8.1 Per-task unit cost (illustrative, defensible)

**Grade one handwritten answer script (~8 pages):**
- Page images ≈ 8 × ~1,900 tokens ≈ 15K input tokens
- Rubric + prompt ≈ 2K input tokens (**cached** across the class → ~90% off after first script)
- Output (marks + per-criterion justification) ≈ 1.5K tokens
- On **Sonnet 4.6**, first script ≈ (17K × \$3 + 1.5K × \$15)/1e6 ≈ **\$0.073**; subsequent scripts with rubric cached ≈ **\$0.05**; **with batch (−50%) ≈ \$0.025** → **≈ ₹2–6 per script**.
- Route easy/clear scripts through Haiku-tier transcription first and the number drops further.

**Generate one question paper:**
- Textbook chapter(s) ≈ 20K input (**cached**), blueprint/prompt ≈ 1K, output paper + key ≈ 3K
- On **Sonnet 4.6**, first paper ≈ **\$0.11**; with chapter cached ≈ **\$0.03–0.05**; batch ≈ **\$0.02–0.03** → **≈ ₹2–9 per paper**.

### 8.2 Realistic monthly cost — and the honest caveat

Per-task costs are tiny, but **volume compounds.** A teacher grading 4 sections × 40 students × 4 assessments/month ≈ 640 scripts → at ₹4/script ≈ **₹2,560/teacher/month** if *everything* runs through frontier vision. A 30-teacher school grading everything could reach **₹50–75K/month** — which is *not* "cheap" for a government school.

**This is exactly why tiering matters and why the design is honest about it:**

- **T2 (funded/private schools):** can afford full cloud routing; the value (teacher hours returned) dwarfs the cost.
- **T1 (most schools):** open-model transcription on a shared edge node; Claude reserved for the *grading-judgment* step and low-confidence escalation; selective use (board exams + sampled assignments, not every worksheet).
- **T0 (under-resourced):** fully open, on-device/edge models with no recurring API cost; Claude-quality available only when a deployment opts in and can fund it.

The toolkit therefore exposes **per-school budget caps and routing policies** as configuration, so a school spends in proportion to its means. *Selective, batched, cached, tiered* usage — not "AI-grade everything" — is the cost-responsible default.

### 8.3 What the Claude for OSS Max benefit actually covers

It accelerates **your building** (Claude Code/Cowork for 6 months), not schools' production inference. Production economics above stand on their own and must be solvable with **open models alone** for the project to be credible as a public good.

---

## 9. Privacy, child-safety & data governance

This is a hard requirement, not a section to skim — the users are minors and the law is the DPDP Act, 2023.

- **Data minimization & on-device redaction.** Student names, faces, roll numbers, and identifiers are **redacted/tokenized before any data leaves the device or edge node**. The model grades *anonymized* scripts wherever possible (a script ID, not a child's name). This maps directly onto Clustral's **Redact** module — a natural open contribution.
- **Consent ledger.** A DPDP-aligned record of verifiable parental/guardian consent per student, with purpose limitation and revocation. No consent → no processing of that child's identifiable data.
- **Teacher-in-the-loop accountability.** No machine-proposed mark becomes final on a child's record without human confirmation; every proposal is auditable.
- **Grounded, bounded generation.** The doubt-solving tutor and content modules are **RAG-grounded strictly in the prescribed curriculum** — refusing open-web speculation reduces both hallucination and child-safety surface area.
- **Data residency & sovereignty.** Edge/on-device deployment keeps sensitive data in-school; cloud routing is opt-in and region-aware.
- **Retention & deletion.** Default short retention for raw images; structured marks retained per school policy; hard-delete honored.

---

## 10. Open-source structure & licensing

**Repository:** a monorepo of independently-usable packages — the "building blocks" model (mirroring Sunbird/NDEAR) is what lets pieces be adopted, depended on, and *quietly relied upon* by others.

```
openpathshala/
├── packages/
│   ├── capture-android/        # Kotlin app: scan, queue, sync
│   ├── capture-pwa/            # offline-capable web capture
│   ├── ingest-htr/            # handwriting + scanned-doc OCR, layout, language
│   ├── core-router/           # model routing, caching, batch, budget caps
│   ├── grade-engine/          # rubric grounding + grading + review API
│   ├── paper-gen/             # blueprint-constrained question-paper generation
│   ├── curriculum-rag/        # NCERT/state textbook ingest + vector store
│   ├── redact/                # DPDP-aligned PII redaction & consent ledger
│   ├── i18n-bhashini/         # multilingual bridge (Bhashini + model)
│   └── integrations/          # DIKSHA/Sunbird, UDISE/APAAR, WhatsApp
├── deploy/
│   ├── cloud/                 # T2
│   ├── edge-node/             # T1 (single mini-PC for a cluster of schools)
│   └── on-device/            # T0/T1 offline
├── docs/                      # this file + ADRs + deployment guides
└── examples/                  # one runnable school in a box
```

This repository also ships a working reference implementation of the router + the two MVP workflows as a deployable web app under [`/web`](./web) (see [§13](#13-this-repository)).

**Licensing:** **Apache-2.0** for code (permissive → maximizes adoption and dependency, which is what the OSS bar rewards); **CC BY-SA-4.0** for any project-authored curricula/rubrics; respect upstream NCERT licenses (CC BY-NC-ND / CC BY-NC-SA) for sourced content.

**Adoption flywheel (the path to the eligibility bar):** runnable "school in a box" example → 5–10 pilot schools (start with St. Kabir, Vadodara and a nearby government school for a deliberate T2/T1 contrast) → documented hour-savings and accuracy metrics → conference/community visibility → contributors → stars/dependents → discretionary OSS application backed by real impact.

---

## 11. Build roadmap

| Phase | Scope | Outcome |
|---|---|---|
| **P0 (4–6 wks)** | `ingest-htr` + `grade-engine` for one board, one language, with teacher-review UI; `core-router` with caching/batch/budget caps | A1 works end-to-end on real scripts at one school |
| **P1 (6–8 wks)** | `paper-gen` with blueprint constraints (online + scanned source); answer-key gen | A2 works; MVP = the two named workflows |
| **P2** | `redact` + consent ledger (DPDP); `i18n-bhashini`; on-device/edge deploy | Privacy-complete; runs offline at T0/T1 |
| **P3** | `curriculum-rag` breadth (multi-board), misconception analytics (A5), report cards (D3) | Toolkit, not single app |
| **P4** | DIKSHA/Sunbird + UDISE/APAAR integrations; WhatsApp parent channel | Interoperates with the public commons |

Each phase ships a **publicly usable release** — visibility compounds only if the work is in the open from P0.

---

## 12. Positioning for Claude for OSS (summary)

- **Don't wait for the document to qualify you — let the *project* qualify you.** Ship P0–P1 publicly, deploy to real schools, measure teacher-hours saved and grading accuracy, then apply via the discretionary "ecosystem depends on it" path with evidence.
- **Keep OSS and commercial clean.** The toolkit is Apache-2.0 public good; Clustral may sell hosting/support/integration (open-core) without compromising the project's standing.
- **Use the Anthropic Startup Program for Clustral's commercial needs** and standard API credits for production inference; use the Max benefit (if/when granted) for *building*.
- **Lead the application narrative with public impact**, not architecture polish: "an open, offline-first toolkit that returns hours to teachers across the full range of Indian school infrastructure, built on and extending the public education commons (DIKSHA/Sunbird, Bhashini, NCERT), already running in N schools."

---

## 13. This repository

This repo contains both the **architecture spec** (this document) and a **working reference prototype** that proves the two MVP workflows end-to-end.

```
open-pathshala/
├── README.md           # this document
├── LICENSE             # Apache-2.0
├── CONTRIBUTING.md     # how to contribute
├── web/                # deployable reference app (Node + Express)
│   ├── server.js       # API: /api/grade, /api/paper, /api/explain, model router, /healthz
│   ├── lib/router.js   # the 3-tier model router (cheap → reasoning → hard)
│   ├── public/         # the prototype website (vanilla, no build step)
│   ├── Dockerfile      # container for AWS App Runner / any container host
│   └── package.json
└── deploy/
    └── aws/            # App Runner + ECR + Route53 deploy scripts & notes
```

### Run the prototype locally

```bash
cd web
npm install
export GROQ_API_KEY=your_groq_key   # or LLM_API_KEY
npm start
# open http://localhost:8080
```

The prototype is provider-agnostic by design: it talks to any OpenAI-compatible chat-completions endpoint. Point `LLM_BASE_URL` / `LLM_API_KEY` at Groq (default), a local Ollama/vLLM server (for the T0/T1 offline story), or — by swapping the adapter — Anthropic.

### Live deployment

The hosted prototype runs on **AWS App Runner** behind **`pathshala.distillai.in`**, with the LLM key stored in **SSM Parameter Store** (never in the image or the repo). See [`deploy/aws/`](./deploy/aws) for the full, reproducible deploy.

---

## Appendix — primary sources

- **UDISE+ 2024-25 & 2023-24** — Ministry of Education, Govt. of India (school counts, infrastructure %, teacher count, dropout). udiseplus.gov.in
- **DIKSHA / CIET-NCERT** — open Sunbird/NDEAR architecture, 36 languages, energized textbooks, content licensing. diksha.gov.in
- **Bhashini / Anuvaad** — national language-AI mission, 22-language translation.
- **NEP 2020** — four-stage structure; mother-tongue instruction; clauses 2.60 & 23.60 (DIKSHA as national repository).
- **DPDP Act, 2023** — personal-data protection; children's-data safeguards.
- **Claude API pricing** — Haiku 4.5 \$1/\$5, Sonnet 4.6 \$3/\$15, Opus 4.8 \$5/\$25 per MTok; batch −50%; caching up to −90% (claude.com/pricing, June 2026).
- Market research by Rhythm Patel and Dhrumil Joshi
*All statistics are dated; verify against the latest official releases before publication, as UDISE+ updates annually and API pricing can change.*
