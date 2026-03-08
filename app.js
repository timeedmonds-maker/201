const state = {
  games: [],
  payload: null,
};

const els = {
  select: document.getElementById('game-select'),
  manual: document.getElementById('manual-game-id'),
  filter: document.getElementById('player-filter'),
  refresh: document.getElementById('refresh-scoreboard'),
  load: document.getElementById('load-game'),
  status: document.getElementById('status'),
  summary: document.getElementById('summary'),
  tables: document.getElementById('tables'),
  diagnostics: document.getElementById('diagnostics'),
};

function setStatus(message, isError = false) {
  els.status.innerHTML = isError ? `<strong>${message}</strong>` : message;
  els.status.style.color = isError ? 'var(--bad)' : 'var(--muted)';
}

function formatRate(value) {
  return value == null ? '—' : value.toFixed(1);
}

function formatPct(value) {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function formatDelta(sec) {
  if (sec == null) return '—';
  const sign = sec > 0 ? '+' : '';
  return `${sign}${sec}s`;
}

function deltaClass(sec) {
  if (sec == null) return '';
  if (Math.abs(sec) <= 2) return 'delta-good';
  if (Math.abs(sec) <= 10) return 'delta-warn';
  return 'delta-bad';
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function renderGames() {
  els.select.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = state.games.length ? 'Choose a game' : 'No games found on current slate';
  els.select.appendChild(empty);

  state.games.forEach((game) => {
    const option = document.createElement('option');
    option.value = game.gameId;
    option.textContent = game.display;
    els.select.appendChild(option);
  });

  const orlMin = state.games.find((g) => g.label === 'ORL @ MIN');
  if (orlMin) {
    els.select.value = orlMin.gameId;
    setStatus(`Loaded current NBA slate. <strong>ORL @ MIN</strong> was found and preselected.`);
  } else if (state.games.length) {
    setStatus(`Loaded current NBA slate with <strong>${state.games.length}</strong> games.`);
  } else {
    setStatus('No games returned from the current NBA slate feed.', true);
  }
}

function buildSummary(payload) {
  const { meta, teams, diagnostics } = payload;
  const trusted = diagnostics.validation?.trusted;
  const cards = [
    { kicker: 'Game', value: `${teams.away.tricode} @ ${teams.home.tricode}`, small: `${meta.gameStatusText} · P${meta.period} ${meta.gameClock || ''}`.trim() },
    { kicker: 'Trust', value: trusted ? 'trusted' : diagnostics.resolution.status, small: `Largest minute delta: ${diagnostics.resolution.largestMinuteDeltaSec}s` },
    { kicker: 'Open lineup match', value: diagnostics.resolution.currentLineups.homeMatches && diagnostics.resolution.currentLineups.awayMatches ? 'matched' : 'warning', small: `Home ${diagnostics.resolution.currentLineups.homeMatches ? '✓' : '✕'} · Away ${diagnostics.resolution.currentLineups.awayMatches ? '✓' : '✕'}` },
    { kicker: 'Counted possessions', value: String(diagnostics.validation?.countedPossessions ?? 0), small: `${teams.away.tricode} ${diagnostics.validation?.awayCountedPossessions ?? 0} · ${teams.home.tricode} ${diagnostics.validation?.homeCountedPossessions ?? 0}` },
    { kicker: 'Snapshots stored', value: String(meta.snapshotsStored), small: meta.lastSnapshotAt ? `Last snapshot ${new Date(meta.lastSnapshotAt).toLocaleTimeString()}` : 'Completed games do not need open-stint patching' },
  ];

  els.summary.innerHTML = cards.map((card) => `
    <article class="summary-card">
      <div class="kicker">${card.kicker}</div>
      <div class="value">${card.value}</div>
      <div class="small">${card.small}</div>
    </article>
  `).join('');
}

function playerMatches(name) {
  const q = els.filter.value.trim().toLowerCase();
  return !q || name.toLowerCase().includes(q);
}

function buildTeamTable(team) {
  const rows = team.players.filter((player) => playerMatches(player.name));
  return `
    <section class="team-block">
      <div class="team-header">
        <h2>${team.name} (${team.tricode})</h2>
        <div>${rows.length} players shown</div>
      </div>
      <div class="table-card">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Min</th>
              <th>Box</th>
              <th>Δ</th>
              <th>On ORTG</th>
              <th>Off ORTG</th>
              <th>On DRTG</th>
              <th>Off DRTG</th>
              <th>On Net</th>
              <th>Off Net</th>
              <th>On TS%</th>
              <th>Off TS%</th>
              <th>On eFG%</th>
              <th>Off eFG%</th>
              <th>On 2PT%</th>
              <th>Off 2PT%</th>
              <th>On 3PT%</th>
              <th>Off 3PT%</th>
              <th>On Poss</th>
              <th>Off Poss</th>
              <th>On +/-</th>
              <th>Box +/-</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((player) => `
              <tr>
                <td>${player.name}${player.starter ? ' ★' : ''}</td>
                <td>${player.parsedMinutes}</td>
                <td>${player.boxMinutes}</td>
                <td class="${deltaClass(player.minuteDeltaSec)}">${formatDelta(player.minuteDeltaSec)}</td>
                <td>${formatRate(player.on.offensiveRating)}</td>
                <td>${formatRate(player.off.offensiveRating)}</td>
                <td>${formatRate(player.on.defensiveRating)}</td>
                <td>${formatRate(player.off.defensiveRating)}</td>
                <td>${formatRate(player.on.netRating)}</td>
                <td>${formatRate(player.off.netRating)}</td>
                <td>${formatPct(player.on.tsPct)}</td>
                <td>${formatPct(player.off.tsPct)}</td>
                <td>${formatPct(player.on.efgPct)}</td>
                <td>${formatPct(player.off.efgPct)}</td>
                <td>${formatPct(player.on.twoPtPct)}</td>
                <td>${formatPct(player.off.twoPtPct)}</td>
                <td>${formatPct(player.on.threePtPct)}</td>
                <td>${formatPct(player.off.threePtPct)}</td>
                <td>${player.on.poss}</td>
                <td>${player.off.poss}</td>
                <td>${player.on.plusMinus}</td>
                <td>${player.boxPlusMinus ?? '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderSimpleList(items, formatter) {
  if (!items || !items.length) return '<div class="diag-list"><div>None</div></div>';
  return `<ul class="warning-list">${items.map((item) => `<li>${formatter(item)}</li>`).join('')}</ul>`;
}

function buildDiagnostics(payload) {
  const { diagnostics } = payload;
  const current = diagnostics.resolution.currentLineups;
  const validation = diagnostics.validation || {};
  const possessions = diagnostics.possessions || [];
  const clusters = diagnostics.clusters || [];
  const actions = diagnostics.reconciliationActions || [];

  els.diagnostics.innerHTML = `
    <div class="diag-grid">
      <section class="diag-card">
        <h3>Validation summary</h3>
        <div class="diag-list">
          <div>Trusted: <strong>${validation.trusted ? 'yes' : 'no'}</strong></div>
          <div>Lineup state valid: <strong>${validation.lineupStateValid ? 'yes' : 'no'}</strong></div>
          <div>Impossible possessions: <strong>${validation.impossiblePossessions ?? 0}</strong></div>
          <div>Possession balance reasonable: <strong>${validation.possessionBalanceReasonable ? 'yes' : 'no'}</strong></div>
          <div>Widespread +/- mismatch: <strong>${validation.widespreadPlusMinusMismatch ? 'yes' : 'no'}</strong></div>
        </div>
      </section>
      <section class="diag-card">
        <h3>Current lineup reconciliation</h3>
        <div class="diag-list">
          <div>Parsed home lineup: <code>${current.parsedHome.join(', ') || '—'}</code></div>
          <div>Box home lineup: <code>${current.boxHome.join(', ') || '—'}</code></div>
          <div>Parsed away lineup: <code>${current.parsedAway.join(', ') || '—'}</code></div>
          <div>Box away lineup: <code>${current.boxAway.join(', ') || '—'}</code></div>
        </div>
      </section>
      <section class="diag-card">
        <h3>Warnings</h3>
        ${renderSimpleList(diagnostics.warnings, (w) => w)}
      </section>
      <section class="diag-card">
        <h3>Reconciliation actions</h3>
        ${renderSimpleList(actions, (a) => `${a.type}: ${a.team} at P${a.period} ${a.clock}`)}
      </section>
      <section class="diag-card">
        <h3>Sub batches</h3>
        ${renderSimpleList((diagnostics.subBatches || []).slice(0, 12), (b) => `${b.team} P${b.period} ${b.clock}: out [${b.out.join(', ')}] in [${b.in.join(', ')}] → [${b.result.join(', ')}]${b.valid ? '' : ' INVALID'}`)}
      </section>
      <section class="diag-card">
        <h3>Canonical possessions</h3>
        ${renderSimpleList(possessions.slice(0, 12), (p) => `${p.team} P${p.period} ${p.startClock}→${p.endClock} · ${p.ptsFor}-${p.ptsAgainst} · ${p.closeReason}${p.counted ? '' : ' UNCOUNTED'}`)}
      </section>
      <section class="diag-card">
        <h3>Same-clock clusters</h3>
        ${renderSimpleList(clusters.slice(0, 12), (c) => `P${c.period} ${c.clock} · events ${c.events}${c.hasSubs ? ' · subs' : ''}${c.hasScoring ? ' · scoring' : ''}${c.isAdminOnly ? ' · admin' : ''}`)}
      </section>
      <section class="diag-card">
        <h3>Open possession</h3>
        ${diagnostics.openPossession ? `<div class="diag-list"><div>${diagnostics.openPossession.team} possession open since P${diagnostics.openPossession.period} ${diagnostics.openPossession.startClock}</div></div>` : '<div class="diag-list"><div>No open possession.</div></div>'}
      </section>
    </div>
  `;
}

function renderPayload() {
  if (!state.payload) return;
  buildSummary(state.payload);
  els.tables.innerHTML = buildTeamTable(state.payload.teams.away) + buildTeamTable(state.payload.teams.home);
  buildDiagnostics(state.payload);
}

async function loadScoreboard() {
  setStatus('Refreshing current NBA slate…');
  try {
    const data = await fetchJson('/api/scoreboard');
    state.games = data.games || [];
    renderGames();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function selectedGameId() {
  const manual = els.manual.value.trim();
  return manual || els.select.value;
}

async function loadGame() {
  const gameId = selectedGameId();
  if (!gameId) {
    setStatus('Choose a game or enter a manual 10-digit game ID.', true);
    return;
  }

  setStatus(`Loading <strong>${gameId}</strong>…`);
  try {
    state.payload = await fetchJson(`/api/game?gameId=${encodeURIComponent(gameId)}`);
    renderPayload();
    const matchup = `${state.payload.teams.away.tricode} @ ${state.payload.teams.home.tricode}`;
    const trust = state.payload.diagnostics.validation?.trusted ? 'trusted' : state.payload.diagnostics.resolution.status;
    setStatus(`Loaded <strong>${matchup}</strong> · ${state.payload.meta.gameStatusText} · parser ${trust}`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

els.refresh.addEventListener('click', loadScoreboard);
els.load.addEventListener('click', loadGame);
els.filter.addEventListener('input', renderPayload);

loadScoreboard();
