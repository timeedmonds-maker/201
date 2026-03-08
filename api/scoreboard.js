const SCOREBOARD_URL = 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json';

function simplifyGame(game) {
  const home = game?.homeTeam ?? {};
  const away = game?.awayTeam ?? {};
  const isFinal = Number(game?.gameStatus) === 3;
  const statusText = game?.gameStatusText || (isFinal ? 'Final' : 'Live');
  return {
    gameId: game?.gameId,
    status: statusText,
    gameStatus: game?.gameStatus,
    gameClock: game?.gameClock || '',
    period: game?.period || 0,
    home: {
      tricode: home?.teamTricode,
      score: home?.score,
      seed: home?.seed,
    },
    away: {
      tricode: away?.teamTricode,
      score: away?.score,
      seed: away?.seed,
    },
    label: `${away?.teamTricode} @ ${home?.teamTricode}`,
    display: `${away?.teamTricode} @ ${home?.teamTricode} — ${statusText}${isFinal ? ` ${away?.score}-${home?.score}` : ''}`,
  };
}

module.exports = async (req, res) => {
  try {
    const response = await fetch(SCOREBOARD_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json,text/plain,*/*',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return res.status(502).json({ error: `Scoreboard fetch failed with ${response.status}` });
    }

    const data = await response.json();
    const games = (data?.scoreboard?.games ?? []).map(simplifyGame);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      source: 'cdn.nba.com todaysScoreboard_00.json',
      fetchedAt: new Date().toISOString(),
      games,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unknown scoreboard error' });
  }
};
