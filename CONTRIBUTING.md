# Contributing to OpenPathshala

Thank you for helping return hours to India's teachers. OpenPathshala is a
public good — Apache-2.0, vendor-neutral, offline-first — and contributions of
every size are welcome.

## Ways to contribute

- **Code** — the reference prototype in [`web/`](./web), or the planned packages in [README §10](./README.md#10-open-source-structure--licensing).
- **Curriculum & rubrics** — board/grade-specific blueprints and marking schemes (contributed content is CC BY-SA-4.0; respect upstream NCERT licenses).
- **Language coverage** — prompts, test cases, and evaluation sets for the 22+ scheduled languages.
- **Field reports** — if you pilot this in a real school, tell us what broke and how many teacher-hours it saved. This evidence is what makes the project credible.
- **Docs & translations** of the documentation itself.

## Development setup

```bash
git clone https://github.com/king-star-12/open-pathshala
cd open-pathshala/web
npm install
cp .env.example .env        # add your GROQ_API_KEY (or point LLM_BASE_URL at a local model)
npm run dev                 # http://localhost:8080
```

The app is provider-agnostic: it speaks the OpenAI-compatible chat-completions
schema. You can develop against Groq, a local Ollama/vLLM server, or any
compatible gateway — no proprietary key required to run the project.

## Principles to keep in mind

These are non-negotiable design constraints, not preferences (see README §4 and §9):

1. **Offline-first.** Never assume connectivity is present. Connectivity is an optimization.
2. **Teacher-in-the-loop.** AI output is always a reviewable draft, never a final mark on a child's record.
3. **Route by judgment required.** Don't default to the biggest model. Cheap tier first; escalate only when the task needs it.
4. **Privacy by design.** Minimize and redact student PII; the DPDP Act, 2023 governs minors' data. Never log raw student identifiers.
5. **Extend the commons.** Prefer interoperating with DIKSHA/Sunbird, Bhashini, and NCERT-licensed content over rebuilding it.

## Pull requests

- Keep PRs focused and small where possible.
- Match the style of the surrounding code.
- Don't commit secrets. `.env` and any key material are gitignored — keep it that way.
- For new workflows, explain *which teacher-hours it returns* in the PR description.

## Code of conduct

Be kind, be constructive, assume good faith. We're all here to help children learn.

## License

By contributing, you agree that your contributions are licensed under
**Apache-2.0** (code) or **CC BY-SA-4.0** (content), consistent with the project.
