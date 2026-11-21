import { PlatformError, type LeaderboardEntry, type Leaderboards, type Outcome } from '@playbridge/core';

export interface FacebookLeaderboardEntry {
  getPlayer(): { getID(): string | null; getName(): string };
  getScore(): number;
  getRank(): number;
  getTimestamp(): number;
  getExtraData(): string | null;
}

export interface FacebookLeaderboard {
  getEntriesAsync(count: number, offset: number): Promise<FacebookLeaderboardEntry[]>;
  getConnectedPlayerEntriesAsync(count: number, offset: number): Promise<FacebookLeaderboardEntry[]>;
  getPlayerEntryAsync(): Promise<FacebookLeaderboardEntry | null>;
  setScoreAsync(score: number, extraData: string): Promise<FacebookLeaderboardEntry>;
}

function entry(value: FacebookLeaderboardEntry): LeaderboardEntry {
  const player = value.getPlayer();
  return { playerId: player.getID(), playerName: player.getName(), score: value.getScore(), rank: value.getRank(),
    timestamp: value.getTimestamp(), extraData: value.getExtraData() };
}

export function createFacebookLeaderboards(get: (name: string) => Promise<FacebookLeaderboard>): Leaderboards {
  async function run<T>(name: string, operation: (board: FacebookLeaderboard) => Promise<T>): Promise<Outcome<T>> {
    if (!name.trim()) return { status: 'failed', error: new Error('A configured Facebook leaderboard name is required.') };
    try { return { status: 'completed', value: await operation(await get(name)) }; }
    catch (error) { return { status: error instanceof PlatformError ? error.status : 'failed', error }; }
  }
  return {
    entries: (name, scope, count, offset) => run(name, async board =>
      (await (scope === 'connected' ? board.getConnectedPlayerEntriesAsync(count, offset) : board.getEntriesAsync(count, offset))).map(entry)),
    playerEntry: name => run(name, async board => {
      const result = await board.getPlayerEntryAsync();
      return result ? entry(result) : null;
    }),
    submitScore: (name, score, metadata) => run(name, async board => entry(await board.setScoreAsync(score, metadata))),
  };
}
