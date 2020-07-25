# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [1.4.0] - 2020-07-21
### Added
-Leaderboards now print automatically on the hour.
-!pending now displays the elo of the players at the time of matchmaking.
-Elo gain/loss is now displayed upon match reporting.
-!autoqueue (!aq) added. Use "!autoqueue <Queue Name>" to toggle.
-!matchhistory (!mh/!history/!hist) added. You can view all of your completed matches.
-New leaderboard for top 25 total games played. "!leaderboard "total games"" to view it.
-!headtohead now displays the total record, overall winrate, and elo gained/lost.
-!profile now includes total record, overall winrate, and average elo.
### Changed
-!pending now always returns matches in order.
-!profile, !headtohead, and the leaderboards now follow a set order as well.
-Maximum time limit for matchmaking increased from 6 to 12 hours.
### Fixed
-!pending, !profile, and !headtohead now split the message if the result is too long.
-!registerlist now prunes enclosing angle brackets.
-Undoing a match will no longer result in an incorrect deadline.
-Added a delay between printing leaderboards, so they should end up out of order less often.
### Admin
-!startprintingleaderboards and !setmatchmakingrequirements are now deprecated. I'm leaving them in just in case, but they should no longer be necessary nor work properly.
-!oldestmatches (!oldest/!old) added.
-!changelogs (!changelog) added.
-!rawsqlite now properly throws an error if there's an issue.
-!trymatchmaking and leaderboard printing now stall 2s between each queue.
-Matchmaker now returns properly if there are no users in queue.
-Added extra TEMP logging for realtime role updates.
-!signup now specifies N/A for Extra Parameter if nothing is supplied.
-Average Elo now rounds.