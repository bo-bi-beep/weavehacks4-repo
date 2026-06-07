export function renderCurationUiHtml(): string {
  return String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Attack KB Curation</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #0f172a; color: #e2e8f0; }
    header { padding: 20px 24px; border-bottom: 1px solid #243047; background: #111827; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    h2, h3 { margin: 0 0 10px; }
    p { color: #a7b5ca; }
    main { display: grid; grid-template-columns: 360px minmax(0, 1fr); min-height: calc(100vh - 88px); }
    aside { border-right: 1px solid #243047; padding: 16px; overflow: auto; }
    section { padding: 16px; overflow: auto; }
    button, select, input, textarea { border: 1px solid #334155; border-radius: 8px; background: #172033; color: #e2e8f0; padding: 8px 10px; }
    button { cursor: pointer; font-weight: 700; }
    button.primary { background: #2563eb; border-color: #3b82f6; }
    button.danger { background: #7f1d1d; border-color: #b91c1c; }
    button.good { background: #166534; border-color: #22c55e; }
    button.warn { background: #854d0e; border-color: #eab308; }
    textarea { width: 100%; min-height: 110px; box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .card { border: 1px solid #26354f; border-radius: 12px; background: #111827; margin: 0 0 12px; padding: 12px; }
    .candidate { cursor: pointer; }
    .candidate:hover, .candidate.selected { border-color: #60a5fa; background: #12213b; }
    .muted { color: #94a3b8; font-size: 13px; }
    .pill { display: inline-flex; gap: 4px; align-items: center; padding: 2px 8px; border-radius: 999px; background: #1e293b; color: #cbd5e1; font-size: 12px; margin: 2px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
    pre { white-space: pre-wrap; word-break: break-word; background: #020617; border: 1px solid #1e293b; padding: 10px; border-radius: 8px; max-height: 380px; overflow: auto; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .error { color: #fecaca; background: #450a0a; border: 1px solid #991b1b; padding: 10px; border-radius: 8px; }
    .ok { color: #bbf7d0; background: #052e16; border: 1px solid #166534; padding: 10px; border-radius: 8px; }
    label { display: block; color: #cbd5e1; margin: 10px 0 6px; font-weight: 700; }
    details { margin: 8px 0; }
    summary { cursor: pointer; color: #bfdbfe; font-weight: 700; }
  </style>
</head>
<body>
  <header>
    <h1>Attack KB human-in-the-loop curation</h1>
    <div class="muted">Review ingested source/data candidates, inspect provenance/evidence, run deterministic auto-review, then accept/reject/edit/merge. Decisions are persisted as canonical Attack KB objects and traced to Weave when WANDB_API_KEY is configured.</div>
  </header>
  <main>
    <aside>
      <div class="toolbar">
        <select id="statusFilter">
          <option value="pending">Pending</option>
          <option value="all">All</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="merged">Merged</option>
        </select>
        <button id="refreshBtn">Refresh</button>
      </div>
      <div id="candidateList" style="margin-top: 12px;"></div>
    </aside>
    <section>
      <div id="message"></div>
      <div id="detail"><p>Select a candidate to review.</p></div>
    </section>
  </main>
<script>
const state = { candidates: [], selectedId: undefined, selected: undefined };
const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

function jsonBlock(value) {
  return '<pre>' + escapeHtml(JSON.stringify(value, null, 2)) + '</pre>';
}

function pills(values) {
  return (values || []).map((value) => '<span class="pill">' + escapeHtml(value) + '</span>').join(' ');
}

function showMessage(text, kind = 'ok') {
  $('message').innerHTML = text ? '<div class="' + kind + '">' + escapeHtml(text) + '</div>' : '';
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error || ('HTTP ' + response.status));
  return body;
}

function renderList() {
  const list = $('candidateList');
  if (!state.candidates.length) {
    list.innerHTML = '<div class="card muted">No candidates for this filter.</div>';
    return;
  }
  list.innerHTML = state.candidates.map((context) => {
    const candidate = context.candidate.payload;
    const confidence = context.confidence.averageConfidence;
    return '<div class="card candidate ' + (candidate.id === state.selectedId ? 'selected' : '') + '" data-id="' + escapeHtml(candidate.id) + '">' +
      '<strong>' + escapeHtml(context.sourceObject?.title || context.candidate.title) + '</strong>' +
      '<div class="muted">' + escapeHtml(candidate.id) + '</div>' +
      '<div>' + pills([candidate.status, candidate.sourceCategory, candidate.candidateType]) + '</div>' +
      '<div class="muted">confidence: ' + escapeHtml(confidence == null ? 'n/a' : Math.round(confidence * 100) + '%') + ' · reviews: ' + context.reviewHistory.length + '</div>' +
    '</div>';
  }).join('');
  list.querySelectorAll('.candidate').forEach((node) => node.addEventListener('click', () => loadDetail(node.dataset.id)));
}

async function loadCandidates() {
  showMessage('');
  const status = $('statusFilter').value;
  const body = await api('/api/candidates?status=' + encodeURIComponent(status));
  state.candidates = body.candidates;
  renderList();
  if (state.selectedId && state.candidates.some((context) => context.candidate.payload.id === state.selectedId)) {
    await loadDetail(state.selectedId);
  } else {
    state.selectedId = undefined;
    state.selected = undefined;
    $('detail').innerHTML = '<p>Select a candidate to review.</p>';
  }
}

async function loadDetail(id) {
  const body = await api('/api/candidates/' + encodeURIComponent(id));
  state.selectedId = id;
  state.selected = body.candidate;
  renderList();
  renderDetail();
}

function renderProposals(context) {
  if (!context.proposedObjects.length) return '<div class="muted">No proposed canonical objects for this candidate.</div>';
  return context.proposedObjects.map((object) =>
    '<label class="row"><input type="checkbox" class="proposalCheck" value="' + escapeHtml(object.id) + '" checked />' +
    '<span class="pill">' + escapeHtml(object.objectType) + '</span><strong>' + escapeHtml(object.title) + '</strong></label>' +
    '<details><summary>JSON</summary>' + jsonBlock(object) + '</details>'
  ).join('');
}

function renderDetail() {
  const context = state.selected;
  const candidate = context.candidate.payload;
  const source = context.sourceObject;
  const latestReview = context.reviewHistory[context.reviewHistory.length - 1];
  const mergeTargets = context.relatedArtifacts
    .filter((item) => !['source', 'candidate', 'review_history'].includes(item.relationship))
    .map((item) => item.object);
  $('detail').innerHTML =
    '<div class="toolbar">' +
      '<button id="autoReviewBtn" class="primary">Run auto-review</button>' +
      '<button id="acceptBtn" class="good">Accept selected</button>' +
      '<button id="rejectBtn" class="danger">Reject</button>' +
      '<button id="editBtn" class="warn">Edit + accept JSON</button>' +
      '<button id="mergeBtn">Merge</button>' +
    '</div>' +
    '<div class="grid" style="margin-top: 12px;">' +
      '<div class="card">' +
        '<h2>' + escapeHtml(source?.title || context.candidate.title) + '</h2>' +
        '<div>' + pills([candidate.status, candidate.sourceCategory, candidate.candidateType, candidate.triggeredBy]) + '</div>' +
        '<p>' + escapeHtml(candidate.reason) + '</p>' +
        '<div class="muted">Candidate ' + escapeHtml(candidate.id) + ' · object ' + escapeHtml(candidate.objectRef.storageType + '/' + candidate.objectRef.id) + '</div>' +
      '</div>' +
      '<div class="card">' +
        '<h3>Confidence & evidence</h3>' +
        '<div class="muted">avg ' + escapeHtml(context.confidence.averageConfidence == null ? 'n/a' : Math.round(context.confidence.averageConfidence * 100) + '%') + ' · min ' + escapeHtml(context.confidence.minConfidence ?? 'n/a') + ' · max ' + escapeHtml(context.confidence.maxConfidence ?? 'n/a') + ' · count ' + escapeHtml(context.confidence.evidenceCount) + '</div>' +
        jsonBlock(context.confidence.evidence) +
      '</div>' +
    '</div>' +
    '<div class="grid">' +
      '<div class="card">' +
        '<h3>Source & provenance</h3>' +
        '<div>' + pills(source?.tags || []) + '</div>' +
        jsonBlock({ provenance: context.provenance, sourceObject: source }) +
      '</div>' +
      '<div class="card">' +
        '<h3>Extracted / proposed objects</h3>' +
        '<div class="muted">Suggested types: ' + escapeHtml(candidate.suggestedObjectTypes.join(', ')) + '</div>' +
        renderProposals(context) +
      '</div>' +
    '</div>' +
    '<div class="card">' +
      '<h3>Review controls</h3>' +
      '<label>Reviewer id</label>' +
      '<input id="reviewerId" value="human-reviewer" />' +
      '<label>Rationale</label>' +
      '<textarea id="rationale">' + escapeHtml(latestReview?.payload?.rationale || 'Reviewed source, provenance, evidence confidence, proposed objects, and related artifacts.') + '</textarea>' +
      '<label>Merge target id</label>' +
      '<input id="mergeTargetId" placeholder="canonical object id" list="mergeTargets" />' +
      '<datalist id="mergeTargets">' + mergeTargets.map((object) => '<option value="' + escapeHtml(object.id) + '">' + escapeHtml(object.objectType + ': ' + object.title) + '</option>').join('') + '</datalist>' +
      '<label>Edited objects JSON (used by Edit + accept)</label>' +
      '<textarea id="editedJson">' + escapeHtml(JSON.stringify(context.proposedObjects, null, 2)) + '</textarea>' +
    '</div>' +
    '<div class="grid">' +
      '<div class="card">' +
        '<h3>Review history</h3>' +
        (context.reviewHistory.length ? context.reviewHistory.map((object) => jsonBlock(object)).join('') : '<div class="muted">No review history yet.</div>') +
      '</div>' +
      '<div class="card">' +
        '<h3>Related artifacts</h3>' +
        context.relatedArtifacts.map((item) => '<details><summary>' + escapeHtml(item.relationship + ' · ' + item.object.objectType + ' · ' + item.object.title) + '</summary>' + jsonBlock(item.object) + '</details>').join('') +
      '</div>' +
    '</div>';

  $('autoReviewBtn').addEventListener('click', runAutoReview);
  $('acceptBtn').addEventListener('click', () => submitDecision('accept'));
  $('rejectBtn').addEventListener('click', () => submitDecision('reject'));
  $('editBtn').addEventListener('click', () => submitDecision('edit'));
  $('mergeBtn').addEventListener('click', () => submitDecision('merge'));
}

function selectedProposalIds() {
  return Array.from(document.querySelectorAll('.proposalCheck:checked')).map((node) => node.value);
}

async function runAutoReview() {
  const id = state.selectedId;
  const body = await api('/api/candidates/' + encodeURIComponent(id) + '/auto-review', { method: 'POST', body: '{}' });
  showMessage('Auto-review proposed: ' + body.decision.payload.action + ' (score ' + Math.round((body.decision.payload.score || 0) * 100) + '%)');
  await loadDetail(id);
}

async function submitDecision(action) {
  const id = state.selectedId;
  let editedObjects;
  if (action === 'edit') {
    editedObjects = JSON.parse($('editedJson').value);
  }
  const body = {
    action,
    reviewerId: $('reviewerId').value,
    rationale: $('rationale').value,
    selectedProposedObjectIds: selectedProposalIds(),
    editedObjects,
    mergeTargetId: $('mergeTargetId').value || undefined,
  };
  const result = await api('/api/candidates/' + encodeURIComponent(id) + '/decision', { method: 'POST', body: JSON.stringify(body) });
  showMessage('Saved ' + action + ' decision. Persisted objects: ' + result.persistedObjects.length);
  await loadCandidates();
}

$('refreshBtn').addEventListener('click', () => loadCandidates().catch((error) => showMessage(error.message, 'error')));
$('statusFilter').addEventListener('change', () => loadCandidates().catch((error) => showMessage(error.message, 'error')));
loadCandidates().catch((error) => showMessage(error.message, 'error'));
</script>
</body>
</html>`;
}
