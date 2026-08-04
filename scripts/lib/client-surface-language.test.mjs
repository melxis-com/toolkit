import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../..', import.meta.url);
// fileURLToPath, not the URL's own pathname: a pathname keeps its
// percent-escapes, so a checkout under a path containing a space or a "%2F"
// resolves to a name that does not exist on disk, and every read here — the
// fixed files and the repo-wide walk below alike — fails with ENOENT instead
// of reporting drift.
const ROOT_DIR = fileURLToPath(ROOT);

const CLIENT_SURFACE_FILES = [
  'AGENTS.md',
  'README.md',
  'scripts/on_session_start.mjs',
  'scripts/on_stop.mjs',
  'scripts/on_task_completed.mjs',
  'scripts/on_user_prompt_submit.mjs',
  'scripts/precompact-capture.mjs',
  'skills/memory/SKILL.md',
  'skills/task/SKILL.md',
];

function readSurface() {
  return CLIENT_SURFACE_FILES.map((file) => ({
    file,
    text: readFileSync(join(ROOT_DIR, file), 'utf8'),
  }));
}

// --- the hive guide (map + rules merged into one control surface) ----------
//
// The server exposes one control surface per hive: the guide. The toolkit is
// the layer that tells an agent what to do with it, so its wording has to name
// the same tools and the same response shape the server actually has. A skill
// that still asks for a map and a rules document sends every install that
// loads it at tools which no longer exist.
//
// The guide is defined by boundaries, destinations and working style — never
// as an index. Describing the old map as "where things are" is what shrank it
// into a table of contents nobody could act on, and re-introducing that
// vocabulary would reproduce the same failure under a new name.

const memorySkill = () => readFileSync(join(ROOT_DIR, 'skills/memory/SKILL.md'), 'utf8');

// Control-surface wording that the guide replaced. General English ("a
// narrower rule than", `Array.prototype.map`, "Map of Content") is untouched
// on purpose: only phrasings that can only mean the old two-surface model are
// listed here.
const SUPERSEDED_CONTROL_SURFACE = [
  /\brules_(?:get|edit|patch)\b/,
  /project-orientation/i,
  /\borientation mels?\b/i,
  /\bhive rules\b/i,
  /\brules document\b/i,
  /\bmap and (?:its )?rules\b/i,
  /^- \*\*Map\*\*/m,
  /^- \*\*Rules\*\*/m,
];

// The rename is a hard cut: the server has no rules_* tools and no alias for
// them, so any surface that still names one hands the agent a call that fails.
// Word boundaries keep another server's tool name (`mcp__eslint__rules_get`,
// quoted in a hook comment as an example of what must NOT count as ours) and
// ordinary English ("Memory Operating Rules") out of it.
test('no client surface names a rules_* tool', () => {
  const violations = [];
  for (const { file, text } of readSurface()) {
    for (const match of text.matchAll(/\brules_(?:get|edit|patch)\b/g)) {
      violations.push(`${file}: ${match[0]}`);
    }
  }

  assert.deepEqual(violations, []);
});

// The guide replaced a surface that had shrunk into a list of what exists.
// Defining it as an index would rebuild that failure under the new name, so the
// definition sentences must speak of boundaries, destinations and working
// style. Only sentences that define or describe the guide are inspected — an
// unrelated mention of an index (a database index, "index/overview mels") is
// none of this test's business.
test('guide definitions avoid index vocabulary', () => {
  const DEFINES_GUIDE = [
    // Predicate form: "the guide is ...", "a hive's guide carries ...".
    /\b(?:the|a|its|hive'?s?|this)\s+(?:\*\*)?guide(?:\*\*)?\s+(?:is|means|carries|holds|says|describes|records)\b/i,
    // Glossary form: "- **Guide**: ...". This is the canonical definition and
    // the first one a reader meets, so leaving it outside the gate would let
    // the index framing back in through the one line most likely to be copied.
    /^[-*]?\s*(?:\*\*)?guide(?:\*\*)?:\s/i,
  ];
  const INDEX_VOCAB = /\bindex(?:es|ing)?\b|\bcatalog(?:ue)?s?\b|\btable of contents\b|\blisting of\b|索引/i;

  const violations = [];
  for (const { file, text } of readSurface()) {
    // Sentence-ish granularity: definitions live in one sentence, and a
    // paragraph-wide window would drag in neighbouring prose.
    for (const sentence of text.split(/(?<=[.!?])\s+|\n/)) {
      if (!DEFINES_GUIDE.some((pattern) => pattern.test(sentence))) continue;
      if (INDEX_VOCAB.test(sentence)) violations.push(`${file}: ${sentence.trim()}`);
    }
  }

  assert.deepEqual(violations, []);
});

// The old two-surface model was described on every client surface, not only in
// the two skills: the hook blocks, AGENTS.md and the README each carried their
// own copy of the map/rules prose. The `rules_*` gate above only catches literal
// tool names, so leftover prose ("that hive's map and its rules") survives it
// there. Comment lines are exempt: they explain to a maintainer what was
// removed and never reach an agent's context.
test('no client surface describes the superseded map/rules pair', () => {
  const violations = [];
  for (const { file, text } of readSurface()) {
    const agentFacing = text
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    for (const pattern of SUPERSEDED_CONTROL_SURFACE) {
      if (pattern.test(agentFacing)) violations.push(`${file}: ${pattern}`);
    }
  }

  assert.deepEqual(violations, []);
});

test('melxis-memory opens on the three kinds of memory a hive holds', () => {
  const text = memorySkill();

  // mel = facts (semantic), task = history (episodic), guide = how
  // (procedural). Memory is the genus; naming one species "memory" is what
  // made the guide read as optional decoration.
  assert.match(text, /memory is the genus/i);
  assert.match(text, /mels are facts/i);
  assert.match(text, /tasks are history/i);
  assert.match(text, /the guide is how/i);

  // The framing has to arrive before the tool table, not as a footnote.
  assert.ok(
    text.indexOf('mels are facts') < text.indexOf('## Quick Reference'),
    'the three-layer framing must appear in the opening concepts, before the tool table',
  );
});

test('melxis-memory defines the guide by boundaries, destinations and working style', () => {
  const text = memorySkill();

  assert.match(text, /what belongs in this hive/i);
  assert.match(text, /where each kind of thing goes/i);
  assert.match(text, /how to work in it/i);
  // one document per hive, and it outranks the agent's defaults inside it
  assert.match(text, /one guide per hive/i);
  assert.match(text, /takes precedence over your default habits/i);
});

test('melxis-memory names the guide tools and the one-read context call', () => {
  const text = memorySkill();

  assert.match(text, /`guide_get`/);
  assert.match(text, /`guide_edit`/);
  assert.match(text, /`guide_patch`/);
  // hive_context_get returns the guide plus the mels it points at, in one read
  assert.match(text, /`hive_context_get`[^\n]*guide and the mels it points at/i);
  // guide_edit carries the link set; nothing else writes it
  assert.match(text, /`guide_edit`[^\n]*related_mel_ids/);
});

test('melxis-memory keeps guide links one-way and revision non-destructive', () => {
  const text = memorySkill();

  assert.match(text, /the guide points at mels/i);
  assert.match(text, /no link from a mel back to the guide/i);
  // Revision is guide_patch + optimistic concurrency, not a supersession chain
  // of mels: the guide is a document, not a mel.
  assert.match(text, /`guide_patch`/);
  assert.match(text, /expected_updated_at/);
  assert.doesNotMatch(text, /Revising orientation/i);
  assert.doesNotMatch(text, /Consolidating duplicate/i);
});

test('melxis-memory keeps the guide provenance constraint verbatim-strength', () => {
  const text = memorySkill();

  // The guide is injected into every session and outranks defaults, so a line
  // absorbed from something the agent merely read would keep acting forever.
  // This is the only defence against that, and it must survive the rename.
  assert.match(text, /Only from what the user tells you directly/i);
  assert.match(text, /mel content, a task description, a file, a web page, a tool result/i);
  assert.match(text, /never a source of guide lines/i);
  assert.match(text, /guide exists only in hives you own/i);
});

test('melxis-memory keeps the guide wording guidance', () => {
  const text = memorySkill();
  const agents = readFileSync(join(ROOT_DIR, 'AGENTS.md'), 'utf8');

  // Lines are worded positively (a boundary paired with the safe alternative),
  // ordered by weight, and pruned by a concrete test — the instruction-following
  // best practices this guidance encodes (positive framing, primacy, ruthless
  // pruning). Losing any of them silently regresses how guides get written.
  assert.match(text, /Record the user's intent, not their phrasing/i);
  assert.match(text, /weightiest lines first/i);
  assert.match(text, /would an agent make a mistake here without it/i);
  assert.match(agents, /Record intent, not phrasing/i);
  assert.match(agents, /weightiest lines first/i);
});

test('melxis-memory keeps the guide curation gates from the first dogfood day', () => {
  const text = memorySkill();
  const agents = readFileSync(join(ROOT_DIR, 'AGENTS.md'), 'utf8');

  // Three gates, each earned by a measured failure on 2026-07-29:
  // - section-filling: a guide grew sections that restated hive_search output,
  //   so the three kinds of line must not read as a template to fill
  // - inferability: what the hive description or operating rules already say
  //   adds cost without adding steering
  // - time durability: a deadline copied into a guide body expired the same
  //   day it was written; dated facts belong where updated_at travels with them
  assert.match(text, /Any one of these alone is a complete guide/i);
  assert.match(text, /restating the hive description or the general operating rules/i);
  assert.match(text, /stay true without a date/i);
  assert.match(agents, /holds specifically in this hive and stays true without a date/i);
});

test('guide links carry the mel summary as the triage handle', () => {
  const text = memorySkill();
  const agents = readFileSync(join(ROOT_DIR, 'AGENTS.md'), 'utf8');

  // The link's job is to let an agent decide which mels to read without
  // fetching bodies. That handle is the mel's own summary (refined by the
  // service), never a curator-written annotation that goes stale (c284405d).
  assert.match(text, /the mel's summary — enough to decide which ones to read/i);
  assert.match(agents, /each with its summary, enough to decide which ones to read/i);
  assert.doesNotMatch(text, /why the guide points at it/i);
});

test('melxis-memory still bans index mels and keeps the MOC proper noun', () => {
  const text = memorySkill();

  // The guide is not a mel, so this rule does not collide with it.
  assert.match(text, /Do not create index\/overview mels/);
  // "Map of Content" is the Zettelkasten/LYT term for a hub mel — a proper
  // noun about the mel graph, not the old hive map. A rename sweep must not
  // take it with it.
  assert.match(text, /Map of Content/);
});

test('client surface avoids create-first Melxis memory/task wording', () => {
  const banned = [
    /MUST be `task_create`/i,
    /propose `task_create` BEFORE/i,
    /create the task retroactively/i,
    /create\/link mels/i,
    /Flow\s+.*save\s*\(mel_create\s*\+\s*mel_link_create\)/i,
  ];

  const violations = [];
  for (const { file, text } of readSurface()) {
    for (const pattern of banned) {
      if (pattern.test(text)) violations.push(`${file}: ${pattern}`);
    }
  }

  assert.deepEqual(violations, []);
});

test('UserPromptSubmit checkpoint recovery prefers existing mel refinement before creation', () => {
  const text = readFileSync(join(ROOT_DIR, 'scripts/on_user_prompt_submit.mjs'), 'utf8');

  assert.match(text, /search existing mels first/i);
  assert.match(text, /prefer \\?`mel_patch\\?` \/ \\?`mel_update\\?`/i);
  assert.match(text, /use \\?`mel_create\\?` only for genuinely new memory/i);
});

test('UserPromptSubmit checkpoint recovery preserves evidence status for uncertain signals', () => {
  const text = readFileSync(join(ROOT_DIR, 'scripts/on_user_prompt_submit.mjs'), 'utf8');

  assert.match(text, /user-reported observations need \\?`user-reported\\?` \+ \\?`needs-verification\\?`/i);
  assert.match(text, /hypotheses should become verification tasks/i);
});

test('UserPromptSubmit reminders prefer existing task before task_create', () => {
  const text = readFileSync(join(ROOT_DIR, 'scripts/on_user_prompt_submit.mjs'), 'utf8');

  assert.match(text, /If an existing task matches this work/i);
  assert.match(text, /If no existing task matches, call \\?`task_create\\?`/i);
});

test('Session bootstrap and prompt recovery form a compact session brief', () => {
  const sessionStart = readFileSync(join(ROOT_DIR, 'scripts/on_session_start.mjs'), 'utf8');
  const userPrompt = readFileSync(join(ROOT_DIR, 'scripts/on_user_prompt_submit.mjs'), 'utf8');
  for (const text of [sessionStart, userPrompt]) {
    assert.match(text, /session brief/i);
    assert.match(text, /hive_context_get/i);
    assert.match(text, /handoff/i);
    assert.match(text, /sort: "recency"/i);
    assert.match(text, /<inferred project name>/i);
    assert.doesNotMatch(text, /<cwd basename>|<repo name>|raw filesystem paths/i);
  }

  assert.match(userPrompt, /patch\/update before create/i);
  assert.match(userPrompt, /user-reported needs verification/i);
  assert.match(userPrompt, /hypotheses become verification tasks/i);
});

// AGENTS.md carries a third, independent copy of the same recall flow — the one
// Codex and other AGENTS.md-reading hosts get. It is not phrased like the hook
// blocks (no "session brief" / "handoff" wording), so only the call sequence is
// compared here. Without this, AGENTS.md is free to keep an older recall path
// while both hooks have already moved on, and nothing fails.
test('AGENTS.md describes the same recall call sequence as the hooks', () => {
  const agents = readFileSync(join(ROOT_DIR, 'AGENTS.md'), 'utf8');

  assert.match(agents, /hive_search/i);
  assert.match(agents, /hive_context_get/i);
  assert.match(agents, /sort="recency"|sort: "recency"/i);
  assert.match(agents, /<inferred project name>/i);
  // and has not reverted to the superseded path (fetching the map with mel_search)
  assert.doesNotMatch(agents, /tags=\["project-orientation"\]|tags: \["project-orientation"\]/i);
  assert.doesNotMatch(agents, /<cwd basename>|<repo name>|raw filesystem paths/i);

  // Hooks are opt-in on Codex: they need `codex features enable plugin_hooks`
  // plus a manual approval per hook, and changing a hook definition revokes
  // that approval until it is granted again. So a user can be fully set up and
  // still receive none of the hook text. Standing guidance therefore has to
  // exist in AGENTS.md as well — moving it into a hook block alone silently
  // drops it for everyone who has not opted in.
  assert.match(agents, /guide_edit/);
  assert.match(agents, /guide_patch/);

  // What the guide is, in the terms the server states it in, plus the two
  // constraints that make it safe to inject every session: it comes from the
  // user, and it exists only in hives you own.
  assert.match(agents, /what belongs in this hive/i);
  assert.match(agents, /where each kind of thing goes/i);
  assert.match(agents, /how to work in it/i);
  assert.match(agents, /Only what the user tells you directly/i);
  assert.match(agents, /guide exists only in hives you own/i);
  // re-read every session, so it stays short
  assert.match(agents, /keep it short|keep the guide short/i);
});

// README documents the same recall flow a fourth time, for readers who never
// see a hook or a skill body. It was the one copy no test looked at, so it kept
// describing the superseded orientation lookup after all three other surfaces
// had moved on — caught by review, not by any check.
test('melxis-task cross-references the hive guide', () => {
  // The guide governs task work too; this line is the only bridge from the
  // task skill to the hive's control surface, so its loss must fail loudly.
  const taskSkill = readFileSync(join(ROOT_DIR, 'skills/task/SKILL.md'), 'utf8');
  assert.match(taskSkill, /hive_context_get/);
  assert.match(taskSkill, /takes precedence over your default habits/);
});

test('README describes the current recall flow', () => {
  const readme = readFileSync(join(ROOT_DIR, 'README.md'), 'utf8');

  assert.match(readme, /hive_search/);
  assert.match(readme, /hive_context_get/);
  assert.doesNotMatch(readme, /orientation `mel_search`|tags=?\["project-orientation"\]/i);
  // hooks/codex-hooks.json has never existed; naming it sends readers to a file
  // that is not there.
  assert.doesNotMatch(readme, /codex-hooks/);

  // The guide is a third stored thing alongside mels and tasks, with its own
  // tools and its own precedence. Listing it as a feature without ever saying
  // what it is leaves a reader who only has the README unable to use it, so
  // require the concept and the provenance guarantee, not just the word.
  assert.match(readme, /\*\*guide\*\*/);
  assert.match(readme, /what belongs in this hive/i);
  assert.match(readme, /how to work in it/i);
  assert.match(readme, /The guide comes from you, not from what an agent read/i);

  // The three kinds of stored thing are named as such, so a reader learns the
  // vocabulary the tools use rather than three unrelated features.
  assert.match(readme, /\*\*mels\*\*/);
  assert.match(readme, /\*\*tasks\*\*/);
});

// --- the precedence ceiling -----------------------------------------------
//
// "The guide takes precedence over your default habits" was stated on every
// surface with no upper bound, so an agent reading only that sentence could
// rank a stored guide line above what the user is saying right now. Both
// reference surfaces state the bound explicitly (the AGENTS.md spec: "explicit
// user chat prompts override everything"; Claude Code: memory is "context, not
// enforced configuration"), and Melxis had no equivalent. The ceiling belongs
// next to the claim, because an agent that reads the claim may never reach the
// paragraph where the bound would otherwise live.

// Prose surfaces share one wording: AGENTS.md and both SKILL bodies are read
// end to end, and a reader who meets the rule twice in two vocabularies has to
// decide whether they are the same rule.
const CEILING_PROSE =
  /outranks your defaults, never the user: an explicit instruction in the conversation always takes precedence over the guide/i;
// Hook blocks are injected into every session, so they pay per byte and carry
// the short form.
const CEILING_SHORT = /an explicit user instruction in the conversation always overrides it/i;
// The README is read by a person deciding whether to install this, so the
// ceiling is stated as what it gives them, not as a caveat.
const CEILING_README = /what you say in the moment always comes first/i;

const PRECEDENCE_CEILING = {
  'AGENTS.md': CEILING_PROSE,
  'skills/memory/SKILL.md': CEILING_PROSE,
  'skills/task/SKILL.md': CEILING_PROSE,
  'README.md': CEILING_README,
  'scripts/on_session_start.mjs': CEILING_SHORT,
  'scripts/on_user_prompt_submit.mjs': CEILING_SHORT,
};

/**
 * Read one top-level template-literal constant out of a hook script. The hook
 * blocks are emitted exclusively (one per SessionStart source), so file-level
 * matching cannot tell whether a given branch carries a line.
 */
function hookBlock(text, name) {
  const match = new RegExp(`const ${name} = \`([\\s\\S]*?)(?<!\\\\)\`;`).exec(text);
  assert.ok(match, `${name} not found — the hook block was renamed or removed`);
  return match[1];
}

test('every surface that gives the guide precedence also states its ceiling', () => {
  const violations = [];
  for (const [file, ceiling] of Object.entries(PRECEDENCE_CEILING)) {
    const text = readFileSync(join(ROOT_DIR, file), 'utf8');
    // The claim itself must still be there — the ceiling is a bound on it, not
    // a replacement for it.
    if (!/takes precedence over (?:your|an agent's) default habits/i.test(text)) {
      violations.push(`${file}: lost the precedence claim`);
    }
    if (!ceiling.test(text)) violations.push(`${file}: no precedence ceiling`);
  }

  assert.deepEqual(violations, []);
});

// A long prose surface restates the claim more than once: once where the guide
// is defined in the glossary, and again at the top of the section an agent
// actually lands on when it looks up how to write a guide. File-level matching
// passes as soon as one copy carries the ceiling, and steering is read where
// the section is — so every restatement carries its own bound.
test('every restatement of the precedence claim carries its own ceiling', () => {
  const claim = /takes precedence over your default habits/g;
  const ceiling = new RegExp(CEILING_PROSE.source, 'gi');
  const violations = [];

  for (const file of ['AGENTS.md', 'skills/memory/SKILL.md', 'skills/task/SKILL.md']) {
    const text = readFileSync(join(ROOT_DIR, file), 'utf8');
    const claims = text.match(claim)?.length ?? 0;
    const ceilings = text.match(ceiling)?.length ?? 0;
    if (claims === 0) violations.push(`${file}: lost the precedence claim`);
    if (claims !== ceilings) {
      violations.push(`${file}: ${claims} precedence claim(s) but ${ceilings} ceiling(s)`);
    }
  }

  assert.deepEqual(violations, []);
});

// SessionStart emits exactly one block per session, chosen by `source`. A
// ceiling in the startup block alone never reaches a resumed session, so the
// two branches are checked separately — file-level matching would pass on one.
test('both SessionStart branches carry the precedence ceiling', () => {
  const text = readFileSync(join(ROOT_DIR, 'scripts/on_session_start.mjs'), 'utf8');

  assert.match(hookBlock(text, 'STARTUP_BLOCK'), CEILING_SHORT);
  assert.match(hookBlock(text, 'RESUME_BLOCK'), CEILING_SHORT);
});

// The UserPromptSubmit reminder is the recovery path for cleared/compacted
// context: the agent that receives it has, by construction, lost the session
// start blocks.
test('the UserPromptSubmit bootstrap reminder carries the precedence ceiling', () => {
  const text = readFileSync(join(ROOT_DIR, 'scripts/on_user_prompt_submit.mjs'), 'utf8');

  assert.match(hookBlock(text, 'BOOTSTRAP_TEMPLATE'), CEILING_SHORT);
});

// --- where a save goes when no own hive fits it ----------------------------
//
// Shared hives make recall work from day one, so an account looks healthy
// while every write path quietly has nowhere to go: mels, tasks and the guide
// all need a hive the account owns. The first cue fired only when the account
// owned nothing at all, which answered the rarer half of the problem: an
// account that already owns hives, none of them fitting the project in front
// of it, still had no rule — and a note belonging to no project had nowhere to
// land either way. The cue now generalises the condition (no fitting own hive,
// owning none at all being one case of that) and names the Default hive as the
// fallback inbox, while still keeping session start silent by firing at the
// first moment something is worth writing.
//
// Pinned verbatim: this is one sentence kept by hand in two hook files, and
// two hand-kept copies drift unless a test compares them to the same string.
// Surfaces render tool names as code spans, so backticks around them are
// optional in the needle — nothing else may vary.
const HIVE_CUE_SHORT_TEXT =
  "When a clear project has no fitting own hive (or you own none at all), propose creating one at the first save-worthy mel or task with hive_create — suggest a name (the project's own, e.g. the repo) and a one-line description; hive creation asks the user even under auto write policy — then write its first guide with guide_edit from the purpose the user just stated. A stray note that belongs to no project goes to the Default hive, the fallback inbox every account starts with (an argless hive_search lists every hive you can reach; `own` tells yours apart), not a project's home.";

const HIVE_CUE_SHORT = new RegExp(
  HIVE_CUE_SHORT_TEXT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(
    /(hive_create|guide_edit|hive_search)/g,
    '`?$1`?',
  ),
  'i',
);

// Per file, because the copies are independent: RULES_POINTER_BLOCK is local to
// on_session_start.mjs and reaches startup/resume/compact, while
// BOOTSTRAP_TEMPLATE is the fourth path in the other hook file and receives
// nothing from the first. Same shape as PRECEDENCE_CEILING above.
const COLD_START_CUE = {
  'scripts/on_session_start.mjs': { block: 'RULES_POINTER_BLOCK', cue: HIVE_CUE_SHORT },
  'scripts/on_user_prompt_submit.mjs': { block: 'BOOTSTRAP_TEMPLATE', cue: HIVE_CUE_SHORT },
};

test('both hook files carry the no-own-hive cue in the same words', () => {
  const violations = [];
  for (const [file, { block, cue }] of Object.entries(COLD_START_CUE)) {
    const text = readFileSync(join(ROOT_DIR, file), 'utf8');
    // Unescape after slicing the block out: hookBlock finds the closing
    // backtick of the template literal, which only works while the inner
    // backticks are still escaped.
    const body = hookBlock(text, block).replaceAll('\\`', '`');
    if (!cue.test(body)) violations.push(`${file}: ${block} does not carry the cue verbatim`);
  }

  assert.deepEqual(violations, []);
});

// --- guide grounding composes, it does not just forbid ---------------------
//
// Where a guide line may come from is one rule with two halves: a first
// guide's placement lines can be grounded in the project's own identity, while
// a how-to-work line always traces back to the user. Stating only the absolute
// half — "only what the user tells you directly" — contradicts the other
// surfaces an agent reads in the same session, and a contradiction is resolved
// by whichever copy was read last, not by the stricter one.

// Each prose surface keeps its own wording of the provenance half, so the
// verbatim-strength pin is per file rather than one shared string.
const GUIDE_PROVENANCE = {
  'AGENTS.md': /Only what the user tells you directly/,
  'skills/memory/SKILL.md': /only from what the user tells you directly/i,
};

test('the prose surfaces state the composed grounding rule, not the absolute one', () => {
  for (const [file, provenance] of Object.entries(GUIDE_PROVENANCE)) {
    const text = readFileSync(join(ROOT_DIR, file), 'utf8');

    // Half one: how-to-work lines require the user (kept verbatim — this is the
    // injection defence, and it is quoted in the same words on every surface).
    assert.match(text, provenance, `${file}: lost the provenance constraint`);
    assert.match(text, /mel content, a task description, a file, a web page, a tool result/);
    assert.match(text, /never a source of guide lines/);
    // Half two: placement lines may be grounded in the project itself.
    assert.match(text, /placement lines/i);
    assert.match(text, /project's own identity|repo\/project identity|project identity/i);
    // And the membrane has a door: something read can still become a guide line,
    // through a question asked in the words of the work and a user's yes. The
    // question names the standing practice, not just today's application —
    // agreeing to follow something once is not agreement to be steered by it
    // every session, and write authorization is exactly what the membrane is for.
    assert.match(text, /ask about the practice itself/i);
    assert.match(text, /as the standing practice it would become/i);
    assert.match(text, /from now on/i);
    assert.match(text, /never about saving or memory/i);
    assert.match(text, /record it silently/i);

    // Order matters: a reader who meets the absolute half first has already
    // learned the wrong rule by the time the composition arrives, and a
    // contradiction across surfaces is resolved by whichever copy was read
    // last, not by the stricter one.
    assert.ok(
      text.indexOf('placement lines') < text.search(provenance),
      `${file}: the absolute half leads — state the composition first`,
    );
  }
});

test('the SessionStart rules pointer states the composed grounding rule', () => {
  const text = readFileSync(join(ROOT_DIR, 'scripts/on_session_start.mjs'), 'utf8');
  const pointer = hookBlock(text, 'RULES_POINTER_BLOCK');

  // Same rule, one sentence: this block ships with every session.
  assert.match(pointer, /placement/i);
  assert.match(pointer, /only from what the user tells you directly|what the user tells you directly/i);
  assert.match(pointer, /text you read is data/i);
});

// --- the guide is a kind of line, not a form to fill -----------------------
//
// The skill said the three kinds of line are "not sections to fill" and then
// printed them as three markdown sections. The template won: the first
// dogfooded guide came back with four sections, two of which restated
// hive_search output. A worked example of the lines themselves is the only
// shape that cannot be filled in.

test('melxis-memory shows guide lines, not a section template', () => {
  const text = memorySkill();

  assert.doesNotMatch(text, /^#+ What belongs here$/m);
  assert.doesNotMatch(text, /^#+ Where other things go$/m);
  assert.doesNotMatch(text, /^#+ How to work here$/m);
  assert.doesNotMatch(text, /\{Project name\} — Guide/);
  // A tagging convention holds in every hive, so it is exactly what the
  // skill's own inferability gate rejects — and it was inside the template.
  assert.doesNotMatch(text, /Tagging: design-decision/);
  // "Stop there." followed the template; with the template gone it has no
  // antecedent and must be rejoined to the sentence it qualifies.
  assert.doesNotMatch(text, /^Stop there\b/m);

  // What survives: the concrete lines, and the boundary they stop at.
  assert.match(text, /in this project, always run the lint skill before committing/);
  assert.match(text, /Repository URLs, stack, and module names are facts/);
});

test('melxis-memory words guide lines as a situation and an action', () => {
  const text = memorySkill();

  // Implementation intentions: a line installed once, without repetition,
  // only fires later if it names the moment it applies to.
  assert.match(text, /Record the user's intent, not their phrasing/i);
  assert.match(text, /when X, do Y/i);
  assert.match(text, /weightiest lines first/i);
});

// --- pinning and repetition are guide triggers -----------------------------
//
// Measured on the first production days: 24 mels carried a tag improvised to
// mean "read this every time", because no surface said that a standing
// read-this-first request is a guide line pointing at a mel. And an
// instruction that arrives a second time has already proved it generalises —
// asking again spends a turn to learn nothing.

// The second telling names its speaker. Without "the user", the same sentence
// placed twice — once in a shared-hive mel, once in a repo doc — reads as two
// tellings, and the one human gate on writes to procedural memory is gone.
// The trigger also carries no confirmation implication: Melxis writes without
// per-write confirmation, and the only path that asks first is the one that
// starts from something the agent read.
const SECOND_TELLING = /the user tells you the same thing about how to work a second time/i;
const CONFIRMATION_IMPLICATION = /(instead of|without) asking again/i;

test('melxis-memory lists the pin request and the second telling as triggers', () => {
  const text = memorySkill();
  const start = text.indexOf('**When to write a line.**');
  const end = text.indexOf('**How to word a line.**');
  assert.ok(start !== -1 && end > start, 'the "When to write a line" list must exist');
  const triggers = text.slice(start, end);

  assert.match(triggers, /always start from/i);
  assert.match(triggers, /related_mel_ids/);
  assert.match(triggers, SECOND_TELLING);
  assert.doesNotMatch(triggers, CONFIRMATION_IMPLICATION);
});

test('AGENTS.md lists the pin request and the second telling as triggers', () => {
  const agents = readFileSync(join(ROOT_DIR, 'AGENTS.md'), 'utf8');

  assert.match(agents, /always start from/i);
  assert.match(agents, SECOND_TELLING);
  assert.doesNotMatch(agents, CONFIRMATION_IMPLICATION);
});

// --- resolving where a save goes ------------------------------------------
//
// Every recall path resolves an own anchor hive, and every write lands in one.
// An account with no hive that fits the work therefore reads shared knowledge
// and never saves anything: the memory loop never starts, and nothing on any
// surface says how it should. Session start is the wrong place to fix it —
// nothing is worth saving yet, so a prompt there is nagging. The moment is the
// first mel or task worth writing, which is why the cue belongs where an agent
// looks when it is about to create a hive, with the session-start flow only
// pointing forward to it. A note that belongs to no project needs no proposal
// at all: it goes to the Default hive, silently.
//
// The wording is pinned per surface, the same way the precedence ceiling is:
// the same rule is stated in the hook blocks, in AGENTS.md and in the skill,
// and three paraphrases of one rule read as three rules. Prose surfaces get
// the long form; the flow line and the hook blocks get the short one.

const HIVE_CUE_PROSE = `If a clear project is at hand but no own hive fits it — or hive_search returns no own hive at all — propose creating one at the first save-worthy mel or task with hive_create: suggest a name (the project's own name, such as the repo's) and a one-line description, and get the user's confirmation — hive creation asks even under auto write policy, because the hive's name and purpose are the user's to state. Then write its first guide with guide_edit from the purpose the user just stated. A stray note that belongs to no project goes to the Default hive instead — the fallback inbox every account starts with (if you need to find it, an argless hive_search lists every hive you can reach and \`own\` tells yours apart); it is a holding place, not a project's home.`;

const verbatim = (text) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

// Per-file dict rather than one shared pattern: each surface carries the form
// that fits how it is read, and a file that quietly switches to the other one
// (or to a paraphrase) has to fail here. The short form is HIVE_CUE_SHORT_TEXT,
// declared with the hook-block pin above — one string, so the AGENTS.md flow
// line and the two hook blocks cannot drift apart. The hook files themselves
// are pinned in on_user_prompt_submit.test.mjs, next to the rest of the
// hook-block assertions.
const HIVE_COLD_START = {
  'skills/memory/SKILL.md': verbatim(HIVE_CUE_PROSE),
  'AGENTS.md': verbatim(HIVE_CUE_SHORT_TEXT),
};

test('the prose surfaces carry the cold-start hive cue verbatim', () => {
  const violations = [];
  for (const [file, cue] of Object.entries(HIVE_COLD_START)) {
    const text = readFileSync(join(ROOT_DIR, file), 'utf8');
    if (!cue.test(text)) violations.push(`${file}: no cold-start hive cue`);
  }

  assert.deepEqual(violations, []);
});

// The superseded wording fired on one condition only — the account owns no
// hive at all — and said nothing about where a note with no project goes. Six
// hand-kept copies carry this rule, so a half-finished migration leaves an
// agent reading the narrow rule on one surface and the general one on another
// in the same session, and a contradiction is resolved by whichever copy was
// read last. The retired phrasings are therefore banned repo-wide rather than
// only on the surfaces the verbatim pins above cover: a stale copy in a README
// section, a hook comment or another test is the same failure.
//
// The last entry retires a wording that was wrong rather than narrow: an
// argless hive_search returns own and shared hives alike, so "lists your own
// hives" invites an agent to take a shared hive for one of its own and write
// there — the one thing the write scope forbids.
const RETIRED_HIVE_CUE = [
  /No own hive \(shared hives do not count\)/i,
  /If hive_search returns no own hive/i,
  /recall stays shared-only — and at the first save-worthy/i,
  /propose creating a hive with hive_create: suggest a name and a one-line description/i,
  /propose creating one with `?hive_create`? \(suggest a name and one-line description/i,
  /argless `?hive_search`? lists your own hives/i,
];

const SCANNED_EXTENSIONS = new Set(['.md', '.mjs', '.js', '.json', '.sh', '.yml', '.yaml', '.txt']);
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'assets']);

/** Every text file in the repository, so no surface is exempt by omission. */
function* textFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) yield* textFiles(path);
    } else if (SCANNED_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
      yield path;
    }
  }
}

test('no file still carries the retired no-own-hive-at-all wording', () => {
  // This file is the one exemption: it quotes the retired sentences in order
  // to ban them, and scanning itself would make the ban unstatable.
  const self = fileURLToPath(import.meta.url);
  const violations = [];

  for (const path of textFiles(ROOT_DIR)) {
    if (path === self) continue;
    const text = readFileSync(path, 'utf8');
    for (const pattern of RETIRED_HIVE_CUE) {
      if (pattern.test(text)) violations.push(`${relative(ROOT_DIR, path)}: ${pattern}`);
    }
  }

  assert.deepEqual(violations, []);
});

// Placement, not just presence: the cue is the answer to "when does this
// happen", so it has to open the section an agent lands on when it looks up
// hive_create — after the call example it reads as a footnote to a capability
// it has already decided to use.
test('the memory skill opens Create a hive with when it fires', () => {
  const text = memorySkill();
  const start = text.indexOf('### Create a hive');
  assert.ok(start !== -1, 'the "Create a hive" section must exist');
  const end = text.indexOf('\n### ', start + 1);
  const section = text.slice(start, end === -1 ? undefined : end);

  const cue = section.search(HIVE_COLD_START['skills/memory/SKILL.md']);
  assert.ok(cue !== -1, 'the "Create a hive" section must carry the cold-start cue');
  assert.ok(
    cue < section.indexOf('```'),
    'the cue must open the section, before the hive_create example',
  );

  // Creating the hive and writing its first guide are one move: the user has
  // just said what the hive is for, and that statement is the grounding a
  // first guide needs. The cue ends on guide_edit for the same reason, so
  // losing this hand-off would leave the two halves stated only once each.
  assert.match(section, /\*\*After hive_create, write the hive's guide\*\*/);
});

// Session start stays silent — but silence with no forward pointer is how the
// hole stayed open: an agent that reads "operate in shared-only mode" learns
// that owning no hive is a steady state, and never reaches the section that
// says it is not.
test('the session-start flow points from shared-only mode to hive creation', () => {
  const text = memorySkill();
  const step = text.split('\n').find((line) => /operate in shared-only mode/.test(line));
  assert.ok(step, 'the session-start flow must still describe shared-only mode');
  assert.match(step, /Create a hive/);

  // The pointer is a pointer: the flow must not restate the trigger here, or
  // session start becomes the moment the agent acts on it.
  assert.doesNotMatch(step, /hive_create/);
});

// --- a sub-task decision that changes the plan changes the parent ----------
//
// Observed: a sub-task recorded a decision that moved the parent's scope, the
// parent kept its old plan, and the next session resumed from a description
// that no longer described the work.
test('melxis-task sends plan-changing sub-task decisions back to the parent', () => {
  const taskSkill = readFileSync(join(ROOT_DIR, 'skills/task/SKILL.md'), 'utf8');

  assert.match(taskSkill, /changes the parent's plan/i);
  assert.match(taskSkill, /same turn/i);
});
