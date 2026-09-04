# TechNow (working title), Science & Tech News Web App, Master Plan v3

All previously open questions are now decided. Decisions are listed in section 9 with the reasoning behind each, so this document has no open-questions section. Anything not covered here is a new decision to be added to section 9 when it comes up.

## 0. Assumptions (locked in until stated otherwise)

- **Platform**. Public, multi-user web app, mobile-responsive. Simple default design for now, visual polish later
- **Language of the codebase**. TypeScript end to end. Frontend, API, and batch pipeline
- **Content model**. RSS feeds are a topic discovery signal only. Each published article is an original piece written from 3 to 5 researched sources, with the sources listed
- **Primary language**. English is the primary language and the quality bar. Korean is a secondary language produced by translation
- **Language setting**. The app defaults to English. Switching the account language to Korean switches the entire UI and all article content to Korean
- **Illustrations**. One AI-generated cover image per article, Flux schnell
- **Style**. One fixed house style, no per-user personalization
- **Selection**. Articles are selected by an importance threshold, not a fixed daily count. Daily cap of 3 as a cost guard
- **Importance criteria**. Three axes only. Novelty, impact, and reader interest, each scored 1 to 5
- **Categories**. A fixed list of seven. AI & Computing, Space & Astronomy, Health & Biotech, Climate & Energy, Physics & Materials, Robotics & Hardware, Tech Industry & Policy. Rare topics go to the nearest category and are distinguished by tags
- **Follow-up coverage**. The grouping step sees titles of articles published in the last 7 days and decides whether a topic is new or a follow-up
- **Sources**. Primary sources first. Reputable major news outlets as secondary sources. Paywalled pages, aggregators, forums, and social media are excluded
- **Publishing**. An article is published only when the English body, the Korean translation, and the cover image are all complete. All articles for the day go live together at 7:00 AM America/Los_Angeles
- **Grounding**. Strict. An unsupported claim blocks publication
- **Immutability**. Published articles are never edited. Errors are handled by unpublishing and, if worthwhile, regenerating
- **Monthly summary**. A per-user summary of the user's own scraps. Free for now, flag-gated so it can become a premium feature later
- **Budget**. About 20 USD per month for all APIs combined
- **Explainer chatbot**. Removed from the plan

---

## 1. Goal and Definition of Done

**One-sentence goal**. A public news web app that discovers notable science and tech topics from curated RSS feeds every day, researches each topic across several sources, writes an original easy-to-read article in English with a cover image and cited sources, offers a Korean version through an account language setting, and lets users scrap articles and revisit them as a personal monthly summary.

**Definition of done**
- New articles are published automatically every morning, the count varying with the importance threshold, up to 3 per day
- Every article is original, cites its sources, and follows the house style
- Every article has an English version, a Korean version, and a cover image
- Switching the account language changes the whole app, including article content
- Users can sign up, scrap articles, and receive a monthly summary of their scraps
- The layout holds on mobile browsers
- Monthly API spend stays within budget

---

## 2. Core Feature Specs (Contracts)

### 2.1 Topic discovery and selection

RSS items are candidates for topics, not article bodies.

- **Input**. List of curated RSS feeds (English-language feeds, science and tech weighted roughly evenly, at least one feed per category)
- **Output**. A list of selected topics for the day, each with a short description and the RSS items that triggered it
- **Processing order**
  1. Fetch all feeds. A feed that fails is skipped for the day and logged
  2. Drop items already recorded in `seen_feed_items`, then record every new item there (URL hash plus date, nothing else)
  3. Cheap filters (too short, promotional, off-topic by keyword)
  4. Agent-based grouping. One Claude call receives the remaining candidate titles and descriptions, plus the titles of articles published in the last 7 days. It groups items covering the same event into topics and marks each topic as new or as a follow-up to a listed article
  5. First-pass importance scoring per topic from RSS descriptions only (Claude call, structured output). Three axes, 1 to 5 each, with a one-line reason per axis
  6. Near-threshold rescoring. Topics whose total lands within 2 points of the threshold get their triggering page fetched and are rescored with the full text. Topics clearly above or below are not fetched
  7. Threshold rule. A topic passes when the total is at least 10 out of 15 and no axis is 2 or below. Passing topics move on, up to the daily cap of 3
- **Constraints**
  - A failed run must not affect the next day's run
  - Threshold, cap, rescoring band, and recent-days window are configuration values, not code
- **Edge cases**
  - No topic passes the threshold. The app shows "No new stories today"
  - More than 3 topics pass. Take the highest totals and log the rest
  - The grouping call fails. Fall back to treating each item as its own new topic
  - A follow-up passes the threshold. It becomes a new article with `follow_up_of` pointing at the earlier one, and the detail page links both ways

**Importance rubric**
- Novelty. Is this a first announcement, a genuine development, or a repeat of known information. For follow-ups, novelty is judged against what was already published, so incremental updates score low and real developments score high
- Impact. How many people or fields does this change, and how soon
- Reader interest. Would a curious general reader click and finish it

**Calibration**. For the first 3 to 4 weeks, scores and selection results are reviewed weekly and the threshold, rescoring band, and cap adjusted.

### 2.2 Research and article writing (English)

- **Input**. A selected topic, its triggering RSS items, the house style guide
- **Output**. An original English article with title, one-line summary, body with subheadings, category, tags, and a list of 3 to 5 sources with URLs and tier labels
- **Processing**
  1. Claude generates 2 to 3 search queries for the topic (event name, organizations involved, likely paper or announcement title)
  2. Brave Search API returns link results for each query
  3. Result URLs are filtered in code by the source tier rules. Tier 1 and Tier 2 domain lists and a block list live in a configuration file
  4. Surviving URLs are fetched directly in rank order and the main text extracted with a Readability-style extractor. A page is treated as paywalled and skipped when the extracted text is very short or contains subscription prompts
  5. Fetching stops once 5 usable sources are collected. If fewer than 3 are found after all candidates, the topic is skipped and logged
  6. Writing step produces the article as structured JSON, with each body section listing which sources support it
  7. Grounding check (below)
- **Constraints**
  - No opinions or speculation not present in the sources
  - Numbers, names, and dates must be traceable to at least one source
  - Sources are stored and displayed on the article page
  - At least one Tier 1 source whenever one exists for the topic
  - Per-topic caps on search calls (3) and fetched pages (10)
  - robots.txt is respected when fetching
- **Edge cases**
  - Search returns nothing usable. Topic is skipped and logged, not published
  - A source page cannot be fetched. Try the next candidate
  - Grounding check fails. Retry the writing step once with the failure reasons attached. If it fails again, the topic is skipped and logged

**Source criteria**
- Tier 1, preferred. Peer-reviewed papers and preprints, official announcements, institutional and company press releases, government and agency publications
- Tier 2, acceptable. Reputable major news outlets and broadcasters with named reporting
- Excluded. Aggregators, content farms, forums, social media posts, SEO blogs, and any page behind a paywall or login

**Grounding check**. Two Claude steps. First, extract the verifiable claims from the article (numbers, names, dates, causal statements). Second, check each claim against the fetched source texts. Plain string matching is not used because it fails on formatting differences such as "5 million" versus "5,000,000". The check is strict. An unsupported claim blocks publication rather than being tolerated, because this is a public site. Fewer articles is the accepted cost. It is a first line of defense, not proof of correctness.

**Immutability**. Published articles are never edited. An article with an error is unpublished and, if worthwhile, regenerated as a new article. This keeps translations and images always consistent with their English body and avoids versioning.

**House style guide (draft, finalized in 3.1)**
- One piece of information per sentence, averaging 15 to 20 words
- Title, then a one-line summary, then body sections with subheadings
- Friendly explanatory tone, not exaggerated. Technical terms get a brief parenthetical explanation on first mention
- Written for a curious general reader, not a specialist

### 2.3 Korean translation

Generated in the batch stage after the English article passes the grounding check, since the result is identical for every reader.

- **Input**. The final English article
- **Output**. Korean title, one-line summary, and body, stored in `article_translations` with locale `ko`
- **Constraints**
  - Translation only. Structure and facts do not change
  - Technical terms may be annotated with the English term on first mention
  - The source list is not translated
- **Edge cases**
  - Translation fails. Retry once within the same run. If it still fails, the article is held back from that morning's publication and retried in the next run

### 2.4 Cover image

- **Input**. Article title and one-line summary
- **Output**. One image generated with Flux schnell (hosted API), stored in Supabase Storage, its URL saved on the article
- **Constraints**
  - One image per article, generated once in the batch stage
  - A fixed visual style prefix in every prompt so images look consistent across the site
  - No real people, logos, brand marks, or text in prompts
- **Edge cases**
  - Generation fails. Retry once within the run. If it still fails, the article is held back from that morning's publication and retried in the next run. No placeholder images on the public site

### 2.5 Publishing

- **Rule**. An article is publishable only when all required assets exist. The required asset list is configuration and grows by phase. English body only in Phase 3, plus Korean translation from Phase 4, plus cover image from Phase 5
- **Timing**. The batch starts at 1:00 AM America/Los_Angeles. Everything that reached `ready` by 6:30 AM is published together at 7:00 AM. Articles that miss the cutoff wait for the next morning
- **Status flow**. `draft` (topic selected, work in progress), `ready_pending` (English done, waiting on other assets), `ready` (all assets complete), `published`, `failed`, `unpublished`
- **Edge cases**
  - Nothing is `ready` at the cutoff. The site shows "No new stories today"
  - An article is held back for two consecutive runs. Mark it `failed`, log it, and alert. Old news should not be published late

### 2.6 Scraps and monthly summary

- **Input**. The articles a user has scrapped
- **Output**. A scrap folder page, plus a per-user summary generated on the first day of each month for the previous month
- **Format**. Grouped by category with a subheading per category, two or three sentences per article, one page or less in total, each article linked
- **Constraints**
  - Users can unscrap at any time
  - The summary is generated in the user's current language
  - Free for now. A `premium` flag on the user profile exists from the start so the feature can be gated later without a migration
- **Edge cases**
  - No scraps in a month. No summary is generated
  - 100 or more scraps in a month. Summary is split by category into separate sections with their own intros

### 2.7 Accounts and language setting

- **Input**. Sign up and login through Supabase Auth
- **Output**. A user profile with a `locale` field (`en` default, `ko` available) and a `premium` flag
- **Constraints**
  - Row-level security so scraps and summaries are visible only to their owner
  - Article reading does not require login. Scrapping does
  - Changing the locale re-renders the UI and swaps article content to the matching translation
  - Korean UI uses a Korean web font (Pretendard) from the start. No separate typography pass until visual polish

---

## 3. Tech Stack and Why

| Area | Choice | Alternatives considered | Why this one |
|---|---|---|---|
| Language | TypeScript end to end | Python full stack, Python pipeline plus Next.js frontend | One language, one repo, two deploy commands. Every AI step is batch, so nothing needs Python's real-time or ML tooling. Trigger.dev is TypeScript-first, so a Python pipeline would mean building or finding a separate orchestrator |
| Frontend | Next.js (React) + Tailwind CSS | Remix, SvelteKit, plain React SPA | Server rendering for public article pages (SEO, fast first paint), file-based routing, and the largest ecosystem for i18n and Supabase helpers |
| i18n | next-intl | react-i18next, Next.js built-in routing only | Made for the Next.js App Router, handles locale routing and message files together. Article content comes from the DB, not from message files |
| Database and auth | Supabase (PostgreSQL, Auth, Storage, RLS) | Firebase, Neon plus Clerk, self-hosted Postgres | One provider for DB, users, file storage, and row-level security. Free tier covers a small public app. Plain Postgres underneath, so nothing is locked in |
| Batch orchestration | Trigger.dev (cloud) from Phase 1 | GitHub Actions, Inngest, always-on server with node-cron, Supabase pg_cron plus Edge Functions | Tasks run for minutes without timeouts, each pipeline step gets its own retry policy, and the dashboard shows exactly where a run failed. Waiting on subtasks is checkpointed and not billed. Free tier covers two schedules and one short run per day. GitHub Actions was rejected because scheduling drifts and retries would be hand-built. Vercel Cron and Edge Functions were rejected because the research pipeline exceeds single-invocation limits |
| AI models | Claude API. Sonnet 5 for writing, grounding verification, translation, and monthly summaries. Haiku 4.5 for cheap filters, grouping, first-pass scoring, and claim extraction | OpenAI, Gemini, a single model for everything | Structured output and tool use fit the pipeline. Splitting by model keeps the writing quality high while the high-volume steps run on the cheapest tier. Assignment is a starting point and moves based on the per-run cost log |
| Web search | Brave Search API | Tavily, Exa, Claude-native web search | Flat per-request price makes the monthly bill predictable. Independent index with top-tier quality and the lowest latency in recent benchmarks. Returns links only, which is what this pipeline wants because source filtering and page reading happen in code. Tavily costs more per call and returns noisier extracted text. Exa's credit-based billing is hard to budget, and its semantic search can return conceptually similar but irrelevant pages. Claude-native search was rejected because tier rules and paywall skipping would rely on prompts rather than code |
| Page fetching | Direct fetch plus a Readability-style extractor | Firecrawl, Jina Reader, Tavily extract | Free, fully under our control, and the extraction quality matters more than the search API because clean text is what limits token cost |
| Image generation | Flux schnell via a hosted API (fal.ai or Together) | Imagen 4 Fast, gpt-image mini, Flux dev or pro, Ideogram | Cheapest credible option at roughly a third of a cent per image, Apache 2.0 licensed, no text rendering needed for covers. Flux dev is excluded because its license is non-commercial without a paid key. Imagen 4 Fast is the fallback if the 5.1 bake-off shows a clear quality gap |
| Deployment | Vercel (app), Trigger.dev cloud (pipeline) | Railway, Fly.io, Render | Zero-config Next.js hosting on a free tier. The pipeline does not run on Vercel, so its limits do not matter |
| Korean font | Pretendard | Noto Sans KR, system fonts | Widely used, good Latin and Hangul pairing, one font for both locales |

---

## 4. Data Model (draft)

```
profiles
  id (matches auth user), display_name, locale (en | ko), premium (bool), created_at

seen_feed_items
  url_hash, feed_name, seen_on
  (one row per RSS item ever observed, used only for dedup)

articles
  id, slug, category (enum of the seven fixed categories), tags[]
  score_novelty, score_impact, score_interest, importance_score
  follow_up_of (nullable, references articles.id)
  title, one_line_summary, body            (English, the primary version)
  cover_image_url (nullable)
  status (draft | ready_pending | ready | published | failed | unpublished)
  style_guide_version, published_at, created_at

article_sources
  id, article_id, url, title, publisher, tier (1 | 2), fetched_at

article_translations
  id, article_id, locale, title, one_line_summary, body, created_at
  (unique on article_id + locale)

scraps
  id, user_id, article_id, scraped_at

monthly_summaries
  id, user_id, month_start, locale, summary_text, article_ids[], created_at

pipeline_runs
  id, run_type (daily | monthly), started_at, finished_at, status
  topics_seen, topics_selected, articles_published
  cost_search_calls, cost_pages_fetched, cost_images, cost_input_tokens, cost_output_tokens, cost_usd_estimate
  notes
  (kept because Trigger.dev free tier retains logs for one day only)
```

Nothing from the raw RSS bodies or the fetched source pages is stored beyond what `seen_feed_items` and `article_sources` need.

---

## 5. Roadmap

Each task is sized so a reviewer can check it in 5 to 10 minutes. Move to the next task only after the completion criterion is met. The site is not public until Phase 7. Until then the deployment is behind a simple access gate.

### Phase 1. Foundation

| # | Task | Completion criterion |
|---|---|---|
| 1.0 | Write the decisions note. Seven categories with Korean names, feed scope, config defaults from section 9 | Note exists and the category enum is final |
| 1.1 | Create the Supabase project, schema migration for all tables in section 4 | Tables exist and RLS is enabled on user-owned tables |
| 1.2 | Supabase Auth sign up, login, logout in the Next.js app | A new account can log in and out |
| 1.3 | Profile creation on sign up with `locale` and `premium` defaults | Profile row appears after sign up |
| 1.4 | Initialize Trigger.dev in the repo, one hello-world scheduled task | Task runs from the dashboard test button and on its schedule |
| 1.5 | Select 3 to 5 RSS feeds covering all seven categories | Each feed URL responds |
| 1.6 | RSS parser (title, description, date, URL) as a Trigger.dev task | Parses 5 or more items from one feed |
| 1.7 | Extend the parser to all feeds with per-feed failure isolation | One failing feed does not stop the others |
| 1.8 | `seen_feed_items` dedup | Running twice records each item once |
| 1.9 | Temporary path that turns each new RSS item into a placeholder article | Articles table fills from a run |
| 1.10 | `pipeline_runs` logging | Each run writes one row with counts |
| 1.11 | Daily schedule at 1:00 AM America/Los_Angeles | Automatic run logged at the configured time |
| 1.12 | Article list page, English UI | Placeholder articles render as a list |
| 1.13 | Responsive styling, simple default design | Layout holds at mobile widths |

**Phase 1 done when** placeholder articles accumulate automatically for two consecutive days and a logged-in user sees the same list as a logged-out user.

### Phase 2. Topic selection

| # | Task | Completion criterion |
|---|---|---|
| 2.0 | Write the importance rubric document (three axes, 1 to 5 scale, examples per level) | One-page rubric exists |
| 2.1 | Cheap filters (short, promotional, keyword off-topic) | Verified against mock data |
| 2.2 | Agent-based grouping prompt (Haiku) | Two items about the same event land in one topic |
| 2.3 | Follow-up detection. Last 7 days of published titles fed into the grouping prompt | A mock item about an already-published story is marked as a follow-up |
| 2.4 | First-pass scoring prompt, three axis scores plus reasons, structured output (Haiku) | Every topic gets three scores and reasons |
| 2.5 | Near-threshold rescoring with the triggering page fetched | A topic within the band is rescored, one outside the band is not fetched |
| 2.6 | Threshold rule (total at least 10, no axis at or below 2), daily cap 3, band and window as configuration | Changing the config changes selection without a deploy |
| 2.7 | Selection logging into `pipeline_runs` | Each run logs all topics, scores, follow-up flags, and pass or fail |
| 2.8 | Weekly calibration review (recurring for 3 to 4 weeks) | Threshold or band adjusted at least once based on logs |

**Phase 2 done when** a run with roughly 100 raw items selects 0 to 3 reasonable topics, follow-ups are identified correctly, and the log explains why each topic passed or failed.

### Phase 3. Research and article writing

| # | Task | Completion criterion |
|---|---|---|
| 3.1 | Write the house style guide document | One-page guide exists |
| 3.2 | Brave Search API client with per-topic call cap | One topic yields link results for 2 to 3 generated queries |
| 3.3 | Source tier configuration (Tier 1 list, Tier 2 list, block list) and URL filter | A mixed URL list is filtered correctly |
| 3.4 | Direct fetch plus Readability extraction, paywall detection, robots.txt check | A mock paywalled page is skipped, a normal page yields clean text |
| 3.5 | Research task. Query generation, search, filter, fetch, stop at 5 sources | One topic yields 3 to 5 source texts stored in `article_sources` with tiers |
| 3.6 | Writing prompt with structured JSON output and per-section source references (Sonnet) | One topic produces a complete article |
| 3.7 | Grounding check, claim extraction step (Haiku) | A list of verifiable claims is produced from a sample article |
| 3.8 | Grounding check, claim verification step (Sonnet) | A deliberately fabricated number is flagged, and a reformatted true number is not |
| 3.9 | Retry and skip logic on grounding failure | A mocked failure retries once, then skips |
| 3.10 | Minimum-source and Tier 1 rules | A topic with 2 sources is not published |
| 3.11 | Build the fixture set. 5 to 10 real topics with cached source texts | Research and writing prompts run against fixtures without live search |
| 3.12 | Split the pipeline into parent and child Trigger.dev tasks with per-step retries | A failed step retries without rerunning the whole pipeline |
| 3.13 | Publishing task with required-asset configuration, 6:30 cutoff, 7:00 publish, status flow | Articles reach `ready` overnight and flip to `published` together at 7:00 |
| 3.14 | Article detail page with sources section and follow-up links | Article, sources, and any linked earlier article render |
| 3.15 | Replace the Phase 1 placeholder path with the real pipeline | Only researched articles are published |
| 3.16 | Per-run cost logging (tokens, search calls, pages fetched) | `pipeline_runs` shows a cost estimate per run |
| 3.17 | Human quality review. Read 10 published articles against the style guide and rubric | Notes recorded and at least one prompt revision made |

**Phase 3 done when** 10 consecutive published articles are original, cite 3 to 5 sources, pass the grounding check, read well to a person, and the cost log shows the per-article cost is at or under target.

### Phase 4. Korean language and language setting

| # | Task | Completion criterion |
|---|---|---|
| 4.1 | Set up next-intl with `en` and `ko` message files, Pretendard loaded | UI strings switch by locale |
| 4.2 | Language setting on the profile page | Changing it updates the `locale` field |
| 4.3 | Translation prompt (English article to Korean, structured output, Sonnet) | One article produces a Korean row in `article_translations` |
| 4.4 | Add the translation task to the pipeline | New articles get a Korean version automatically |
| 4.5 | Content lookup by locale | A Korean user sees Korean content on every published article |
| 4.6 | Add the Korean translation to the required-asset configuration, with in-run retry and hold-back | A mocked failure holds the article back from that morning's publication |

**Phase 4 done when** switching the language changes every visible string and every article on the list and detail pages.

### Phase 5. Cover images

| # | Task | Completion criterion |
|---|---|---|
| 5.1 | Bake-off. Flux schnell and Imagen 4 Fast, same style prompt, 5 images each | Flux schnell confirmed, or the gap documented and Imagen chosen |
| 5.2 | Fixed style prefix | Five test images look consistent |
| 5.3 | Storage upload and `cover_image_url` save | Image is served from Supabase Storage |
| 5.4 | Add the cover image to the required-asset configuration, with in-run retry and hold-back | A mocked failure holds the article back from that morning's publication |
| 5.5 | Add the image task to the pipeline | New articles have images automatically |
| 5.6 | Cover image in list and detail layouts | Images render at both viewport sizes |

**Phase 5 done when** every article published for three consecutive days has a cover image.

### Phase 6. Scraps and monthly summary

| # | Task | Completion criterion |
|---|---|---|
| 6.1 | Scrap and unscrap button | Row appears and disappears in `scraps` |
| 6.2 | Scrap folder page | Scrapped articles can be revisited |
| 6.3 | Monthly aggregation query | Returns a user's scraps for a given month |
| 6.4 | Summary prompt, locale-aware, category-grouped format (Sonnet) | A test summary from 5 articles in each language |
| 6.5 | Category-split logic for 100 or more scraps | Verified against a large mock set |
| 6.6 | Monthly Trigger.dev schedule on the 1st for all users with scraps | Scheduled run logged, users without scraps skipped |
| 6.7 | Summary page | Saved summary displays |
| 6.8 | Gate behind the `premium` flag with the flag defaulting to on | Turning the flag off hides the feature for that user |

**Phase 6 done when** a summary is generated for every user who scrapped anything the previous month.

### Phase 7. Public launch preparation

| # | Task | Completion criterion |
|---|---|---|
| 7.0 | Final app name and domain | Name decided, domain registered |
| 7.1 | Terms of service and privacy policy pages | Pages linked from the footer |
| 7.2 | Rate limiting on auth and scrap endpoints | Abuse test is blocked |
| 7.3 | Category and tag filter UI | Filter narrows the list |
| 7.4 | Error monitoring and batch failure alerts | A forced failure sends an alert |
| 7.5 | Budget alert when the month-to-date cost estimate passes 80 percent of budget | A forced overrun sends an alert |
| 7.6 | Per-user data isolation test | A second account cannot see the first account's scraps |
| 7.7 | Remove the access gate | Site is reachable without a password |

---

## 6. Testing Strategy

- Split the pipeline into independently testable Trigger.dev tasks (discover, group, score, research, write, check, translate, illustrate, publish)
- For AI output, test that the format holds rather than that content is perfect. Required fields, JSON schema validation, grounding check, minimum-source rule
- Keep the fixture set of real topics with cached source texts so research and writing prompts can be iterated without live search calls, and rerun it after every prompt change
- The Trigger.dev dashboard test button and a manual trigger cover both the daily batch and the monthly summary, so testing never waits on the schedule

---

## 7. Cost Guards and Budget

- Monthly budget. About 20 USD across Claude, Brave, image generation, and any paid tier
- Target. At or under 0.20 USD per published article, measured by the cost log, so 3 articles per day fits with headroom
- Daily cap of 3 articles
- Per-topic caps. 3 search calls, 10 fetched pages, 1 image
- Model split. Cheap steps on Haiku, quality steps on Sonnet, revisited when the cost log shows where the money goes
- Batch API is a later optimization if headroom is needed. The pipeline already tolerates a delay, so it fits, but it adds complexity to the first build
- Monthly summary is the only feature whose cost scales with user count. The `premium` flag is the lever if that becomes a problem
- Trigger.dev, Supabase, and Vercel free tiers are expected to cover the app at this scale. Their usage is checked at the monthly cost review

---

## 8. Naming

Working title is TechNow. The final name and domain are decided in 7.0 before launch. Nothing in the codebase depends on the name except UI strings.

---

## 9. Decisions Log

| Decision | Choice | Reasoning in short |
|---|---|---|
| Content model | Original researched articles, not rewrites | Avoids copyright exposure of translating others' articles on a public site |
| Users | Public, multi-user from Phase 1 | Auth and RLS are easier to add first than to retrofit |
| Primary language | English, Korean by translation | English quality is the bar. Korean is a feature |
| Chatbot | Removed | Simplifies the project and removes the only per-user LLM cost besides summaries |
| Selection | Threshold, not fixed count | Busy days should have more articles, quiet days fewer |
| Rubric | Novelty, impact, reader interest, 1 to 5 each | Simple enough to calibrate |
| Threshold rule | Total at least 10 of 15 and no axis at or below 2 | Filters both boring big announcements and fun but trivial items |
| Initial config | Threshold 10, cap 3, rescoring band 2, follow-up window 7 days | Starting values for calibration |
| Rescoring | Fetch the page only for near-threshold topics | Cheap first pass, accuracy where it matters |
| Categories | Seven fixed | Enough to feel organized without empty sections on a 3-article day |
| Follow-ups | Recent titles in the grouping prompt, `follow_up_of` link | Handles multi-day stories without a separate dedup system |
| Sources | Tier 1 primary, Tier 2 major outlets, paywalls and aggregators excluded | Grounding quality depends on source quality |
| Grounding | Two-step Claude check, strict | String matching fails on formatting. Public site should err toward fewer articles |
| Immutability | Published articles are never edited | Keeps translation and image consistent, avoids versioning |
| Publishing | All assets required, 1:00 batch, 6:30 cutoff, 7:00 AM Pacific publish | Consistent daily experience, no half-finished articles |
| Language of the code | TypeScript end to end | One language, Trigger.dev is TypeScript-first, no real-time ML work |
| Orchestrator | Trigger.dev from Phase 1 | Avoids rewriting the Phase 1 pipeline later |
| Search | Brave Search API | Predictable flat pricing, top-tier quality, links-only fits code-side filtering |
| Page reading | Direct fetch plus Readability | Free and controllable, extraction quality drives token cost |
| Image model | Flux schnell (hosted), Imagen 4 Fast as fallback | Cheapest credible option, permissive license, bake-off in 5.1 |
| Budget | 20 USD per month, 0.20 USD per article target, daily cadence with cap 3 | Daily freshness beats batching every few days |
| Storage | Final articles, sources, dedup hashes, run logs only | Raw RSS bodies and fetched pages have no later use |
| Monthly summary | Per-user, category-grouped, one page, free, flag-gated | Personal feature with a premium path |
| Design | Simple default, Pretendard for Korean, polish later | Ship function first |
| Name | Working title TechNow, final in 7.0 | Not needed before launch |

---

## Changes from v2.1

- All open questions resolved and moved into the decisions log
- Trigger.dev adopted from Phase 1. The GitHub Actions stage and the mid-Phase-3 migration were removed
- Brave Search API and direct fetch with Readability chosen for research
- Flux schnell chosen for cover images with a Phase 5 bake-off against Imagen 4 Fast
- Near-threshold rescoring added to topic selection
- Threshold rule, initial config values, publish time, and time zone fixed
- Budget of 20 USD per month, 0.20 USD per article target, daily cap lowered to 3
- Model split between Haiku and Sonnet specified per step
- `pipeline_runs` table added for run and cost logging
- Monthly summary format specified
- Tech stack section expanded with alternatives and reasoning
- Working title TechNow
