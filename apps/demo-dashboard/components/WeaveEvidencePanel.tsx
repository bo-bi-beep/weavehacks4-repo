import type { ReplayCase } from "../lib/replay";

type WeaveEvidencePanelProps = {
  selectedCase: ReplayCase;
};

export function WeaveEvidencePanel({ selectedCase }: WeaveEvidencePanelProps) {
  return (
    <section className="panel evidence-panel">
      <div className="section-heading">
        <h2>Weave evidence</h2>
      </div>

      <div className="evidence-list">
        <EvidenceItem label="Trace ID" value={selectedCase.weave.traceId} />
        <EvidenceItem label="Call ID" value={selectedCase.weave.callId} />
        <EvidenceItem label="Operation" value={selectedCase.weave.opName} />
        <EvidenceItem label="Latency" value={`${selectedCase.weave.latencyMs} ms`} />
        <EvidenceItem label="Status" value={selectedCase.weave.status} />
      </div>

      <a className="weave-link" href={selectedCase.weave.url} target="_blank" rel="noreferrer">
        Open trace in W&B Weave
      </a>

      {selectedCase.patchNote ? (
        <div className="patch-note">
          <span>Patch note</span>
          <p>{selectedCase.patchNote}</p>
        </div>
      ) : null}
    </section>
  );
}

type EvidenceItemProps = {
  label: string;
  value: string;
};

function EvidenceItem({ label, value }: EvidenceItemProps) {
  return (
    <div className="evidence-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
