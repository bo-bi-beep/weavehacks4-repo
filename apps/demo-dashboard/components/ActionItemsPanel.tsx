"use client";

import { RobotIcon, UserIcon, WaveformIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  actionItems as initialActionItems,
  applyActionItemFix,
  filterVulnerabilities,
  getActionPanelSummary,
  sortVulnerabilities,
  vulnerabilities,
  type ActionItem,
  type ActionStatus,
  type Vulnerability,
  type VulnerabilityChatRole,
  type VulnerabilitySort,
} from "../lib/action-items";

const attackFamilies = ["all", ...Array.from(new Set(vulnerabilities.map((item) => item.attackFamily)))];
const systemTags = ["all", ...Array.from(new Set(vulnerabilities.flatMap((item) => item.systemTags)))];
const panelTransitionMs = 240;

const shortLabels: Record<string, string> = {
  all: "all",
  amount_boundary: "big loan",
  data_manipulation: "fake data",
  identity_confusion: "wrong user",
  immutable_field_mutation: "locked fields",
  normal_flow: "normal case",
  prompt_injection: "prompt trick",
  immutable_fields: "locked fields",
  loan_amount_validation: "loan amount",
  prompt_policy: "prompt rules",
  regression_control: "control case",
  scoring: "scoring",
  weave_trace: "Weave trace",
};

export function ActionItemsPanel() {
  const [items, setItems] = useState<ActionItem[]>(initialActionItems);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [selectedVulnerabilityId, setSelectedVulnerabilityId] = useState<string | null>(null);
  const [isVulnerabilityPanelOpen, setIsVulnerabilityPanelOpen] = useState(false);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  const [replayVulnerabilityId, setReplayVulnerabilityId] = useState<string | null>(null);
  const [attackFamily, setAttackFamily] = useState("all");
  const [systemTag, setSystemTag] = useState("all");
  const [sort, setSort] = useState<VulnerabilitySort>("severity");
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedAction =
    items.find((item) => item.id === selectedActionId) ?? null;
  const replayVulnerability =
    vulnerabilities.find((item) => item.id === replayVulnerabilityId) ?? null;

  const visibleVulnerabilities = useMemo(() => {
    const filtered = filterVulnerabilities(vulnerabilities, {
      attackFamily: attackFamily === "all" ? undefined : attackFamily,
      systemTag: systemTag === "all" ? undefined : systemTag,
      source: "real_weave_trace",
    });

    const related = selectedAction
      ? filtered.filter((item) => selectedAction.vulnerabilityIds.includes(item.id))
      : [];

    return sortVulnerabilities(related, sort);
  }, [attackFamily, selectedAction, sort, systemTag]);

  const summary = getActionPanelSummary(items, vulnerabilities);

  useEffect(() => {
    return () => clearCloseTimer();
  }, []);

  function clearCloseTimer() {
    if (!closeTimerRef.current) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function showFixProposal(actionItemId: string) {
    setActiveProposalId((current) => (current === actionItemId ? null : actionItemId));
  }

  function approveActionItem(actionItemId: string) {
    setItems((current) => applyActionItemFix(current, actionItemId));
    setActiveProposalId(null);
  }

  function selectAction(item: ActionItem) {
    clearCloseTimer();
    setSelectedActionId(item.id);
    setIsVulnerabilityPanelOpen(true);
    const firstRelatedVulnerability = vulnerabilities.find((vulnerability) =>
      item.vulnerabilityIds.includes(vulnerability.id),
    );
    setSelectedVulnerabilityId(firstRelatedVulnerability?.id ?? null);
  }

  function closeVulnerabilityPanel() {
    setIsVulnerabilityPanelOpen(false);
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setSelectedActionId(null);
      setSelectedVulnerabilityId(null);
      closeTimerRef.current = null;
    }, panelTransitionMs);
  }

  function selectVulnerability(item: Vulnerability) {
    setSelectedVulnerabilityId(item.id);
    setReplayVulnerabilityId(item.id);
    const firstRelatedAction = items.find((action) =>
      item.relatedActionItemIds.includes(action.id),
    );
    if (firstRelatedAction) setSelectedActionId(firstRelatedAction.id);
  }

  function closeReplay() {
    setReplayVulnerabilityId(null);
  }

  return (
    <main className="action-panel-shell">
      <section className="action-panel-hero">
        <div>
          <p className="eyebrow">Weave traces</p>
          <h1>Fix Queue</h1>
        </div>
        <div className="action-summary-grid" aria-label="Action panel summary">
          <SummaryPill label="To fix" value={summary.openActionItems.toString()} />
          <SummaryPill label="Fixed" value={summary.fixedActionItems.toString()} tone="success" />
          <SummaryPill label="Critical" value={summary.criticalVulnerabilities.toString()} tone="danger" />
          <SummaryPill label="Traces" value={summary.realTraceVulnerabilities.toString()} />
        </div>
      </section>

      <section
        className={`action-panel-grid ${
          selectedAction ? (isVulnerabilityPanelOpen ? "drilldown-open" : "drilldown-closing") : "queue-only"
        }`}
      >
        <section className="action-list-panel" aria-label="Action items">
          <div className="panel-heading-row">
            <div>
              <p className="eyebrow">Fix first</p>
              <h2>Action items</h2>
            </div>
            <span>{items.length} fixes</span>
          </div>

          <div className="action-item-list">
            {items.map((item, index) => (
              <article
                className={`action-item-card ${item.id === selectedAction?.id ? "selected" : ""} ${
                  item.id === activeProposalId ? "proposal-open" : ""
                }`}
                key={item.id}
              >
                <button className="card-select-button" type="button" onClick={() => selectAction(item)}>
                  <span className="item-index">{index + 1}</span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.rationale}</small>
                  </span>
                </button>
                <div className="compact-meta-row">
                  <SeverityBadge value={item.priority} />
                  <StatusBadge value={item.status} />
                  <button
                    className="inline-fix-button"
                    disabled={item.status === "fixed"}
                    type="button"
                    onClick={() => showFixProposal(item.id)}
                  >
                    {item.status === "fixed" ? "Done" : item.id === activeProposalId ? "Review" : "Fix"}
                  </button>
                </div>
                {item.id === activeProposalId ? (
                  <div className="fix-proposal-bubble" role="status">
                    <div>
                      <p className="proposal-label">Fix summary</p>
                      <ul>
                        {item.fixProposal.summary.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="proposal-pr-row">
                      <a href={item.fixProposal.prUrl} target="_blank" rel="noreferrer">
                        {item.fixProposal.prTitle}
                      </a>
                      <button type="button" onClick={() => approveActionItem(item.id)}>
                        Approve
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        {selectedAction ? (
          <section
            className={`vulnerability-list-panel ${
              isVulnerabilityPanelOpen ? "panel-entered" : "panel-closing"
            }`}
            aria-label="Vulnerabilities"
          >
            <div className="panel-heading-row">
              <div>
                <p className="eyebrow">Weave traces</p>
                <h2>Related vulnerabilities</h2>
              </div>
              <button className="panel-close-button" type="button" onClick={closeVulnerabilityPanel}>
                Close
              </button>
            </div>

            <div className="selected-action-strip">
              <strong>{selectedAction.title}</strong>
              <span>{visibleVulnerabilities.length} traces</span>
            </div>

            <div className="filter-row">
              <label>
                <span>Type</span>
                <select value={attackFamily} onChange={(event) => setAttackFamily(event.target.value)}>
                  {attackFamilies.map((family) => (
                    <option key={family} value={family}>
                      {shortLabel(family)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Area</span>
                <select value={systemTag} onChange={(event) => setSystemTag(event.target.value)}>
                  {systemTags.map((tag) => (
                    <option key={tag} value={tag}>
                      {shortLabel(tag)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Sort</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as VulnerabilitySort)}>
                  <option value="severity">severity</option>
                  <option value="affected_systems">area count</option>
                  <option value="status">fix status</option>
                </select>
              </label>
            </div>

            <div className="vulnerability-list">
              {visibleVulnerabilities.map((item) => (
                <article
                  className={`vulnerability-card ${
                    item.id === selectedVulnerabilityId ? "selected" : ""
                  } ${item.breached ? "breached" : ""}`}
                  key={item.id}
                >
                  <button className="vulnerability-main" type="button" onClick={() => selectVulnerability(item)}>
                    <div className="card-title-row">
                      <strong>{item.title}</strong>
                      <SeverityBadge value={item.severity} />
                    </div>
                    <p>{item.evidenceSnippet}</p>
                  </button>
                  <div className="card-footer-row">
                    <span>{shortLabel(item.attackFamily)}</span>
                    <span>{item.breached ? "breach" : "blocked"}</span>
                    <a href={item.weaveTraceUrl} target="_blank" rel="noreferrer">
                      Trace
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </section>

      {replayVulnerability ? (
        <section className="replay-overlay" aria-label="Vulnerability conversation replay">
          <button className="replay-backdrop" type="button" aria-label="Close replay" onClick={closeReplay} />
          <article className="replay-panel">
            <header className="replay-header">
              <div>
                <p className="eyebrow">Conversation replay</p>
                <h2>{replayVulnerability.title}</h2>
                <p>{replayVulnerability.evidenceSnippet}</p>
              </div>
              <button className="panel-close-button" type="button" onClick={closeReplay}>
                Close
              </button>
            </header>

            <div className="replay-meta-row">
              <SeverityBadge value={replayVulnerability.severity} />
              <span>{shortLabel(replayVulnerability.attackFamily)}</span>
              <span>{replayVulnerability.breached ? "breach" : "blocked"}</span>
              <a href={replayVulnerability.weaveTraceUrl} target="_blank" rel="noreferrer">
                Weave trace
              </a>
            </div>

            <div className="chat-replay-list">
              {replayVulnerability.discoveryChat
                .filter((turn) => turn.role !== "trace")
                .map((turn, index) => (
                  <div className={`chat-turn chat-turn-${turn.role}`} key={`${turn.role}-${index}`}>
                    <ChatAvatar role={turn.role} />
                    <div className="chat-bubble">
                      <span>{turn.speaker}</span>
                      <p>{turn.message}</p>
                    </div>
                  </div>
                ))}
            </div>
          </article>
        </section>
      ) : null}
    </main>
  );
}

type SummaryPillProps = {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "danger";
};

function SummaryPill({ label, value, tone = "neutral" }: SummaryPillProps) {
  return (
    <div className={`action-summary-pill action-summary-pill-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SeverityBadge({ value }: { value: string }) {
  return <span className={`severity-badge severity-badge-${value}`}>{value}</span>;
}

function StatusBadge({ value }: { value: ActionStatus }) {
  return <span className={`status-badge status-badge-${value}`}>{statusLabel(value)}</span>;
}

function ChatAvatar({ role }: { role: VulnerabilityChatRole }) {
  const Icon = role === "attacker" ? UserIcon : role === "loan_agent" ? RobotIcon : WaveformIcon;

  return (
    <span className={`chat-avatar chat-avatar-${role}`} aria-hidden="true">
      <Icon size={22} weight="duotone" />
    </span>
  );
}

function shortLabel(value: string) {
  return shortLabels[value] ?? value.replaceAll("_", " ");
}

function statusLabel(value: ActionStatus) {
  if (value === "open") return "todo";
  if (value === "in_progress") return "doing";
  if (value === "needs_review") return "review";
  return "done";
}
