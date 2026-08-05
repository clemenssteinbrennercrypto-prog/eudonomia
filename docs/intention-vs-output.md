# Intention vs. Output — architecture proposal

**Status:** proposal, nothing implemented yet. Written to be argued with.

## The gap

Eudaimonia measures **attention**. It does not measure **direction** or **result**.

A session where you stared, rapt, at the wrong thing for 50 minutes scores the
same as one where you finished the chapter. That is the honest limitation of
every focus tracker on the market, and closing it is the thing worth building.

Three questions, only the first of which we answer today:

| Question | Signal | Status |
|---|---|---|
| How focused were you? | webcam, blink, gaze, head pose | ✅ built |
| Focused **on what**? | apps, domains, window titles vs. the stated goal | ⚠️ keyword matching only |
| Did anything **come out of it**? | files changed, words added, commits | ❌ not measured at all |

### Why the current version isn't enough

`src/lib/sessionIntent.js` holds six hardcoded profiles (software, writing,
research, design, planning) and scores a goal by counting keyword hits. It
cannot understand a goal it has no keywords for. "Finish the Q3 deck for the
investor call" matches nothing, so confidence drops to `low`, `off_goal` never
fires, and the whole goal-awareness layer silently switches itself off.

It is a lookup table wearing the word "intent". It also only ever asks
*"is this app plausible?"* — never *"is this working?"*

---

## The shape of the answer

Four stages. Each is useful alone; together they compound.

```
  ┌── 1. CONTRACT ──────────────────────────────────────────────┐
  │  goal text  ──►  structured expectations                    │
  │  "finish intro chapter"                                     │
  │      ├─ likely tools:      Word, Docs, Zotero, PDF reader   │
  │      ├─ likely sources:    scholar.google, arxiv            │
  │      ├─ off-goal:          social, video, shopping          │
  │      ├─ output shape:      words added to one document      │
  │      └─ plausible size:    600–1200 words in 50 min         │
  └─────────────────────────────────────────────────────────────┘
                              │
  ┌── 2. EVIDENCE ────────────┴─────────────────────────────────┐
  │  attention   focus score, gaze, phases      (have it)       │
  │  direction   frontmost app, domain,         (have it,       │
  │              WINDOW TITLE                    unused)        │
  │  output      file mtimes, size deltas,      (missing —      │
  │              commits, keystroke volume       the new part)  │
  └─────────────────────────────────────────────────────────────┘
                              │
  ┌── 3. VERDICT ─────────────┴─────────────────────────────────┐
  │  contract × evidence ──► what actually happened             │
  └─────────────────────────────────────────────────────────────┘
                              │
  ┌── 4. MEMORY ──────────────┴─────────────────────────────────┐
  │  many sessions ──► weekly report, session planning,         │
  │                    a personal model of how you work         │
  └─────────────────────────────────────────────────────────────┘
```

---

## 1. Contract — turning a goal into expectations

One LLM call at session start. Input: the goal sentence, the task name, tags,
and the user's own focus/distraction app lists. Output: a small JSON contract.

```jsonc
{
  "restated_goal": "Write the introduction chapter of the thesis",
  "kind": "writing",
  "expected_tools":   ["word", "pages", "docs.google.com", "zotero"],
  "supporting":       ["scholar.google.com", "arxiv.org", "pdf"],
  "off_goal":         ["youtube.com", "instagram.com", "steam"],
  "output": {
    "type": "document",          // document | code | reading | design | admin
    "unit": "words",
    "plausible_range": [600, 1200],
    "artifact_hint": "thesis"    // matched loosely against window titles
  },
  "checkpoints": [
    { "at_pct": 50, "prompt": "Is the outline down?" }
  ],
  "confidence": "high"
}
```

Why an LLM rather than more keywords: the contract has to work for *"prepare the
pitch for Thursday"*, *"study anatomy chapter 4"*, *"do my taxes"* — an open set.
Keywords cannot cover an open set; that is what the current confidence collapse
is telling us.

**Cost is negligible.** One call per session, cacheable by goal text. A user
doing 3 sessions a day costs cents per month.

**Degrades safely.** No key, no network, or refused consent → fall back to
today's keyword profiles. The feature is additive, never load-bearing.

---

## 2. Evidence — the missing half

### 2a. Window titles (free, already collected, currently thrown away)

`activity.rs` already reports `window`. `thesis_intro_v3.docx — Word` tells us
the *artifact*, not just the app. That single field turns

> "you were in Word for 40 minutes"

into

> "you were in **thesis_intro_v3** for 40 minutes, and switched to
> **budget_2026.xlsx** for 6 of them"

This needs no new permission and no new code in the companion. It is the
highest-value-per-effort change on this page.

**Privacy:** window titles can contain sensitive text. They must stay local,
never be sent to an LLM, and be redactable — see the consent model below.

### 2b. Output evidence (new)

The user nominates a **project folder** per session (or once, per recurring
goal). The companion watches it and reports metadata only:

| Signal | How | Reads content? |
|---|---|---|
| files changed | mtime scan | no |
| growth | byte-size delta | no |
| word delta | word count of nominated doc, before/after | count only |
| commits | `git log` in the folder | message + stat only |
| keystroke volume | OS-level count per minute | **count only, never keys** |

That is enough to distinguish *"open in Word for 40 minutes"* from
*"the document grew by 900 words"*. It is the difference between attention and
work.

**Hard line:** never read file contents, never log keystrokes. Counts, sizes,
timestamps, names. If a signal cannot be gathered from metadata, it does not
get gathered.

### 2c. Self-report (one tap, high value)

At session end: **"Did you get what you came for?"** → yes / partly / no.

One tap, and it is the only ground truth in the whole system. Everything else
is inference. This label is what later lets the app learn which *measured*
patterns actually predict a session the user considers successful — without it,
the weekly report is just confident guessing.

---

## 3. Verdict — four outcomes, not one score

Attention and output are independent axes, and conflating them into one number
is what makes current focus apps feel hollow.

```
              output ▲
                     │
   FLOW              │              SCATTERED
   deep and produced │   produced, but attention was fragmented
                     │   → "it worked, but it cost you more than it should"
  ───────────────────┼───────────────────────────────►  attention
                     │
   SPINNING          │              DRIFT
   focused, nothing  │   neither
   came out          │
   → "concentrated   │   → the honest bad session
      on the wrong   │
      thing, or      │
      stuck"         │
```

**SPINNING is the insight no other tool gives you.** High focus, no output means
you were locked onto something that wasn't moving — the wrong task, a rabbit
hole, or genuinely stuck. Today the app would congratulate you for it.

---

## 4. Memory — where it stops being a timer

Once sessions carry `{contract, evidence, verdict, self-report}`:

- **Weekly report** — not "you focused 6h" but *"writing sessions produce ~40%
  more when they start before 11:00. Three of five afternoon sessions were
  SPINNING. Your 90-minute sessions produce no more than your 50-minute ones."*
- **Session planning** — *"you consistently plan 2× what fits. For this goal,
  50 minutes is realistic; here is where it fits today."*
- **Calibration** — the plausible-output ranges start as LLM guesses and get
  replaced by the user's own measured history. After ~20 sessions the app knows
  *your* pace, not a generic one.

This is the compounding asset. A competitor can clone the webcam in a weekend
(MediaPipe is open source). They cannot clone eight weeks of a specific
person's measured working rhythm.

---

## The decision that has to be made first

**Sending anything to an LLM conflicts with "nothing leaves your device."**
That claim is currently true and is a real part of the product's positioning.

| | reasoning quality | what leaves the device |
|---|---|---|
| A · cloud LLM, everything | best | goal + full activity log |
| B · local model | weak today | nothing |
| **C · cloud for the contract only** | **good** | **the goal sentence, once** |

**Recommendation: C.**

Send the *intention*, never the *evidence*. The goal sentence — "finish intro
chapter" — is one line the user typed on purpose. The activity log, window
titles and file names are the sensitive part, and they never leave.

Wording then stays honest and, more importantly, precise:

> Your camera never leaves your Mac. Your activity never leaves your Mac.
> If you turn on goal understanding, the one sentence you type as your goal is
> sent to an AI model to work out what the session needs. Nothing else.

Opt-in, off by default, and the app is fully functional without it.

---

## Build order

Each step ships alone and is useful alone.

1. **Window titles into the session record.** No permissions, no AI, no new
   dependency. Immediately upgrades every existing report from "which app" to
   "which artifact".
2. **End-of-session self-report.** One tap. Creates the ground truth everything
   later depends on. Start collecting it *before* it is needed.
3. **Output evidence via a watched folder.** The genuinely new signal. Start
   with file/size deltas and git; keystroke volume later if at all.
4. **The four-way verdict.** Only needs 1–3, no AI required. SPINNING alone is
   worth the feature.
5. **LLM contract.** Replaces the keyword profiles. Everything above already
   works without it, so this is an upgrade rather than a dependency.
6. **Weekly report and planning.** Needs history, so it lands last by nature.

Steps 1, 2 and 4 need no AI, no network and no new permissions — and they
already deliver "tracks *what* you focus on, not just *how much*."

## Open questions

- Does the watched folder need to be per-session, or per recurring goal?
- Keystroke volume: real signal, or a permission cost not worth paying?
- Should SPINNING interrupt live, or only appear in the debrief? Interrupting a
  focused person is exactly what the app exists to prevent.
- How much does the self-report bias itself? People rate a session they enjoyed
  as productive.
