import jetpack from 'fs-jetpack'
import axios from 'axios'
import semver from 'semver/preload.js'
import { log, logError, getTime, shuffleArray, random, randomPosition, sha256, decodePayload, isNumeric } from './util'

const path = require('path')
const shortId = require('shortid')

const mapData = jetpack.read(path.resolve('./public/data/map.json'), 'json')

const serverVersion = "1.6.3"
let io
let observers = []
const testMode = false
let roundLoopTimeout
const addressToUsername = {}
let announceReboot = false
let rebootAfterRound = false
let totalLegitPlayers = 0
const debugQueue = false
const killSameNetworkClients = false
const sockets = {} // to storage sockets
const clientLookup = {}
const powerups = []
const powerupLookup = {}
let currentReward
const orbs = []
const orbLookup = {}
let eventQueue = []
let clients = [] // to storage clients
let lastReward
let lastLeaderName
let round = {
  id: 1,
  startedAt: Math.round(getTime() / 1000),
  events: [],
  states: [],
  players: []
}
const ranks = {}
const realmServer = {
  socket: undefined
}
const rsCallbacks = {}

const baseConfig = {
  damagePerTouch: 2,
  periodicReboots: false,
  startAvatar: 0,
  spriteXpMultiplier: 1,
  forcedLatency: 0,
  isRoundPaused: false,
  level2forced: false,
  level2allowed: true,
  level2open: false,
  level3open: false,
  hideMap: false,
  dynamicDecayPower: true,
  decayPowerPerMaxEvolvedPlayers: 0.2,
  pickupCheckPositionDistance: 1,
  playersRequiredForLevel2: 15,
  preventBadKills: false,
  colliderBuffer: 0.05,
  stickyIslands: false,
  antifeed2: true,
  antifeed3: false,
  antifeed4: true,
  isBattleRoyale: false,
  isGodParty: false,
  avatarDirection: 1,
  calcRoundRewards: true,
  rewardItemAmountPerLegitPlayer: 0,
  rewardItemAmountMax: 0,
  rewardWinnerAmountPerLegitPlayer: 0,
  rewardWinnerAmountMax: 0,
  flushEventQueueSeconds: 0.02,
  log: {
    connections: false
  },
  anticheat: {
    enabled: false,
    samePlayerCantClaimRewardTwiceInRow: false,
    disconnectPositionJumps: false
  },
  optimization: {
    sendPlayerUpdateWithNoChanges: true
  }
}

const sharedConfig = {
  antifeed1: true,
  avatarDecayPower0: 1.5,
  avatarDecayPower1: 2.5,
  avatarDecayPower2: 3,
  avatarTouchDistance0: 0.25 * 0.7,
  avatarTouchDistance1: 0.3 * 0.7,
  avatarTouchDistance2: 0.35 * 0.7,
  avatarSpeedMultiplier0: 1,
  avatarSpeedMultiplier1: 1,
  avatarSpeedMultiplier2: 0.85,
  baseSpeed: 3,
  cameraSize: 3,
  checkConnectionLoopSeconds: 2,
  checkInterval: 1,
  checkPositionDistance: 2,
  claimingRewards: false,
  decayPower: 1.4,
  disconnectPlayerSeconds: testMode ? 999 : 30,
  disconnectPositionJumps: true, // TODO: remove
  fastestLoopSeconds: 0.02,
  fastLoopSeconds: 0.02,
  gameMode: 'Standard',
  immunitySeconds: 5,
  isMaintenance: false,
  leadercap: false,
  maxEvolves: 3,
  noBoot: testMode,
  noDecay: testMode,
  orbCutoffSeconds: testMode? 0 : 60,
  orbOnDeathPercent: 25,
  orbTimeoutSeconds: testMode ? 3 : 10,
  pickupDistance: 0.3,
  pointsPerEvolve: 1,
  pointsPerKill: 20,
  pointsPerOrb: 1,
  pointsPerPowerup: 1,
  pointsPerReward: 5,
  powerupXp0: 2,
  powerupXp1: 4,
  powerupXp2: 8,
  powerupXp3: 16,
  resetInterval: 3.1,
  rewardItemAmount: 0,
  rewardItemName: '?',
  rewardItemType: 0,
  rewardSpawnLoopSeconds: testMode ? 1 : 3 * 60 / 20,
  rewardWinnerAmount: 0,
  rewardWinnerName: 'ZOD',
  roundLoopSeconds: testMode ? 2 * 60 : 5 * 60,
  sendUpdateLoopSeconds: 3,
  slowLoopSeconds: 1,
  spritesPerPlayerCount: 1,
  spritesStartCount: 50,
  spritesTotal: 50
}

let config = {
  ...baseConfig,
  ...sharedConfig
}

const presets = [
  {
    gameMode: 'Standard',
    pointsPerEvolve: 1,
    pointsPerPowerup: 1,
    pointsPerKill: 20,
    pointsPerReward: 5,
  },
  {
    gameMode: 'Lets Be Friends',
    pointsPerKill: -200,
    orbOnDeathPercent: 0,
    antifeed1: false,
    antifeed2: false,
    calcRoundRewards: false,
    preventBadKills: false
  },
  {
    gameMode: 'Mix Game 1',
    pointsPerEvolve: 2,
    pointsPerPowerup: 2,
    pointsPerKill: 50,
    pointsPerReward: 10,
  },
  {
    gameMode: 'Mix Game 2',
    pointsPerEvolve: 10,
    pointsPerKill: 200,
    pointsPerReward: 20,
  },
  {
    gameMode: 'Deathmatch',
    pointsPerKill: 300,
    orbOnDeathPercent: 0,
    pointsPerEvolve: 0,
    pointsPerPowerup: 1,
    pointsPerReward: 0,
    baseSpeed: 4,
    antifeed1: false,
    dynamicDecayPower: true,
    decayPowerPerMaxEvolvedPlayers: 0.2,
  },
  {
    gameMode: 'Evolution',
    pointsPerEvolve: 10,
  },
  {
    gameMode: 'Orb Master',
    // orbOnDeathPercent: 25,
    orbTimeoutSeconds: 3,
    pointsPerOrb: 200,
    pointsPerEvolve: 0,
    pointsPerReward: 0,
    pointsPerKill: 0,
    orbCutoffSeconds: 0
  },
  {
    gameMode: 'Sprite Leader',
    spritesPerPlayerCount: 10,
    // decayPower: 7,
    avatarDecayPower0: 2,
    avatarDecayPower1: 2 * (7 / 1.4),
    avatarDecayPower2: 3 * (7 / 1.4),
    pointsPerEvolve: 0,
    pointsPerPowerup: 2,
    pointsPerReward: 0,
    pointsPerKill: 0,
    immunitySeconds: 10,
    orbOnDeathPercent: 0,
  },
  {
    gameMode: 'Fast Drake',
    avatarSpeedMultiplier2: 1.5,
    decayPower: 4,
    immunitySeconds: 10,
    orbOnDeathPercent: 0,
    spritesPerPlayerCount: 3,
  },
  {
    gameMode: 'Bird Eye',
    cameraSize: 6,
    baseSpeed: 4,
    decayPower: 2.8,
  },
  {
    gameMode: 'Friendly Reverse',
    pointsPerKill: -200,
    orbOnDeathPercent: 0,
    antifeed1: false,
    antifeed2: false,
    pointsPerEvolve: 25,
    decayPower: -3,
    dynamicDecayPower: false,
    avatarDecayPower0: 4,
    avatarDecayPower1: 3,
    avatarDecayPower2: 2,
    spriteXpMultiplier: -1,
    spritesPerPlayerCount: 10,
    preventBadKills: false
  },
  {
    gameMode: 'Reverse Evolve',
    startAvatar: 2,
    decayPower: -1,
    antifeed1: false,
    antifeed2: false,
    dynamicDecayPower: false,
    avatarDecayPower0: 4,
    avatarDecayPower1: 3,
    avatarDecayPower2: 2,
    spriteXpMultiplier: -2,
    // avatarDirection: -1
  },
  {
    gameMode: 'Marco Polo',
    cameraSize: 2,
    baseSpeed: 3,
    decayPower: 1.4,
    avatarSpeedMultiplier0: 1,
    avatarSpeedMultiplier1: 1,
    avatarSpeedMultiplier2: 1,
    hideMap: true
  },
  {
    gameMode: 'Leadercap',
    leadercap: true
  },
  {
    gameMode: 'Sticky Mode',
    stickyIslands: true,
    colliderBuffer: 0
  },
  // {
  //   gameMode: 'Storm Cuddle',
  //   fortnight: true
  // },
]

let currentPreset = presets[(Math.floor(Math.random() * presets.length))]
let roundConfig = {
  ...baseConfig,
  ...sharedConfig,
  ...currentPreset
}

const spawnBoundary1 = {
  x: {min: -17, max: 0},
  y: {min: -13, max: -4}
}

const spawnBoundary2 = {
  x: {min: -37, max: 0},
  y: {min: -13, max: -2}
}

const mapBoundary = {
  x: {min: -38, max: 2},
  y: {min: -20, max: 2}
}


const playerSpawnPoints = [
  {x: -4.14, y: -11.66},
  {x: -11.14, y: -8.55},
  {x: -12.27, y: -14.24},
  {x: -7.08, y: -12.75},
  {x: -7.32, y: -15.29},
]

//auxiliary function to sort the best players
function comparePlayers(a, b) {
  if (a.points > b.points) {
    // if (a.isDead) {
    //   return 1
    // }
    return -1
  }
  if (a.points < b.points) {
    // if (b.isDead) {
    //   return -1
    // }
    return 1
  }

  return 0
}

function emitAll(...args) {
  // log('emitAll', ...args)
  io.emit(...args)
}

function emitElse(socket, ...args) {
  log('emitElse', ...args)

  if (!socket || !socket.emit) {
    io.emit(...args)
    return
  }

  socket.broadcast.emit('Events', getPayload([[...args]].map(e => `["${e[0]}","${e.slice(1).join(':')}"]`)))
  // socket.broadcast.emit(...args)
}

function emitDirect(socket, ...args) {
  log('emitDirect', ...args)

  if (!socket || !socket.emit) return

  const eventQueue = [[...args]]
  const compiled = []
  for (const e of eventQueue) {
    const name = e[0]
    const args = e.slice(1)
    
    compiled.push(`["${name}","${args.join(':')}"]`)

    round.events.push({ type: 'emitDirect', player: socket.id, name, args })
  }

  socket.emit('Events', getPayload(compiled))
}

function emitAllFast(socket, ...args) {
  log('emitAllFast', ...args)

  if (!socket || !socket.emit) {
    io.emit(...args)
    return
  }

  socket.emit(...args)
  socket.broadcast.emit(...args)
}

function publishEvent(...args) {
  // console.log(args)
  eventQueue.push(args)
}

async function rsCall(name, data = {}) {
  return new Promise(resolve => {
    const id = shortId()
    
    rsCallbacks[id] = resolve

    if (!realmServer.socket) {
      logError('Not connected to realm server.')
      return
    }

    log('Emit', name, { id, data })

    realmServer.socket.emit(name, { id, data })
  })
}

async function normalizeAddress(address) {
  try {
    const res = await rsCall('GS_NormalizeAddressRequest', { address }) as any
    return res
  } catch(e) {
    logError(e)
    return false
  }
}

async function verifySignature(signature, address) {
  log('Verifying', signature, address)
  try {
    const res = await rsCall('GS_VerifySignatureRequest', { value: signature.value, hash: signature.hash, address }) as any
    return res === true
  } catch(e) {
    logError(e)
    return false
  }
}

async function verifyAdminSignature(signature, address) {
  log('Verifying', signature, address)
  try {
    const res = await rsCall('GS_VerifyAdminSignatureRequest', { value: signature.value, hash: signature.hash, address }) as any
    return res
  } catch(e) {
    logError(e)
    return false
  }
}

async function spawnRandomReward() {
  if (currentReward) {
    return
  }
  
  removeReward()

  const tempReward = await rsCall('GS_GetRandomRewardRequest') as any

  console.log(tempReward)

  if (!tempReward) {
    setTimeout(spawnRandomReward, 1 * 1000)
    return
  }

  if (tempReward.type !== 'rune') {
    publishEvent('OnBroadcast', `Powerful Energy Detected - ${config.rewardItemName}`, 3)
  }

  setTimeout(() => {
    currentReward = JSON.parse(JSON.stringify(tempReward))

    publishEvent('OnSpawnReward', currentReward.id, config.rewardItemType, config.rewardItemName, config.rewardItemAmount, currentReward.position.x, currentReward.position.y)

    setTimeout(() => {
      if (!currentReward) return
      if (currentReward.id !== tempReward.id) return
      
      removeReward()
    }, 30 * 1000)
  }, 3 * 1000)
}

function disconnectAllPlayers() {
  if (clients.length === 0) return

  log('Disconnecting all players')

  for (let i = 0; i < clients.length; i++) {
    const client = clients[i]
    disconnectPlayer(client)
  }
}

function monitorObservers() {
  updateObservers()

  if (observers.length === 0) {
    publishEvent('OnBroadcast', `Realm not connected. Contact support.`, 0)

    disconnectAllPlayers()
  }

  setTimeout(monitorObservers, 5 * 1000)
}

setTimeout(monitorObservers, 30 * 1000)

function moveVectorTowards(current, target, maxDistanceDelta) {
  const a = {
    x: target.x - current.x,
    y: target.y - current.y
  }

  const magnitude = Math.sqrt(a.x * a.x + a.y * a.y)

  if (magnitude <= maxDistanceDelta || magnitude == 0)
      return target

  return {
    x: current.x + a.x / magnitude * maxDistanceDelta,
    y: current.y + a.y / magnitude * maxDistanceDelta
  }
}

async function claimReward(currentPlayer, reward) {
  if (!reward) return

  if (config.anticheat.samePlayerCantClaimRewardTwiceInRow && lastReward?.winner.name === currentPlayer.name) return

  const claimRewardRes = await rsCall('GS_ClaimRewardRequest', { reward, currentPlayer }) as any

  if (claimRewardRes.success !== 1) {
    publishEvent('OnBroadcast', `Problem claiming reward. Contact support.`, 3)
  }

  reward.winner = currentPlayer

  publishEvent('OnUpdateReward', currentPlayer.id, reward.id)

  currentPlayer.rewards += 1
  currentPlayer.points += config.pointsPerReward

  lastReward = reward

  currentReward = null
}

function randomizeSpriteXp() {
  const shuffledValues = shuffleArray([2, 4, 8, 16])
  config.powerupXp0 = shuffledValues[0]
  config.powerupXp1 = shuffledValues[1]
  config.powerupXp2 = shuffledValues[2]
  config.powerupXp3 = shuffledValues[3]
}

async function getUsername(address: string): Promise<string> {
  try {
    log(`Getting username for ${address}`)
    const response = await axios(`https://rune-api.binzy.workers.dev/users/${address}`)

    // const data = await response.json()

    const { username = '' } = response.data as any
  
    return username
  } catch (error) {
    return 'Guest' + Math.floor(Math.random() * 999)
  }
}

function distanceBetweenPoints(pos1, pos2) {
  return Math.hypot(pos1.x - pos2.x, pos1.y - pos2.y)
}

function syncSprites() {
  log('Syncing sprites')
  const playerCount = clients.filter(c => !c.isDead && !c.isSpectating && !c.isInvincible).length
  const length = config.spritesStartCount + playerCount * config.spritesPerPlayerCount

  if (powerups.length > length) {
    const deletedPoints = powerups.splice(length)
  
    for (let i = 0; i < deletedPoints.length; i++) {
      publishEvent('OnUpdatePickup', 'null', deletedPoints[i].id, 0)
      // delete powerupLookup[deletedPoints[i].id]
    }

    config.spritesTotal = length
  } else if (length > powerups.length) {
    spawnSprites(length - powerups.length)
  }
}

function disconnectPlayer(player) {
  if (player.isDisconnected) return

  try {
    log("Disconnecting", player.id)

    player.isDisconnected = true
    player.isDead = true
    player.joinedAt = 0
    player.latency = 0
    publishEvent('OnUserDisconnected', player.id)

    let totalAlivePlayers = []

    for (let i = 0; i < clients.length; i++) {
      if (!clients[i].isSpectating && !clients[i].isDead) {
        totalAlivePlayers.push(clients[i])
      }

      if (clients[i].id == player.id) {
        clients.splice(i, 1)
      }
    }

    if (sockets[player.id] && sockets[player.id].emit) {
      emitDirect(sockets[player.id], 'OnUserDisconnected', player.id)

      sockets[player.id].disconnect()

      delete sockets[player.id]
    }

    delete clientLookup[player.id]

    syncSprites()

    if (config.isBattleRoyale && totalAlivePlayers.length === 1) {
      publishEvent('OnBroadcast', `${totalAlivePlayers[0].name} is the last dragon standing`, 3)
    }
  } catch(e) {
    logError(e)
  }
}

function randomRoundPreset() {
  const gameMode = config.gameMode

  while(config.gameMode === gameMode) {
    currentPreset = presets[random(0, presets.length-1)]
  
    roundConfig = {
      ...baseConfig,
      ...sharedConfig,
      ...currentPreset
    }
    config = JSON.parse(JSON.stringify(roundConfig))
  }
}

function removeSprite(id) {
  if (powerupLookup[id]) {
    delete powerupLookup[id]
  }
  
  for (let i = 0; i < powerups.length; i++) {
    if (powerups[i].id == id) {
      powerups.splice(i, 1)
    }
  }
}

function removeOrb(id) {
  if (orbLookup[id]) {
    delete orbLookup[id]
  }
  
  for (let i = 0; i < orbs.length; i++) {
    if (orbs[i].id == id) {
      orbs.splice(i, 1)
    }
  }
}

function removeReward() {
  if (!currentReward) return
  publishEvent('OnUpdateReward', 'null', currentReward.id)
  currentReward = undefined
}

function getUnobstructedPosition() {
  const spawnBoundary = config.level2open ? spawnBoundary2 : spawnBoundary1

  let res

  while(!res) {
    let collided = false

    const position = {
      x: randomPosition(spawnBoundary.x.min, spawnBoundary.x.max),
      y: randomPosition(spawnBoundary.y.min, spawnBoundary.y.max)
    }
  
    for (const gameObject of mapData) {
      if (!gameObject.Colliders || !gameObject.Colliders.length) continue

      for (const gameCollider of gameObject.Colliders) {
        const collider = {
          minX: gameCollider.Min[0],
          maxX: gameCollider.Max[0],
          minY: gameCollider.Min[1],
          maxY: gameCollider.Max[1]
        }

        if (config.level2open && gameObject.Name === 'Level2Divider') {
          const diff = 25
          collider.minY -= diff
          collider.maxY -= diff
        }

        if (
          position.x >= collider.minX &&
          position.x <= collider.maxX &&
          position.y >= collider.minY &&
          position.y <= collider.maxY
        ) {
          collided = true

          break
        }
      }

      if (collided) break
    }

    if (!collided) {
      res = position
    }
  }

  return res
}

function spawnSprites(amount) {
  for (let i = 0; i < amount; i++) {
    const position = getUnobstructedPosition()

    const powerupSpawnPoint = {
      id: shortId.generate(),
      type: (Math.floor(Math.random() * 4)),
      scale: 1,
      position
    }

    powerups.push(powerupSpawnPoint) // add power up on the list

    powerupLookup[powerupSpawnPoint.id] = powerupSpawnPoint //add powerup in search engine

    publishEvent('OnSpawnPowerUp', powerupSpawnPoint.id, powerupSpawnPoint.type, powerupSpawnPoint.position.x, powerupSpawnPoint.position.y, powerupSpawnPoint.scale)
  }

  config.spritesTotal = powerups.length
}

function addToRecentPlayers(player) {
  if (!player.address || !player.name) return

  round.players = round.players.filter(r => r.address !== player.address)

  round.players.push(player)
}

async function isValidAdminRequest(hash, address, data) {
  return verifyAdminSignature({ value: JSON.stringify(data), hash }, address)
}

function roundEndingSoon(sec) {
  const roundTimer = (round.startedAt + config.roundLoopSeconds) - Math.round(getTime() / 1000)
  return roundTimer < sec
}

const registerKill = (winner, loser) => {
  const now = getTime()

  if (config.isGodParty) return
  if (winner.isInvincible) return
  if (loser.isInvincible) return
  if (config.preventBadKills && (winner.isPhased || now < winner.phasedUntil)) return

  const totalKills = winner.log.kills.filter(h => h === loser.hash).length
  const notReallyTrying = config.antifeed1 ? (totalKills >= 2 && loser.kills < 2 && loser.rewards <= 1) || (totalKills >= 2 && loser.kills < 2 && loser.powerups <= 100) : false
  const tooManyKills = config.antifeed2 ? clients.length > 2 && totalKills >= 5 && totalKills > winner.log.kills.length / clients.filter(c => !c.isDead).length : false
  const killingThemselves = config.antifeed3 ? winner.hash === loser.hash : false
  const allowKill = !notReallyTrying && !tooManyKills && !killingThemselves
    
  if (notReallyTrying) {
    loser.log.notReallyTrying += 1
  }
  if (tooManyKills) {
    loser.log.tooManyKills += 1
  }
  if (killingThemselves) {
    loser.log.killingThemselves += 1
  }

  if (config.preventBadKills && !allowKill) {
    loser.phasedUntil = getTime() + 2000

    return
  }

  // LV3 vs LV1 = 0.5 * 3 + 0.5 * 2 * 2 = 3.5
  // LV3 vs LV2 = 0.5 * 3 + 0.5 * 1 * 2 = 2.5
  // LV2 vs LV1 = 0.5 * 2 + 0.5 * 1 * 2 = 2
  // loser.xp -= config.damagePerTouch * (winner.avatar + 1) + config.damagePerTouch * (winner.avatar - loser.avatar) * 2

  // if (loser.avatar !== 0 || loser.xp > 0) {
  //   // Can't be killed yet
  //   return
  // }

  winner.kills += 1
  winner.points += config.pointsPerKill * (loser.avatar + 1)
  winner.log.kills.push(loser.hash)

  const orbOnDeathPercent = config.leadercap && loser.name === lastLeaderName ? 75 : config.orbOnDeathPercent
  const orbPoints = Math.floor(loser.points * (orbOnDeathPercent / 100))

  loser.deaths += 1
  loser.points = Math.floor(loser.points * ((100 - orbOnDeathPercent) / 100))
  loser.isDead = true
  loser.log.deaths.push(winner.hash)

  if (winner.points < 0) winner.points = 0
  if (loser.points < 0) loser.points = 0

  if (winner.log.deaths.length && winner.log.deaths[winner.log.deaths.length-1] === loser.hash) {
    winner.log.revenge += 1
  }

  publishEvent('OnGameOver', loser.id, winner.id)

  setTimeout(() => {
    disconnectPlayer(loser)
  }, 2 * 1000)

  const orb = {
    id: shortId.generate(),
    type: 4,
    points: orbPoints,
    scale: orbPoints,
    enabledAt: now + config.orbTimeoutSeconds * 1000,
    position: {
      x: loser.position.x,
      y: loser.position.y
    }
  }

  const currentRound = round.id

  if (config.orbOnDeathPercent > 0 && !roundEndingSoon(config.orbCutoffSeconds)) {
    setTimeout(() => {
      if (round.id !== currentRound) return

      orbs.push(orb)
      orbLookup[orb.id] = orb
  
      publishEvent('OnSpawnPowerUp', orb.id, orb.type, orb.position.x, orb.position.y, orb.scale)
    }, config.orbTimeoutSeconds * 1000)
  }
}

function spectate(currentPlayer) {
  try {
    if (config.isMaintenance && !currentPlayer.isMod) {
      return
    }

    if (currentPlayer.isSpectating) {
      // if (!currentPlayer.isMod) {
        disconnectPlayer(currentPlayer)
        return
      // }
  
      currentPlayer.isSpectating = false
      currentPlayer.isInvincible = false
      currentPlayer.isJoining = true
      currentPlayer.points = 0
      currentPlayer.xp = 100
      currentPlayer.avatar = config.startAvatar
      currentPlayer.speed = config.baseSpeed * config.avatarSpeedMultiplier0
      currentPlayer.overrideSpeed = null
      currentPlayer.cameraSize = config.cameraSize
      currentPlayer.overrideCameraSize = null
  
      syncSprites()
  
      publishEvent('OnUnspectate', currentPlayer.id, currentPlayer.speed, currentPlayer.cameraSize)
    } else {
      currentPlayer.isSpectating = true
      currentPlayer.isInvincible = true
      currentPlayer.points = 0
      currentPlayer.xp = 0
      currentPlayer.avatar = config.startAvatar
      currentPlayer.speed = 7
      currentPlayer.overrideSpeed = 7
      currentPlayer.cameraSize = 8
      currentPlayer.overrideCameraSize = 8
  
      syncSprites()
  
      publishEvent('OnSpectate', currentPlayer.id, currentPlayer.speed, currentPlayer.cameraSize)
    }
  } catch(e) {
    logError(e)
  }
}

function updateObservers() {
  observers = observers.filter(observer => observer.socket.connected)
}

function sendUpdates() {
  publishEvent('OnClearLeaderboard')

  const leaderboard = round.players.sort(comparePlayers).slice(0, 10)
  for (let j = 0; j < leaderboard.length; j++) {
    publishEvent('OnUpdateBestKiller', leaderboard[j].name, j, leaderboard[j].points, leaderboard[j].kills, leaderboard[j].deaths, leaderboard[j].powerups, leaderboard[j].evolves, leaderboard[j].rewards, leaderboard[j].isDead ? '-' : Math.round(leaderboard[j].latency), ranks[leaderboard[j].address]?.kills / 5 || 1)
  }
  
  setTimeout(sendUpdates, config.sendUpdateLoopSeconds * 1000)
}

function spawnRewards() {
  spawnRandomReward()

  setTimeout(spawnRewards, config.rewardSpawnLoopSeconds * 1000)
}

function getRoundInfo() {
  return Object.keys(sharedConfig).sort().reduce(
    (obj, key) => {
      obj.push(config[key])
      return obj;
    }, 
    []
  )
}

function calcRoundRewards() {
  totalLegitPlayers = 1

  for (const client of clients) {
    if (client.name.indexOf('Guest') !== -1 || client.name.indexOf('Unknown') !== -1) continue

    try {
      if ((client.points > 100 && client.kills > 1) || (client.points > 300 && client.evolves > 20 && client.powerups > 200) || (client.rewards > 3 && client.powerups > 200) || (client.evolves > 100) || (client.points > 1000)) {
        totalLegitPlayers += 1
      }
    } catch (e) {
      console.log(e)
    }
  }

  sharedConfig.rewardItemAmount = parseFloat((Math.round(Math.min(totalLegitPlayers * config.rewardItemAmountPerLegitPlayer, config.rewardItemAmountMax) * 1000) / 1000).toFixed(3))
  sharedConfig.rewardWinnerAmount = parseFloat((Math.round(Math.min(totalLegitPlayers * config.rewardWinnerAmountPerLegitPlayer, config.rewardWinnerAmountMax) * 1000) / 1000).toFixed(3))

  config.rewardItemAmount = sharedConfig.rewardItemAmount
  config.rewardWinnerAmount = sharedConfig.rewardWinnerAmount
}

let lastFastGameloopTime = getTime()
let lastFastestGameloopTime = getTime()

async function resetLeaderboard(preset) {
  try {
    updateObservers()

    if (observers.length === 0) {
      publishEvent('OnBroadcast', `Realm not connected. Contact support.`, 0)
      roundLoopTimeout = setTimeout(resetLeaderboard, config.roundLoopSeconds * 1000)
      return
    }

    const fiveSecondsAgo = getTime() - 7000

    const leaders = round.players.filter(p => p.lastUpdate >= fiveSecondsAgo).sort((a, b) => b.points - a.points)

    if (leaders.length) {
      lastLeaderName = leaders[0].name
      log('Leader: ', leaders[0])
    
      if (leaders[0]?.address) {
        publishEvent('OnRoundWinner', leaders[0].name)
      }

      if (config.isBattleRoyale) {
        publishEvent('OnBroadcast', `Top 5 - ${leaders.slice(0, 5).map(l => l.name).join(', ')}`, 0)
      }
    }

    const saveRoundRes = await rsCall('GS_SaveRoundRequest', {
      id: round.id,
      startedAt: round.startedAt,
      leaders: leaders,
      players: round.players
    }) as any

    if (saveRoundRes.success !== 1) {
      publishEvent('OnBroadcast', `Problem saving the round. Contact support.`, 3)
    }

    if (config.calcRoundRewards) {
      calcRoundRewards()
    }

    if (preset) {
      roundConfig = {
        ...baseConfig,
        ...sharedConfig,
        ...preset
      }
      config = JSON.parse(JSON.stringify(roundConfig))
    }
    else {
      randomRoundPreset()
    }

    const roundId = round.id + 1

    round = null
    round = {
      id: roundId,
      startedAt: Math.round(getTime() / 1000),
      players: [],
      events: [],
      states: [],
    }

    for (const client of clients) {
      if (!ranks[client.address]) ranks[client.address] = {}
      if (!ranks[client.address].kills) ranks[client.address].kills = 0

      ranks[client.address].kills += client.kills

      client.points = 0
      client.kills = 0
      client.deaths = 0
      client.evolves = 0
      client.rewards = 0
      client.powerups = 0
      client.avatar = config.startAvatar
      client.orbs = 0
      client.xp = 50
      client.speed = (config.baseSpeed * config['avatarSpeedMultiplier' + client.avatar])
      client.cameraSize = client.overrideCameraSize || config.cameraSize
      client.log = {
        kills: [],
        deaths: [],
        revenge: 0,
        resetPosition: 0,
        phases: 0,
        stuck: 0,
        collided: 0,
        timeoutDisconnect: 0,
        speedProblem: 0,
        clientDistanceProblem: 0,
        outOfBounds: 0,
        ranOutOfHealth: 0,
        notReallyTrying: 0,
        tooManyKills: 0,
        killingThemselves: 0,
        sameNetworkDisconnect: 0,
        connectedTooSoon: 0,
        clientDisconnected: 0,
        positionJump: 0,
        pauses: 0,
        connects: 0,
        path: '',
        positions: 0,
        replay: []
      }
      client.gameMode = config.gameMode

      publishEvent('OnUpdateRegression', client.id, client.avatar, client.speed)

      if (client.isDead || client.isSpectating) continue

      client.startedRoundAt = Math.round(getTime() / 1000)

      round.players.push(client)
    }

    for (let i = 0; i < orbs.length; i++) {
      publishEvent('OnUpdatePickup', 'null', orbs[i].id, 0)
      // socket.broadcast.emit('UpdatePickup', currentPlayer.id, pack.id)
      // orbs.splice(i, 1)
    }

    orbs.splice(0, orbs.length)

    randomizeSpriteXp()

    syncSprites()

    publishEvent('OnSetRoundInfo', config.roundLoopSeconds + ':' + getRoundInfo().join(':')  + '1. Eat sprites to stay alive' + ':' + '2. Avoid bigger dragons' + ':' + '3. Eat smaller dragons')

    publishEvent('OnClearLeaderboard')

    publishEvent('OnBroadcast', `Game Mode - ${config.gameMode} (Round ${round.id})`, 0)

    if (config.hideMap) {
      publishEvent('OnHideMinimap')
      publishEvent('OnBroadcast', `Minimap hidden in this mode!`, 2)
    } else {
      publishEvent('OnShowMinimap')
    }

    if (config.periodicReboots && rebootAfterRound) {
      publishEvent('OnMaintenance', true)

      setTimeout(() => {
        process.exit()
      }, 3 * 1000)
    }

    if (config.periodicReboots && announceReboot) {
      const value = 'Restarting server at end of this round.'

      publishEvent('OnBroadcast', value, 1)
      
      rebootAfterRound = true
    }

    for (const observer of observers) {
      emitDirect(observer.socket, 'GS_StartRound')
    }

    roundLoopTimeout = setTimeout(resetLeaderboard, config.roundLoopSeconds * 1000)
  } catch(e) {
    logError(e)
  }
}

function checkConnectionLoop() {
  if (!config.noBoot && !config.isRoundPaused) {
    const oneMinuteAgo = getTime() - (config.disconnectPlayerSeconds * 1000)
    // const oneMinuteAgo = Math.round(getTime() / 1000) - config.disconnectPlayerSeconds

    for (let i = 0; i < clients.length; i++) {
      const client = clients[i]

      if (client.isSpectating) continue
      // if (client.isInvincible) continue
      // if (client.isDead) continue

      if (client.lastUpdate !== 0 && client.lastUpdate <= oneMinuteAgo) {
        client.log.timeoutDisconnect += 1
        disconnectPlayer(client)
      }
    }
  }
  
  setTimeout(checkConnectionLoop, config.checkConnectionLoopSeconds * 1000)
}

function getPayload(messages) {
  // super-cheap JSON Array construction
  return Buffer.from([ '[', messages.join(','), ']' ].join(''));
}

//updates the list of best players every 1000 milliseconds
function slowGameloop() {
  if (config.dynamicDecayPower) {
    const players = clients.filter(p => !p.isDead && !p.isSpectating)
    const maxEvolvedPlayers = players.filter(p => p.avatar === config.maxEvolves - 1)
    
    // if (maxEvolvedPlayers.length > players.length / 2) {
      config.decayPower = roundConfig.decayPower + (maxEvolvedPlayers.length * config.decayPowerPerMaxEvolvedPlayers)
    // }
  }
  
  setTimeout(slowGameloop, config.slowLoopSeconds * 1000)
}

// function castVectorTowards(position, target, scalar) {
//   const magnitude = Math.sqrt(position.x * position.x + position.y * position.y)

//   return {
//     x: position.x + (target.x - position.x) / magnitude * scalar,
//     y: position.y + (target.y - position.y) / magnitude * scalar
//   }
// }

function detectCollisions() {
  try {
    const now = getTime()
    const currentTime = Math.round(now / 1000)
    const deltaTime = (now - lastFastestGameloopTime) / 1000

    const distanceMap = {
      0: config.avatarTouchDistance0,
      1: config.avatarTouchDistance0,
      2: config.avatarTouchDistance0
    }

    // Update players
    for (let i = 0; i < clients.length; i++) {
      const player = clients[i]

      if (player.isDead) continue
      if (player.isSpectating) continue
      if (player.isJoining) continue

      if (!Number.isFinite(player.position.x) || !Number.isFinite(player.speed)) { // Not sure what happened
        player.log.speedProblem += 1
        disconnectPlayer(player)
        continue
      }

      if (distanceBetweenPoints(player.position, player.clientPosition) > 2) {
        player.phasedUntil = getTime() + 2000
        player.log.phases += 1
        player.log.clientDistanceProblem += 1
      }

      // if (distanceBetweenPoints(player.position, player.clientPosition) > config.checkPositionDistance) {
      //   // Do nothing for now
      //   player.position = moveVectorTowards(player.position, player.clientPosition, player.speed * deltaTime)
      //   player.log.resetPosition += 1
      // } else {
        // if (player.lastReportedTime > )
      let position = moveVectorTowards(player.position, player.clientTarget, (player.overrideSpeed || player.speed) * deltaTime) // castVectorTowards(player.position, player.clientTarget, 9999)
      // let target = castVectorTowards(position, player.clientTarget, 100)

      let outOfBounds = false
      if (position.x > mapBoundary.x.max) {
        position.x = mapBoundary.x.max
        outOfBounds = true
      }
      if (position.x < mapBoundary.x.min) {
        position.x = mapBoundary.x.min
        outOfBounds = true
      }
      if (position.y > mapBoundary.y.max) {
        position.y = mapBoundary.y.max
        outOfBounds = true
      }
      if (position.y < mapBoundary.y.min) {
        position.y = mapBoundary.y.min
        outOfBounds = true
      }

      if (outOfBounds) {
        player.log.outOfBounds += 1
      }

      let collided = false
      let stuck = false

      for (const i in mapData) {
        const gameObject = mapData[i]

        if (!gameObject.Colliders || !gameObject.Colliders.length) continue

        for (const gameCollider of gameObject.Colliders) {
          let collider
          
          if (gameObject.Name.indexOf('Island') === 0) {
            collider = {
              minX: gameCollider.Min[0],
              maxX: gameCollider.Max[0],
              minY: gameCollider.Min[1],
              maxY: gameCollider.Max[1]
            }
          } else {
            collider = {
              minX: gameCollider.Min[0],
              maxX: gameCollider.Max[0],
              minY: gameCollider.Min[1],
              maxY: gameCollider.Max[1]
            }
          }

          if (config.level2open && gameObject.Name === 'Level2Divider') {
            const diff = 25
            collider.minY -= diff
            collider.maxY -= diff
          }

          if (
            position.x >= collider.minX &&
            position.x <= collider.maxX &&
            position.y >= collider.minY &&
            position.y <= collider.maxY
          ) {
            if (gameObject.Name.indexOf('Land') === 0) {
              stuck = true
            }
            else if (gameObject.Name.indexOf('Island') === 0) {
              if (config.stickyIslands) {
                stuck = true
              } else {
                collided = true
              }
            }
            else if (gameObject.Name.indexOf('Collider') === 0) {
              stuck = true
            }
            else if (gameObject.Name.indexOf('Level2Divider') === 0) {
              stuck = true
            }
          }
        }

        if (stuck) break
        if (collided) break
      }

      player.isStuck = false

      if (collided) {
        player.position = position
        player.target = player.clientTarget
        player.phasedUntil = getTime() + 2000
        player.log.phases += 1
        player.log.collided += 1
        player.overrideSpeed = 0.5
      } else if (stuck) {
        player.target = player.clientTarget
        player.phasedUntil = getTime() + 2000
        player.log.phases += 1
        player.log.stuck += 1
        player.overrideSpeed = 0.5
        if (config.stickyIslands) {
          player.isStuck = true
        }
      } else {
        player.position = position
        player.target = player.clientTarget //castVectorTowards(position, player.clientTarget, 9999)
        player.overrideSpeed = null
      }

      const pos = Math.round(player.position.x) + ':' + Math.round(player.position.y)
      
      if (player.log.path.indexOf(pos) === -1) {
        // player.log.path += pos + ','
        player.log.positions += 1
      }
    }

    if (config.level2allowed) {
      if (config.level2forced || clients.filter(c => !c.isSpectating && !c.isDead).length >= config.playersRequiredForLevel2) {
        if (!config.level2open) {
          baseConfig.level2open = true
          config.level2open = true

          publishEvent('OnBroadcast', `Level 2 opening...`, 0)

          setTimeout(() => {
            sharedConfig.spritesStartCount = 200
            config.spritesStartCount = 200
            clearSprites()
            spawnSprites(config.spritesStartCount)
            publishEvent('OnOpenLevel2')
          }, 2 * 1000)
        }
      }

      if (!config.level2forced && clients.filter(c => !c.isSpectating && !c.isDead).length < config.playersRequiredForLevel2 - 7) {
        if (config.level2open) {
          baseConfig.level2open = false
          config.level2open = false

          publishEvent('OnBroadcast', `Level 2 closing...`, 0)

          setTimeout(() => {
            sharedConfig.spritesStartCount = 50
            config.spritesStartCount = 50
            clearSprites()
            spawnSprites(config.spritesStartCount)
            publishEvent('OnCloseLevel2')
          }, 2 * 1000)
        }
      }
    }

    if (!config.isRoundPaused) {
      // Check kills
      for (let i = 0; i < clients.length; i++) {
        const player1 = clients[i]
        const isPlayer1Invincible = player1.isInvincible ? true : ((player1.joinedAt >= currentTime - config.immunitySeconds))
        if (player1.isSpectating) continue
        if (player1.isDead) continue
        if (isPlayer1Invincible) continue

        for (let j = 0; j < clients.length; j++) {
          const player2 = clients[j]
          const isPlayer2Invincible = player2.isInvincible ? true : ((player2.joinedAt >= currentTime - config.immunitySeconds))

          if (player1.id === player2.id) continue
          if (player2.isDead) continue
          if (player2.isSpectating) continue
          if (isPlayer2Invincible) continue
          if (player2.avatar === player1.avatar) continue

          // console.log(player1.position, player2.position, distanceBetweenPoints(player1.position.x, player1.position.y, player2.position.x, player2.position.y))

          const distance = distanceMap[player1.avatar] + distanceMap[player2.avatar] //Math.max(distanceMap[player1.avatar], distanceMap[player2.avatar]) + Math.min(distanceMap[player1.avatar], distanceMap[player2.avatar])

          if (distanceBetweenPoints(player1.position, player2.position) > distance) continue

          if (player2.avatar > player1.avatar) {
            // if (distanceBetweenPoints(player2.position, player2.clientPosition) > config.pickupCheckPositionDistance) continue
            // playerDamageGiven[currentPlayer.id + pack.id] = now
            // // console.log('Player Damage Given', currentPlayer.id + pack.id)
            // if (playerDamageTaken[currentPlayer.id + pack.id] > now - 500) {
              // if (player1.xp > 5) {
                // player1.xp -= 1
              // } else {
                registerKill(player2, player1)
              // }
              break
            // }
          } else if (player1.avatar > player2.avatar) {
            // if (distanceBetweenPoints(player1.position, player1.clientPosition) > config.pickupCheckPositionDistance) continue
            // playerDamageGiven[pack.id + currentPlayer.id] = now
            // // console.log('Player Damage Given', pack.id + currentPlayer.id)
            // if (playerDamageTaken[pack.id + currentPlayer.id] > now - 500) {
              // if (player2.xp > 5) {
              //   player2.xp -= 1
              // } else {
                registerKill(player1, player2)
              // }
              break
            // }
          }
        }
      }

      // Check pickups
      for (let i = 0; i < clients.length; i++) {
        const player = clients[i]

        if (player.isDead) continue
        if (player.isSpectating) continue
        if (player.isPhased || now < player.phasedUntil) continue
        // console.log(player.position, player.clientPosition, distanceBetweenPoints(player.position, player.clientPosition))
        // console.log(currentReward)
        // if (distanceBetweenPoints(player.position, player.clientPosition) > config.pickupCheckPositionDistance) continue

        const touchDistance = config.pickupDistance + config['avatarTouchDistance' + player.avatar]

        for (const powerup of powerups) {
          if (distanceBetweenPoints(player.position, powerup.position) > touchDistance) continue

          let value = 0

          if (powerup.type == 0) value = config.powerupXp0
          if (powerup.type == 1) value = config.powerupXp1
          if (powerup.type == 2) value = config.powerupXp2
          if (powerup.type == 3) value = config.powerupXp3

          player.powerups += 1
          player.points += config.pointsPerPowerup
          player.xp += (value * config.spriteXpMultiplier)
      
          publishEvent('OnUpdatePickup', player.id, powerup.id, value)

          removeSprite(powerup.id)
          spawnSprites(1)
        }

        const currentTime = Math.round(now / 1000)
        const isNew = player.joinedAt >= currentTime - config.immunitySeconds || player.isInvincible

        if (!isNew) {
          for (const orb of orbs) {
            if (!orb) continue
            if (now < orb.enabledAt) continue
            if (distanceBetweenPoints(player.position, orb.position) > touchDistance) continue
      
            player.orbs += 1
            player.points += orb.points
            player.points += config.pointsPerOrb
      
            publishEvent('OnUpdatePickup', player.id, orb.id, 0)
      
            removeOrb(orb.id)
          }
      
          const rewards = [currentReward]

          for (const reward of rewards) {
            if (!reward) continue
            if (now < reward.enabledAt) continue
            // console.log(distanceBetweenPoints(player.position, reward.position), player.position, reward.position, touchDistance)
            if (distanceBetweenPoints(player.position, reward.position) > touchDistance) continue
      
            // player.rewards += 1
            // player.points += config.pointsPerReward
      
            claimReward(player, reward)
            removeReward()
          }
        }
      }
    }

    lastFastestGameloopTime = now
  } catch (e) {
    console.log(e)
  }
}

function fastestGameloop() {
  // detectCollisions()

  setTimeout(fastestGameloop, config.fastestLoopSeconds * 1000)
}

function fastGameloop() {
  try {
    const now = getTime()

    detectCollisions()

    for (let i = 0; i < clients.length; i++) {
      const client = clients[i]

      if (client.isDisconnected) continue
      if (client.isDead) continue
      if (client.isSpectating) continue
      if (client.isJoining) continue

      const currentTime = Math.round(now / 1000)
      const isInvincible = config.isGodParty || (client.isInvincible ? true : ((client.joinedAt >= currentTime - config.immunitySeconds)))
      const isPhased = client.isPhased ? true : now <= client.phasedUntil

      client.speed = client.overrideSpeed || (config.baseSpeed * config['avatarSpeedMultiplier' + client.avatar])

      if (!config.isRoundPaused) {
        let decay = config.noDecay ? 0 : (client.avatar + 1) / (1 / config.fastLoopSeconds) * ((config['avatarDecayPower' + client.avatar] || 1) * config.decayPower)
  
        if (client.xp > 100) {
          if (decay > 0) {
            if (client.avatar < (config.maxEvolves - 1)) {
              client.xp = client.xp - 100
              client.avatar = Math.max(Math.min(client.avatar + (1 * config.avatarDirection), config.maxEvolves - 1), 0)
              client.evolves += 1
              client.points += config.pointsPerEvolve
      
              if (config.leadercap && client.name === lastLeaderName) {
                client.speed = client.speed * 0.9
              }
      
              publishEvent('OnUpdateEvolution', client.id, client.avatar, client.speed)
            } else {
              client.xp = 100
            }
          } else {
            if (client.avatar >= (config.maxEvolves - 1)) {
              client.xp = 100
              // const currentTime = Math.round(now / 1000)
              // const isNew = client.joinedAt >= currentTime - config.immunitySeconds
                
              // if (!config.noBoot && !isInvincible && !isNew) {
              //   disconnectPlayer(client)
              // }
            } else {
              client.xp = client.xp - 100
              client.avatar = Math.max(Math.min(client.avatar + (1 * config.avatarDirection), config.maxEvolves - 1), 0)
              client.evolves += 1
              client.points += config.pointsPerEvolve
      
              if (config.leadercap && client.name === lastLeaderName) {
                client.speed = client.speed * 0.9
              }
      
              publishEvent('OnUpdateEvolution', client.id, client.avatar, client.speed)
            }
          }
        } else {
          client.xp -= decay
  
          if (client.xp <= 0) {
            client.xp = 0
  
            if (decay > 0) {
              if (client.avatar === 0) {
                const currentTime = Math.round(now / 1000)
                const isNew = client.joinedAt >= currentTime - config.immunitySeconds
                  
                if (!config.noBoot && !isInvincible && !isNew && !config.isGodParty) {
                  client.log.ranOutOfHealth += 1
                  disconnectPlayer(client)
                }
              } else {
                client.xp = 100
                client.avatar = Math.max(Math.min(client.avatar - (1 * config.avatarDirection), config.maxEvolves - 1), 0)
  
                if (config.leadercap && client.name === lastLeaderName) {
                  client.speed = client.speed * 0.9
                }
        
                publishEvent('OnUpdateRegression', client.id, client.avatar, client.speed)
              }
            } else {
              if (client.avatar === 0) {
                client.xp = 0
              } else {
                client.xp = 100
                client.avatar = Math.max(Math.min(client.avatar - (1 * config.avatarDirection), config.maxEvolves - 1), 0)
  
                if (config.leadercap && client.name === lastLeaderName) {
                  client.speed = client.speed * 0.9
                }
        
                publishEvent('OnUpdateRegression', client.id, client.avatar, client.speed)
              }
            }
          }
        }
      }

      client.latency = ((now - client.lastReportedTime) / 2)// - (now - lastFastGameloopTime)

      if (Number.isNaN(client.latency)) {
        client.latency = 0
      }
  
      publishEvent('OnUpdatePlayer',
        client.id, 
        client.overrideSpeed || client.speed, 
        client.cameraSize, 
        client.position.x, 
        client.position.y, 
        client.target.x, 
        client.target.y, 
        Math.floor(client.xp), 
        now, 
        Math.round(client.latency), 
        isInvincible ? '1' : '0', 
        client.isStuck ? '1' : '0', 
        isPhased && !isInvincible ? '1' : '0'
       )
    }

    flushEventQueue()

    lastFastGameloopTime = now
  } catch(e) {
    logError(e)
    process.exit(1)
  }

  setTimeout(fastGameloop, config.fastLoopSeconds * 1000)
}

let eventFlushedAt = getTime()

function flushEventQueue() {
  const now = getTime()

  if (eventQueue.length) {
    if (debugQueue) log('Sending queue', eventQueue)

    let recordDetailed = now - eventFlushedAt > 500

    if (recordDetailed) {
      eventFlushedAt = now
    }

    const compiled = []
    for (const e of eventQueue) {
      const name = e[0]
      const args = e.slice(1)

      compiled.push(`["${name}","${args.join(':')}"]`)

      if (name == 'OnUpdatePlayer' || name == 'OnSpawnPowerup') {
        if (recordDetailed) {
          round.events.push({ type: 'emitAll', name, args })
        }
      } else {
        round.events.push({ type: 'emitAll', name, args })
      }
    }

    emitAll('Events', getPayload(compiled))

    // round.events = round.events.concat(eventQueue)
  
    eventQueue = null
    eventQueue = []
  }
}

function clearSprites() {
  powerups.splice(0, powerups.length) // clear the powerup list
}

function initEventHandler() {
  io.on('connection', function(socket) {
    try {
      const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0] || socket.conn.remoteAddress?.split(":")[3]
      // socket.request.connection.remoteAddress ::ffff:127.0.0.1
      // socket.conn.remoteAddress ::ffff:127.0.0.1
      // socket.conn.transport.socket._socket.remoteAddress ::ffff:127.0.0.1
      const hash = ip ? sha256(ip.slice(ip.length/2)) : ''

      const spawnPoint = playerSpawnPoints[(Math.floor(Math.random() * playerSpawnPoints.length))]

      let currentPlayer = {
        name: 'Unknown' + Math.floor(Math.random() * 999),
        id: socket.id,
        avatar: null,
        network: null,
        address: null,
        device: null,
        position: spawnPoint,
        target: spawnPoint,
        clientPosition: spawnPoint,
        clientTarget: spawnPoint,
        rotation: null,
        xp: 50,
        latency: 0,
        kills: 0,
        deaths: 0,
        points: 0,
        evolves: 0,
        powerups: 0,
        rewards: 0,
        orbs: 0,
        isMod: false,
        isBanned: false,
        isMasterClient: false,
        isDisconnected: false,
        isDead: true,
        isJoining: false,
        isSpectating: false,
        isStuck: false,
        isInvincible: config.isGodParty ? true : false,
        isPhased: false,
        overrideSpeed: null,
        overrideCameraSize: null,
        cameraSize: config.cameraSize,
        speed: config.baseSpeed * config.avatarSpeedMultiplier0,
        joinedAt: 0,
        hash: hash.slice(hash.length - 10, hash.length - 1),
        lastReportedTime: getTime(),
        lastUpdate: 0,
        gameMode: config.gameMode,
        phasedUntil: getTime(),
        log: {
          kills: [],
          deaths: [],
          revenge: 0,
          resetPosition: 0,
          phases: 0,
          stuck: 0,
          collided: 0,
          timeoutDisconnect: 0,
          speedProblem: 0,
          clientDistanceProblem: 0,
          outOfBounds: 0,
          ranOutOfHealth: 0,
          notReallyTrying: 0,
          tooManyKills: 0,
          killingThemselves: 0,
          sameNetworkDisconnect: 0,
          connectedTooSoon: 0,
          clientDisconnected: 0,
          positionJump: 0,
          pauses: 0,
          connects: 0,
          path: '',
          positions: 0,
          replay: [],
          recentJoinProblem: 0,
          usernameProblem: 0,
          maintenanceJoin: 0,
          signatureProblem: 0,
          signinProblem: 0,
          versionProblem: 0,
          failedRealmCheck: 0,
        }
      }

      log('User connected from ' + ip + ' with hash ' + hash)

      if (!testMode && killSameNetworkClients) {
        const sameNetworkClients = clients.filter(r => r.hash === currentPlayer.hash && r.id !== currentPlayer.id)

        for (const client of sameNetworkClients) {
          client.log.sameNetworkDisconnect += 1
          disconnectPlayer(client)
        }
      }

      sockets[currentPlayer.id] = socket
      clientLookup[currentPlayer.id] = currentPlayer

      if (Object.keys(clientLookup).length == 1) {
        currentPlayer.isMasterClient = true // first client to join the game
      }

      clients.push(currentPlayer)

      socket.on('RS_Connected', function() {
        const sameNetworkObservers = observers.filter(r => r.hash === currentPlayer.hash)

        for (const observer of sameNetworkObservers) {
          disconnectPlayer(observer)
        }

        const observer = {
          socket
        }

        observers.push(observer)

        // TODO: confirm it's the realm server
        realmServer.socket = socket

        emitDirect(socket, 'GS_Init', 1)
      })

      socket.on('Load', function() {
        emitDirect(socket, 'OnLoaded', 1)
      })

      socket.on('Spectate', function() {
        spectate(currentPlayer)
      })
      
      socket.on('SetInfo', async function(msg) {
        try {
          const pack = decodePayload(msg)

          if (!pack.signature || !pack.network || !pack.device || !pack.address) {
            currentPlayer.log.signinProblem += 1
            disconnectPlayer(currentPlayer)
            return
          }

          if (semver.diff(serverVersion, pack.version) !== 'patch') {
            currentPlayer.log.versionProblem += 1
            disconnectPlayer(currentPlayer)
            return
          }

          const address = await normalizeAddress(pack.address) as string

          if (!await verifySignature({ value: 'evolution', hash: pack.signature.trim() }, address)) {
            currentPlayer.log.signatureProblem += 1
            disconnectPlayer(currentPlayer)
            return
          }

          if (currentPlayer.isBanned) {
            emitDirect(socket, 'OnBanned', true)
            disconnectPlayer(currentPlayer)
            return
          }

          if (config.isMaintenance && !currentPlayer.isMod) {
            currentPlayer.log.maintenanceJoin += 1
            emitDirect(socket, 'OnMaintenance', true)
            disconnectPlayer(currentPlayer)
            return
          }

          let name = addressToUsername[address]

          if (!name || name.indexOf('Guest') === 0) {
            name = await getUsername(address)

            if (!name) {
              currentPlayer.log.usernameProblem += 1
              disconnectPlayer(currentPlayer)
              return
            }

            log('Username: ' + name)
            addressToUsername[address] = name
          }

          const now = getTime()
          if (currentPlayer.name !== name || currentPlayer.address !== address) {
            currentPlayer.name = name
            currentPlayer.address = address
            currentPlayer.network = pack.network
            currentPlayer.device = pack.device

            const recentPlayer = round.players.find(r => r.address === address)

            if (recentPlayer) {
              if ((now - recentPlayer.lastUpdate) < 3000) {
                currentPlayer.log.recentJoinProblem += 1
                disconnectPlayer(currentPlayer)
                return
              }

              currentPlayer.kills = recentPlayer.kills
              currentPlayer.deaths = recentPlayer.deaths
              currentPlayer.points = recentPlayer.points
              currentPlayer.evolves = recentPlayer.evolves
              currentPlayer.powerups = recentPlayer.powerups
              currentPlayer.rewards = recentPlayer.rewards
              currentPlayer.lastUpdate = recentPlayer.lastUpdate
              currentPlayer.log = recentPlayer.log

              currentPlayer.log.connects += 1
            }
        
            publishEvent('OnSetInfo', currentPlayer.id, currentPlayer.name, currentPlayer.network, currentPlayer.address, currentPlayer.device)

            if (config.log.connections) {
              log('Connected', {
                ip,
                address: currentPlayer.address,
                name: currentPlayer.name
              })
            }
          }
        } catch(e) {
          logError(e)
        }
      })

      socket.on('JoinRoom', async function() {
        log('JoinRoom', currentPlayer.id)

        const confirmUser = await rsCall('GS_ConfirmUserRequest', { address: currentPlayer.address }) as any

        if (confirmUser.success !== 1) {
          currentPlayer.log.failedRealmCheck += 1
          disconnectPlayer(currentPlayer)
          return
        }

        // const pack = decodePayload(msg)
        const now = getTime()
        const recentPlayer = round.players.find(r => r.address === currentPlayer.address)

        if (recentPlayer && (now - recentPlayer.lastUpdate) < 3000) {
          currentPlayer.log.connectedTooSoon += 1
          disconnectPlayer(currentPlayer)
          return
        }

        if (config.isMaintenance && !currentPlayer.isMod) {
          emitDirect(socket, 'OnMaintenance', true)
          disconnectPlayer(currentPlayer)
          return
        }

        currentPlayer.isJoining = true
        currentPlayer.avatar = config.startAvatar
        currentPlayer.speed = (config.baseSpeed * config['avatarSpeedMultiplier' + currentPlayer.avatar])

        log("[INFO] player " + currentPlayer.id + ": logged!")

        log("[INFO] Total players: " + Object.keys(clientLookup).length)
        const roundTimer = (round.startedAt + config.roundLoopSeconds) - Math.round(getTime() / 1000)
        emitDirect(socket, 'OnSetPositionMonitor', config.checkPositionDistance + ':' + config.checkInterval + ':' + config.resetInterval)
        emitDirect(socket, 'OnJoinGame', currentPlayer.id, currentPlayer.name, currentPlayer.avatar, currentPlayer.isMasterClient ? 'true' : 'false', roundTimer, currentPlayer.position.x, currentPlayer.position.y)
        // emitDirect(socket, 'OnSetInfo', currentPlayer.id, currentPlayer.name, currentPlayer.address, currentPlayer.network, currentPlayer.device)

        if (observers.length === 0) {
          emitDirect(socket, 'OnBroadcast', `Realm not connected. Contact support.`, 0)
          disconnectPlayer(currentPlayer)
          return
        }

        let guide

        if (config.gameMode === 'Lets Be Friends') {
          guide = [
            'Game Mode - Lets Be Friends',
            '-200 Points Per Kill',
            'No Death Orbs'
          ]
        } else if (config.gameMode === 'Deathmatch') {
          guide = [
            'Game Mode - Deathmatch',
            '+300 Points Per Kill (Per Evolve)',
            'No Death Orbs',
            'Faster Decay'
          ]
        } else if (config.gameMode === 'Evolution') {
          guide = [
            'Game Mode - Evolution',
            '+10 Points Per Evolution'
          ]
        } else if (config.gameMode === 'Orb Master') {
          guide = [
            'Game Mode - Orb Master',
            '+200 Points Per Orb Pickup',
            'No Points Per Kill, Evolve, etc.',
            'Orbs Last Until End of Round'
          ]
        } else if (config.gameMode === 'Sprite Leader') {
          guide = [
            'Game Mode - Sprite Leader',
            '+3 Sprites Per Player',
            'No Points Per Kill, Evolve, etc.',
            'No Orbs',
            'Faster Decay',
            'Longer Immunity'
          ]
        } else if (config.gameMode === 'Fast Drake') {
          guide = [
            'Game Mode - Fast Drake',
            '+50% Speed as Black Drake',
            'Faster Decay',
            'Longer Immunity'
          ]
        } else if (config.gameMode === 'Bird Eye') {
          guide = [
            'Game Mode - Bird Eye',
            'Faster Movement',
            'Faster Decay'
          ]
        } else if (config.gameMode === 'Friendly Reverse') {
          guide = [
            'Game Mode - Friendly Reverse',
            '-200 Points Per Kill (Per Evolve)',
            '+25 Points Per Evolve',
            'Reverse Evolution',
            'No Orbs'
          ]
        } else if (config.gameMode === 'Reverse Evolve') {
          guide = [
            'Game Mode - Reverse Evolve',
            'Reverse Evolution'
          ]
        } else if (config.gameMode === 'Marco Polo') {
          guide = [
            'Game Mode - Marco Polo',
            'Zoomed in + no map',
            'Faster Movement',
            'Faster Decay'
          ]
        } else if (config.gameMode === 'Leadercap') {
          guide = [
            'Game Mode - Leadercap',
            'Kill the last round leader',
            'Leader -10% Speed',
            'Leader 75% Death Orb'
          ]
        } else if (config.gameMode === 'Sticky Mode') {
          guide = [
            'Game Mode - Sticky Mode',
            'Sticky islands'
          ]
        } else {
          guide = [
            'Game Mode - ' + config.gameMode,
            'Eat sprites to stay alive',
            'Avoid bigger dragons',
            'Eat smaller dragons'
          ]
        }

        if (!config.isRoundPaused) {
          emitDirect(socket, 'OnSetRoundInfo', roundTimer + ':' + getRoundInfo().join(':') + ':' + guide.join(':'))
          emitDirect(socket, 'OnBroadcast', `Game Mode - ${config.gameMode} (Round ${round.id})`, 0)
        }

        syncSprites()

        if (config.hideMap) {
          emitDirect(socket, 'OnHideMinimap')
          emitDirect(socket, 'OnBroadcast', `Minimap hidden in this mode!`, 2)
        }

        if (config.level2open) {
          emitDirect(socket, 'OnOpenLevel2')
          emitDirect(socket, 'OnBroadcast', `Level 2 open!`, 0)
        }

        // spawn all connected clients for currentUser client 
        for (const client of clients) {
          if (client.id === currentPlayer.id) continue
          if (client.isDisconnected || client.isDead || client.isSpectating || client.isJoining) continue

          emitDirect(socket, 'OnSpawnPlayer', client.id, client.name, client.speed, client.avatar, client.position.x, client.position.y, client.position.x, client.position.y)
        }

        for (let c = 0; c < powerups.length; c++) {
          emitDirect(socket, 'OnSpawnPowerUp', powerups[c].id, powerups[c].type, powerups[c].position.x, powerups[c].position.y, powerups[c].scale) // spawn power up in unity scene
        }

        for (let c = 0; c < orbs.length; c++) {
          emitDirect(socket, 'OnSpawnPowerUp', orbs[c].id, orbs[c].type, orbs[c].position.x, orbs[c].position.y, orbs[c].scale) // spawn power up in unity scene
        }

        if (currentReward) {
          emitDirect(socket, 'OnSpawnReward', currentReward.id, config.rewardItemType, config.rewardItemName, config.rewardItemAmount, currentReward.position.x, currentReward.position.y)
        }

        currentPlayer.lastUpdate = getTime()
      })

      socket.on('UpdateMyself', function(msg) {
        try {
          if (currentPlayer.isDead && !currentPlayer.isJoining) return
          if (currentPlayer.isSpectating) return

          if (config.isMaintenance && !currentPlayer.isMod) {
            emitDirect(socket, 'OnMaintenance', true)
            disconnectPlayer(currentPlayer)
            return
          }

          const now = getTime()

          if (now - currentPlayer.lastUpdate < config.forcedLatency) return

          if (currentPlayer.isJoining) {
            currentPlayer.isDead = false
            currentPlayer.isJoining = false
            currentPlayer.joinedAt = Math.round(getTime() / 1000)

            if (config.isBattleRoyale) {
              spectate(currentPlayer)
              return
            }
    
            if (config.isRoundPaused) {
              emitDirect(socket, 'OnRoundPaused')
              return
            }

            addToRecentPlayers(currentPlayer)

            // spawn currentPlayer client on clients in broadcast
            publishEvent('OnSpawnPlayer', currentPlayer.id, currentPlayer.name, currentPlayer.speed, currentPlayer.avatar, currentPlayer.position.x, currentPlayer.position.y, currentPlayer.position.x, currentPlayer.position.y)
          }

          const pack = decodePayload(msg)

          const positionX = parseFloat(parseFloat(pack.position.split(':')[0].replace(',', '.')).toFixed(3))
          const positionY = parseFloat(parseFloat(pack.position.split(':')[1].replace(',', '.')).toFixed(3))

          const targetX = parseFloat(parseFloat(pack.target.split(':')[0].replace(',', '.')).toFixed(3))
          const targetY = parseFloat(parseFloat(pack.target.split(':')[1].replace(',', '.')).toFixed(3))

          if (!Number.isFinite(positionX) || !Number.isFinite(positionY) || !Number.isFinite(targetX) || !Number.isFinite(targetY)) return
          if (positionX < mapBoundary.x.min) return
          if (positionX > mapBoundary.x.max) return
          if (positionY < mapBoundary.y.min) return
          if (positionY > mapBoundary.y.max) return
        
          if (config.anticheat.disconnectPositionJumps && distanceBetweenPoints(currentPlayer.position, { x: positionY, y: positionY }) > 5) {
            currentPlayer.log.positionJump += 1
            disconnectPlayer(currentPlayer)
            return
          }

          currentPlayer.clientPosition = { x: positionX, y: positionY }
          currentPlayer.clientTarget = { x: targetX, y: targetY }
          currentPlayer.lastReportedTime = parseFloat(pack.time)
          currentPlayer.lastUpdate = now
        } catch(e) {
          logError(e)
        }
      })

      socket.on('ServerInfoRequest', function(req) {
        console.log(req)
        emitDirect('ServerInfoResponse', {
          id: req.id,
          data: {
            version: serverVersion,
            round: { id: round.id, startedAt: round.startedAt },
            clientTotal: clients.length,
            playerTotal: clients.filter(c => !c.isDead && !c.isSpectating).length,
            spectatorTotal: clients.filter(c => c.isSpectating).length,
            recentPlayersTotal: round.players.length,
            spritesTotal: config.spritesTotal,
            connectedPlayers: clients.map(c => c.name),
            rewardItemAmount: config.rewardItemAmount,
            rewardWinnerAmount: config.rewardWinnerAmount,
            totalLegitPlayers: totalLegitPlayers,
            gameMode: config.gameMode,
            orbs: orbs,
            currentReward
          }
        })
      })

      socket.on('ConfigRequest', function(req) {
        emitDirect('ConfigResponse', {
          id: req.id,
          data: config
        })
      })

      socket.on('MaintenanceRequest', async function(req) {
        try {
          log('Maintenance', {
            caller: req.data.address
          })

          if (await isValidAdminRequest(req.hash, req.address, req.data)) {
            sharedConfig.isMaintenance = true
            config.isMaintenance = true
        
            publishEvent('OnMaintenance', config.isMaintenance)

            emitDirect('MaintenanceResponse', {
              id: req.id,
              data: { success: 1 }
            })
          } else {
            emitDirect('MaintenanceResponse', {
              id: req.id,
              data: { success: 0 }
            })
          }
        } catch (e) {
          console.log(e)
          
          emitDirect('MaintenanceResponse', {
            id: req.id,
            data: { success: 0 }
          })
        }
      })

      socket.on('UnmaintenanceRequest', async function(req) {
        try {
          log('Unmaintenance', {
            caller: req.data.address
          })

          if (await isValidAdminRequest(req.hash, req.address, req.data)) {
            sharedConfig.isMaintenance = false
            config.isMaintenance = false
        
            publishEvent('OnUnmaintenance', config.isMaintenance)

            emitDirect('UnmaintenanceResponse', {
              id: req.id,
              data: { success: 1 }
            })
          } else {
            emitDirect('UnmaintenanceResponse', {
              id: req.id,
              data: { success: 0 }
            })
          }
        } catch (e) {
          console.log(e)
          
          emitDirect('UnmaintenanceResponse', {
            id: req.id,
            data: { success: 0 }
          })
        }
      })

      socket.on('StartBattleRoyaleRequest', async function(req) {
        try {
          log('StartBattleRoyale', {
            caller: req.data.address
          })

          if (await isValidAdminRequest(req.hash, req.address, req.data)) {
            baseConfig.isBattleRoyale = true
            config.isBattleRoyale = true

            publishEvent('OnBroadcast', `Battle Royale Started`, 3)
            
            emitDirect('StartBattleRoyaleResponse', {
              id: req.id,
              data: { success: 1 }
            })
          } else {
            emitDirect('StartBattleRoyaleResponse', {
              id: req.id,
              data: { success: 0 }
            })
          }
        } catch (e) {
          console.log(e)
          
          emitDirect('StartBattleRoyaleResponse', {
            id: req.id,
            data: { success: 0 }
          })
        }
      })

      socket.on('StopBattleRoyaleRequest', async function(req) {
        try {
          log('StopBattleRoyale', {
            caller: req.data.address
          })

          if (await isValidAdminRequest(req.hash, req.address, req.data)) {
            baseConfig.isBattleRoyale = false
            config.isBattleRoyale = false

            publishEvent('OnBroadcast', `Battle Royale Stopped`, 0)
        
            emitDirect('StopBattleRoyaleResponse', {
              id: req.id,
              data: { success: 1 }
            })
          } else {
            emitDirect('StopBattleRoyaleResponse', {
              id: req.id,
              data: { success: 0 }
            })
          }
        } catch (e) {
          console.log(e)
          
          emitDirect('StopBattleRoyaleResponse', {
            id: req.id,
            data: { success: 0 }
          })
        }
      })

      socket.on('PauseRoundRequest', async function(req) {
        try {
          log('PauseRound', {
            caller: req.data.address
          })

          if (await isValidAdminRequest(req.hash, req.address, req.data)) {
            clearTimeout(roundLoopTimeout)

            baseConfig.isRoundPaused = true
            config.isRoundPaused = true

            publishEvent('OnRoundPaused')
            publishEvent('OnBroadcast', `Round Paused`, 0)
        
            
            emitDirect('PauseRoundResponse', {
              id: req.id,
              data: { success: 1 }
            })
          } else {
            emitDirect('PauseRoundResponse', {
              id: req.id,
              data: { success: 0 }
            })
          }
        } catch (e) {
          console.log(e)
          
          emitDirect('PauseRoundResponse', {
            id: req.id,
            data: { success: 0 }
          })
        }
      })

      socket.on('StartRoundRequest', async function(req) {
        try {
          log('StartRound', {
            caller: req.data.address
          })

          if (await isValidAdminRequest(req.hash, req.address, req.data)) {
            clearTimeout(roundLoopTimeout)

            if (config.isRoundPaused) {
              baseConfig.isRoundPaused = false
              config.isRoundPaused = false
            }

            resetLeaderboard(presets.find(p => p.gameMode === req.data.gameMode))

            emitDirect('StartRoundResponse', {
              id: req.id,
              data: { success: 1 }
            })
          } else {
            emitDirect('StartRoundResponse', {
              id: req.id,
              data: { success: 0 }
            })
          }
        } catch (e) {
          console.log(e)

          emitDirect('StartRoundResponse', {
            id: req.id,
            data: { success: 0 }
          })
        }
      })

      socket.on('EnableForceLevel2Request', async function(req) {
        try {
          log('EnableForceLevel2', {
            caller: req.data.address
          })

          if (await isValidAdminRequest(req.hash, req.address, req.data)) {
            baseConfig.level2forced = true
            config.level2forced = true
            
            emitDirect('EnableForceLevel2Response', {
              id: req.id,
              data: { success: 1 }
            })
          } else {
            emitDirect('EnableForceLevel2Response', {
              id: req.id,
              data: { success: 0 }
            })
          }
        } catch (e) {
          console.log(e)

          emitDirect('EnableForceLevel2Response', {
            id: req.id,
            data: { success: 0 }
          })
        }
      })

      socket.on('DisableForceLevel2Request', async function(req) {
        try {
          log('DisableForceLevel2', {
            caller: req.data.address
          })

          if (await isValidAdminRequest(req.hash, req.address, req.data)) {
            baseConfig.level2forced = false
            config.level2forced = false
            
            emitDirect('DisableForceLevel2Response', {
              id: req.id,
              data: { success: 1 }
            })
          } else {
            emitDirect('DisableForceLevel2Response', {
              id: req.id,
              data: { success: 0 }
            })
          }
        } catch (e) {
          console.log(e)

          emitDirect('DisableForceLevel2Response', {
            id: req.id,
            data: { success: 0 }
          })
        }
      })

      socket.on('StartGodPartyRequest', async function(req) {
        try {
          log('StartGodParty', {
            caller: req.data.address
          })

          if (await isValidAdminRequest(req.hash, req.address, req.data)) {
            baseConfig.isGodParty = true
            config.isGodParty = true

            publishEvent('OnBroadcast', `God Party Started`, 0)
            
            emitDirect('StartGodPartyResponse', {
              id: req.id,
              data: { success: 1 }
            })
          } else {
            emitDirect('StartGodPartyResponse', {
              id: req.id,
              data: { success: 0 }
            })
          }
        } catch (e) {
          console.log(e)
          
          emitDirect('StartGodPartyResponse', {
            id: req.id,
            data: { success: 0 }
          })
        }
      })

      socket.on('StopGodPartyRequest', async function(req) {
        try {
          log('StopGodParty', {
            caller: req.data.address
          })

          if (await isValidAdminRequest(req.hash, req.address, req.data)) {
            baseConfig.isGodParty = false
            config.isGodParty = false

            for (let i = 0; i < clients.length; i++) {
              const player = clients[i]

              player.isInvincible = false
            }

            publishEvent('OnBroadcast', `God Party Stopped`, 2)
            
            emitDirect('StopGodPartyResponse', {
              id: req.id,
              data: { success: 1 }
            })
          } else {
            emitDirect('StopGodPartyResponse', {
              id: req.id,
              data: { success: 0 }
            })
          }
        } catch (e) {
          console.log(e)
          
          emitDirect('StopGodPartyResponse', {
            id: req.id,
            data: { success: 0 }
          })
        }
      })

      socket.on('MakeBattleHarderRequest', async function(req) {
        try {
          log('MakeBattleHarder', {
            caller: req.data.address
          })

          if (await isValidAdminRequest(req.hash, req.address, req.data)) {
            baseConfig.dynamicDecayPower = false
            config.dynamicDecayPower = false

            sharedConfig.decayPower += 2
            config.decayPower += 2

            sharedConfig.baseSpeed += 1
            config.baseSpeed += 1

            sharedConfig.checkPositionDistance += 1
            config.checkPositionDistance += 1
            
            sharedConfig.checkInterval += 1
            config.checkInterval += 1

            publishEvent('OnSetPositionMonitor', config.checkPositionDistance + ':' + config.checkInterval + ':' + config.resetInterval)
            publishEvent('OnBroadcast', `Difficulty Increased!`, 2)
        
            
            emitDirect('MakeBattleHarderResponse', {
              id: req.id,
              data: { success: 1 }
            })
          } else {
            emitDirect('MakeBattleHarderResponse', {
              id: req.id,
              data: { success: 0 }
            })
          }
        } catch (e) {
          console.log(e)
          
          emitDirect('MakeBattleHarderResponse', {
            id: req.id,
            data: { success: 0 }
          })
        }
      })

      socket.on('MakeBattleEasierRequest', async function(req) {
        try {
          log('MakeBattleEasier', {
            caller: req.data.address
          })

          if (await isValidAdminRequest(req.hash, req.address, req.data)) {
            baseConfig.dynamicDecayPower = false
            config.dynamicDecayPower = false

            sharedConfig.decayPower -= 2
            config.decayPower -= 2

            sharedConfig.baseSpeed -= 1
            config.baseSpeed -= 1

            sharedConfig.checkPositionDistance -= 1
            config.checkPositionDistance -= 1
            
            sharedConfig.checkInterval -= 1
            config.checkInterval -= 1

            publishEvent('OnSetPositionMonitor', config.checkPositionDistance + ':' + config.checkInterval + ':' + config.resetInterval)
            publishEvent('OnBroadcast', `Difficulty Decreased!`, 0)
        
            emitDirect('MakeBattleEasierResponse', {
              id: req.id,
              data: { success: 1 }
            })
          } else {
            emitDirect('MakeBattleEasierResponse', {
              id: req.id,
              data: { success: 0 }
            })
          }
        } catch (e) {
          emitDirect('MakeBattleEasierResponse', {
            id: req.id,
            data: { success: 0 }
          })
        }
      })

      socket.on('ResetBattleDifficultyRequest', async function(req) {
        try {
          log('ResetBattleDifficulty', {
            caller: req.data.address
          })

          if (await isValidAdminRequest(req.hash, req.address, req.data)) {
            baseConfig.dynamicDecayPower = true
            config.dynamicDecayPower = true

            sharedConfig.decayPower = 1.4
            config.decayPower = 1.4

            sharedConfig.baseSpeed = 3
            config.baseSpeed = 3

            sharedConfig.checkPositionDistance = 2
            config.checkPositionDistance = 2
            
            sharedConfig.checkInterval = 1
            config.checkInterval = 1

            publishEvent('OnSetPositionMonitor', config.checkPositionDistance + ':' + config.checkInterval + ':' + config.resetInterval)
            publishEvent('OnBroadcast', `Difficulty Reset!`, 0)
        
            emitDirect('ResetBattleDifficultyResponse', {
              id: req.id,
              data: { success: 1 }
            })
          } else {
            emitDirect('ResetBattleDifficultyResponse', {
              id: req.id,
              data: { success: 0 }
            })
          }
        } catch (e) {
          emitDirect('ResetBattleDifficultyResponse', {
            id: req.id,
            data: { success: 0 }
          })
        }
      })

      socket.on('SetConfigRequest', async function(req) {
        try {
          log('SetConfig', {
            caller: req.data.address
          })

          if (await isValidAdminRequest(req.hash, req.address, req.data)) {
            const val = isNumeric(req.data.value) ? parseFloat(req.data.value) : req.data.value
            if (baseConfig.hasOwnProperty(req.data.key)) 
              baseConfig[req.data.key] = val

            if (sharedConfig.hasOwnProperty(req.data.key)) 
              sharedConfig[req.data.key] = val

            config[req.data.key] = val

            publishEvent('OnBroadcast', `${req.data.key} = ${val}`, 1)
            
            emitDirect('SetConfigResponse', {
              id: req.id,
              data: { success: 1 }
            })
          } else {
            emitDirect('SetConfigResponse', {
              id: req.id,
              data: { success: 0 }
            })
          }
        } catch (e) {
          console.log(e)
          
          emitDirect('SetConfigResponse', {
            id: req.id,
            data: { success: 0 }
          })
        }
      })

      socket.on('ReportUser', async function(req) {
        const reportedPlayer = clients.find(c => c.address === req.data.target)

        if (reportedPlayer) {
          const res = await rsCall('GS_ReportUserRequest', { currentAddress: currentPlayer.address, reportedAddress: reportedPlayer.address }) as any
          
          emitDirect('ReportUserResponse', {
            id: req.id,
            data: { success: res.success }
          })
        } else {
          emitDirect('ReportUserResponse', {
            id: req.id,
            data: { success: 0 }
          })
        }

      })

      socket.on('MessageUserRequest', async function(req) {
        try {
          log('Message', {
            value: req.data.target,
            caller: req.data.address,
            message: req.data.message
          })

          if (await isValidAdminRequest(req.hash, req.address, req.data)) {
            const socket = sockets[clients.find(c => c.address === req.data.target).id]

            emitDirect(socket, 'OnBroadcast', req.data.message.replace(/:/gi, ''), 0)
            
            emitDirect('MessageUserResponse', {
              id: req.id,
              data: { success: 1 }
            })
          } else {
            emitDirect('MessageUserResponse', {
              id: req.id,
              data: { success: 0 }
            })
          }
        } catch (e) {
          emitDirect('MessageUserResponse', {
            id: req.id,
            data: { success: 0 }
          })
        }
      })

      socket.on('BroadcastRequest', async function(req) {
        try {
          log('Broadcast', {
            caller: req.address,
            message: req.data.message
          })

          if (await isValidAdminRequest(req.hash, req.address, req.data)) {
            publishEvent('OnBroadcast', req.data.message.replace(/:/gi, ''), 0)
            
            emitDirect('BroadcastResponse', {
              id: req.id,
              data: { success: 1 }
            })
          } else {
            emitDirect('BroadcastResponse', {
              id: req.id,
              data: { success: 0 }
            })
          }
        } catch (e) {
          console.log(e)
          
          emitDirect('BroadcastResponse', {
            id: req.id,
            data: { success: 0 }
          })
        }
      })

      socket.on('KickUser', async function(req) {
        if (await isValidAdminRequest(req.hash, req.address, req.data) && clients.find(c => c.address === req.data.target)) {
          disconnectPlayer(clients.find(c => c.address === req.data.target))
        }
      })

      socket.onAny(function(eventName, res) {
        // log('onAny', eventName, res)
        if (!res || !res.id) return
        // console.log(eventName, res)
        if (rsCallbacks[res.id]) {
          log('Callback', eventName)
          rsCallbacks[res.id](res.data)
    
          delete rsCallbacks[res.id]
        }
      })

      socket.on('disconnect', function() {
        log("User has disconnected")

        currentPlayer.log.clientDisconnected += 1

        setTimeout(() => {
          disconnectPlayer(currentPlayer)
          flushEventQueue()
        }, 2 * 1000)
      })
    } catch(e) {
      logError(e)
    }
  })
}

export async function initGameServer(_io) {
  io = _io

  initEventHandler()

  if (Object.keys(clientLookup).length == 0) {
    randomRoundPreset()
    clearSprites()
    spawnSprites(config.spritesStartCount)
  }

  setTimeout(fastestGameloop, config.fastestLoopSeconds * 1000)
  setTimeout(fastGameloop, config.fastLoopSeconds * 1000)
  setTimeout(slowGameloop, config.slowLoopSeconds * 1000)
  setTimeout(sendUpdates, config.sendUpdateLoopSeconds * 1000)
  setTimeout(spawnRewards, config.rewardSpawnLoopSeconds * 1000)
  setTimeout(checkConnectionLoop, config.checkConnectionLoopSeconds * 1000)
  roundLoopTimeout = setTimeout(resetLeaderboard, config.roundLoopSeconds * 1000)
  // setTimeout(flushEventQueue, config.flushEventQueueSeconds * 1000)
}
