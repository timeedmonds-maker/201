const { reconcileGame } = require('./_lib/reconcile');
const { getSnapshots, pushSnapshot } = require('./_lib/store');

function validateGameId(gameId) {
  return /^\d{10}$/.test(String(gameId || ''));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json,text/plain,*/*',
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Fetch failed (${response.status}) for ${url}`);
  }
  return response.json();
}

module.exports = async (req, res) => {
  try {
    const gameId = req.query?.gameId;
    if (!validateGameId(gameId)) {
      return res.status(400).json({ error: 'Provide a valid 10-digit NBA gameId.' });
    }

    const boxscoreUrl = `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`;
    const playbyplayUrl = `https://cdn.nba.com/static/json/liveData/playbyplay/playbyplay_${gameId}.json`;

    const [boxscore, playbyplay] = await Promise.all([
      fetchJson(boxscoreUrl),
      fetchJson(playbyplayUrl),
    ]);

    pushSnapshot(gameId, boxscore);
    const reconciled = reconcileGame({
      boxscore,
      playbyplay,
      snapshots: getSnapshots(gameId),
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ...reconciled,
      raw: {
        homeTeamScore: boxscore?.game?.homeTeam?.score,
        awayTeamScore: boxscore?.game?.awayTeam?.score,
      },
      source: {
        boxscoreUrl,
        playbyplayUrl,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unknown game error' });
  }
};
