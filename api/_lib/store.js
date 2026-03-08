const snapshotsByGame = globalThis.__NBA_SNAPSHOTS__ || (globalThis.__NBA_SNAPSHOTS__ = new Map());

function pushSnapshot(gameId, boxscore) {
  const game = boxscore?.game;
  if (!game) return [];

  const snapshot = {
    capturedAt: new Date().toISOString(),
    homeTeam: {
      teamId: Number(game.homeTeam?.teamId),
      oncourt: (game.homeTeam?.players ?? []).filter((p) => String(p.oncourt) === '1').map((p) => Number(p.personId)),
    },
    awayTeam: {
      teamId: Number(game.awayTeam?.teamId),
      oncourt: (game.awayTeam?.players ?? []).filter((p) => String(p.oncourt) === '1').map((p) => Number(p.personId)),
    },
  };

  const existing = snapshotsByGame.get(gameId) ?? [];
  existing.push(snapshot);
  const trimmed = existing.slice(-50);
  snapshotsByGame.set(gameId, trimmed);
  return trimmed;
}

function getSnapshots(gameId) {
  return snapshotsByGame.get(gameId) ?? [];
}

module.exports = { snapshotsByGame, pushSnapshot, getSnapshots };
