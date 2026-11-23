# mental-math-trainer

A Zetamac-style mental-arithmetic speed trainer for quant interview prep. It logs every problem at keystroke level, models where each player loses time by problem type, and generates targeted drills to fix it.

> **Status:** early development. See the roadmap below for what's built and what's planned.

## Why

Arithmetic speed tests are a standard part of trading and quant interviews. Most trainers only track your final score. This project focuses on **diagnosis and prescription**:

- **Where** you lose time (e.g. ×7 and ×8, subtraction with borrows)
- **How much** each weakness costs you, in expected seconds lost per round
- **What to drill**, with practice weighted toward your highest-cost weaknesses
- **Whether it worked**, by measuring latency before and after drilling

## Architecture

```
Browser game (Next.js) ──raw events──▶ Postgres (Supabase)
                                            │
                          Python pipeline (scheduled + on-demand)
                          ingest → staging → features → models
                                (DuckDB for transforms)
                                            │
                                     Postgres marts
                                            │
                              Dashboard reads model outputs
```

| Layer | Tech | Role |
|---|---|---|
| Game & dashboard | Next.js, TypeScript | Accurate client-side timing, charts, auth UI |
| Storage | Postgres (Supabase) | System of record, auth, row-level security |
| Pipeline | Python, DuckDB | Feature engineering, modelling, recommendations |
| CI | GitHub Actions | Lint, type-check, tests, build on every PR |

## Game rules

Default (ranked) settings match Zetamac so scores are comparable:

- **Addition:** (2–100) + (2–100)
- **Subtraction:** addition problems in reverse
- **Multiplication:** (2–12) × (2–100)
- **Division:** multiplication problems in reverse
- **Duration:** 120 seconds

Only rounds played with default settings count towards ranked stats. Practice rounds are logged separately so drill effectiveness can be measured.

## Planned analysis

- **Category latency with shrinkage:** empirical Bayes estimates per problem category, so small samples don't produce false weaknesses
- **Expected seconds lost per round:** frequency in a ranked round × excess latency
- **Latency feature model:** what actually slows you down (carries, factor, digit count, fatigue, time of day), validated on held-out later sessions
- **Learning curves:** power-law fit per category with projected scores
- **Adaptive drill selection:** practice sampled in proportion to expected score gain

## Roadmap

- [x] Repo scaffold, local Supabase stack, CI
- [ ] Database schema and row-level security policies
- [ ] Game with keystroke-level event logging
- [ ] Auth (guest play + accounts)
- [ ] Activity heatmap and daily-best charts
- [ ] Pipeline: staging and feature layers
- [ ] Category models and four-operation dashboard
- [ ] Practice mode with recommended drills
- [ ] Learning curves and latency model write-up

## Local development

**Requirements:** Docker Desktop, Node 20+, pnpm, uv, Supabase CLI

```bash
supabase start                 # local Postgres, auth, Studio
cd web && pnpm install && pnpm dev       # http://localhost:3000
cd pipeline && uv sync && uv run pytest
```

Copy `web/.env.example` to `web/.env.local` and `pipeline/.env.example` to `pipeline/.env`, then fill both from `supabase status -o env`.

## Repo layout

```
web/          Next.js game + dashboard
pipeline/     Python package: ingest, features, models, recommend
supabase/     Migrations and local config (schema as code)
notebooks/    Exploratory analysis
docs/         Design notes
```

## Disclaimer

Not affiliated with Zetamac. "Zetamac" is referenced only to describe the game format and default settings.

## License

AGPL-3.0
