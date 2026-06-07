import type {
  AttackKbSourceCategory,
  AttackKbStorageObjectType,
  EvidenceSourceType,
  SourceEvidence,
  SourceProvenance,
} from "../types.js";
import type { SourceDiscoveryCandidate, SourceRetrievalPacket } from "./types.js";

const USER_AGENT = "WeaveHacksAttackKBResearch/1.0 (+https://github.com/bo-bi-beep/weavehacks4-repo)";
const MAX_EXCERPT_CHARS = 640;
const MAX_SOURCE_TEXT_CHARS = 90_000;

export type PrefetchCandidate = SourceDiscoveryCandidate & {
  keywords: string[];
  description: string;
};

export type PrefetchResult = {
  retrievedSources: SourceRetrievalPacket[];
  discardedCandidates: Array<{ title: string; url: string; reason: string }>;
};

const DEFAULT_TARGETS: AttackKbStorageObjectType[] = [
  "vulnerability",
  "attack_pattern",
  "system_attack_pattern",
  "delivery_mode",
  "success_signal",
  "evidence_source",
];

const ALLOWED_HOST_SUFFIXES = [
  "nist.gov",
  "nvlpubs.nist.gov",
  "consumerfinance.gov",
  "federalreserve.gov",
  "ffiec.gov",
  "occ.treas.gov",
  "fanniemae.com",
  "selling-guide.fanniemae.com",
  "freddiemac.com",
];

export const OFFICIAL_PREFETCH_CANDIDATES: PrefetchCandidate[] = [
  {
    id: "nist-ai-rmf-framework-page",
    title: "NIST AI Risk Management Framework overview",
    url: "https://www.nist.gov/itl/ai-risk-management-framework",
    publisher: "NIST",
    category: "nist_ai_rmf_genai",
    sourceType: "standard",
    standardsRefs: ["NIST AI RMF 1.0", "Govern", "Map", "Measure", "Manage", "Trustworthy AI"],
    reason: "Official NIST AI risk-management source for AI system governance, measurement, trustworthiness, and risk management.",
    expectedExtractionTargets: DEFAULT_TARGETS,
    safetyNotes: "Use for defensive AI risk and synthetic evaluation curation only.",
    description: "NIST overview page for the AI Risk Management Framework and companion resources.",
    keywords: ["trustworthy", "risk management", "govern", "map", "measure", "manage", "secure and resilient", "privacy", "fair"],
  },
  {
    id: "nist-genai-profile-publication-page",
    title: "NIST AI RMF Generative AI Profile publication page",
    url: "https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence",
    publisher: "NIST",
    category: "nist_ai_rmf_genai",
    sourceType: "standard",
    standardsRefs: ["NIST AI 600-1", "Generative AI Profile", "AI RMF"],
    reason: "Official NIST publication page for GenAI-specific risk-management guidance.",
    expectedExtractionTargets: DEFAULT_TARGETS,
    safetyNotes: "Use for defensive GenAI risk-management curation only.",
    description: "NIST publication page for Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile.",
    keywords: ["generative artificial intelligence", "risks", "govern", "map", "measure", "manage", "trustworthy", "evaluation"],
  },
  {
    id: "cfpb-compliance-resources",
    title: "CFPB compliance resources",
    url: "https://www.consumerfinance.gov/compliance/compliance-resources/",
    publisher: "Consumer Financial Protection Bureau",
    category: "vendor_documentation",
    sourceType: "standard",
    standardsRefs: ["CFPB compliance resources", "ECOA", "FCRA", "consumer lending"],
    reason: "Official CFPB compliance index for consumer lending, equal credit opportunity, credit reporting, and personal financial data rights.",
    expectedExtractionTargets: DEFAULT_TARGETS,
    safetyNotes: "Use only for high-level compliance/evaluation vocabulary; no real lending advice.",
    description: "CFPB compliance resource index across consumer lending and other applicable requirements.",
    keywords: ["consumer lending", "credit reporting", "equal credit", "personal financial data", "compliance", "requirements"],
  },
  {
    id: "cfpb-regulation-b-1002",
    title: "CFPB Regulation B / ECOA 12 CFR Part 1002",
    url: "https://www.consumerfinance.gov/rules-policy/regulations/1002/",
    publisher: "Consumer Financial Protection Bureau",
    category: "vendor_documentation",
    sourceType: "standard",
    standardsRefs: ["Regulation B", "ECOA", "12 CFR Part 1002", "adverse action"],
    reason: "Official CFPB Regulation B text for equal credit opportunity and adverse-action concepts relevant to loan-agent evaluation.",
    expectedExtractionTargets: DEFAULT_TARGETS,
    safetyNotes: "Use for synthetic compliance evaluation only; no real credit-decision advice.",
    description: "Official CFPB interactive regulation page for Equal Credit Opportunity Act / Regulation B.",
    keywords: ["adverse action", "creditor", "applicant", "discrimination", "credit transaction", "notice", "equal credit"],
  },
  {
    id: "cfpb-ecoa-compliance-resource",
    title: "CFPB ECOA compliance resource",
    url: "https://www.consumerfinance.gov/compliance/compliance-resources/other-applicable-requirements/equal-credit-opportunity-act/",
    publisher: "Consumer Financial Protection Bureau",
    category: "vendor_documentation",
    sourceType: "standard",
    standardsRefs: ["ECOA", "equal credit opportunity", "CFPB compliance"],
    reason: "Official CFPB topic page for equal credit opportunity requirements and resources.",
    expectedExtractionTargets: DEFAULT_TARGETS,
    safetyNotes: "Use for synthetic equal-credit evaluation vocabulary only.",
    description: "CFPB compliance topic page for providing equal credit opportunities.",
    keywords: ["equal credit", "discrimination", "applicants", "credit", "compliance", "adverse action"],
  },
  {
    id: "cfpb-fcra-compliance-resource",
    title: "CFPB FCRA compliance resource",
    url: "https://www.consumerfinance.gov/compliance/compliance-resources/other-applicable-requirements/fair-credit-reporting-act/",
    publisher: "Consumer Financial Protection Bureau",
    category: "vendor_documentation",
    sourceType: "standard",
    standardsRefs: ["FCRA", "credit reporting", "CFPB compliance"],
    reason: "Official CFPB topic page for credit reporting requirements relevant to applicant-data handling and privacy boundaries.",
    expectedExtractionTargets: DEFAULT_TARGETS,
    safetyNotes: "Use for synthetic data-handling and credit-reporting evaluation only.",
    description: "CFPB compliance topic page for credit reporting requirements.",
    keywords: ["credit reporting", "consumer reports", "data", "dispute", "furnish", "privacy", "requirements"],
  },
  {
    id: "fannie-mae-du-risk-factors",
    title: "Fannie Mae DU risk factors evaluated",
    url: "https://selling-guide.fanniemae.com/sel/b3-2-03/risk-factors-evaluated-du",
    publisher: "Fannie Mae",
    category: "vendor_documentation",
    sourceType: "standard",
    standardsRefs: ["Fannie Mae Selling Guide", "Desktop Underwriter", "risk factors"],
    reason: "Official Fannie Mae selling-guide page with concrete automated-underwriting risk-factor vocabulary.",
    expectedExtractionTargets: DEFAULT_TARGETS,
    safetyNotes: "Use only for high-level synthetic loan-risk factor vocabulary; no real underwriting advice.",
    description: "Fannie Mae Selling Guide page describing risk factors evaluated by Desktop Underwriter.",
    keywords: ["risk factors", "credit history", "delinquent", "debt-to-income", "loan-to-value", "reserves", "underwriting"],
  },
];

function isAllowedUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function htmlTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/isu);
  return match ? decodeHtmlEntities(match[1].replace(/\s+/gu, " ").trim()) : undefined;
}

function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/giu, " ")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/giu, " ")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/giu, " ")
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/giu, " ")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/(p|li|h1|h2|h3|h4|tr|section|article|div)>/giu, "\n")
    .replace(/<[^>]+>/gu, " ");

  return decodeHtmlEntities(withoutNoise)
    .replace(/\r/gu, "\n")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function clipAround(text: string, index: number): string {
  const start = Math.max(0, index - Math.floor(MAX_EXCERPT_CHARS / 2));
  const end = Math.min(text.length, start + MAX_EXCERPT_CHARS);
  return text.slice(start, end).replace(/\s+/gu, " ").trim();
}

function extractEvidence(text: string, candidate: PrefetchCandidate, now: string): SourceEvidence[] {
  const lower = text.toLowerCase();
  const evidence: SourceEvidence[] = [];
  const used = new Set<string>();

  for (const keyword of candidate.keywords) {
    const index = lower.indexOf(keyword.toLowerCase());
    if (index < 0) continue;
    const excerpt = clipAround(text, index);
    const normalized = excerpt.slice(0, 160).toLowerCase();
    if (used.has(normalized)) continue;
    used.add(normalized);
    evidence.push({
      summary: `Official source excerpt around "${keyword}".`,
      excerpt,
      locator: `keyword:${keyword}`,
      confidence: 0.78,
      observedAt: now,
    });
    if (evidence.length >= 4) break;
  }

  if (evidence.length === 0 && text.length > 500) {
    evidence.push({
      summary: "Official source excerpt from beginning of fetched page.",
      excerpt: clipAround(text, 300),
      locator: "document-start",
      confidence: 0.62,
      observedAt: now,
    });
  }

  return evidence;
}

function sourceVersionFromHeaders(headers: Headers): string | undefined {
  const modified = headers.get("last-modified");
  if (modified) return `Last-Modified: ${modified}`;
  const etag = headers.get("etag");
  return etag ? `ETag: ${etag}` : undefined;
}

async function prefetchCandidate(candidate: PrefetchCandidate, now: string): Promise<{ packet?: SourceRetrievalPacket; discard?: { title: string; url: string; reason: string } }> {
  if (!isAllowedUrl(candidate.url)) {
    return { discard: { title: candidate.title, url: candidate.url, reason: "URL is outside the retrieval-only official-source allowlist." } };
  }

  const response = await fetch(candidate.url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.2",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    return { discard: { title: candidate.title, url: candidate.url, reason: `HTTP ${response.status} during trusted local prefetch.` } };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/pdf")) {
    return { discard: { title: candidate.title, url: candidate.url, reason: "PDF returned but this safe prefetch bridge currently extracts only HTML/text." } };
  }

  const raw = await response.text();
  const text = contentType.includes("html") ? htmlToText(raw) : raw.replace(/\s+/gu, " ").trim();
  if (text.length < 600) {
    return { discard: { title: candidate.title, url: candidate.url, reason: `Fetched text was too short for reliable curation (${text.length} chars).` } };
  }

  const evidence = extractEvidence(text.slice(0, MAX_SOURCE_TEXT_CHARS), candidate, now);
  if (evidence.length === 0) {
    return { discard: { title: candidate.title, url: candidate.url, reason: "No safe evidence excerpts were extracted." } };
  }

  const title = htmlTitle(raw) || candidate.title;
  const provenance: SourceProvenance = {
    category: candidate.category as AttackKbSourceCategory,
    originLabel: title,
    publisher: candidate.publisher,
    url: candidate.url,
    retrievedAt: now,
    retrievedBy: "import_script",
    sourceVersion: sourceVersionFromHeaders(response.headers),
    standardsRefs: candidate.standardsRefs,
  };

  return {
    packet: {
      candidate,
      retrievedAt: now,
      retrievalStatus: "retrieved",
      provenance,
      description: candidate.description,
      evidence,
      suggestedObjectTypes: candidate.expectedExtractionTargets,
      tags: ["trusted-local-prefetch", "official-source", "retrieval-only-bridge"],
      retrievalNotes: `Fetched by trusted local prefetch bridge. contentType=${contentType}; textChars=${text.length}; evidenceCount=${evidence.length}.`,
      safetyNotes: `${candidate.safetyNotes} Trusted local prefetch returned sanitized excerpts only; sandbox agents received no secrets, Redis credentials, or AUT access.`,
    },
  };
}

export function selectPrefetchCandidates(ids?: string[], limit?: number): PrefetchCandidate[] {
  const wanted = ids?.length ? OFFICIAL_PREFETCH_CANDIDATES.filter((candidate) => ids.includes(candidate.id ?? "")) : OFFICIAL_PREFETCH_CANDIDATES;
  return limit && limit > 0 ? wanted.slice(0, limit) : wanted;
}

export async function prefetchOfficialSources(options: { ids?: string[]; limit?: number } = {}): Promise<PrefetchResult> {
  const now = new Date().toISOString();
  const retrievedSources: SourceRetrievalPacket[] = [];
  const discardedCandidates: PrefetchResult["discardedCandidates"] = [];

  for (const candidate of selectPrefetchCandidates(options.ids, options.limit)) {
    try {
      const result = await prefetchCandidate(candidate, now);
      if (result.packet) retrievedSources.push(result.packet);
      if (result.discard) discardedCandidates.push(result.discard);
    } catch (error) {
      discardedCandidates.push({
        title: candidate.title,
        url: candidate.url,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { retrievedSources, discardedCandidates };
}
