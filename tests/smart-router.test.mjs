import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeUnicodeDashes,
  isNoisyScratchEntityName,
  sanitizeObservationOrSummaryXml,
  sanitizeGraphXmlOutput,
  inspectAndCleanResponse,
  buildLocalExtractiveFallback,
  selectTargetsForFormat,
  TARGETS,
  FAST_MODEL_ORDER,
  ACCURACY_MODEL_ORDER
} from "../router/smart-router.mjs";

test("normalizeUnicodeDashes normalizes NFKC, unicode dashes, zero-width chars, and whitespace", () => {
  const input = "agent\u2011memory\u2013graph\u2014linker\u2212v4\u00ad\u200b  \uff0d  test";
  assert.equal(normalizeUnicodeDashes(input), "agent-memory-graph-linker-v4- - test");
  assert.equal(normalizeUnicodeDashes("  foo\u2010bar\ufeff  "), "foo-bar");
  assert.equal(normalizeUnicodeDashes(null), "");
});

test("isNoisyScratchEntityName blocks scratch paths, hallucinations, and unmapped CJK while allowing clean entities", () => {
  const noisy = [
    "",
    "   ",
    "/tmp/scratch-output.log",
    "/private/tmp/build.txt",
    "/Users/dev/.gemini/antigravity/brain/abc/.system_generated/steps/1/output.txt",
    "/Users/dev/.user_uploaded/media_1234.png",
    "media_1700000_deadbeef.png",
    "task-42.log",
    "steps/7/output.txt",
    "/var/folders/xx/12345/T/tmpfile.json",
    "0xdeadbeef1234",
    "World War II",
    "German Invasion",
    "未知的随机实体"
  ];
  for (const name of noisy) {
    assert.equal(isNoisyScratchEntityName(name), true, `expected noisy: ${name}`);
  }

  const clean = [
    "router/smart-router.mjs",
    "skill/agentmemory-graph-linker/scripts/graph-linker.mjs",
    "AgentMemory",
    "graph-linker",
    "逆向工程"
  ];
  for (const name of clean) {
    assert.equal(isNoisyScratchEntityName(name), false, `expected clean: ${name}`);
  }
});

test("sanitizeObservationOrSummaryXml strips noisy files/concepts, normalizes dashes, and maps CJK canonicals", () => {
  const raw = [
    "<observation>",
    "  <title>Test</title>",
    "  <concepts>",
    "    <concept>graph\u2011linker</concept>",
    "    <concept>逆向工程</concept>",
    "    <concept>未知概念</concept>",
    "    <concept>World War II</concept>",
    "  </concepts>",
    "  <files>",
    "    <file>router/smart\u2011router.mjs</file>",
    "    <file>/tmp/ephemeral.log</file>",
    "    <file>/.system_generated/steps/5/output.txt</file>",
    "  </files>",
    "</observation>"
  ].join("\n");

  const cleaned = sanitizeObservationOrSummaryXml(raw);
  assert.match(cleaned, /<concept>graph-linker<\/concept>/);
  assert.match(cleaned, /<concept>Reverse Engineering<\/concept>/);
  assert.doesNotMatch(cleaned, /未知概念/);
  assert.doesNotMatch(cleaned, /World War II/);
  assert.match(cleaned, /<file>router\/smart-router\.mjs<\/file>/);
  assert.doesNotMatch(cleaned, /\/tmp\/ephemeral\.log/);
  assert.doesNotMatch(cleaned, /\.system_generated/);
});

test("sanitizeGraphXmlOutput cleans entity/relationship attributes, unescapes nested entities, and drops blocked edges", () => {
  const raw = [
    "<entities>",
    '  <entity name="agent\u2011memory &amp;amp; core" type="project"/>',
    '  <entity name="/tmp/bad\u2011file.txt" type="file"/>',
    '  <entity name="逆向工程" type="concept">details</entity>',
    '  <entity name="Adolf Hitler" type="person">noise</entity>',
    "</entities>",
    "<relationships>",
    '  <relationship source="agent\u2011memory &amp;amp; core" target="逆向工程" type="uses"/>',
    '  <relationship source="agent\u2011memory &amp;amp; core" target="/tmp/bad\u2011file.txt" type="modifies"/>',
    '  <relationship source="Adolf Hitler" target="逆向工程" type="related_to">bad edge</relationship>',
    "</relationships>"
  ].join("\n");

  const cleaned = sanitizeGraphXmlOutput(raw);
  assert.match(cleaned, /<entity name="agent-memory &amp; core" type="project"\/>/);
  assert.match(cleaned, /<entity name="Reverse Engineering" type="concept">details<\/entity>/);
  assert.match(
    cleaned,
    /<relationship source="agent-memory &amp; core" target="Reverse Engineering" type="uses"\/>/
  );
  assert.doesNotMatch(cleaned, /\/tmp\/bad/);
  assert.doesNotMatch(cleaned, /Adolf Hitler/);
});

test("selectTargetsForFormat separates fast vs accuracy tiers and excludes dead gemini-2.5-flash", () => {
  assert.equal(
    TARGETS.some((t) => t.model === "gemini-2.5-flash"),
    false,
    "TARGETS must not include dead gemini-2.5-flash"
  );
  assert.equal(FAST_MODEL_ORDER.includes("gemini-2.5-flash"), false);
  assert.equal(ACCURACY_MODEL_ORDER.includes("gemini-2.5-flash"), false);

  const fastTargets = selectTargetsForFormat("observation");
  assert.deepEqual(
    fastTargets.slice(0, 3).map((t) => t.model),
    ["gemini-3.1-flash-lite-preview", "gemini-flash-lite-latest", "openai/gpt-oss-20b"]
  );

  for (const fmt of ["summary", "graph", "entities", "temporal_graph"]) {
    const accTargets = selectTargetsForFormat(fmt);
    assert.deepEqual(
      accTargets.slice(0, 4).map((t) => t.model),
      ["gemini-3.8-flash", "gemini-flash-latest", "openai/gpt-oss-120b", "gemma-4-26b-a4b-it"],
      `expected accuracy-first chain for format=${fmt}`
    );
  }
});

test("inspectAndCleanResponse rejects truncated replies and cleans valid XML formats", () => {
  const truncated = JSON.stringify({
    choices: [{ finish_reason: "length", message: { content: "<observation><title>Cut" } }]
  });
  const truncRes = inspectAndCleanResponse(truncated, "observation");
  assert.equal(truncRes.ok, false);
  assert.equal(truncRes.reason, "finish_reason_length_truncated");

  const validGraph = JSON.stringify({
    choices: [
      {
        finish_reason: "stop",
        message: {
          content:
            '<thought>internal</thought><entities><entity name="/tmp/noise.txt" type="file"/><entity name="graph\u2011linker" type="tool"/></entities><relationships><relationship source="graph\u2011linker" target="/tmp/noise.txt" type="uses"/></relationships>'
        }
      }
    ]
  });
  const graphRes = inspectAndCleanResponse(validGraph, "entities");
  assert.equal(graphRes.ok, true);
  const parsed = JSON.parse(graphRes.data);
  const content = parsed.choices[0].message.content;
  assert.match(content, /<entity name="graph-linker" type="tool"\/>/);
  assert.doesNotMatch(content, /\/tmp\/noise\.txt/);
  assert.doesNotMatch(content, /<thought>/);
});

test("buildLocalExtractiveFallback <observation> extracts clean files, skips /tmp/, and never hardcodes ~/.agentmemory/.env", () => {
  const obsWithCleanAndNoisyFiles = buildLocalExtractiveFallback({
    messages: [
      {
        role: "system",
        content: "Extract an <observation> XML record for the tool event."
      },
      {
        role: "user",
        content: [
          "Tool: edit_file",
          "Updated router/smart\u2011router.mjs and skill/agentmemory-graph-linker/scripts/graph-linker.mjs.",
          "Ignored temp scratch /tmp/debug-run.log and /private/tmp/scratch.txt and task-12.log.",
          "Used `selectTargetsForFormat` with AgentMemory smart-router."
        ].join("\n")
      }
    ]
  });

  const parsedClean = JSON.parse(obsWithCleanAndNoisyFiles);
  const xmlClean = parsedClean.choices[0].message.content;
  assert.match(xmlClean, /<observation>[\s\S]*<\/observation>/);
  assert.match(xmlClean, /<file>router\/smart-router\.mjs<\/file>/);
  assert.match(xmlClean, /<file>skill\/agentmemory-graph-linker\/scripts\/graph-linker\.mjs<\/file>/);
  assert.doesNotMatch(xmlClean, /\/tmp\/debug-run\.log/);
  assert.doesNotMatch(xmlClean, /\/private\/tmp\/scratch\.txt/);
  assert.doesNotMatch(xmlClean, /task-12\.log/);
  assert.doesNotMatch(xmlClean, /\.agentmemory\/\.env/);
  assert.doesNotMatch(xmlClean, /<concept>agent-workflow<\/concept>/);

  const obsWithOnlyNoisyFiles = buildLocalExtractiveFallback({
    messages: [
      {
        role: "system",
        content: "Extract an <observation> XML record."
      },
      {
        role: "user",
        content: "Tool: run_command\nChecked /tmp/only-temp.txt and /var/folders/x/y/z.log"
      }
    ]
  });

  const parsedNoisyOnly = JSON.parse(obsWithOnlyNoisyFiles);
  const xmlNoisyOnly = parsedNoisyOnly.choices[0].message.content;
  assert.match(xmlNoisyOnly, /<files><\/files>/);
  assert.doesNotMatch(xmlNoisyOnly, /\.agentmemory\/\.env/);
  assert.doesNotMatch(xmlNoisyOnly, /<concept>agent-workflow<\/concept>/);
});
