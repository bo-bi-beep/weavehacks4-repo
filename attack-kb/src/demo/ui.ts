export function renderAttackKbDemoHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Attack KB Main-Agent Demo</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
    body { margin: 0; background: #0c1020; color: #edf2ff; }
    header { padding: 28px 32px; background: linear-gradient(135deg, #172554, #4c1d95); border-bottom: 1px solid #334155; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    h3 { margin: 0 0 8px; font-size: 15px; color: #bfdbfe; }
    main { padding: 24px 32px 40px; display: grid; gap: 18px; }
    .banner { border: 1px solid #f59e0b; background: rgba(245, 158, 11, 0.12); color: #fde68a; padding: 12px 14px; border-radius: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .card { border: 1px solid #334155; background: rgba(15, 23, 42, 0.88); border-radius: 16px; padding: 16px; box-shadow: 0 14px 30px rgba(0,0,0,.24); }
    .step { border-left: 4px solid #38bdf8; }
    .attack { border-left-color: #fb7185; }
    .delivery { border-left-color: #a78bfa; }
    .muted { color: #94a3b8; }
    .pill { display: inline-flex; gap: 6px; align-items: center; border: 1px solid #475569; border-radius: 999px; padding: 4px 8px; margin: 3px; font-size: 12px; background: #111827; }
    .ok { color: #86efac; }
    .warn { color: #fcd34d; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #020617; border: 1px solid #1e293b; border-radius: 12px; padding: 12px; max-height: 320px; overflow: auto; }
    button { border: 0; border-radius: 10px; padding: 9px 12px; background: #38bdf8; color: #06202d; font-weight: 700; cursor: pointer; }
    button:hover { filter: brightness(1.1); }
    .flow { display: grid; gap: 12px; }
    .arrow { text-align: center; color: #60a5fa; font-weight: 800; }
    .rec { border-top: 1px solid #334155; padding-top: 10px; margin-top: 10px; }
  </style>
</head>
<body>
  <header>
    <h1>Attack KB Main-Agent Flow Demo</h1>
    <div class="muted">Credit-loan P0: probing → observed profile → composed recommendations → delivery subagent tasks</div>
  </header>
  <main>
    <div class="banner" id="boundary">Loading boundary…</div>
    <section class="grid">
      <div class="card"><h2>Trace / Project</h2><div id="trace"></div></div>
      <div class="card"><h2>What this proves</h2><ul><li>Attack KB starts with probing when target info is missing.</li><li>Main agent supplies observed target profile.</li><li>Attack KB returns composed system + credit-loan routes.</li><li>Main agent creates constrained delivery subagents.</li></ul></div>
    </section>
    <section class="flow" id="flow"></section>
    <section class="card"><h2>Raw demo packet</h2><button id="toggleRaw">Toggle JSON</button><pre id="raw" hidden></pre></section>
  </main>
<script>
const esc = (value) => String(value ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const list = (items) => (items || []).map(item => '<span class="pill">' + esc(item) + '</span>').join('');
function recHtml(rec) {
  return '<div class="rec"><h3>' + esc(rec.title) + '</h3>' +
    '<div class="muted">' + esc(rec.whyRelevant) + '</div>' +
    '<div>' + list([...(rec.domainDecisionFactorRefs || []), ...(rec.businessAttackRouteRefs || []), ...(rec.systemPatternRefs || [])]) + '</div>' +
    '<details><summary>Safety boundary</summary><div class="warn">' + esc(rec.safetyBoundary) + '</div></details></div>';
}
function render(flow) {
  document.getElementById('boundary').textContent = flow.boundary;
  document.getElementById('trace').innerHTML = '<div>Weave project: <b>' + esc(flow.weaveProject) + '</b></div>' +
    '<div>Trace state: <span class="' + (flow.traceState === 'enabled' ? 'ok' : 'warn') + '">' + esc(flow.traceState) + '</span></div>' +
    '<div class="muted">Set WANDB_API_KEY to make eval/demo-related operations visible in Weave.</div>';
  const steps = flow.steps;
  document.getElementById('flow').innerHTML = [
    '<div class="card step"><h2>1. Main agent initiates attack</h2><pre>' + esc(JSON.stringify(steps.initialAttackRequest, null, 2)) + '</pre></div>',
    '<div class="arrow">↓</div>',
    '<div class="card step"><h2>2. Attack KB returns probing recommendations</h2><div>Phase: <b>' + esc(steps.probingResponse.phase) + '</b></div><div>Missing info: ' + list(steps.probingResponse.missingInfo.map(x => x.key)) + '</div>' + steps.probingResponse.recommendations.map(recHtml).join('') + '</div>',
    '<div class="arrow">↓ main agent probes Agent Under Test itself ↓</div>',
    '<div class="card step"><h2>3. Main agent sends observed profile</h2><div>Observed factors: ' + list((steps.mainAgentObservedProfile.observedDecisionFactors || []).map(x => x.factorRef + ' @ ' + Math.round(x.confidence * 100) + '%')) + '</div><pre>' + esc(JSON.stringify(steps.mainAgentObservedProfile.observedBehavior, null, 2)) + '</pre></div>',
    '<div class="arrow">↓</div>',
    '<div class="card step attack"><h2>4. Attack KB returns composed attack recommendations</h2><div>Phase: <b>' + esc(steps.attackResponse.phase) + '</b></div>' + steps.attackResponse.recommendations.map(recHtml).join('') + '</div>',
    '<div class="arrow">↓</div>',
    '<div class="card step delivery"><h2>5. Main agent creates delivery subagents</h2>' + steps.deliverySubagentTasks.map(task => '<div class="rec"><h3>' + esc(task.id) + ': ' + esc(task.title) + '</h3><div>Recommendation: ' + esc(task.recommendationId) + '</div><div>' + list(task.allowedActions) + '</div></div>').join('') + '</div>'
  ].join('');
  document.getElementById('raw').textContent = JSON.stringify(flow, null, 2);
}
fetch('/api/demo').then(r => r.json()).then(render).catch(err => {
  document.getElementById('flow').innerHTML = '<div class="card warn">' + esc(err.message) + '</div>';
});
document.getElementById('toggleRaw').onclick = () => document.getElementById('raw').hidden = !document.getElementById('raw').hidden;
</script>
</body>
</html>`;
}
