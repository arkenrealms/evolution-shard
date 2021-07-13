import * as leaderboard from './leaderboard'

export const init = async (db) => {
  await leaderboard.init(db)
}

export const crawl = async (db) => {
  await leaderboard.crawl(db)
}
