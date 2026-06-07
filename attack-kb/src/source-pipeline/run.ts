import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { SubAgentService } from "../../../agents/sub_agents/index.js";
import { createAttackKbSandboxAgent } from "../sandbox.js";
import { ATTACK_KB_SOURCE_CATEGORIES, ATTACK_KB_STORAGE_OBJECT_TYPES } from "../types.js";
import type {
  AttackKbSourceCategory,
  AttackKbStorageObjectType,
  EvidenceSourceType,
  SourceEvidence,
  SourceProvenance,
} from "../types.js";
import { persistCuratedSourceArtifacts } from "./curator-storage.js";
import { asNumber, asOptionalString, asRecord, asString, asStringArray, extractJsonObject } from "./json.js";
import type {
  CredibilityTriageDecision,
  CredibilityTriagePacket,
  CuratedSourceArtifactInput,
  KbCuratorPacket,
  SourceDiscoveryCandidate,
  SourceDiscoveryPacket,
  SourceRetrievalPacket,
} from "./types.js";

const DEFAULT_MISSION =
  "Find one high-quality public defensive source for credit-loan agent adversary evaluation. Prefer standards, official guidance, or reputable AI-security benchmarks. Do not use hardcoded sample URLs from repo files.";

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value?.slice(prefix.length).trim();
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected positive integer, received ${value}`);
  }

  return parsed;
}

function isSourceCategory(value: string): value is AttackKbSourceCategory {
  return ATTACK_KB_SOURCE_CATEGORIES.includes(value as AttackKbSourceCategory);
}

function normalizeCategory(value: unknown): AttackKbSourceCategory {
  const category = asOptionalString(value) ?? "vendor_documentation";
  if (isSourceCategory(category)) {
    return category;
  }

  return "vendor_documentation";
}

function normalizeObjectTypes(value: unknown): AttackKbStorageObjectType[] {
  return asStringArray(value).filter((item): item is AttackKbStorageObjectType =>
    ATTACK_KB_STORAGE_OBJECT_TYPES.includes(item as AttackKbStorageObjectType),
  );
}

function normalizeSourceType(value: unknown): EvidenceSourceType {
  const normalized = asOptionalString(value) ?? "documentation";
  if (["standard", "paper", "documentation", "manual_seed", "run_outcome"].includes(normalized)) {
    return normalized as EvidenceSourceType;
  }

  return "documentation";
}

function normalizeCandidate(value: unknown, index: number): SourceDiscoveryCandidate {
  const item = asRecord(value, `candidate[${index}]`);
  const title = asString(item.title, `candidate[${index}].title`);
  const url = asString(item.url, `candidate[${index}].url`);
  return {
    id: asOptionalString(item.id) ?? `candidate-${index + 1}`,
    title,
    url,
    publisher: asOptionalString(item.publisher),
    category: normalizeCategory(item.category),
    sourceType: normalizeSourceType(item.sourceType),
    standardsRefs: asStringArray(item.standardsRefs),
    reason: asOptionalString(item.reason) ?? "Source Discovery selected this as a potentially useful defensive source.",
    expectedExtractionTargets: normalizeObjectTypes(item.expectedExtractionTargets),
    safetyNotes: asOptionalString(item.safetyNotes) ?? "Use only for defensive/synthetic Attack KB curation.",
  };
}

function normalizeEvidence(value: unknown): SourceEvidence[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const item = asRecord(entry, `evidence[${index}]`);
    return {
      summary: asString(item.summary, `evidence[${index}].summary`),
      excerpt: asOptionalString(item.excerpt),
      locator: asOptionalString(item.locator),
      confidence: Math.max(0, Math.min(1, asNumber(item.confidence, 0.5))),
      observedAt: asOptionalString(item.observedAt) ?? new Date().toISOString(),
    };
  });
}

function normalizeProvenance(value: unknown, candidate: SourceDiscoveryCandidate): SourceProvenance {
  const item = asRecord(value, "provenance");
  return {
    category: normalizeCategory(item.category ?? candidate.category),
    originLabel: asOptionalString(item.originLabel) ?? candidate.title,
    publisher: asOptionalString(item.publisher) ?? candidate.publisher,
    url: asOptionalString(item.url) ?? candidate.url,
    retrievedAt: asOptionalString(item.retrievedAt) ?? new Date().toISOString(),
    retrievedBy: "source_retrieval_agent",
    sourceVersion: asOptionalString(item.sourceVersion),
    standardsRefs: asStringArray(item.standardsRefs).length ? asStringArray(item.standardsRefs) : candidate.standardsRefs,
    license: asOptionalString(item.license),
  };
}

function normalizeDiscoveryPacket(value: unknown, runId: string, mission: string): SourceDiscoveryPacket {
  const root = asRecord(value, "SourceDiscoveryPacket");
  const candidates = Array.isArray(root.candidates)
    ? root.candidates.map(normalizeCandidate)
    : [];

  return {
    runId,
    generatedAt: new Date().toISOString(),
    mission,
    candidates,
    spawnRetrievalForCandidateIds: asStringArray(root.spawnRetrievalForCandidateIds).length
      ? asStringArray(root.spawnRetrievalForCandidateIds)
      : candidates.map((candidate) => candidate.id ?? candidate.url),
    notes: asOptionalString(root.notes),
  };
}

function normalizeRetrievalPacket(value: unknown, candidate: SourceDiscoveryCandidate): SourceRetrievalPacket {
  const root = asRecord(value, "SourceRetrievalPacket");
  const status = asOptionalString(root.retrievalStatus);
  const evidence = normalizeEvidence(root.evidence);
  return {
    candidate,
    retrievedAt: asOptionalString(root.retrievedAt) ?? new Date().toISOString(),
    retrievalStatus: status === "partial" || status === "failed" ? status : "retrieved",
    provenance: normalizeProvenance(root.provenance, candidate),
    description: asOptionalString(root.description) ?? candidate.reason,
    evidence,
    suggestedObjectTypes: normalizeObjectTypes(root.suggestedObjectTypes).length
      ? normalizeObjectTypes(root.suggestedObjectTypes)
      : candidate.expectedExtractionTargets,
    tags: ["live-retrieved", "source-retrieval-agent", ...asStringArray(root.tags)],
    retrievalNotes: asOptionalString(root.retrievalNotes) ?? "Retrieved by Source Retrieval agent.",
    safetyNotes: asOptionalString(root.safetyNotes) ?? "Use only for defensive/synthetic Attack KB curation.",
  };
}

function normalizeTriagePacket(value: unknown, runId: string, packets: SourceRetrievalPacket[]): CredibilityTriagePacket {
  const root = asRecord(value, "CredibilityTriagePacket");
  const decisions = Array.isArray(root.decisions) ? root.decisions : [];
  const byUrl = new Map(packets.map((packet) => [packet.candidate.url, packet]));

  return {
    runId,
    generatedAt: new Date().toISOString(),
    decisions: decisions.map((entry, index): CredibilityTriageDecision => {
      const item = asRecord(entry, `decisions[${index}]`);
      const candidateUrl = asString(item.candidateUrl, `decisions[${index}].candidateUrl`);
      const action = asOptionalString(item.action);
      const packet = byUrl.get(candidateUrl);
      return {
        candidateUrl,
        title: asOptionalString(item.title) ?? packet?.candidate.title ?? candidateUrl,
        action: action === "accept" || action === "reject" || action === "needs_review" ? action : "needs_review",
        score: Math.max(0, Math.min(1, asNumber(item.score, 0.5))),
        rationale: asOptionalString(item.rationale) ?? "Triage decision did not include a rationale.",
        safetyNotes: asOptionalString(item.safetyNotes) ?? "No safety notes provided.",
        requiredFixes: asStringArray(item.requiredFixes),
        approvedPacket: action === "accept" ? packet : undefined,
      };
    }),
  };
}

function normalizeCuratorPacket(value: unknown, runId: string): KbCuratorPacket {
  const root = asRecord(value, "KbCuratorPacket");
  const approved = Array.isArray(root.approvedSourceArtifacts) ? root.approvedSourceArtifacts : [];
  return {
    runId,
    generatedAt: new Date().toISOString(),
    approvedSourceArtifacts: approved.map((entry, index): CuratedSourceArtifactInput => {
      const item = asRecord(entry, `approvedSourceArtifacts[${index}]`);
      return {
        id: asOptionalString(item.id),
        title: asString(item.title, `approvedSourceArtifacts[${index}].title`),
        description: asString(item.description, `approvedSourceArtifacts[${index}].description`),
        category: normalizeCategory(item.category),
        sourceType: normalizeSourceType(item.sourceType),
        url: asString(item.url, `approvedSourceArtifacts[${index}].url`),
        provenance: normalizeProvenance(item.provenance, {
          title: asString(item.title, `approvedSourceArtifacts[${index}].title`),
          url: asString(item.url, `approvedSourceArtifacts[${index}].url`),
          category: normalizeCategory(item.category),
          sourceType: normalizeSourceType(item.sourceType),
          standardsRefs: [],
          reason: "Curator-approved source artifact.",
          expectedExtractionTargets: [],
          safetyNotes: "Curator-approved source artifact.",
        }),
        evidence: normalizeEvidence(item.evidence),
        suggestedObjectTypes: normalizeObjectTypes(item.suggestedObjectTypes),
        tags: ["source-pipeline", "kb-curator", ...asStringArray(item.tags)],
      };
    }),
    rejectedCandidateUrls: asStringArray(root.rejectedCandidateUrls),
    curatorNotes: asOptionalString(root.curatorNotes) ?? "KB Curator produced source artifacts for storage.",
  };
}

async function collectAgentReply(
  service: SubAgentService,
  agentId: string,
  message: string,
): Promise<string> {
  let final = "";
  for await (const event of service.sendMessage(agentId, message)) {
    if (event.type === "done") {
      final = event.finalOutput;
    }
    if (event.type === "error") {
      throw new Error(event.message);
    }
  }

  if (!final.trim()) {
    throw new Error("Agent did not return final output.");
  }

  return final;
}

function discoveryPrompt(runId: string, mission: string, maxCandidates: number): string {
  return `Manual Attack KB source pipeline run ${runId}.

Mission: ${mission}

Scope:
- You are Source Discovery only.
- Do not write Redis.
- Do not use repo hardcoded sample sources.
- Identify up to ${maxCandidates} public defensive sources suitable for credit-loan agent adversary-system curation.
- Do a lightweight availability check for each candidate URL when possible (HEAD/status/title only) and avoid obvious 404s.
- Do not retrieve full pages or extract evidence; just select candidates and explain why retrieval agents should fetch them.

Return strict JSON only:
{
  "candidates": [
    {
      "id": "short-stable-id",
      "title": "source title",
      "url": "https://...",
      "publisher": "publisher",
      "category": "owasp|mitre_atlas|nist_ai_rmf_genai|maestro_agentic_risk|research_paper|vendor_documentation|manual_observation",
      "sourceType": "standard|paper|documentation",
      "standardsRefs": ["..."],
      "reason": "why this source matters",
      "expectedExtractionTargets": ["vulnerability", "attack_pattern", "evidence_source"],
      "safetyNotes": "defensive/synthetic only"
    }
  ],
  "spawnRetrievalForCandidateIds": ["short-stable-id"],
  "notes": "brief"
}`;
}

function retrievalPrompt(runId: string, candidate: SourceDiscoveryCandidate): string {
  return `Manual Attack KB source pipeline run ${runId}.

You are Source Retrieval for exactly one candidate. Fetch and summarize this public defensive source only:
${JSON.stringify(candidate, null, 2)}

Scope:
- Do not write Redis.
- Do not contact the Agent Under Test.
- Retrieve the URL with shell tools if possible.
- If the assigned URL is broken, repair it by finding the current canonical URL for the same source/title/publisher; do not switch to an unrelated source.
- Extract short safe evidence excerpts only; do not include raw exploit payloads or actionable fraud/evasion instructions.

Return strict JSON only:
{
  "retrievedAt": "ISO timestamp",
  "retrievalStatus": "retrieved|partial|failed",
  "provenance": {
    "category": "${candidate.category}",
    "originLabel": "...",
    "publisher": "...",
    "url": "${candidate.url}",
    "retrievedAt": "ISO timestamp",
    "retrievedBy": "source_retrieval_agent",
    "sourceVersion": "optional visible version/date",
    "standardsRefs": ["..."],
    "license": "optional"
  },
  "description": "safe source summary",
  "evidence": [
    { "summary": "...", "excerpt": "short safe excerpt", "locator": "section/page locator", "confidence": 0.0, "observedAt": "ISO timestamp" }
  ],
  "suggestedObjectTypes": ["vulnerability", "attack_pattern", "evidence_source"],
  "tags": ["live-retrieved"],
  "retrievalNotes": "what was fetched and any limits",
  "safetyNotes": "why this is safe for defensive curation"
}`;
}

function triagePrompt(runId: string, packets: SourceRetrievalPacket[]): string {
  return `Manual Attack KB source pipeline run ${runId}.

You are Credibility Triage. Validate retrieved source packets before any Redis write.

Scope:
- Do not write Redis.
- Judge credibility, safety, relevance, and provenance.
- Accept only public defensive/reputable sources with usable safe evidence.
- Reject or mark needs_review if retrieval failed, provenance is weak, or content includes unsafe raw payloads/fraud guidance.

Packets:
${JSON.stringify(packets, null, 2)}

Return strict JSON only:
{
  "decisions": [
    {
      "candidateUrl": "https://...",
      "title": "...",
      "action": "accept|reject|needs_review",
      "score": 0.0,
      "rationale": "...",
      "safetyNotes": "...",
      "requiredFixes": []
    }
  ]
}`;
}

function curatorPrompt(runId: string, triage: CredibilityTriagePacket): string {
  const accepted = triage.decisions.filter((decision) => decision.action === "accept" && decision.approvedPacket);
  return `Manual Attack KB source pipeline run ${runId}.

You are KB Curator. Convert only triage-accepted retrieval packets into canonical source artifact inputs for the trusted local orchestrator to write to Redis Cloud.

Scope:
- Do not ask for Redis credentials.
- Do not write Redis yourself.
- Do not discover or retrieve new sources.
- Preserve provenance/evidence and add tags indicating live retrieval and triage approval.

Accepted packets:
${JSON.stringify(accepted, null, 2)}

Return strict JSON only:
{
  "approvedSourceArtifacts": [
    {
      "id": "source-live-stable-id",
      "title": "...",
      "description": "...",
      "category": "owasp|mitre_atlas|nist_ai_rmf_genai|maestro_agentic_risk|research_paper|vendor_documentation|manual_observation",
      "sourceType": "standard|paper|documentation",
      "url": "https://...",
      "provenance": { "category": "...", "originLabel": "...", "publisher": "...", "url": "https://...", "retrievedAt": "ISO timestamp", "retrievedBy": "source_retrieval_agent", "standardsRefs": ["..."] },
      "evidence": [ { "summary": "...", "excerpt": "short safe excerpt", "locator": "...", "confidence": 0.0, "observedAt": "ISO timestamp" } ],
      "suggestedObjectTypes": ["vulnerability", "attack_pattern", "evidence_source"],
      "tags": ["live-retrieved", "triage-approved", "manual-trigger"]
    }
  ],
  "rejectedCandidateUrls": [],
  "curatorNotes": "..."
}`;
}

async function writeRunArtifact(runDir: string, name: string, value: unknown): Promise<void> {
  await writeFile(path.join(runDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const runId = parseArg("run-id") || `source-run-${randomUUID()}`;
  const mission = parseArg("mission") || env("ATTACK_KB_SOURCE_PIPELINE_MISSION") || DEFAULT_MISSION;
  const maxCandidates = parsePositiveInteger(parseArg("max-candidates") || env("ATTACK_KB_SOURCE_PIPELINE_MAX_CANDIDATES"), 1);
  const maxRetrievals = parsePositiveInteger(parseArg("max-retrievals") || env("ATTACK_KB_SOURCE_PIPELINE_MAX_RETRIEVALS"), maxCandidates);
  const runDir = path.join(process.cwd(), ".tmp", "attack-kb-source-runs", runId);
  await mkdir(runDir, { recursive: true });

  const service = new SubAgentService();
  try {
    const discoveryAgent = await createAttackKbSandboxAgent("sourceDiscovery", {
      service,
      task: discoveryPrompt(runId, mission, maxCandidates),
      name: `Attack KB Source Discovery ${runId}`,
    });
    const discoveryRaw = await collectAgentReply(service, discoveryAgent.agent.id, discoveryPrompt(runId, mission, maxCandidates));
    const discovery = normalizeDiscoveryPacket(extractJsonObject(discoveryRaw), runId, mission);
    await writeRunArtifact(runDir, "01-discovery.json", discovery);
    await writeRunArtifact(runDir, "01-discovery.raw.txt", discoveryRaw);

    const selectedCandidateIds = new Set(discovery.spawnRetrievalForCandidateIds);
    const retrievalCandidates = discovery.candidates
      .filter((candidate) => selectedCandidateIds.has(candidate.id ?? candidate.url) || selectedCandidateIds.has(candidate.url))
      .slice(0, maxRetrievals);

    if (retrievalCandidates.length === 0) {
      throw new Error("Source Discovery returned no candidates selected for retrieval.");
    }

    const retrievalPackets: SourceRetrievalPacket[] = [];
    for (const [index, candidate] of retrievalCandidates.entries()) {
      const retrievalAgent = await createAttackKbSandboxAgent("sourceRetrieval", {
        service,
        task: retrievalPrompt(runId, candidate),
        name: `Attack KB Source Retrieval ${index + 1} ${runId}`,
      });
      const retrievalRaw = await collectAgentReply(service, retrievalAgent.agent.id, retrievalPrompt(runId, candidate));
      const packet = normalizeRetrievalPacket(extractJsonObject(retrievalRaw), candidate);
      retrievalPackets.push(packet);
      await writeRunArtifact(runDir, `02-retrieval-${index + 1}.json`, packet);
      await writeRunArtifact(runDir, `02-retrieval-${index + 1}.raw.txt`, retrievalRaw);
    }

    const triageAgent = await createAttackKbSandboxAgent("credibilityTriage", {
      service,
      task: triagePrompt(runId, retrievalPackets),
      name: `Attack KB Credibility Triage ${runId}`,
    });
    const triageRaw = await collectAgentReply(service, triageAgent.agent.id, triagePrompt(runId, retrievalPackets));
    const triage = normalizeTriagePacket(extractJsonObject(triageRaw), runId, retrievalPackets);
    await writeRunArtifact(runDir, "03-triage.json", triage);
    await writeRunArtifact(runDir, "03-triage.raw.txt", triageRaw);

    const curatorAgent = await createAttackKbSandboxAgent("kbCurator", {
      service,
      task: curatorPrompt(runId, triage),
      name: `Attack KB KB Curator ${runId}`,
    });
    const curatorRaw = await collectAgentReply(service, curatorAgent.agent.id, curatorPrompt(runId, triage));
    const curator = normalizeCuratorPacket(extractJsonObject(curatorRaw), runId);
    await writeRunArtifact(runDir, "04-curator.json", curator);
    await writeRunArtifact(runDir, "04-curator.raw.txt", curatorRaw);

    const persisted = await persistCuratedSourceArtifacts(curator.approvedSourceArtifacts);
    await writeRunArtifact(runDir, "05-persisted.json", persisted);

    console.log(
      JSON.stringify(
        {
          ok: true,
          runId,
          runDir,
          discovery: { candidates: discovery.candidates.length },
          retrieval: { packets: retrievalPackets.length },
          triage: {
            accepted: triage.decisions.filter((decision) => decision.action === "accept").length,
            needsReview: triage.decisions.filter((decision) => decision.action === "needs_review").length,
            rejected: triage.decisions.filter((decision) => decision.action === "reject").length,
          },
          curator: { approvedSourceArtifacts: curator.approvedSourceArtifacts.length },
          persisted,
        },
        null,
        2,
      ),
    );
  } finally {
    await service.closeAll();
  }
}

await main();
