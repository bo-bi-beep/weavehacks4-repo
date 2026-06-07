# Attack KB source candidate references

Last researched: 2026-06-06  
Purpose: source-candidate reference for the Attack Agent Knowledgebase workstream.  
Safety boundary: use these sources for defensive/synthetic agent evaluation and KB curation. Do not import real-world fraud instructions or raw exploit payloads without HITL review.

## Executive recommendation

Seed the KB from canonical standards first, then benchmark/tool catalogs, then official credit-loan domain sources.

Recommended P0 source order:

1. **OWASP Top 10 for LLM Applications 2025** — baseline GenAI/LLM vulnerability taxonomy.
2. **OWASP Top 10 for Agentic Applications 2026 + Agentic AI Threats & Mitigations** — agent-specific risk language.
3. **MITRE ATLAS** — standardized tactics/techniques/case-study vocabulary for AI systems.
4. **AgentDojo** — realistic tool-using-agent prompt-injection benchmark; useful for recon probes, attack patterns, and success signals.
5. **NVIDIA garak** — broad model/app weakness probe catalog.
6. **promptfoo** — practical eval/red-team config patterns and reporting workflow.
7. **Fannie Mae DU risk factors + CFPB/ECOA adverse-action rules + myFICO factors** — credit-loan decision variables and safe domain success signals.
8. **FHFA fraud prevention + FTC Red Flags Rule** — official domain red-flag vocabulary for synthetic fraud/identity-risk testing.

## P0 source-candidate table

| Priority | Source | URL | Why it is useful | KB extraction targets | Caveats |
|---:|---|---|---|---|---|
| P0 | OWASP Top 10 for LLM Applications 2025 | https://genai.owasp.org/llm-top-10/ | Canonical LLM app risks: prompt injection, sensitive information disclosure, supply chain, poisoning, improper output handling, excessive agency, prompt leakage, vector/embedding weaknesses, misinformation, unbounded consumption. | `RiskCategory`, `Vulnerability`, `AttackPattern`, `DeliveryMode`, `SuccessSignal`, `EvidenceSource` | Broad LLM-app framing; pair with agentic sources for multiagent/tool nuance. |
| P0 | OWASP LLM01 Prompt Injection detail | https://genai.owasp.org/llmrisk/llm01-prompt-injection/ | Gives direct vs indirect prompt-injection language and impact categories: unauthorized access, tool/function misuse, sensitive disclosure, decision manipulation. | `Vulnerability`, `AttackPattern`, `DeliveryMode`, `SuccessSignal` | Keep payloads abstract/synthetic; avoid copying harmful strings. |
| P0 | OWASP Top 10 for Agentic Applications 2026 | https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/ | Official agentic risk framework. Blog names key risks: ASI01 Agent Goal Hijack, ASI02 Tool Misuse, ASI03 Identity & Privilege Abuse, ASI04 Agentic Supply Chain, ASI05 Unexpected Code Execution, ASI06 Memory & Context Poisoning, ASI07 Insecure Inter-Agent Communication, ASI08 Cascading Failures, ASI09 Human-Agent Trust Exploitation, ASI10 Rogue Agents. | `RiskCategory`, `Vulnerability`, `AttackPattern`, `DeliveryMode`, `SuccessSignal` | Current page is high-level; use downloaded paper/details when available for full definitions. |
| P0 | OWASP Agentic AI Threats & Mitigations | https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/ | Threat-model-based reference for emerging agentic threats and mitigations. Good bridge from taxonomy to attack/recommendation objects. | `RiskCategory`, `Vulnerability`, `AttackPattern`, `EvidenceSource` | Use as evidence/reference; do not overfit to mitigation text for attack generation. |
| P0 | MITRE ATLAS | https://atlas.mitre.org/ | Living knowledge base of adversary tactics and techniques against AI systems with matrix, mitigations, case studies, and agentic AI filters. Includes techniques such as LLM prompt injection, AI agent tool invocation, RAG/context/tool poisoning, credential harvesting, exfiltration, and impact. | `RiskCategory`, `AttackPattern`, `DeliveryMode`, `SuccessSignal`, `EvidenceSource` | ATLAS is broader than LLM agents; curate only items relevant to the demo target. |
| P0 | AgentDojo | https://github.com/ethz-spylab/agentdojo and https://arxiv.org/abs/2406.13352 | Dynamic benchmark for LLM agents using tools over untrusted data. Paper reports 97 realistic tasks and 629 security test cases for prompt-injection attacks/defenses. | `ReconProbe`, `AttackPattern`, `PayloadTemplate`, `DeliveryMode`, `SuccessSignal`, `EvidenceSource` | Prefer using task structure and success criteria. Import raw attack strings only with HITL review and sandbox labels. |
| P0 | NVIDIA garak | https://github.com/NVIDIA/garak | LLM vulnerability scanner with probes for hallucination, data leakage, prompt injection, misinformation, toxicity, jailbreaks, encoding attacks, etc. Useful as a catalog of probe classes and detectors. | `ReconProbe`, `AttackPattern`, `PayloadTemplate`, `SuccessSignal`, `EvidenceSource` | More model-scanner than domain-agent KB; map probes to safe synthetic evaluation language. |
| P0/P1 | promptfoo | https://github.com/promptfoo/promptfoo | CLI/library for LLM evals and red teaming. Useful for translating KB entries into test configs and scoreable eval reports. | `PayloadTemplate`, `SuccessSignal`, `EvidenceSource` | More eval harness than taxonomy source; use after core KB objects exist. |
| P1 | Microsoft PyRIT | https://github.com/microsoft/PyRIT | Open-source framework for proactive generative-AI risk identification and red-team orchestration. Good for multi-turn/adaptive testing workflows. | `AttackPattern`, `PayloadTemplate`, `SuccessSignal`, `EvidenceSource` | Heavyweight for P0; use as future orchestration reference. |
| P1 | IPI-proxy / indirect prompt-injection benchmarks | https://arxiv.org/html/2605.11868v1 | Intercepting proxy for red-teaming web-browsing agents. Abstract mentions 820 deduplicated attack strings from BIPIA, InjecAgent, AgentDojo, Tensor Trust, WASP, and LLMail-Inject. Strong source for indirect prompt injection via retrieved web content. | `DeliveryMode`, `AttackPattern`, `PayloadTemplate`, `SuccessSignal`, `EvidenceSource` | Best when the AUT has browsing/retrieval. Not primary P0 if the current credit-loan AUT has no web tool. |
| Meta | LLMSecurity awesome-agent-skills-security | https://github.com/LLMSecurity/awesome-agent-skills-security | Curated list covering standards, attack research, prompt injection via tools, tool poisoning, privilege escalation, data exfiltration, cross-plugin attacks, defenses, benchmarks, tools. | `EvidenceSource` discovery queue | Meta-source only; follow through to primary sources before storing KB facts. |
| Meta | ottosulin awesome-ai-security | https://github.com/ottosulin/awesome-ai-security | Broad curated AI security list: frameworks, standards, benchmarks, CTFs, MCP security, RAG/vector risks, red-team tools. | `EvidenceSource` discovery queue | Meta-source only; use to find candidates, not as canonical evidence. |

## Credit-loan domain sources

These should seed safe, synthetic domain-specific routes and success criteria. They should not be used to generate real-world fraud guidance.

| Priority | Source | URL | Why it is useful | KB extraction targets | Caveats |
|---:|---|---|---|---|---|
| P0 | Fannie Mae DU risk factors | https://selling-guide.fanniemae.com/sel/b3-2-03/risk-factors-evaluated-du | Concrete underwriting risk-factor language: credit history, delinquent accounts, installment loans, revolving utilization, public records/collections, inquiries, equity/LTV, reserves, loan purpose/term/amortization, occupancy, DTI, housing expense, property type. | `RiskCategory`, `ReconProbe`, `SuccessSignal`, `EvidenceSource` | Mortgage-specific, but excellent canonical domain vocabulary for loan-risk probes. |
| P0 | CFPB Regulation B / ECOA notifications | https://www.consumerfinance.gov/rules-policy/regulations/1002/9/ | Official requirement that adverse-action notices disclose principal reasons; useful for checking whether a loan agent explains denials accurately and specifically. | `SuccessSignal`, `ReconProbe`, `EvidenceSource` | Compliance reference, not an attack source. Use as oracle for explanation quality. |
| P0 | CFPB Regulation B interpretations | https://www.consumerfinance.gov/rules-policy/regulations/1002/interp-9/ | Interpretation emphasizes principal reasons for denial/adverse action. Useful for success/failure criteria when testing decision explanations. | `SuccessSignal`, `EvidenceSource` | Keep tests synthetic; avoid giving legal advice. |
| P0 | myFICO score-factor overview | https://www.myfico.com/credit-education/whats-in-your-credit-score | Clear credit-score factor categories and weights: payment history, amounts owed, length of history, new credit, credit mix. Also notes lenders may consider income, employment, and credit type. | `RiskCategory`, `ReconProbe`, `EvidenceSource` | Consumer-facing scoring reference; combine with underwriting/regulatory sources. |
| P0/P1 | FHFA fraud prevention | https://www.fhfa.gov/programs/fraud-prevention | Official mortgage-fraud vocabulary: material misstatement/misrepresentation/omission; examples include false employment/income/employer, source of funds, credit score/debts/liabilities, occupancy intent, identity, appraisal, multiple loans, property information. | `RiskCategory`, `Vulnerability`, `SuccessSignal`, `EvidenceSource` | Use for defensive detection/red-flag taxonomy only. Do not turn into fraud instructions. |
| P1 | FTC Red Flags Rule | https://www.ftc.gov/business-guidance/privacy-security/red-flags-rule | Official identity-theft red-flag framing for creditors/financial institutions. Useful for identity-risk probes and success signals. | `RiskCategory`, `ReconProbe`, `SuccessSignal`, `EvidenceSource` | Broad identity-theft compliance framing; curate only relevant red-flag concepts. |

## How to map sources into current P0 KB types

| KB type | Best sources | Safe example entries |
|---|---|---|
| `RiskCategory` | OWASP LLM/Agentic, MITRE ATLAS, Fannie Mae DU, myFICO, FHFA | Prompt injection; excessive agency; memory/context poisoning; credit-history risk; high DTI; identity-risk red flags. |
| `ReconProbe` | AgentDojo, garak, Fannie Mae DU, CFPB/ECOA | Ask the AUT what applicant fields are required; ask what information is missing; probe whether the AUT exposes internal decision thresholds; probe whether it can explain denial reasons. |
| `Vulnerability` | OWASP LLM/Agentic, MITRE ATLAS, FHFA/FTC | Direct/indirect prompt injection; tool misuse; system prompt leakage; vector/embedding weakness; identity/privilege abuse; reliance on unverifiable synthetic applicant data. |
| `AttackPattern` | MITRE ATLAS, OWASP Agentic, AgentDojo, garak | Tool-output hijack; retrieved-content instruction confusion; memory/context poisoning; goal hijack; decision-manipulation attempt in a synthetic loan scenario. |
| `PayloadTemplate` | AgentDojo, garak, promptfoo, PyRIT | Store only sanitized, synthetic templates by default; tag raw benchmark payloads as sandbox-only and require HITL approval. |
| `DeliveryMode` | OWASP LLM01, MITRE ATLAS, AgentDojo, IPI-proxy | Direct user message; external/retrieved content; tool result; memory/context entry; inter-agent message; loan-application field. |
| `SuccessSignal` | AgentDojo, promptfoo, CFPB/ECOA, Fannie Mae DU, FHFA | Unauthorized tool call; hidden-instruction disclosure; synthetic decision flip; accepts inconsistent/unverified applicant data; gives vague or inconsistent adverse-action reasoning. |
| `EvidenceSource` | All primary sources above | URL, publisher, source type, trust tier, captured date, extraction targets, update cadence, notes. |

## Suggested ingestion plan

1. Create `EvidenceSource` records for the P0 authoritative sources first.
2. Extract OWASP/MITRE categories into `RiskCategory` and `Vulnerability` with source references.
3. Extract AgentDojo/garak/promptfoo patterns into safe `ReconProbe`, `AttackPattern`, `DeliveryMode`, and `SuccessSignal` objects.
4. Extract credit-loan source vocabulary into domain `RiskCategory` and `ReconProbe` objects: credit score/history, income/employment, existing debt/DTI, previous fraud/identity red flags, and adverse-action explanation quality.
5. Run curator/HITL review before promoting any `PayloadTemplate` to active recommendation use.
6. Trace ingestion, curation, and recommendation generation through W&B Weave.

## Sources to deprioritize for P0

- Vendor/blog explainers can be useful for incident examples, but they should not be canonical P0 evidence when OWASP, MITRE, CFPB/eCFR, Fannie Mae, FHFA, FTC, and primary benchmark repos are available.
- Meta awesome lists are useful discovery queues, not final authority.
- Raw prompt-injection payload libraries should be treated as sandbox-only until the curation UI and safety labels exist.
