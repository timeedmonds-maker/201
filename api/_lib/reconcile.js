function parseClockToSecondsRemaining(clock) {
  if (!clock || typeof clock !== 'string') return 0;
  const match = clock.match(/PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/i);
  if (!match) return 0;
  const minutes = Number(match[1] ?? 0);
  const seconds = Number(match[2] ?? 0);
  return Math.round(minutes * 60 + seconds);
}

function secondsToClock(seconds) {
  const clamped = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(clamped / 60);
  const remainder = clamped % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function secondsToMinutes(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function parseDurationToSeconds(duration) {
  if (!duration || typeof duration !== 'string') return 0;
  const match = duration.match(/PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/i);
  if (!match) return 0;
  const minutes = Number(match[1] ?? 0);
  const seconds = Number(match[2] ?? 0);
  return Math.round(minutes * 60 + seconds);
}

function periodLength(period) {
  return Number(period) > 4 ? 5 * 60 : 12 * 60;
}

function absoluteGameSeconds(period, remaining) {
  let elapsed = 0;
  for (let p = 1; p < Number(period || 1); p += 1) elapsed += periodLength(p);
  return elapsed + (periodLength(period || 1) - Math.max(0, remaining));
}

function lower(value) {
  return String(value ?? '').toLowerCase();
}

function emptyBucket() {
  return {
    seconds: 0,
    poss: 0,
    oppPoss: 0,
    points: 0,
    oppPoints: 0,
    fga: 0,
    fgm: 0,
    twoPA: 0,
    twoPM: 0,
    threePA: 0,
    threePM: 0,
    fta: 0,
    ftm: 0,
    oreb: 0,
    dreb: 0,
    tov: 0,
  };
}

function parseBoxPlusMinus(raw) {
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function createTeamContext(team, opponentTeam) {
  const roster = (team.players ?? []).map((player) => ({
    personId: Number(player.personId),
    name: player.nameI || player.name || `${player.firstName ?? ''} ${player.familyName ?? ''}`.trim(),
    starter: String(player.starter) === '1',
    order: player.order ?? 999,
    position: player.position || '',
    boxMinutesSec: parseDurationToSeconds(player.statistics?.minutesCalculated || player.statistics?.minutes),
    plusMinus: parseBoxPlusMinus(player.statistics?.plusMinusPoints ?? player.statistics?.plusMinus),
    oncourt: String(player.oncourt) === '1',
    played: String(player.played) === '1'
  }));

  const playerMap = new Map(roster.map((player) => [player.personId, player]));
  const splits = new Map();
  roster.forEach((player) => splits.set(player.personId, { on: emptyBucket(), off: emptyBucket() }));

  return {
    teamId: Number(team.teamId),
    tricode: team.teamTricode,
    name: `${team.teamCity} ${team.teamName}`,
    opponentTeamId: Number(opponentTeam.teamId),
    roster,
    playerMap,
    rosterSet: new Set(roster.map((p) => p.personId)),
    splits,
  };
}

function getStartingLineup(teamContext) {
  const starters = teamContext.roster
    .filter((player) => player.starter)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, 5)
    .map((player) => player.personId);
  if (starters.length === 5) return starters;

  return teamContext.roster
    .filter((player) => player.played || player.starter)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, 5)
    .map((player) => player.personId);
}

function getLatestSnapshot(snapshots) {
  return Array.isArray(snapshots) && snapshots.length ? snapshots[snapshots.length - 1] : null;
}

function getSnapshotOnCourt(snapshot, teamId) {
  if (!snapshot) return [];
  if (Number(snapshot.homeTeam?.teamId) === Number(teamId)) return snapshot.homeTeam.oncourt ?? [];
  if (Number(snapshot.awayTeam?.teamId) === Number(teamId)) return snapshot.awayTeam.oncourt ?? [];
  return [];
}

function sortActions(actions) {
  return [...(actions ?? [])].sort((a, b) => {
    const periodDiff = (a.period ?? 0) - (b.period ?? 0);
    if (periodDiff !== 0) return periodDiff;
    const clockDiff = parseClockToSecondsRemaining(b.clock) - parseClockToSecondsRemaining(a.clock);
    if (clockDiff !== 0) return clockDiff;
    return (a.orderNumber ?? a.actionNumber ?? 0) - (b.orderNumber ?? b.actionNumber ?? 0);
  });
}

function sortedIds(setLike) {
  return [...new Set(Array.from(setLike ?? []))].map(Number).filter(Boolean).sort((a, b) => a - b);
}

function lineupsEqual(a, b) {
  const left = sortedIds(a);
  const right = sortedIds(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function scoreFromAction(raw, fallback) {
  const home = Number(raw?.scoreHome);
  const away = Number(raw?.scoreAway);
  return {
    home: Number.isFinite(home) ? home : fallback.home,
    away: Number.isFinite(away) ? away : fallback.away,
  };
}

function normalizeAction(raw, homeContext, awayContext) {
  const teamId = Number(raw?.teamId ?? 0);
  const action = lower(raw?.actionType);
  const subType = lower(raw?.subType);
  const descriptor = lower(raw?.descriptor);
  const description = String(raw?.description ?? '');
  const shotResult = lower(raw?.shotResult);
  const remaining = parseClockToSecondsRemaining(raw?.clock);
  const opponentTeamId = teamId === homeContext.teamId
    ? awayContext.teamId
    : teamId === awayContext.teamId
      ? homeContext.teamId
      : 0;

  const isSubstitution = action === 'substitution';
  const isFreeThrow = action.includes('freethrow') || action.includes('free throw');
  const isMadeShot = shotResult === 'made' || /\bmade\b/i.test(description);
  const isMissedShot = shotResult === 'missed' || /\bmiss(?:ed)?\b/i.test(description);
  const isTwo = action === '2pt';
  const isThree = action === '3pt';
  const isShotAttempt = isTwo || isThree;
  const isRebound = action === 'rebound';
  const isOffensiveRebound = isRebound && subType === 'offensive';
  const isDefensiveRebound = isRebound && subType === 'defensive';
  const isTurnover = action === 'turnover';
  const isFoul = action.includes('foul');
  const isOffensiveFoul = isFoul && (subType.includes('offensive') || descriptor.includes('offensive') || /offensive foul/i.test(description));
  const isJumpBall = action === 'jumpball' || action === 'jump ball';
  const isTimeout = action === 'timeout';
  const isReplay = action.includes('replay') || action.includes('review') || descriptor.includes('replay') || descriptor.includes('review');
  const isTechnical = subType.includes('technical') || descriptor.includes('technical') || /technical/i.test(description);
  const isFlagrant = subType.includes('flagrant') || descriptor.includes('flagrant') || /flagrant/i.test(description);
  const isPeriodStart = descriptor.includes('startperiod') || /start period/i.test(description) || raw?.actionNumber === 1;
  const isPeriodEnd = descriptor.includes('endperiod') || /end period/i.test(description);
  const possessionTeamId = Number(raw?.possession ?? 0);

  const ftMatch = `${descriptor} ${subType} ${description}`.match(/(\d+)\s*of\s*(\d+)/i);
  const descriptorFtMatch = `${descriptor} ${subType}`.match(/(\d+)\s*of\s*(\d+)/i) || `${descriptor} ${subType}`.match(/(\d)(?:st|nd|rd|th)?\s*ft\s*of\s*(\d)/i);
  const ftCurrent = Number(ftMatch?.[1] ?? descriptorFtMatch?.[1] ?? 0);
  const ftTotal = Number(ftMatch?.[2] ?? descriptorFtMatch?.[2] ?? 0);
  const isFinalFreeThrow = !!isFreeThrow && ftCurrent > 0 && ftCurrent === ftTotal;

  return {
    raw,
    eventId: Number(raw?.actionNumber ?? raw?.orderNumber ?? 0),
    orderNumber: Number(raw?.orderNumber ?? raw?.actionNumber ?? 0),
    period: Number(raw?.period ?? 0),
    clock: raw?.clock || '',
    remaining,
    absoluteGameSeconds: absoluteGameSeconds(raw?.period ?? 1, remaining),
    teamId,
    opponentTeamId,
    possessionTeamId,
    actorPlayerId: Number(raw?.personId ?? 0),
    secondaryPlayerId: Number(raw?.playerId2 ?? raw?.assistPersonId ?? 0),
    actionType: action,
    subType,
    descriptor,
    description,
    pointsScored: isTwo && isMadeShot ? 2 : isThree && isMadeShot ? 3 : isFreeThrow && isMadeShot ? 1 : 0,
    scoreHome: Number(raw?.scoreHome),
    scoreAway: Number(raw?.scoreAway),
    isMadeShot,
    isMissedShot,
    isFieldGoal: isShotAttempt,
    isFreeThrow,
    isFinalFreeThrow,
    isRebound,
    isOffensiveRebound,
    isDefensiveRebound,
    isTurnover,
    isFoul,
    isOffensiveFoul,
    isJumpBall,
    isSubstitution,
    isTimeout,
    isReplay,
    isTechnical,
    isFlagrant,
    isPeriodStart,
    isPeriodEnd,
    isShotAttempt,
    isAdministrative: isSubstitution || isTimeout || isReplay || isTechnical,
  };
}

function clusterActions(actions, homeContext, awayContext) {
  const normalized = actions.map((raw) => normalizeAction(raw, homeContext, awayContext));
  const clusters = [];
  const byKey = new Map();

  normalized.forEach((event) => {
    const key = `${event.period}|${event.clock}`;
    if (!byKey.has(key)) {
      const cluster = {
        key,
        period: event.period,
        clock: event.clock,
        remaining: event.remaining,
        absoluteGameSeconds: event.absoluteGameSeconds,
        events: [],
      };
      byKey.set(key, cluster);
      clusters.push(cluster);
    }
    byKey.get(key).events.push(event);
  });

  clusters.forEach((cluster) => {
    cluster.events.sort((a, b) => a.orderNumber - b.orderNumber);
    cluster.hasSubs = cluster.events.some((e) => e.isSubstitution);
    cluster.hasScoring = cluster.events.some((e) => e.pointsScored > 0);
    cluster.hasControlChangeEvidence = cluster.events.some((e) => e.isTurnover || e.isDefensiveRebound || e.isMadeShot || e.isJumpBall || e.isOffensiveFoul);
    cluster.isAdminOnly = cluster.events.every((e) => e.isAdministrative || e.isPeriodStart || e.isPeriodEnd);
    cluster.isFreeThrowTripCluster = cluster.events.some((e) => e.isFreeThrow);
    cluster.isReboundWindow = cluster.events.some((e) => e.isRebound);
  });

  return { normalized, clusters };
}

function cloneLineups(lineups, homeTeamId, awayTeamId) {
  return {
    [homeTeamId]: new Set(sortedIds(lineups[homeTeamId])),
    [awayTeamId]: new Set(sortedIds(lineups[awayTeamId])),
  };
}

function lineupsSnapshot(lineups, homeTeamId, awayTeamId) {
  return {
    home: sortedIds(lineups[homeTeamId]),
    away: sortedIds(lineups[awayTeamId]),
  };
}

function createOnCourtMap(latestSnapshot, homeTeamId, awayTeamId) {
  return {
    [homeTeamId]: new Set(getSnapshotOnCourt(latestSnapshot, homeTeamId)),
    [awayTeamId]: new Set(getSnapshotOnCourt(latestSnapshot, awayTeamId)),
  };
}

function validateSingleTeamLineup(teamContext, lineupSet) {
  const ids = sortedIds(lineupSet);
  const unknown = ids.filter((id) => !teamContext.rosterSet.has(id));
  return {
    valid: ids.length === 5 && unknown.length === 0 && new Set(ids).size === ids.length,
    size: ids.length,
    unknown,
    ids,
  };
}

function validateLineups(homeContext, awayContext, lineups) {
  const home = validateSingleTeamLineup(homeContext, lineups[homeContext.teamId]);
  const away = validateSingleTeamLineup(awayContext, lineups[awayContext.teamId]);
  return {
    valid: home.valid && away.valid,
    home,
    away,
  };
}

function applySecondsToLineups(teamContext, lineups, seconds) {
  if (seconds <= 0) return;
  teamContext.roster.forEach((player) => {
    const split = teamContext.splits.get(player.personId);
    const key = lineups[teamContext.teamId].has(player.personId) ? 'on' : 'off';
    split[key].seconds += seconds;
  });
}

function applyBucketPatch(teamContext, lineups, patch) {
  if (!patch) return;
  teamContext.roster.forEach((player) => {
    const split = teamContext.splits.get(player.personId);
    const key = lineups[teamContext.teamId].has(player.personId) ? 'on' : 'off';
    const bucket = split[key];
    Object.entries(patch).forEach(([stat, delta]) => {
      bucket[stat] += delta;
    });
  });
}

function applyPossessionOutcome(offenseContext, defenseContext, countedLineups, ptsFor, ptsAgainst) {
  offenseContext.roster.forEach((player) => {
    const split = offenseContext.splits.get(player.personId);
    const key = countedLineups[offenseContext.teamId].has(player.personId) ? 'on' : 'off';
    const bucket = split[key];
    bucket.poss += 1;
    bucket.points += ptsFor;
    bucket.oppPoints += ptsAgainst;
  });

  defenseContext.roster.forEach((player) => {
    const split = defenseContext.splits.get(player.personId);
    const key = countedLineups[defenseContext.teamId].has(player.personId) ? 'on' : 'off';
    const bucket = split[key];
    bucket.oppPoss += 1;
    bucket.points += ptsAgainst;
    bucket.oppPoints += ptsFor;
  });
}

function getEventPatch(event) {
  if (event.isShotAttempt) {
    if (event.actionType === '2pt') return { fga: 1, fgm: event.isMadeShot ? 1 : 0, twoPA: 1, twoPM: event.isMadeShot ? 1 : 0 };
    if (event.actionType === '3pt') return { fga: 1, fgm: event.isMadeShot ? 1 : 0, threePA: 1, threePM: event.isMadeShot ? 1 : 0 };
  }
  if (event.isFreeThrow) return { fta: 1, ftm: event.isMadeShot ? 1 : 0 };
  if (event.isOffensiveRebound) return { oreb: 1 };
  if (event.isDefensiveRebound) return { dreb: 1 };
  if (event.isTurnover || event.isOffensiveFoul) return { tov: 1 };
  return null;
}

function deriveDisplayName(player, fallbackId) {
  return player?.name || `Player ${fallbackId}`;
}

function finalizeSplit(split) {
  const poss = split.poss || 0;
  const oppPoss = split.oppPoss || 0;
  const fga = split.fga || 0;
  const fta = split.fta || 0;
  const tsDenominator = 2 * (fga + 0.44 * fta);

  return {
    ...split,
    minutes: secondsToMinutes(split.seconds),
    offensiveRating: poss ? (split.points / poss) * 100 : null,
    defensiveRating: oppPoss ? (split.oppPoints / oppPoss) * 100 : null,
    netRating: poss && oppPoss ? ((split.points / poss) * 100) - ((split.oppPoints / oppPoss) * 100) : null,
    tsPct: tsDenominator ? split.points / tsDenominator : null,
    efgPct: fga ? (split.fgm + 0.5 * split.threePM) / fga : null,
    twoPtPct: split.twoPA ? split.twoPM / split.twoPA : null,
    threePtPct: split.threePA ? split.threePM / split.threePA : null,
    plusMinus: split.points - split.oppPoints,
  };
}

function getGameClockForAccrual(game) {
  return Number(game?.gameStatus) === 3 ? 0 : parseClockToSecondsRemaining(game?.gameClock) || 0;
}

function formatScore(score) {
  return `${score.away}-${score.home}`;
}

function scoreDeltaForTeam(teamId, scoreOpen, scoreClose, homeContext, awayContext) {
  if (teamId === homeContext.teamId) return scoreClose.home - scoreOpen.home;
  if (teamId === awayContext.teamId) return scoreClose.away - scoreOpen.away;
  return 0;
}

function likelyPossessionEvidence(event) {
  return event.isShotAttempt || event.isFreeThrow || event.isTurnover || event.isRebound || event.isJumpBall || event.isFoul;
}

function controlTeamForEvent(event, currentOffenseTeamId, contextsByTeamId) {
  if (event.isJumpBall) return event.possessionTeamId || event.teamId || 0;
  if (event.isShotAttempt || event.isFreeThrow || event.isTurnover || event.isOffensiveFoul) return event.teamId || event.possessionTeamId || 0;
  if (event.isOffensiveRebound) return event.teamId || currentOffenseTeamId || 0;
  if (event.isDefensiveRebound) return event.teamId || 0;
  if (event.isFoul) {
    if (event.possessionTeamId) return event.possessionTeamId;
    if (event.teamId && contextsByTeamId[event.teamId]) return contextsByTeamId[event.teamId].opponentTeamId;
  }
  return event.possessionTeamId || event.teamId || 0;
}

function buildPlayerRows(teamContext) {
  return teamContext.roster
    .filter((player) => player.played || player.boxMinutesSec > 0)
    .map((player) => {
      const split = teamContext.splits.get(player.personId);
      const on = finalizeSplit(split.on);
      const off = finalizeSplit(split.off);
      return {
        personId: player.personId,
        name: player.name,
        starter: player.starter,
        boxMinutes: secondsToMinutes(player.boxMinutesSec),
        parsedMinutes: on.minutes,
        minuteDeltaSec: on.seconds - player.boxMinutesSec,
        boxPlusMinus: player.plusMinus,
        onPlusMinusDelta: player.plusMinus == null ? null : on.plusMinus - player.plusMinus,
        on,
        off,
      };
    })
    .sort((a, b) => b.on.seconds - a.on.seconds);
}

function resolveWindows(rawWindows) {
  const resolved = [];
  rawWindows.forEach((window) => {
    const last = resolved[resolved.length - 1];
    if (
      last &&
      last.period === window.period &&
      last.endRemaining === window.startRemaining &&
      lineupsEqual(last.homeLineup, window.homeLineup) &&
      lineupsEqual(last.awayLineup, window.awayLineup)
    ) {
      last.endRemaining = window.endRemaining;
      last.seconds += window.seconds;
      last.duration = secondsToMinutes(last.seconds);
      last.endClock = secondsToClock(last.endRemaining);
      return;
    }
    resolved.push({ ...window });
  });
  return resolved;
}

function reconcileGame({ boxscore, playbyplay, snapshots = [] }) {
  const game = boxscore?.game;
  if (!game) throw new Error('Missing boxscore game payload');

  const homeContext = createTeamContext(game.homeTeam, game.awayTeam);
  const awayContext = createTeamContext(game.awayTeam, game.homeTeam);
  const contextsByTeamId = {
    [homeContext.teamId]: homeContext,
    [awayContext.teamId]: awayContext,
  };

  const warnings = [];
  const reconciliationActions = [];
  const structuralErrors = [];
  const actions = sortActions(playbyplay?.game?.actions ?? []);
  const { normalized, clusters } = clusterActions(actions, homeContext, awayContext);
  const latestSnapshot = getLatestSnapshot(snapshots);

  let lineups = {
    [homeContext.teamId]: new Set(getStartingLineup(homeContext)),
    [awayContext.teamId]: new Set(getStartingLineup(awayContext)),
  };

  let currentPeriod = clusters[0]?.period ?? (game.period || 1);
  let prevRemaining = periodLength(currentPeriod);
  let currentScore = { home: 0, away: 0 };
  let openPossession = null;
  let pendingOffenseTeamId = 0;
  let possessionId = 1;
  let structuralInvalid = false;
  const rawWindows = [];
  const possessions = [];
  const subBatches = [];
  const clusterDebug = [];

  function recordStructuralError(message) {
    warnings.push(message);
    structuralErrors.push(message);
    structuralInvalid = true;
  }

  function accrueInterval(nextRemaining, reason = 'clock') {
    const seconds = Math.max(0, prevRemaining - nextRemaining);
    if (seconds > 0) {
      applySecondsToLineups(homeContext, lineups, seconds);
      applySecondsToLineups(awayContext, lineups, seconds);
      const validity = validateLineups(homeContext, awayContext, lineups);
      rawWindows.push({
        period: currentPeriod,
        startRemaining: prevRemaining,
        endRemaining: nextRemaining,
        startClock: secondsToClock(prevRemaining),
        endClock: secondsToClock(nextRemaining),
        seconds,
        duration: secondsToMinutes(seconds),
        reason,
        homeLineup: sortedIds(lineups[homeContext.teamId]),
        awayLineup: sortedIds(lineups[awayContext.teamId]),
        homeValid: validity.home.valid,
        awayValid: validity.away.valid,
      });
    }
    prevRemaining = nextRemaining;
  }

  function ensureOpenPossession(teamId, event, reason, preScore) {
    const validLineups = validateLineups(homeContext, awayContext, lineups);
    if (!teamId || !contextsByTeamId[teamId]) return;
    if (openPossession) {
      if (openPossession.teamId === teamId) return;
      if (likelyPossessionEvidence(event)) {
        closeOpenPossession('explicit_control_transfer', preScore, event);
      } else {
        return;
      }
    }
    const countedLineups = cloneLineups(lineups, homeContext.teamId, awayContext.teamId);
    openPossession = {
      id: possessionId++,
      teamId,
      opponentTeamId: contextsByTeamId[teamId].opponentTeamId,
      period: event.period,
      startClock: event.clock,
      startRemaining: event.remaining,
      startAbsoluteGameSeconds: event.absoluteGameSeconds,
      trigger: reason,
      scoreOpen: { ...preScore },
      triggerLineup: lineupsSnapshot(lineups, homeContext.teamId, awayContext.teamId),
      resolvedLineup: lineupsSnapshot(lineups, homeContext.teamId, awayContext.teamId),
      countedLineup: {
        home: sortedIds(countedLineups[homeContext.teamId]),
        away: sortedIds(countedLineups[awayContext.teamId]),
      },
      countedLineups,
      validAtOpen: validLineups.valid,
      eventIds: [],
      statEvents: [],
    };
    pendingOffenseTeamId = 0;
    if (!validLineups.valid) {
      recordStructuralError(`Opened possession ${openPossession.id} with invalid lineup state at P${event.period} ${secondsToClock(event.remaining)}.`);
    }
  }

  function attributeEventToOpenPossession(event) {
    if (!openPossession || !openPossession.countedLineups || !openPossession.validAtOpen) return;
    const patch = getEventPatch(event);
    if (!patch) return;
    const teamId = event.isDefensiveRebound ? event.teamId : openPossession.teamId;
    if (!teamId || !contextsByTeamId[teamId]) return;
    applyBucketPatch(contextsByTeamId[teamId], openPossession.countedLineups, patch);
    openPossession.statEvents.push({ eventId: event.eventId, actionType: event.actionType, patch });
  }

  function attributeDefensiveReboundCurrentLineup(event) {
    const patch = getEventPatch(event);
    if (!patch || !event.teamId || !contextsByTeamId[event.teamId]) return;
    applyBucketPatch(contextsByTeamId[event.teamId], lineups, patch);
  }

  function closeOpenPossession(reason, closeScore, event) {
    if (!openPossession) return;
    openPossession.resolvedLineup = lineupsSnapshot(lineups, homeContext.teamId, awayContext.teamId);
    const ptsFor = scoreDeltaForTeam(openPossession.teamId, openPossession.scoreOpen, closeScore, homeContext, awayContext);
    const ptsAgainst = scoreDeltaForTeam(openPossession.opponentTeamId, openPossession.scoreOpen, closeScore, homeContext, awayContext);
    const impossible = ptsFor < 0 || ptsAgainst < 0 || ptsFor > 5 || ptsAgainst > 5;
    const counted = openPossession.validAtOpen && !impossible;
    if (impossible) {
      recordStructuralError(`Possession ${openPossession.id} has impossible score delta ${ptsFor}-${ptsAgainst} at close P${event?.period ?? currentPeriod} ${secondsToClock(event?.remaining ?? prevRemaining)}.`);
    }

    const possessionRecord = {
      id: openPossession.id,
      teamId: openPossession.teamId,
      team: contextsByTeamId[openPossession.teamId]?.tricode || String(openPossession.teamId),
      opponentTeamId: openPossession.opponentTeamId,
      opponent: contextsByTeamId[openPossession.opponentTeamId]?.tricode || String(openPossession.opponentTeamId),
      period: openPossession.period,
      startClock: openPossession.startClock,
      endClock: event?.clock || secondsToClock(event?.remaining ?? prevRemaining),
      startRemaining: openPossession.startRemaining,
      endRemaining: event?.remaining ?? prevRemaining,
      trigger: openPossession.trigger,
      closeReason: reason,
      scoreOpen: formatScore(openPossession.scoreOpen),
      scoreClose: formatScore(closeScore),
      ptsFor,
      ptsAgainst,
      impossible,
      counted,
      validAtOpen: openPossession.validAtOpen,
      triggerLineup: openPossession.triggerLineup,
      resolvedLineup: openPossession.resolvedLineup,
      countedLineup: openPossession.countedLineup,
      statEvents: openPossession.statEvents,
      eventIds: openPossession.eventIds,
    };

    possessions.push(possessionRecord);
    if (counted && openPossession.countedLineups) {
      const offenseContext = contextsByTeamId[openPossession.teamId];
      const defenseContext = contextsByTeamId[openPossession.opponentTeamId];
      applyPossessionOutcome(offenseContext, defenseContext, openPossession.countedLineups, ptsFor, ptsAgainst);
    }
    openPossession = null;
  }

  function applySubstitutionBatches(cluster) {
    const teamBatches = new Map();
    cluster.events.filter((event) => event.isSubstitution).forEach((event) => {
      if (!event.teamId || !contextsByTeamId[event.teamId]) return;
      if (!teamBatches.has(event.teamId)) teamBatches.set(event.teamId, { out: [], in: [], teamId: event.teamId, period: cluster.period, clock: cluster.clock });
      const batch = teamBatches.get(event.teamId);
      if (event.subType === 'out') batch.out.push(event.actorPlayerId);
      if (event.subType === 'in') batch.in.push(event.actorPlayerId);
    });

    for (const batch of teamBatches.values()) {
      const teamContext = contextsByTeamId[batch.teamId];
      const next = new Set(sortedIds(lineups[batch.teamId]));
      batch.out.forEach((id) => next.delete(Number(id)));
      batch.in.forEach((id) => next.add(Number(id)));
      const validity = validateSingleTeamLineup(teamContext, next);
      const record = {
        teamId: batch.teamId,
        team: teamContext.tricode,
        period: batch.period,
        clock: batch.clock,
        out: sortedIds(batch.out),
        in: sortedIds(batch.in),
        result: validity.ids,
        valid: validity.valid,
      };
      subBatches.push(record);
      lineups[batch.teamId] = next;
      if (!validity.valid) {
        recordStructuralError(`Sub batch invalid for ${teamContext.tricode} at P${batch.period} ${secondsToClock(cluster.remaining)}. Result size ${validity.size}.`);
      }
    }
  }

  clusters.forEach((cluster) => {
    while (currentPeriod < cluster.period) {
      accrueInterval(0, 'period_end');
      closeOpenPossession('period_transition', currentScore, { period: currentPeriod, remaining: 0, clock: 'PT0M00.00S' });
      currentPeriod += 1;
      prevRemaining = periodLength(currentPeriod);
    }

    accrueInterval(cluster.remaining, cluster.hasSubs ? 'sub_boundary' : 'cluster_boundary');

    const preClusterLineups = lineupsSnapshot(lineups, homeContext.teamId, awayContext.teamId);
    const clusterScoreStart = { ...currentScore };

    cluster.events.filter((event) => !event.isSubstitution).forEach((event) => {
      const preScore = { ...currentScore };
      const eventScore = scoreFromAction(event.raw, currentScore);
      const controlTeamId = controlTeamForEvent(event, openPossession?.teamId || pendingOffenseTeamId, contextsByTeamId);

      if (!openPossession) {
        if (event.isFoul && !event.isOffensiveFoul && controlTeamId) {
          ensureOpenPossession(controlTeamId, event, 'foul_continuation', preScore);
        } else if ((pendingOffenseTeamId && controlTeamId === pendingOffenseTeamId) || (controlTeamId && likelyPossessionEvidence(event))) {
          ensureOpenPossession(controlTeamId || pendingOffenseTeamId, event, pendingOffenseTeamId ? 'pending_control' : 'event_control', preScore);
        }
      }

      if (openPossession) openPossession.eventIds.push(event.eventId);

      if (event.isShotAttempt || event.isFreeThrow || event.isTurnover || event.isOffensiveRebound || event.isOffensiveFoul) {
        if (controlTeamId) ensureOpenPossession(controlTeamId, event, 'event_control', preScore);
      }

      if (event.isShotAttempt || event.isFreeThrow || event.isTurnover || event.isOffensiveRebound || event.isOffensiveFoul) {
        attributeEventToOpenPossession(event);
      }

      if (event.isDefensiveRebound) {
        attributeDefensiveReboundCurrentLineup(event);
      }

      currentScore = eventScore;

      if (event.isPeriodEnd) {
        closeOpenPossession('period_end', currentScore, event);
        pendingOffenseTeamId = 0;
      } else if (event.isMadeShot && event.isShotAttempt) {
        closeOpenPossession('made_fg', currentScore, event);
        pendingOffenseTeamId = contextsByTeamId[event.teamId]?.opponentTeamId || 0;
      } else if (event.isTurnover || event.isOffensiveFoul) {
        closeOpenPossession(event.isOffensiveFoul ? 'offensive_foul' : 'turnover', currentScore, event);
        pendingOffenseTeamId = contextsByTeamId[event.teamId]?.opponentTeamId || 0;
      } else if (event.isDefensiveRebound) {
        if (openPossession && event.teamId === openPossession.teamId) {
          recordStructuralError(`Defensive rebound by offense team on possession ${openPossession.id} at P${event.period} ${secondsToClock(event.remaining)}.`);
        }
        closeOpenPossession('defensive_rebound', currentScore, event);
        pendingOffenseTeamId = event.teamId || 0;
      } else if (event.isFreeThrow && event.isFinalFreeThrow && event.isMadeShot) {
        closeOpenPossession('final_ft_made', currentScore, event);
        pendingOffenseTeamId = contextsByTeamId[event.teamId]?.opponentTeamId || 0;
      } else if (event.isJumpBall && controlTeamId) {
        ensureOpenPossession(controlTeamId, event, 'jumpball_control', preScore);
      }

    });

    const beforeSubs = lineupsSnapshot(lineups, homeContext.teamId, awayContext.teamId);
    if (cluster.hasSubs) applySubstitutionBatches(cluster);
    const afterSubs = lineupsSnapshot(lineups, homeContext.teamId, awayContext.teamId);

    clusterDebug.push({
      key: cluster.key,
      period: cluster.period,
      clock: cluster.clock,
      events: cluster.events.length,
      hasSubs: cluster.hasSubs,
      hasScoring: cluster.hasScoring,
      isAdminOnly: cluster.isAdminOnly,
      hasControlChangeEvidence: cluster.hasControlChangeEvidence,
      preLineups: preClusterLineups,
      preSubs: beforeSubs,
      postSubs: afterSubs,
      scoreStart: formatScore(clusterScoreStart),
      scoreEnd: formatScore(currentScore),
      subBatchCount: cluster.hasSubs ? subBatches.filter((b) => b.period === cluster.period && b.clock === cluster.clock).length : 0,
    });
  });

  const finalClockRemaining = getGameClockForAccrual(game);
  const isFinal = Number(game.gameStatus) === 3;

  if (!isFinal && latestSnapshot) {
    const snapshotLineups = createOnCourtMap(latestSnapshot, homeContext.teamId, awayContext.teamId);
    const validity = validateLineups(homeContext, awayContext, snapshotLineups);
    if (validity.valid) {
      if (!lineupsEqual(lineups[homeContext.teamId], snapshotLineups[homeContext.teamId])) {
        reconciliationActions.push({
          type: 'open_lineup_patch',
          team: homeContext.tricode,
          period: game.period,
          clock: secondsToClock(finalClockRemaining),
          from: sortedIds(lineups[homeContext.teamId]),
          to: sortedIds(snapshotLineups[homeContext.teamId]),
          reason: 'live boxscore oncourt authority',
        });
        lineups[homeContext.teamId] = snapshotLineups[homeContext.teamId];
      }
      if (!lineupsEqual(lineups[awayContext.teamId], snapshotLineups[awayContext.teamId])) {
        reconciliationActions.push({
          type: 'open_lineup_patch',
          team: awayContext.tricode,
          period: game.period,
          clock: secondsToClock(finalClockRemaining),
          from: sortedIds(lineups[awayContext.teamId]),
          to: sortedIds(snapshotLineups[awayContext.teamId]),
          reason: 'live boxscore oncourt authority',
        });
        lineups[awayContext.teamId] = snapshotLineups[awayContext.teamId];
      }
    }
  }

  accrueInterval(finalClockRemaining, isFinal ? 'final_close' : 'live_open_stint');
  if (isFinal && openPossession) {
    closeOpenPossession('final_game_close', currentScore, { period: game.period, remaining: finalClockRemaining, clock: game.gameClock || 'PT0M00.00S' });
  }

  const resolvedWindows = resolveWindows(rawWindows);
  const homeRows = buildPlayerRows(homeContext);
  const awayRows = buildPlayerRows(awayContext);
  const minuteAudit = [...homeRows, ...awayRows]
    .map((row) => ({
      personId: row.personId,
      name: row.name,
      parsedMinutes: row.parsedMinutes,
      boxMinutes: row.boxMinutes,
      deltaSeconds: row.minuteDeltaSec,
      onPlusMinusDelta: row.onPlusMinusDelta,
      boxPlusMinus: row.boxPlusMinus,
    }))
    .sort((a, b) => Math.abs(b.deltaSeconds) - Math.abs(a.deltaSeconds));

  const plusMinusAudit = [...homeRows, ...awayRows]
    .filter((row) => row.boxPlusMinus != null)
    .map((row) => ({
      personId: row.personId,
      name: row.name,
      parsedPlusMinus: row.on.plusMinus,
      boxPlusMinus: row.boxPlusMinus,
      delta: row.onPlusMinusDelta,
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const boxOnCourtHome = sortedIds(getSnapshotOnCourt(latestSnapshot, homeContext.teamId).length
    ? getSnapshotOnCourt(latestSnapshot, homeContext.teamId)
    : (game.homeTeam.players ?? []).filter((player) => String(player.oncourt) === '1').map((player) => Number(player.personId)));
  const boxOnCourtAway = sortedIds(getSnapshotOnCourt(latestSnapshot, awayContext.teamId).length
    ? getSnapshotOnCourt(latestSnapshot, awayContext.teamId)
    : (game.awayTeam.players ?? []).filter((player) => String(player.oncourt) === '1').map((player) => Number(player.personId)));

  const countedPossessions = possessions.filter((p) => p.counted);
  const impossiblePossessions = possessions.filter((p) => p.impossible);
  const homePoss = countedPossessions.filter((p) => p.teamId === homeContext.teamId).length;
  const awayPoss = countedPossessions.filter((p) => p.teamId === awayContext.teamId).length;
  const lineupStateValid = !structuralErrors.length;
  const widespreadPlusMinusMismatch = plusMinusAudit.filter((item) => Math.abs(item.delta) > 3).length >= 4;
  const minuteTrust = Math.abs(minuteAudit[0]?.deltaSeconds ?? 0) <= 5;
  const possessionBalanceReasonable = Math.abs(homePoss - awayPoss) <= 2;
  const trusted = lineupStateValid && !impossiblePossessions.length && possessionBalanceReasonable && !widespreadPlusMinusMismatch && minuteTrust;

  return {
    meta: {
      gameId: game.gameId,
      gameStatus: game.gameStatus,
      gameStatusText: game.gameStatusText,
      period: game.period,
      gameClock: game.gameClock,
      snapshotsStored: snapshots.length,
      lastSnapshotAt: latestSnapshot?.capturedAt ?? null,
    },
    teams: {
      home: { teamId: homeContext.teamId, tricode: homeContext.tricode, name: homeContext.name, players: homeRows },
      away: { teamId: awayContext.teamId, tricode: awayContext.tricode, name: awayContext.name, players: awayRows },
    },
    diagnostics: {
      validation: {
        trusted,
        lineupStateValid,
        impossiblePossessions: impossiblePossessions.length,
        countedPossessions: countedPossessions.length,
        homeCountedPossessions: homePoss,
        awayCountedPossessions: awayPoss,
        possessionBalanceReasonable,
        widespreadPlusMinusMismatch,
        largestMinuteDeltaSec: minuteAudit[0]?.deltaSeconds ?? 0,
      },
      resolution: {
        status: trusted ? 'trusted' : structuralInvalid || impossiblePossessions.length ? 'untrusted' : 'warning',
        largestMinuteDeltaSec: minuteAudit[0]?.deltaSeconds ?? 0,
        currentLineups: {
          parsedHome: sortedIds(lineups[homeContext.teamId]),
          parsedAway: sortedIds(lineups[awayContext.teamId]),
          boxHome: boxOnCourtHome,
          boxAway: boxOnCourtAway,
          homeMatches: boxOnCourtHome.length ? lineupsEqual(lineups[homeContext.teamId], boxOnCourtHome) : null,
          awayMatches: boxOnCourtAway.length ? lineupsEqual(lineups[awayContext.teamId], boxOnCourtAway) : null,
        },
      },
      minuteAudit,
      plusMinusAudit,
      warnings: [...new Set(warnings)].slice(0, 150),
      structuralErrors: [...new Set(structuralErrors)].slice(0, 100),
      reconciliationActions,
      normalizedEvents: normalized.slice(0, 200).map((event) => ({
        eventId: event.eventId,
        period: event.period,
        clock: event.clock,
        teamId: event.teamId,
        possessionTeamId: event.possessionTeamId,
        actionType: event.actionType,
        subType: event.subType,
        descriptor: event.descriptor,
        pointsScored: event.pointsScored,
        isShotAttempt: event.isShotAttempt,
        isFreeThrow: event.isFreeThrow,
        isFinalFreeThrow: event.isFinalFreeThrow,
        isRebound: event.isRebound,
        isTurnover: event.isTurnover,
        isFoul: event.isFoul,
        isSubstitution: event.isSubstitution,
        description: event.description,
      })),
      clusters: clusterDebug.slice(0, 120),
      subBatches: subBatches.slice(0, 120),
      rawLineupWindows: rawWindows.slice(0, 160),
      resolvedLineupWindows: resolvedWindows.slice(0, 160),
      possessions: possessions.slice(0, 160),
      openPossession: openPossession ? {
        id: openPossession.id,
        teamId: openPossession.teamId,
        team: contextsByTeamId[openPossession.teamId]?.tricode || String(openPossession.teamId),
        period: openPossession.period,
        startClock: openPossession.startClock,
        scoreOpen: formatScore(openPossession.scoreOpen),
        triggerLineup: openPossession.triggerLineup,
        countedLineup: openPossession.countedLineup,
      } : null,
    },
  };
}

module.exports = { reconcileGame };
