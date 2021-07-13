export const operationId = 'getInfo'
export const run = async (options, db, req, res) => {
  return res.data({
      version: '0.10.0',
      clientTotal: db.clientTotal,
      recentPlayersTotal: db.recentPlayersTotal,
      spritesTotal: db.spritesTotal,
      connectedPlayers: db.clients.map(c => c.name)
  })
}
