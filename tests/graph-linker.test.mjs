import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  VERSION,
  USAGE_TEXT,
  normalizeSoftHyphens,
  normalizeUnicodeGraphKey,
  isTransientScratchNode,
  isXmlEntityCorrupted,
  getErrorFingerprint,
  buildDeduplicationPlan,
  classifyNodeDomain,
  determineSemanticRelation,
  evaluateVerifyInvariants,
  runVerifyJson
} from "../skill/agentmemory-graph-linker/scripts/graph-linker.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRAPH_LINKER_PATH = path.resolve(
  __dirname,
  "../skill/agentmemory-graph-linker/scripts/graph-linker.mjs"
);

test("normalizeSoftHyphens and normalizeUnicodeGraphKey normalize soft/non-breaking hyphens and zero-width chars", () => {
  assert.equal(normalizeSoftHyphens("agent\u2011memory\u00adlinker\u200b  v4"), "agent-memory-linker v4");
  assert.equal(normalizeSoftHyphens("foo\u2010bar\u2212baz\\"), "foo-bar-baz");
  assert.equal(normalizeUnicodeGraphKey("Smart\u2011AI\u2014Router"), "smart-ai-router");
});

test("isTransientScratchNode identifies scratch paths/artifacts and preserves valid nodes", () => {
  const scratchNodes = [
    { name: "" },
    { name: "/tmp/build-output.log" },
    { name: "/private/tmp/cache.json" },
    { name: "/Users/dev/.gemini/antigravity/brain/1/.system_generated/steps/2/output.txt" },
    { name: "/Users/dev/.user_uploaded/img.png" },
    { name: "media_170000_deadbeef.png" },
    { name: "task-9.log" },
    { name: "steps/4/output.txt" },
    { name: "obs_abc123" },
    { name: "cap_xyz789" },
    { name: "/var/folders/12/34/T/tmp.txt" },
    { name: "workspace" }
  ];
  for (const node of scratchNodes) {
    assert.equal(isTransientScratchNode(node), true, `expected scratch: ${node.name}`);
  }

  const validNodes = [
    { name: "router/smart-router.mjs" },
    { name: "Smart AI Router" },
    { name: "agentmemory-graph-linker" }
  ];
  for (const node of validNodes) {
    assert.equal(isTransientScratchNode(node), false, `expected valid: ${node.name}`);
  }
});

test("buildDeduplicationPlan merges \\u2011 duplicates preferring ASCII '-' and triggers singleNodeRenames on isolated \\u2011", () => {
  const nodes = [
    // Duplicate pair: ASCII '-' vs Unicode \u2011 (even if \u2011 has slightly higher degree, ASCII is preferred)
    { id: "n_uni", type: "concept", name: "smart\u2011router" },
    { id: "n_ascii", type: "concept", name: "smart-router" },
    // Isolated node with \u2011 -> should trigger singleNodeRenames
    { id: "n_iso", type: "tool", name: "edge\u2011compactor" },
    // Isolated XML-corrupted node -> should trigger singleNodeRenames
    { id: "n_xml", type: "concept", name: "A &amp;quot;B&amp;quot;" },
    // Clean isolated node -> should not be touched
    { id: "n_clean", type: "concept", name: "clean-node" }
  ];

  const degreeMap = new Map([
    ["n_uni", 3],
    ["n_ascii", 1],
    ["n_iso", 2],
    ["n_xml", 1],
    ["n_clean", 4]
  ]);
  const fixedNodeIds = new Set();

  const plan = buildDeduplicationPlan(nodes, degreeMap, fixedNodeIds);

  assert.equal(plan.mergeGroups.length, 1);
  assert.equal(plan.mergeGroups[0].canonicalNode.id, "n_ascii");
  assert.equal(plan.mergeGroups[0].canonicalName, "smart-router");
  assert.deepEqual(
    plan.mergeGroups[0].duplicates.map((d) => d.id),
    ["n_uni"]
  );

  assert.equal(plan.singleNodeRenames.length, 2);
  const renameById = new Map(plan.singleNodeRenames.map((r) => [r.node.id, r]));
  assert.equal(renameById.get("n_iso")?.oldName, "edge\u2011compactor");
  assert.equal(renameById.get("n_iso")?.newName, "edge-compactor");
  assert.equal(renameById.get("n_xml")?.newName, 'A "B"');
});

test("classifyNodeDomain and determineSemanticRelation classify domains and relations accurately", () => {
  assert.equal(
    classifyNodeDomain({ type: "file", name: "router/smart-router.mjs" }).id,
    "ai_models"
  );
  assert.equal(
    classifyNodeDomain({ type: "concept", name: "agentmemory sqlite metrics" }).id,
    "agentmemory"
  );
  assert.equal(
    classifyNodeDomain({ type: "concept", name: "Samsung Galaxy Z Fold 3 termux" }).id,
    "mobile_nodes"
  );
  assert.equal(
    classifyNodeDomain({ type: "file", name: "lib/main_screen.dart" }).id,
    "flutter_ui"
  );
  assert.equal(
    classifyNodeDomain({ type: "song", name: "Hollywood Tonight" }).id,
    "macos_audio"
  );
  assert.equal(
    classifyNodeDomain({ type: "tool", name: "git npm cli" }).id,
    "dev_tooling"
  );

  assert.equal(determineSemanticRelation({ type: "file", name: "router/smart-router.mjs" }), "modifies");
  assert.equal(determineSemanticRelation({ type: "file", name: "SKILL.md" }), "imports");
  assert.equal(determineSemanticRelation({ type: "file", name: "package.json" }), "depends_on");
  assert.equal(determineSemanticRelation({ type: "error", name: "xcodebuild not found" }), "causes");
  assert.equal(isXmlEntityCorrupted("foo &amp;bar"), true);
  assert.equal(
    getErrorFingerprint({ type: "error", name: "xcodebuild: error: unable to find utility" })?.fingerprint,
    "error_fp:xcodebuild_not_found"
  );
});

test("evaluateVerifyInvariants and runVerifyJson enforce non-destructive v4.0 verification gates", async () => {
  assert.equal(VERSION, "4.0");
  assert.equal(
    evaluateVerifyInvariants(
      { unlinkedCount: 0, globalDeg0Count: 0, incompleteRecords: 0, auditReducible: 0, truncated: true },
      false
    ).verified,
    true
  );
  assert.equal(
    evaluateVerifyInvariants(
      { unlinkedCount: 0, globalDeg0Count: 0, incompleteRecords: 0, auditReducible: 0, truncated: true },
      true
    ).verified,
    false
  );
  assert.equal(
    evaluateVerifyInvariants(
      { unlinkedCount: 1, globalDeg0Count: 0, incompleteRecords: 0, auditReducible: 0, truncated: false },
      false
    ).verified,
    false
  );

  const mockNodes = [
    { id: "n1", type: "project", name: "AgentMemory" },
    { id: "n2", type: "file", name: "router/smart-router.mjs" }
  ];
  const mockEdges = [
    { id: "e1", sourceNodeId: "n1", targetNodeId: "n2", type: "uses", isLatest: true }
  ];
  const mockEngine = {
    async kvList(bucket) {
      if (bucket === "mem:graph:nodes") return mockNodes;
      if (bucket === "mem:graph:edges") return mockEdges;
      return [];
    }
  };
  const makeMockFetch = (indexPayload) => async (url) => {
    if (url.endsWith("/agentmemory/graph/query")) {
      return {
        ok: true,
        async json() {
          return {
            nodes: mockNodes,
            edges: mockEdges,
            totalNodes: 2,
            totalEdges: 1,
            truncated: false
          };
        }
      };
    }
    if (url.endsWith("/agentmemory/graph/index")) {
      return {
        ok: true,
        async json() {
          return indexPayload;
        }
      };
    }
    if (url.endsWith("/agentmemory/graph/stats")) {
      return {
        ok: true,
        async json() {
          return { coverage: "complete" };
        }
      };
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  for (const indexPayload of [
    { ready: true, state: "ready", coverage: "complete", incompleteRecords: 0 },
    { ready: true, state: "ready", control: { incompleteRecords: 0 } }
  ]) {
    const report = await runVerifyJson(
      {
        engine: mockEngine,
        secret: "mock-secret",
        baseUrl: "http://mock.local",
        fetchImpl: makeMockFetch(indexPayload),
        maintenanceLockPath: path.join(os.tmpdir(), "nonexistent-lock-file.lock")
      },
      { strict: true }
    );

    assert.equal(report.status, "verified");
    assert.equal(report.version, "4.0");
    assert.equal(report.invariants.unlinkedCount, 0);
    assert.equal(report.invariants.globalDeg0Count, 0);
    assert.equal(report.invariants.incompleteRecords, 0);
    assert.equal(report.invariants.auditReducible, 0);
    assert.equal(report.invariants.truncated, false);
    assert.equal(report.checks.indexComplete, true);
    assert.equal(report.checks.strictBudgetOk, true);
  }
});

test("CLI --help prints v4.0 usage and unknown flags exit non-zero without touching live DB", async () => {
  const isolatedDataDir = path.join(os.tmpdir(), `agm-isolated-${process.pid}`);
  const isolatedEnv = {
    ...process.env,
    AGENTMEMORY_DATA_DIR: isolatedDataDir,
    AGENTMEMORY_SECRET: ""
  };

  const { stdout } = await execFileAsync(process.execPath, [GRAPH_LINKER_PATH, "--help"], {
    env: isolatedEnv
  });
  assert.match(stdout, /AgentMemory Graph Linker v4\.0/);
  assert.match(stdout, /--verify-json/);
  assert.match(stdout, /--simulate-budget/);
  assert.match(stdout, /--compact-edges/);
  assert.match(stdout, /--suggest-merges/);
  assert.match(stdout, /--merge-plan/);
  assert.match(stdout, /--suggest-links/);
  assert.match(stdout, /--apply-temporal/);
  assert.equal(stdout.trim(), USAGE_TEXT.trim());

  await assert.rejects(
    execFileAsync(process.execPath, [GRAPH_LINKER_PATH, "--not-a-valid-flag"], {
      env: isolatedEnv
    }),
    (err) => {
      assert.notEqual(err.code, 0);
      assert.match(err.stderr, /Unknown flag: --not-a-valid-flag/);
      assert.match(err.stderr, /AgentMemory Graph Linker v4\.0/);
      return true;
    }
  );
});
