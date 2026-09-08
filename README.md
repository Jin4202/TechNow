# TechNow

A science and technology news site that writes itself, once a day.

Every morning a pipeline discovers what happened, researches each story across
three to five independent sources, writes an original article in English,
**verifies every factual claim against those sources**, translates it to Korean,
generates a cover image, and publishes the batch at 07:00 America/Los_Angeles.
Readers can save articles and receive a monthly summary of what they saved.

Nothing is summarized or translated from another outlet. Sources are research
material, not copy.

---

## How it works

```
01:00 PT   discover   pull curated RSS feeds, drop what we have already seen
           filter     length, promo language, keywords          (code, no LLM)
           group      cluster items into topics, match against
                      the last 7 days of published titles       [Haiku]
           score      novelty · impact · interest, 1-5 each     [Haiku]
           rescore    fetch the trigger page for borderline
                      topics and score them again               [Haiku]
           select     total >= 10 && every axis >= 3, top 5,
                      at most 2 papers per day

           per topic, in parallel:
             research   generate queries, search, filter by source
                        tier, fetch and extract article text
             write      structured JSON article                 [Sonnet]
             verify     extract claims, check each one against
                        the sources it cites                    [Sonnet]
             translate  Korean                                  [Sonnet]
             illustrate cover image                             [Flux Pro Ultra]

07:00 PT   publish    everything that reached `ready`
```

If a topic cannot find enough sources, or a claim cannot be grounded in one, the
article does not ship. An empty day is an acceptable outcome; a wrong article is
not.

**Categories** — AI & Computing · Space & Astronomy · Health & Biotech ·
Climate & Energy · Physics & Materials · Robotics & Hardware ·
Tech Industry & Policy

---

## Design constraints

These are enforced in code, not requested in prompts. They are the reason the
codebase looks the way it does.

**Grounding is a gate, not a warning.** An article whose claims fail
verification is discarded and the topic is skipped. There is no path that
softens a failure into a caveat.

**Published articles are never edited.** A mistake is unpublished; if the story
is still worth telling it is regenerated as a new article.

**Cost ceilings are counters at the call site.** Searches per topic, pages
fetched, images generated, articles per day — each is checked before the call,
not asked for in a system prompt. Every run records what it spent to
`pipeline_runs`, because the free log tier only keeps a day.

**Row level security on every table, no exceptions.** The web app holds only the
anon key; RLS is the whole defense. The service role key exists in the
Trigger.dev environment and nowhere else — a `NEXT_PUBLIC_` prefix on it would
make it a public key.

**Tuning values live in config, not in logic.** Thresholds, caps, source tiers,
and feed lists are in `src/config/` and can be changed without a deploy.

---

## Stack

TypeScript · Next.js 16 (App Router) · Tailwind CSS 4 · next-intl ·
Supabase (Postgres, Auth, Storage, RLS) · Trigger.dev (scheduled batches) ·
Claude API (Sonnet + Haiku) · Brave Search · fal.ai (Flux Pro v1.1 Ultra)

## Layout

```
src/
  app/[locale]/     Next.js App Router — public pages, saved articles, settings
  proxy.ts          access gate (Next 16 renamed middleware.ts to proxy.ts)
  clients/          Anthropic · Brave · fal
  config/           tuning values: models, thresholds, feeds, filters, tiers
  db/               types, query helpers, Supabase clients (anon/server/service)
  pipeline/         the logic — pure functions, no Trigger.dev or Supabase imports
  trigger/          Trigger.dev task definitions — thin wrappers over pipeline/
  prompts/          prompt templates and their zod output schemas
fixtures/           real topics with cached source text, for repeatable prompt runs
supabase/migrations/
docs/
```

The boundary that matters: **`src/trigger/` is thin, `src/pipeline/` is thick.**
A task file parses input, calls a pipeline function, and stores the result.
Judgment that lives in a task file cannot be tested against a fixture.

## Development

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm verify       # typecheck + lint + tests + secret scan
```

Local Supabase stack:

```bash
supabase start
supabase status
```

Copy `.env.example` to `.env.local` and fill it in. **App keys and
pipeline-only keys never mix** — see `CLAUDE.md` §2.1.

Steps that call a model are exercised against `fixtures/` rather than live
search, so a prompt can be iterated on without paying for it twice or getting a
different answer each time. The `tests/live/` suite is the exception and is
never part of `pnpm verify`.

## Documentation

| Document | Contents |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Working rules, project structure, document routing |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Tasks and completion criteria per phase — **current position lives here** |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Runtime boundaries, pipeline, data model, RLS |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decisions made after the plan was written (D-01 onward) |
| [docs/RUBRIC.md](docs/RUBRIC.md) | Scoring rubric and its calibration history |
| [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md) | How articles are written and translated |
| [docs/MASTER_PLAN.md](docs/MASTER_PLAN.md) | The original plan |

Documents are in Korean; code, prompts, and published articles are in English.

## Status

The pipeline runs in production and publishes daily. The site itself sits behind
an access gate until Phase 7 (name, domain, auth callback, terms) is finished.
