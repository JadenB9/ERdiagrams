// Returns the MLB ER diagram text definition for the text input
function loadMLBText() {
  return `# MLB Baseball Database ER Diagram
# CS3610 - HW7 ER Modeling Lab

ENTITY Player: *player_id, name, birthday, birth_city, batting_hand, throwing_hand, first_game_date, last_game_date, {positions}
ENTITY Team: *team_id, name, league, year_founded, most_recent_year

WEAK TeamSeason: ~year, games, wins, losses, ranking, attendance
WEAK BattingStats: ~year, at_bats, strikeouts, steals, walks, hits, singles, doubles, triples, home_runs
WEAK PitchingStats: ~year, earned_runs, outs_pitched, saves, starts, wins, losses, walks, strikeouts
WEAK FieldingStats: ~year, errors, put_outs
WEAK CatchingStats: ~year, passed_balls, steals_caught, steals_allowed

REL plays_for (Player, TeamSeason) M:N partial/total [games_played, salary]
IDENT has_season (Team, TeamSeason) 1:N partial/total
IDENT has_batting (Player, BattingStats) 1:N partial/total
IDENT has_pitching (Player, PitchingStats) 1:N partial/total
IDENT has_fielding (Player, FieldingStats) 1:N partial/total
IDENT has_catching (Player, CatchingStats) 1:N partial/total`;
}
