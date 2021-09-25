import * as utf8 from 'utf8'
import * as ethers from 'ethers'
import * as Web3 from 'web3'
import * as fs from 'fs'
import * as express from 'express'
import * as helmet from 'helmet'
import * as cors from 'cors'
import * as RateLimit from 'express-rate-limit'
import * as bodyParser from 'body-parser'
import * as morgan from 'morgan'
import * as crypto from 'crypto'
import * as jetpack from 'fs-jetpack'
import axios from 'axios'
import middleware from './middleware'
import * as database from './db'
import * as services from './services'
import { decodeItem } from './decodeItem'
import Provider from './util/provider'

const path = require('path')

const serverVersion = "1.5.0"

const server = express()
const http = require('http').Server(server)
const https = require('https').createServer({ 
  key: fs.readFileSync(path.resolve('./privkey.pem')),
  cert: fs.readFileSync(path.resolve('./fullchain.pem'))
}, server)
const io = require('socket.io')(process.env.SUDO_USER === 'dev' || process.env.OS_FLAVOUR === 'debian-10' ? https : http, {
  secure: process.env.SUDO_USER === 'dev' || process.env.OS_FLAVOUR === 'debian-10' ? true : false,
  pingInterval: 30005,
  pingTimeout: 5000,
  upgradeTimeout: 3000,
  allowUpgrades: true,
  cookie: false,
  serveClient: true,
  allowEIO3: false,
  cors: {
    origin: "*"
  }
})
const shortId = require('shortid')

function logError(err) {
  console.log(err)

  const errorLog = jetpack.read(path.resolve('./public/data/errors.json'), 'json') || []

  errorLog.push(err + '')
  
  jetpack.write(path.resolve('./public/data/errors.json'), JSON.stringify(errorLog, null, 2), { atomic: true })
}


process
  .on("unhandledRejection", (reason, p) => {
    console.log(reason, "Unhandled Rejection at Promise", p);
    logError(reason + ". Unhandled Rejection at Promise:" + p);
  })
  .on("uncaughtException", (err) => {
    console.log(err, "Uncaught Exception thrown");
    // logError(err + ". Uncaught Exception thrown" + err.stack);
    process.exit(1);
  })


const eventCache: any = {
  'OnUpdateMyself': {},
  'OnUpdatePlayer': {}
}

const db: any = {}

db.config = jetpack.read(path.resolve('./public/data/config.json'), 'json')
db.rewardHistory = jetpack.read(path.resolve('./public/data/rewardHistory.json'), 'json')
db.rewards = jetpack.read(path.resolve('./public/data/rewards.json'), 'json')
db.leaderboardHistory = jetpack.read(path.resolve('./public/data/leaderboardHistory.json'), 'json')
db.modList = jetpack.read(path.resolve('./public/data/modList.json'), 'json') || []
db.banList = jetpack.read(path.resolve('./public/data/banList.json'), 'json')
db.reportList = jetpack.read(path.resolve('./public/data/playerReports.json'), 'json')
db.playerRewards = jetpack.read(path.resolve('./public/data/playerRewards.json'), 'json')
db.map = jetpack.read(path.resolve('./public/data/map.json'), 'json')
db.log = jetpack.read(path.resolve('./public/data/log.json'), 'json')

if (!db.modList.length) {
  db.modList.push('0xa987f487639920A3c2eFe58C8FBDedB96253ed9B')
  db.modList.push('0x545612032BeaDED7E9f5F5Ab611aF6428026E53E')
  db.modList.push('0xfE27380E57e5336eB8FFc017371F2147A3268fbE')
  db.modList.push('0x2DF94b980FC880100D93072011675E6659C0ca21')
  db.modList.push('0x37470038C615Def104e1bee33c710bD16a09FdEf')
  db.modList.push('0x9b229c01eEf692A780d8Fee2558AaEa9873C032f')
}

function getTime() {
  return new Date().getTime()
}

const savePlayerRewards = () => {
  jetpack.write(path.resolve('./public/data/playerRewards.json'), JSON.stringify(db.playerRewards, null, 2), { atomic: true })
}

const saveLeaderboardHistory = () => {
  if (db.leaderboardHistory.length > 1100) {
    db.leaderboardHistory = db.leaderboardHistory.slice(db.leaderboardHistory.length - 1000, db.leaderboardHistory.length)
  }

  jetpack.write(path.resolve('./public/data/leaderboardHistory.json'), JSON.stringify(db.leaderboardHistory, null, 2), { atomic: true })
}

const saveRewardHistory = () => {
  jetpack.write(path.resolve('./public/data/rewardHistory.json'), JSON.stringify(db.rewardHistory, null, 2), { atomic: true })
}

const saveRewards = () => {
  jetpack.write(path.resolve('./public/data/rewards.json'), JSON.stringify(db.rewards, null, 2), { atomic: true })
}

const saveBanList = () => {
  jetpack.write(path.resolve('./public/data/banList.json'), JSON.stringify(db.banList, null, 2), { atomic: true })
}

const saveModList = () => {
  jetpack.write(path.resolve('./public/data/modList.json'), JSON.stringify(db.modList, null, 2), { atomic: true })
}

const saveReportList = () => {
  jetpack.write(path.resolve('./public/data/playerReports.json'), JSON.stringify(db.reportList, null, 2), { atomic: true })
}

const saveLog = () => {
  jetpack.write(path.resolve('./public/data/log.json'), JSON.stringify(db.log, null, 2), { atomic: true })
}

function reportPlayer(currentGamePlayers, currentPlayer, reportedPlayer) {
  if (currentPlayer.name.indexOf('Guest') !== -1 || currentPlayer.name.indexOf('Unknown') !== -1) return // No guest reports

  if (!db.reportList[reportedPlayer.address])
    db.reportList[reportedPlayer.address] = []
  
  if (!db.reportList[reportedPlayer.address].includes(currentPlayer.address))
    db.reportList[reportedPlayer.address].push(currentPlayer.address)
  
  if (db.reportList[reportedPlayer.address].length >= 6) {
    db.banList.push(reportedPlayer.address)

    disconnectPlayer(reportedPlayer)
    // emitDirect(sockets[reportedPlayer.id], 'OnBanned', true)
    return
  }

  if (currentGamePlayers.length >= 4) {
    const reportsFromCurrentGamePlayers = db.reportList[reportedPlayer.address].filter(function(n) {
      return currentGamePlayers.indexOf(n) !== -1;
    })

    if (reportsFromCurrentGamePlayers.length >= currentGamePlayers.length / 3) {
      db.banList.push(reportedPlayer.address)

      disconnectPlayer(reportedPlayer)
      // emitDirect(sockets[reportedPlayer.id], 'OnBanned', true)
      return
    }
  }
}

const testMode = false

const baseConfig = {
  damagePerTouch: 2,
  periodicReboots: false,
  rebootSeconds: 12 * 60 * 60,
  startAvatar: 0,
  spriteXpMultiplier: 1,
  forcedLatency: 0,
  level2allowed: true,
  level2open: false,
  level3open: false,
  hideMap: false,
  dynamicDecayPower: true,
  decayPowerPerMaxEvolvedPlayers: 0.2,
  pickupCheckPositionDistance: 1,
  playersRequiredForLevel2: 15,
  preventBadKills: true,
  colliderBuffer: 0.2,
  stickyIslands: false,
  antifeed2: true,
  antifeed3: false,
  antifeed4: true,
  avatarDirection: 1,
  calcRoundRewards: true,
  rewardItemAmountPerLegitPlayer: 0.03 / 20,
  rewardItemAmountMax: 0.03,
  rewardWinnerAmountPerLegitPlayer: 0.08 / 15,
  rewardWinnerAmountMax: 0.08,
  flushEventQueueSeconds: 0.02,
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
  pickupDistance: 0.2,
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
  rewardItemAmount: 0.01,
  rewardItemName: '?',
  rewardItemType: 0,
  rewardSpawnLoopSeconds: testMode ? 1 : 3 * 60 / 20,
  rewardWinnerAmount: 0.08 / 15,
  rewardWinnerName: 'ZOD',
  roundLoopSeconds: testMode ? 2 * 60 : 5 * 60,
  sendUpdateLoopSeconds: 3,
  slowLoopSeconds: 1,
  spritesPerPlayerCount: 1,
  spritesStartCount: 50,
  spritesTotal: 50
}

const addressToUsername = {}

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
    spritesPerPlayerCount: 3,
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
    immunitySeconds: 20,
    orbOnDeathPercent: 0,
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
    spritesPerPlayerCount: 3,
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
    spriteXpMultiplier: -1,
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
  //   gameMode: 'Fortnight',
  //   fortnight: true
  // },
]

let currentPreset = presets[(Math.floor(Math.random() * presets.length))]
let roundConfig = {
  ...baseConfig,
  ...sharedConfig,
  ...currentPreset
}

let announceReboot = false
let rebootAfterRound = false
let totalLegitPlayers = 0
const debug = false // !(process.env.SUDO_USER === 'dev' || process.env.OS_FLAVOUR === 'debian-10')
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
  id: (db.config.roundId || 1),
  startedAt: Math.round(getTime() / 1000),
  events: [],
  states: [],
  players: []
}
const ranks = {}

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

const rewardSpawnPoints = [
  {x: -16.32, y: -15.7774},
  {x: -9.420004, y: -6.517404},
  {x: -3.130003, y: -7.537404},
  {x: -7.290003, y: -12.9074},
  {x: -16.09, y: -2.867404},
  {x: -5.39, y: -3.76},
  {x: -7.28, y: -15.36},
  {x: -13.46, y: -13.92},
  {x: -12.66, y: -1.527404},
]

const rewardSpawnPoints2 = [
  {x: -16.32, y: -15.7774},
  {x: -9.420004, y: -6.517404},
  {x: -3.130003, y: -7.537404},
  {x: -7.290003, y: -12.9074},
  {x: -16.09, y: -2.867404},
  {x: -5.39, y: -3.76},
  {x: -12.66, y: -1.527404},

  {x: -24.21, y: -7.58},
  {x: -30.62, y: -7.58},
  {x: -30.8, y: -14.52},
  {x: -20.04, y: -15.11},
  {x: -29.21, y: -3.76},
  {x: -18.16, y: 0.06},
  {x: -22.98, y: -3.35},
  {x: -25.92, y: -7.64},
  {x: -20.1, y: -6.93},
  {x: -26.74, y: 0},
  {x: -32.74, y: -5.17},
  {x: -25.74, y: -15.28},
  {x: -22.62, y: -11.69},
  {x: -26.44, y: -4.05},
]

const playerSpawnPoints = [
  {x: -4.14, y: -11.66},
  {x: -11.14, y: -8.55},
  {x: -12.27, y: -14.24},
  {x: -7.08, y: -12.75},
  {x: -7.32, y: -15.29},
]

const log = (...msgs) => {
  if (debug) {
    console.log(...msgs)
  }
}

// @ts-ignore
const web3 = new Web3(new Provider())


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

const howManyRewardsPerHour = (playerCount) => {
    return Math.ceil(playerCount / 5)
}

const emitAll = (...args) => {
  // log('emitAll', ...args)
  io.emit(...args)
}

const emitElse = (socket, ...args) => {
  log('emitElse', ...args)

  if (!socket || !socket.emit) {
    io.emit(...args)
    return
  }

  socket.broadcast.emit('Events', getPayload([[...args]].map(e => `["${e[0]}","${e.slice(1).join(':')}"]`)))
  // socket.broadcast.emit(...args)
}

const emitDirect = (socket, ...args) => {
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

const emitAllFast = (socket, ...args) => {
  log('emitAllFast', ...args)

  if (!socket || !socket.emit) {
    io.emit(...args)
    return
  }

  socket.emit(...args)
  socket.broadcast.emit(...args)
}

const publishEvent = (...args) => {
  // console.log(args)
  eventQueue.push(args)
}

const verifySignature = (signature, address) => {
  log('Verifying', signature, address)
  try {
    return web3.eth.accounts.recover(signature.value, signature.hash).toLowerCase() === address.toLowerCase()
  } catch(e) {
    log(e)
    return false
  }
}

const spawnRandomReward = () => {
  if (currentReward) {
    return
  }
  // if (currentReward) return

  const odds = [
    'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
    'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
    'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
    'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
    'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
    'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
    'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
    'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
    'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
    'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes', 'runes',
    'items'
  ]

  const rewardType = db.rewards[odds[random(0, odds.length-1)]]

  if (rewardType.length === 0) return spawnRandomReward()

  const reward = rewardType[random(0, rewardType.length-1)]

  if (reward.type === 'rune' && reward.quantity <= 0) return spawnRandomReward()

  const now = getTime()

  currentReward = JSON.parse(JSON.stringify(reward))
  currentReward.id = shortId.generate()
  currentReward.position = config.level2open ? rewardSpawnPoints2[random(0, rewardSpawnPoints2.length-1)] : rewardSpawnPoints[random(0, rewardSpawnPoints.length-1)]
  currentReward.enabledAt = now
  
  if (currentReward.type === 'rune') {
    sharedConfig.rewardItemType = 0
    sharedConfig.rewardItemName = currentReward.symbol.toUpperCase()
    config.rewardItemName = sharedConfig.rewardItemName
    config.rewardItemType = sharedConfig.rewardItemType
  } else if (currentReward.type === 'item') {
    const item = decodeItem(currentReward.tokenId)
    sharedConfig.rewardItemName = item.name
    sharedConfig.rewardItemType = 1
    config.rewardItemName = sharedConfig.rewardItemName
    config.rewardItemType = sharedConfig.rewardItemType
  }

  publishEvent('OnSpawnReward', currentReward.id, config.rewardItemType, config.rewardItemName, config.rewardItemAmount, currentReward.position.x, currentReward.position.y)

  const tempReward = JSON.parse(JSON.stringify(currentReward))

  setTimeout(() => {
    if (!currentReward) return
    if (currentReward.id === tempReward.id) {
      removeReward()
    }
  }, 30 * 1000)
}

function moveVectorTowards(current, target, maxDistanceDelta)
{
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

const claimReward = (currentPlayer) => {
  if (!currentReward) return

  if (config.anticheat.samePlayerCantClaimRewardTwiceInRow && lastReward?.winner.name === currentPlayer.name) return

  currentReward.winner = currentPlayer
  try {
    if (currentPlayer.address) {
      if (currentReward.type === 'item') {
        log('Transfer item')

        // try {
        //   sendItem(currentReward.tokenId, currentPlayer.address).then(tx => {
        //     newReward.tx = tx
        //     // saveRewardHistory()
        //   })
        // } catch(e) {
        //   console.log(e)
        // }

        db.rewards.items = db.rewards.items.filter(i => i.tokenId !== currentReward.tokenId)
      } else if (currentReward.type === 'rune') {
        if (!db.playerRewards[currentPlayer.address]) db.playerRewards[currentPlayer.address] = {}
        if (!db.playerRewards[currentPlayer.address].pending) db.playerRewards[currentPlayer.address].pending = {}
        if (!db.playerRewards[currentPlayer.address].pending[currentReward.symbol]) db.playerRewards[currentPlayer.address].pending[currentReward.symbol] = 0

        db.playerRewards[currentPlayer.address].pending[currentReward.symbol] = Math.round((db.playerRewards[currentPlayer.address].pending[currentReward.symbol] + config.rewardItemAmount) * 100) / 100
        
        db.rewards.runes.find(r => r.symbol === currentReward.symbol).quantity -= config.rewardItemAmount
      }
    }
  } catch(e) {
    console.log(e)
  }

  publishEvent('OnUpdateReward', currentPlayer.id, currentReward.id)

  currentPlayer.rewards += 1
  currentPlayer.points += config.pointsPerReward

  lastReward = currentReward

  currentReward = null
}

const random = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

const randomPosition = (min, max) => {
  return Math.random() * (max - min) + min
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
  }

  return array
}

function randomizeSpriteXp() {
  const shuffledValues = shuffleArray([2, 4, 8, 16])
  config.powerupXp0 = shuffledValues[0]
  config.powerupXp1 = shuffledValues[1]
  config.powerupXp2 = shuffledValues[2]
  config.powerupXp3 = shuffledValues[3]
}

function convertToDecimal(byte) {
  let result = 0;

  byte = byte.split('');

  byte.reverse();

  for (let a = 0; a < byte.length; a++){
    if (byte[a] === '1'){
      result += 2 ** a;
    }
  }

  return result;
}

function binaryAgent(str) {
  let bytes = str.split(' ');
  let output = '';
    
  for (let k = 0; k < bytes.length; k++){
      if (bytes[k]) output += String.fromCharCode(convertToDecimal(bytes[k]));
  }

  return output;
}

function decodePayload(msg) {
  // @ts-ignore
  let json = binaryAgent(msg) //String.fromCharCode.apply(null, new Uint8Array(msg));

  try {
    // explicitly decode the String as UTF-8 for Unicode
    //   https://github.com/mathiasbynens/utf8.js
    // json = utf8.decode(json)
    // const buffer = Buffer.from(json, "binary");
    const data = JSON.parse(json)

    return data
  }
  catch (err) {
    // ...
    console.log(err)
  }
  
}


export const getUsername = async (address: string): Promise<string> => {
  try {
    log(`Getting username for ${address}`)
    const response = await axios(`https://rune-api.binzy.workers.dev/users/${address}`)

    // const data = await response.json()

    const { username = '' } = response.data as any
  
    return username
  } catch (error) {
    console.log(error)
    return ''
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
    player.joinedAt = null
    player.latency = 0
    publishEvent('OnUserDisconnected', player.id)

    for (let i = 0; i < clients.length; i++) {
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
  } catch(e) {
    console.log(e)
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
  
    for (const gameObject of db.map) {
      if (!gameObject.Colliders || !gameObject.Colliders.length) continue

      for (const gameCollider of gameObject.Colliders) {
        const collider = {
          minX: gameCollider.Min[0],
          maxX: gameCollider.Max[0],
          minY: gameCollider.Min[1],
          maxY: gameCollider.Max[1]
        }

        if (config.level2open && gameObject.Name === 'Level2Divider') {
          const diff = gameObject.Transform.LocalPosition[1] - -16
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

  db.recentPlayersTotal = round.players.length
}

function roundEndingSoon(sec) {
  const roundTimer = (round.startedAt + config.roundLoopSeconds) - Math.round(getTime() / 1000)
  return roundTimer < sec
}

function sha256(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("base64")
}

const registerKill = (winner, loser) => {
  const now = getTime()

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
  loser.xp -= config.damagePerTouch * (winner.avatar + 1) + config.damagePerTouch * (winner.avatar - loser.avatar) * 2

  if (loser.avatar !== 0 || loser.xp > 0) {
    // Can't be killed yet
    return
  }

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
      isMasterClient: false,
      isDisconnected: false,
      isDead: true,
      isJoining: false,
      isSpectating: false,
      isStuck: false,
      isPhased: false,
      overrideSpeed: null,
      overrideCameraSize: null,
      cameraSize: config.cameraSize,
      speed: config.baseSpeed * config.avatarSpeedMultiplier0,
      joinedAt: null,
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
        replay: []
      }
    }

    log('User connected from ' + ip + ' with hash ' + hash)

    if (!testMode && killSameNetworkClients) {
      const sameNetworkClients = clients.filter(r => r.hash === currentPlayer.hash && r.id !== currentPlayer.id)

      for (const client of sameNetworkClients) {
        disconnectPlayer(client)
        client.log.sameNetworkDisconnect += 1
      }
    }

    sockets[currentPlayer.id] = socket
    clientLookup[currentPlayer.id] = currentPlayer

    if (Object.keys(clientLookup).length == 1) {
      currentPlayer.isMasterClient = true // first client to join the game
    }

    clients.push(currentPlayer)

    socket.on('Passthrough', function(msg) {
      try {
        const pack = decodePayload(msg)
        const data = JSON.parse(unescape(pack.data))

        db.log.push({
          event: data.event,
          value: data.value,
          caller: currentPlayer?.address
        })

        if (data.event === 'Ban') {
          if (!db.modList.includes(currentPlayer?.address)) return
          if (!(data.signature.value > 0 && data.signature.value < 1000)) return
          if (!verifySignature(data.signature, currentPlayer?.address)) return
      
          const offender = data.value
      
          db.banList.push(offender)

          if (clients.find(c => c.address === offender)) {
            disconnectPlayer(clients.find(c => c.address === offender))
          }
      
          saveBanList()
        } else if (data.event === 'Unban') {
          if (!db.modList.includes(currentPlayer?.address)) return
          if (!(data.signature.value > 0 && data.signature.value < 1000)) return
          if (!verifySignature(data.signature, currentPlayer?.address)) return
      
          const offender = data.value
      
          db.banList.splice(db.banList.indexOf(offender), 1)
      
          saveBanList()
        } else if (data.event === 'AddMod') {
          if (!db.modList.includes(currentPlayer?.address)) return
          if (!(data.signature.value > 0 && data.signature.value < 1000)) return
          if (!verifySignature(data.signature, currentPlayer?.address)) return
      
          const newMod = data.value
      
          db.modList.push(newMod)
      
          saveModList()
        } else if (data.event === 'RemoveMod') {
          if (!db.modList.includes(currentPlayer?.address)) return
          if (!(data.signature.value > 0 && data.signature.value < 1000)) return
          if (!verifySignature(data.signature, currentPlayer?.address)) return
      
          const newMod = data.value
      
          db.modList.splice(db.modList.indexOf(newMod), 1)
      
          saveModList()
        } else if (data.event === 'SetBroadcast') {
          if (!db.modList.includes(currentPlayer?.address)) return
          if (!(data.signature.value > 0 && data.signature.value < 1000)) return
          if (!verifySignature(data.signature, currentPlayer?.address)) return
      
          publishEvent('OnBroadcast', escape(JSON.stringify(data.value)))
        } else if (data.event === 'SetMaintenance') {
          if (!db.modList.includes(currentPlayer?.address)) return
          if (!(data.signature.value > 0 && data.signature.value < 1000)) return
          if (!verifySignature(data.signature, currentPlayer?.address)) return
      
          sharedConfig.isMaintenance = data.value
          config.isMaintenance = data.value
      
          publishEvent('OnMaintenance', config.isMaintenance)
        } else if (data.event === 'SetConfig') {
          if (!db.modList.includes(currentPlayer?.address)) return
          if (!(data.signature.value > 0 && data.signature.value < 1000)) return
          if (!verifySignature(data.signature, currentPlayer?.address)) return

          for (const item of data.value) {
            if (item.key in baseConfig)
              baseConfig[item.key] = item.value

            if (item.key in sharedConfig)
              sharedConfig[item.key] = item.value
            
            config[item.key] = item.value
        
            if (item.publish) {
              publishEvent(item.publish.eventName, ...item.publish.eventArgs)
            }
          }
        } else if (data.event === 'SetClaiming') {
          if (!db.modList.includes(currentPlayer?.address)) return
          if (!(data.signature.value > 0 && data.signature.value < 1000)) return
          if (!verifySignature(data.signature, currentPlayer?.address)) return
      
          db.playerRewards[data.value.address].claiming = data.value.value
        } else if (data.event === 'ResetClaiming') {
          if (!db.modList.includes(currentPlayer?.address)) return
          if (!(data.signature.value > 0 && data.signature.value < 1000)) return
          if (!verifySignature(data.signature, currentPlayer?.address)) return
      
          for (const address in db.playerRewards) {
            db.playerRewards[address].claiming = false
          }
        } else if (data.event === 'SetPreset') {
          if (!db.modList.includes(currentPlayer?.address)) return
          if (!(data.signature.value > 0 && data.signature.value < 1000)) return
          if (!verifySignature(data.signature, currentPlayer?.address)) return
      
          presets[data.value.index] = data.value.config
        } else if (data.event === 'SetGodmode') {
          if (!db.modList.includes(currentPlayer?.address)) return
          if (!(data.signature.value > 0 && data.signature.value < 1000)) return
          if (!verifySignature(data.signature, currentPlayer?.address)) return
      
          let client
          for (let i = 0; i < clients.length; i++) {
            if (clients[i].name == data.value) {
              client = clients[i]
              break;
            }
          }
      
          if (client) {
            client.isInvincible = true
          }
        }
      } catch(e) {
        console.log(e)
      }
    })

    socket.on('Load', function() {
      emitDirect(socket, 'OnLoaded', 1)
    })

    socket.on('Spectate', function() {
      try {
        if (config.isMaintenance && !db.modList.includes(currentPlayer?.address)) {
          return
        }

        currentPlayer.isSpectating = true
        // currentPlayer.points = 0
        currentPlayer.xp = 0
        currentPlayer.avatar = config.startAvatar
        currentPlayer.speed = 5
        currentPlayer.overrideSpeed = 5
        currentPlayer.cameraSize = 6
        currentPlayer.overrideCameraSize = 6

        syncSprites()

        publishEvent('OnSpectate', currentPlayer.id, currentPlayer.speed, currentPlayer.cameraSize)
      } catch(e) {
        console.log(e)
      }
    })
    
    socket.on('Report', function(name) {
      try {
        const currentGamePlayers = clients.map(c => c.name)
        const reportedPlayer = clients.find(c => c.name === name)

        reportPlayer(currentGamePlayers, currentPlayer, reportedPlayer)
      } catch(e) {
        console.log(e)
      }
    })

    socket.on('ping', function() {
      emitDirect(socket, 'pong')
    })

    socket.on('SetInfo', async function(msg) {
      try {
        const pack = decodePayload(msg)

        if (!pack.signature || !pack.network || !pack.device || !pack.address) {
          disconnectPlayer(currentPlayer)
          return
        }

        const address = web3.utils.toChecksumAddress(pack.address.trim())

        if (!verifySignature({ value: 'evolution', hash: pack.signature.trim() }, address)) {
          disconnectPlayer(currentPlayer)
          return
        }

        if (db.banList.includes(address)) {
          emitDirect(socket, 'OnBanned', true)
          disconnectPlayer(currentPlayer)
          return
        }

        if (config.isMaintenance && !db.modList.includes(address)) {
          emitDirect(socket, 'OnMaintenance', true)
          disconnectPlayer(currentPlayer)
          return
        }

        let name = addressToUsername[address]

        if (!name) {
          name = await getUsername(address)

          if (!name) {
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

          addToRecentPlayers(currentPlayer)
      
          publishEvent('OnSetInfo', currentPlayer.id, currentPlayer.name, currentPlayer.network, currentPlayer.address, currentPlayer.device)

          db.log.push({
            event: 'Connected',
            ip,
            address: currentPlayer.address,
            name: currentPlayer.name
          })
        }
      } catch(e) {
        console.log(e)
      }
    })

    socket.on('JoinRoom', function() {
      log('JoinRoom', currentPlayer.id)

      // const pack = decodePayload(msg)
      const now = getTime()
      const recentPlayer = round.players.find(r => r.address === currentPlayer.address)

      if (recentPlayer && (now - recentPlayer.lastUpdate) < 3000) {
        disconnectPlayer(currentPlayer)
        currentPlayer.log.connectedTooSoon += 1
        return
      }

      if (config.isMaintenance && !db.modList.includes(currentPlayer?.address)) {
        emitDirect(socket, 'OnMaintenance', true)
        disconnectPlayer(currentPlayer)
        return
      }

      currentPlayer.isJoining = true
      currentPlayer.avatar = config.startAvatar
      currentPlayer.joinedAt = Math.round(getTime() / 1000)
      currentPlayer.speed = (config.baseSpeed * config['avatarSpeedMultiplier' + currentPlayer.avatar])

      log("[INFO] player " + currentPlayer.id + ": logged!")

      log("[INFO] Total players: " + Object.keys(clientLookup).length)
      const roundTimer = (round.startedAt + config.roundLoopSeconds) - Math.round(getTime() / 1000)
      emitDirect(socket, 'OnSetPositionMonitor', config.checkPositionDistance + ':' + config.checkInterval + ':' + config.resetInterval)
      emitDirect(socket, 'OnJoinGame', currentPlayer.id, currentPlayer.name, currentPlayer.avatar, currentPlayer.isMasterClient ? 'true' : 'false', roundTimer, spawnPoint.x, spawnPoint.y)
      // emitDirect(socket, 'OnSetInfo', currentPlayer.id, currentPlayer.name, currentPlayer.address, currentPlayer.network, currentPlayer.device)

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
          '+300 Points Per Kill (Per Evolution)',
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
          '+50% Speed as LV. 3',
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
          '-200 Points Per Kill',
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


      emitDirect(socket, 'OnSetRoundInfo', roundTimer + ':' + getRoundInfo().join(':') + ':' + guide.join(':'))

      syncSprites()

      if (config.hideMap) {
        emitDirect(socket, 'OnHideMinimap')
      }

      if (config.level2open) {
        emitDirect(socket, 'OnOpenLevel2')
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

      if (config.level2allowed) {
        if (clients.filter(c => !c.isSpectating && !c.isDead).length >= config.playersRequiredForLevel2) {
          if (!config.level2open) {
            baseConfig.level2open = true
            config.level2open = true
            sharedConfig.spritesStartCount = 200
            config.spritesStartCount = 200
            clearSprites()
            spawnSprites(config.spritesStartCount)
            publishEvent('OnOpenLevel2')
          }
        }

        if (clients.filter(c => !c.isSpectating && !c.isDead).length < config.playersRequiredForLevel2 - 5) {
          if (config.level2open) {
            baseConfig.level2open = false
            config.level2open = false
            sharedConfig.spritesStartCount = 50
            config.spritesStartCount = 50
            clearSprites()
            spawnSprites(config.spritesStartCount)
            publishEvent('OnCloseLevel2')
  
            spawnRandomReward()
          }
        }
      }

      // setTimeout(() => {
      //   baseConfig.level2open = true
      //   config.level2open = true
      //   sharedConfig.spritesStartCount = 100
      //   config.spritesStartCount = 100
      //   publishEvent('OnOpenLevel2')
      // }, 5 * 1000)
      // setTimeout(() => {
      //   publishEvent('OnCloseLevel2')
      // }, 10 * 1000)
    })

    socket.on('UpdateMyself', function(msg) {
      try {
        if (currentPlayer.isDead && !currentPlayer.isJoining) return
        if (currentPlayer.isSpectating) return
        if (config.isMaintenance && !db.modList.includes(currentPlayer?.address)) return

        const now = getTime()

        if (now - currentPlayer.lastUpdate < config.forcedLatency) return

        if (currentPlayer.isJoining) {
          currentPlayer.isDead = false
          currentPlayer.isJoining = false

          // spawn currentPlayer client on clients in broadcast
          publishEvent('OnSpawnPlayer', currentPlayer.id, currentPlayer.name, currentPlayer.speed, currentPlayer.avatar, currentPlayer.position.x, currentPlayer.position.y, currentPlayer.position.x, currentPlayer.position.y)
        }

        const pack = decodePayload(msg)

        const positionX = parseFloat(parseFloat(pack.position.split(':')[0]).toFixed(2))
        const positionY = parseFloat(parseFloat(pack.position.split(':')[1]).toFixed(2))

        const targetX = parseFloat(parseFloat(pack.target.split(':')[0]).toFixed(2))
        const targetY = parseFloat(parseFloat(pack.target.split(':')[1]).toFixed(2))


        if (!Number.isFinite(positionX) || !Number.isFinite(positionY) || !Number.isFinite(targetX) || !Number.isFinite(targetY)) return
        if (positionX < mapBoundary.x.min) return
        if (positionX > mapBoundary.x.max) return
        if (positionY < mapBoundary.y.min) return
        if (positionY > mapBoundary.y.max) return
      
        if (config.anticheat.disconnectPositionJumps && distanceBetweenPoints(currentPlayer.position, { x: positionY, y: positionY }) > 5) {
          disconnectPlayer(currentPlayer)
          currentPlayer.log.positionJump += 1
          return
        }

        currentPlayer.clientPosition = { x: positionX, y: positionY }
        currentPlayer.clientTarget = { x: targetX, y: targetY }
        currentPlayer.lastReportedTime = parseFloat(pack.time)

        // const cacheKey = Math.floor(pack.target.split(':')[0])

        // if (eventCache['OnUpdateMyself'][socket.id] !== cacheKey) {
          currentPlayer.lastUpdate = now

          // publishEvent('OnUpdateMyself', data.id, data.position, data.target)
        //   eventCache['OnUpdateMyself'][socket.id] = cacheKey
        // }
      } catch(e) {
        console.log(e)
      }
    })

    socket.on('Pickup', async function (msg) {
      try {
        const now = getTime()
        const isPhased = currentPlayer.isPhased ? true : now <= currentPlayer.phasedUntil

        if (currentPlayer.isDead) return
        if (currentPlayer.isSpectating) return
        if (isPhased) return
        if (config.isMaintenance && !db.modList.includes(currentPlayer?.address)) return

        const pack = decodePayload(msg)

        const powerup = powerupLookup[pack.id]

        log('Pickup', msg, powerup)

        if (powerup) {
          removeSprite(pack.id)

          let value = 0

          if (powerup.type == 0) value = config.powerupXp0
          if (powerup.type == 1) value = config.powerupXp1
          if (powerup.type == 2) value = config.powerupXp2
          if (powerup.type == 3) value = config.powerupXp3

          currentPlayer.powerups += 1
          currentPlayer.points += config.pointsPerPowerup
          currentPlayer.xp += (value * config.spriteXpMultiplier)
      
          publishEvent('OnUpdatePickup', currentPlayer.id, pack.id, value)

          removeSprite(pack.id)
          spawnSprites(1)
        }
      } catch(e) {
        console.log(e)
      }
    })
    
    // socket.on('GetBestKillers', function(pack) {
    //   const leaderboard = round.players.sort(comparePlayers)
    //   for (let j = 0; j < leaderboard.length; j++) {
    //     emitDirect(socket, 'OnUpdateBestKiller', leaderboard[j].name, j, leaderboard[j].points, leaderboard[j].kills, leaderboard[j].deaths, leaderboard[j].powerups, leaderboard[j].evolves, leaderboard[j].rewards, leaderboard[j].isDead ? '-' : Math.round(leaderboard[j].latency), ranks[leaderboard[j].address]?.kills / 5 || 1)
    //   }
    // })

    socket.on('disconnect', function() {
      log("User has disconnected")

      disconnectPlayer(currentPlayer)
      currentPlayer.log.clientDisconnected += 1

      flushEventQueue()
    })
  } catch(e) {
    logError(e)
  }
})

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

function sendLeaderReward(leaders) {
  log('Leader: ', leaders[0])

  if (leaders[0]?.address) {
    try {
      if (!db.playerRewards[leaders[0].address]) db.playerRewards[leaders[0].address] = {}
      if (!db.playerRewards[leaders[0].address].pending) db.playerRewards[leaders[0].address].pending = {}
      if (!db.playerRewards[leaders[0].address].pending.zod) db.playerRewards[leaders[0].address].pending.zod = 0
    
      db.playerRewards[leaders[0].address].pending.zod  = Math.round((db.playerRewards[leaders[0].address].pending.zod + config.rewardWinnerAmount * 1) * 1000) / 1000

      publishEvent('OnRoundWinner', leaders[0].name)
    } catch(e) {
      console.log(e)
    }
  }
  if (leaders[1]?.address) {
    try {
      if (!db.playerRewards[leaders[1].address]) db.playerRewards[leaders[1].address] = {}
      if (!db.playerRewards[leaders[1].address].pending) db.playerRewards[leaders[1].address].pending = {}
      if (!db.playerRewards[leaders[1].address].pending.zod) db.playerRewards[leaders[1].address].pending.zod = 0
    
      db.playerRewards[leaders[1].address].pending.zod  = Math.round((db.playerRewards[leaders[1].address].pending.zod + config.rewardWinnerAmount * 0.25) * 1000) / 1000
    } catch(e) {
      console.log(e)
    }
  }
  if (leaders[2]?.address) {
    try {
      if (!db.playerRewards[leaders[2].address]) db.playerRewards[leaders[2].address] = {}
      if (!db.playerRewards[leaders[2].address].pending) db.playerRewards[leaders[2].address].pending = {}
      if (!db.playerRewards[leaders[2].address].pending.zod) db.playerRewards[leaders[2].address].pending.zod = 0
    
      db.playerRewards[leaders[2].address].pending.zod  = Math.round((db.playerRewards[leaders[2].address].pending.zod + config.rewardWinnerAmount * 0.15) * 1000) / 1000
    } catch(e) {
      console.log(e)
    }
  }
  if (leaders[3]?.address) {
    try {
      if (!db.playerRewards[leaders[3].address]) db.playerRewards[leaders[3].address] = {}
      if (!db.playerRewards[leaders[3].address].pending) db.playerRewards[leaders[3].address].pending = {}
      if (!db.playerRewards[leaders[3].address].pending.zod) db.playerRewards[leaders[3].address].pending.zod = 0
    
      db.playerRewards[leaders[3].address].pending.zod  = Math.round((db.playerRewards[leaders[3].address].pending.zod + config.rewardWinnerAmount * 0.05) * 1000) / 1000
    } catch(e) {
      console.log(e)
    }
  }
  if (leaders[4]?.address) {
    try {
      if (!db.playerRewards[leaders[4].address]) db.playerRewards[leaders[4].address] = {}
      if (!db.playerRewards[leaders[4].address].pending) db.playerRewards[leaders[4].address].pending = {}
      if (!db.playerRewards[leaders[4].address].pending.zod) db.playerRewards[leaders[4].address].pending.zod = 0
    
      db.playerRewards[leaders[4].address].pending.zod  = Math.round((db.playerRewards[leaders[4].address].pending.zod + config.rewardWinnerAmount * 0.05) * 1000) / 1000
    } catch(e) {
      console.log(e)
    }
  }
  if (leaders[5]?.address) {
    try {
      if (!db.playerRewards[leaders[5].address]) db.playerRewards[leaders[5].address] = {}
      if (!db.playerRewards[leaders[5].address].pending) db.playerRewards[leaders[5].address].pending = {}
      if (!db.playerRewards[leaders[5].address].pending.zod) db.playerRewards[leaders[5].address].pending.zod = 0
    
      db.playerRewards[leaders[5].address].pending.zod  = Math.round((db.playerRewards[leaders[5].address].pending.zod + config.rewardWinnerAmount * 0.05) * 1000) / 1000
    } catch(e) {
      console.log(e)
    }
  }
  if (leaders[6]?.address) {
    try {
      if (!db.playerRewards[leaders[6].address]) db.playerRewards[leaders[6].address] = {}
      if (!db.playerRewards[leaders[6].address].pending) db.playerRewards[leaders[6].address].pending = {}
      if (!db.playerRewards[leaders[6].address].pending.zod) db.playerRewards[leaders[6].address].pending.zod = 0
    
      db.playerRewards[leaders[6].address].pending.zod  = Math.round((db.playerRewards[leaders[6].address].pending.zod + config.rewardWinnerAmount * 0.05) * 1000) / 1000
    } catch(e) {
      console.log(e)
    }
  }
  if (leaders[7]?.address) {
    try {
      if (!db.playerRewards[leaders[7].address]) db.playerRewards[leaders[7].address] = {}
      if (!db.playerRewards[leaders[7].address].pending) db.playerRewards[leaders[7].address].pending = {}
      if (!db.playerRewards[leaders[7].address].pending.zod) db.playerRewards[leaders[7].address].pending.zod = 0
    
      db.playerRewards[leaders[7].address].pending.zod  = Math.round((db.playerRewards[leaders[7].address].pending.zod + config.rewardWinnerAmount * 0.05) * 1000) / 1000
    } catch(e) {
      console.log(e)
    }
  }
  if (leaders[8]?.address) {
    try {
      if (!db.playerRewards[leaders[8].address]) db.playerRewards[leaders[8].address] = {}
      if (!db.playerRewards[leaders[8].address].pending) db.playerRewards[leaders[8].address].pending = {}
      if (!db.playerRewards[leaders[8].address].pending.zod) db.playerRewards[leaders[8].address].pending.zod = 0
    
      db.playerRewards[leaders[8].address].pending.zod  = Math.round((db.playerRewards[leaders[8].address].pending.zod + config.rewardWinnerAmount * 0.05) * 1000) / 1000
    } catch(e) {
      console.log(e)
    }
  }
  if (leaders[9]?.address) {
    try {
      if (!db.playerRewards[leaders[9].address]) db.playerRewards[leaders[9].address] = {}
      if (!db.playerRewards[leaders[9].address].pending) db.playerRewards[leaders[9].address].pending = {}
      if (!db.playerRewards[leaders[9].address].pending.zod) db.playerRewards[leaders[9].address].pending.zod = 0
    
      db.playerRewards[leaders[9].address].pending.zod  = Math.round((db.playerRewards[leaders[9].address].pending.zod + config.rewardWinnerAmount * 0.05) * 1000) / 1000
    } catch(e) {
      console.log(e)
    }
  }
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

  sharedConfig.rewardItemAmount = Math.round(Math.min(totalLegitPlayers * config.rewardItemAmountPerLegitPlayer, config.rewardItemAmountMax) * 1000) / 1000
  sharedConfig.rewardWinnerAmount = Math.round(Math.min(totalLegitPlayers * config.rewardWinnerAmountPerLegitPlayer, config.rewardWinnerAmountMax) * 1000) / 1000

  config.rewardItemAmount = sharedConfig.rewardItemAmount
  config.rewardWinnerAmount = sharedConfig.rewardWinnerAmount
}


let lastFastGameloopTime = getTime()
let lastFastestGameloopTime = getTime()

function resetLeaderboard() {
  const fiveSecondsAgo = getTime() - 7000

  const leaders = round.players.filter(p => p.lastUpdate >= fiveSecondsAgo).sort((a, b) => b.points - a.points)

  if (leaders.length) {
    lastLeaderName = leaders[0].name
    sendLeaderReward(leaders)
  }

  db.leaderboardHistory.push(JSON.parse(JSON.stringify(round.players)))

  saveLeaderboardHistory()
  savePlayerRewards()
  saveRewards()
  saveReportList()
  saveBanList()
  // saveLog()
  saveModList()

  jetpack.write(path.resolve(`./public/data/rounds/${round.id}.json`), JSON.stringify(round, null, 2), { atomic: true })

  if (config.calcRoundRewards) {
    calcRoundRewards()
  }

  randomRoundPreset()

  db.config.roundId = round.id + 1

  round = null
  round = {
    id: db.config.roundId,
    startedAt: Math.round(getTime() / 1000),
    players: [],
    events: [],
    states: [],
  }

  jetpack.write(path.resolve(`./public/data/config.json`), JSON.stringify(db.config, null, 2), { atomic: true })

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

  if (config.hideMap) {
    publishEvent('OnHideMinimap')
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
    const value = { text: 'Restarting server at end of this round.' }

    publishEvent('OnBroadcast', escape(JSON.stringify(value)))
    
    rebootAfterRound = true
  }

  setTimeout(resetLeaderboard, config.roundLoopSeconds * 1000)
}

function checkConnectionLoop() {
  if (!config.noBoot) {
    const oneMinuteAgo = getTime() - (config.disconnectPlayerSeconds * 1000)
    // const oneMinuteAgo = Math.round(getTime() / 1000) - config.disconnectPlayerSeconds

    for (let i = 0; i < clients.length; i++) {
      const client = clients[i]

      if (client.isSpectating) continue
      // if (client.isInvincible) continue
      // if (client.isDead) continue

      if (client.lastUpdate !== 0 && client.lastUpdate <= oneMinuteAgo) {
        disconnectPlayer(client)
        client.log.timeoutDisconnect += 1
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

function castVectorTowards(position, target, scalar) {
  const magnitude = Math.sqrt(position.x * position.x + position.y * position.y)

  return {
    x: position.x + (target.x - position.x) / magnitude * scalar,
    y: position.y + (target.y - position.y) / magnitude * scalar
  }
}

function detectCollisions() {
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

    for (const gameObject of db.map) {
      if (!gameObject.Colliders || !gameObject.Colliders.length) continue

      for (const gameCollider of gameObject.Colliders) {
        let collider
        
        if (gameObject.Name.indexOf('Island') !== -1) {
          collider = {
            minX: gameCollider.Min[0] + (gameCollider.Max[0] - gameCollider.Min[0]) * config.colliderBuffer,
            maxX: gameCollider.Max[0] - (gameCollider.Max[0] - gameCollider.Min[0]) * config.colliderBuffer,
            minY: gameCollider.Min[1] + (gameCollider.Max[1] - gameCollider.Min[1]) * config.colliderBuffer,
            maxY: gameCollider.Max[1] - (gameCollider.Max[1] - gameCollider.Min[1]) * config.colliderBuffer
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
          const diff = gameObject.Transform.LocalPosition[1] - -16
          collider.minY -= diff
          collider.maxY -= diff
        }

        if (
          position.x >= collider.minX &&
          position.x <= collider.maxX &&
          position.y >= collider.minY &&
          position.y <= collider.maxY
        ) {

          if (gameObject.Name.indexOf('Land') !== -1) {
            stuck = true
          }
          else if (gameObject.Name.indexOf('Island') !== -1) {
            if (config.stickyIslands) {
              stuck = true
            } else {
              collided = true
            }
          }
          else if (gameObject.Name.indexOf('Collider') !== -1) {
            stuck = true
          }
          else if (gameObject.Name.indexOf('Divider') !== -1) {
            stuck = true
          }

          break
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

  // Check players
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
  
        claimReward(player)
  
        // publishEvent('OnUpdatePickup', player.id, reward.id, 0)
  
        // removeReward(reward.id)
      }
    }
  }

  lastFastestGameloopTime = now
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
      const isInvincible = client.isInvincible ? true : ((client.joinedAt >= currentTime - config.immunitySeconds))
      const isPhased = client.isPhased ? true : now <= client.phasedUntil

      let decay = config.noDecay ? 0 : (client.avatar + 1) / (1 / config.fastLoopSeconds) * ((config['avatarDecayPower' + client.avatar] || 1) * config.decayPower)

      client.speed = client.overrideSpeed || (config.baseSpeed * config['avatarSpeedMultiplier' + client.avatar])

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
                
              if (!config.noBoot && !isInvincible && !isNew) {
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

      // const cacheKey = client.position.x + client.position.y + isInvincible
    
      // if (config.optimization.sendPlayerUpdateWithNoChanges || eventCache['OnUpdatePlayer'][client.id] !== cacheKey) {
        client.latency = ((now - client.lastReportedTime) / 2)// - (now - lastFastGameloopTime)

        if (Number.isNaN(client.latency)) {
          client.latency = 0
        }
    
        publishEvent('OnUpdatePlayer', client.id, client.overrideSpeed || client.speed, client.cameraSize, client.position.x, client.position.y, client.target.x, client.target.y, Math.floor(client.xp), now, Math.round(client.latency), isInvincible ? '1': '0', client.isStuck ? '1' : '0', isPhased && !isInvincible ? '1' : '0')

        // eventCache['OnUpdatePlayer'][client.id] = cacheKey
      // }
    }

    flushEventQueue()

    lastFastGameloopTime = now
  } catch(e) {
    console.log(e)
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

const initWebServer = async () => {
  // @ts-ignore
  const rateLimiter = new RateLimit({
    windowMs: 2,
    max: 5,
  })

  // Security related
  server.set('trust proxy', 1)
  server.use(helmet())
  server.use(
    cors({
      allowedHeaders: ['Accept', 'Authorization', 'Cache-Control', 'X-Requested-With', 'Content-Type', 'applicationId'],
    })
  )

  // Accept json and other formats in the body
  server.use(bodyParser.urlencoded({ extended: true }))
  server.use(bodyParser.json())

  // Apply ratelimit
  server.use(rateLimiter)

  // Logging
  server.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))

  server.use(express.static(path.join(__dirname, '/../public')))
}

const initRoutes = async () => {
  try {
    const api = {}

    const routes = [
      // require('./routes/info/get')
    ]

    for (const route of routes) {
      api[route.operationId] = function (options, db, req, res) {
        return route.run(options, db, req, res).catch((error) => {
          log(`Route error:`, error.stack)

          res.status(500).json({ message: `Error encountered: ${error}` })
        })
      }
    }

    const notFound = (options, db, req, res) => res.status(404).end()
    const notImplemented = (options, db, req, res) => res.status(501).end()

    const paths = [
      // {
      //   operationId: 'getInfo',
      //   method: 'get',
      //   route: '/info',
      // },
    ]

    paths.forEach((p: any) => {
      const runSequence = []
      const options = {
        body: p.body || [],
        parameters: p.parameters || [],
        responses: p.responses || {},
        security: p.security || {},
      }

      let routeRun = notFound

      if (p.operationId) {
        if (typeof api[p.operationId] === 'function') {
          routeRun = api[p.operationId]
        } else {
          routeRun = notImplemented
        }
      }

      for (const item of middleware) {
        runSequence.push(item.bind(null, options, db))
      }

      runSequence.push(routeRun.bind(null, options, db))

      server[p.method](p.route, ...runSequence)
    })

    server.get('/info', async function(req, res) {
      return res.json({
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
      })
    })

    server.get('/db', async function(req, res) {
      return res.json(db)
    })

    server.get('/config', async function(req, res) {
      return res.json(config)
    })

    server.get('/buff/binzy', async function(req, res) {
      db.playerRewards['0xa987f487639920A3c2eFe58C8FBDedB96253ed9B'].pending = {
        "ral": 1,
        "tir": 0.9,
        "amn": 0.9,
        "thul": 0.9,
        "zod": 0.9,
        "sol": 1.1,
        "tal": 0.9,
        "ort": 1.2,
        "shael": 0.9,
        "nef": 0.9
      }

      config.claimingRewards = false
      db.playerRewards['0xa987f487639920A3c2eFe58C8FBDedB96253ed9B'].claiming = false

      savePlayerRewards()
    
      res.json(db.playerRewards['0xa987f487639920A3c2eFe58C8FBDedB96253ed9B'].pending)
    })

    server.post('/maintenance', function(req, res) {
      db.log.push({
        event: 'Maintenance',
        caller: req.body.address
      })

      saveLog()

      if (verifySignature({ value: req.body.address, hash: req.body.signature }, req.body.address) && db.modList.includes(req.body.address)) {
        sharedConfig.isMaintenance = true
        config.isMaintenance = true
    
        publishEvent('OnMaintenance', config.isMaintenance)

        res.json({ success: 1 })
      } else {
        res.json({ success: 0 })
      }
    })

    server.post('/unmaintenance', function(req, res) {
      db.log.push({
        event: 'Unmaintenance',
        caller: req.body.address
      })

      saveLog()

      if (verifySignature({ value: req.body.address, hash: req.body.signature }, req.body.address) && db.modList.includes(req.body.address)) {
        sharedConfig.isMaintenance = false
        config.isMaintenance = false
    
        publishEvent('OnMaintenance', config.isMaintenance)

        res.json({ success: 1 })
      } else {
        res.json({ success: 0 })
      }
    })

    server.post('/report/:address', function(req, res) {
      db.log.push({
        event: 'Report',
        value: req.params.address,
        caller: req.body.address
      })

      saveLog()

      const currentPlayer = round.players.find(p => p.address === req.body.address)
      if (currentPlayer && verifySignature({ value: req.body.address, hash: req.body.signature }, req.body.address)) {
        const reportedPlayer = clients.find(c => c.address === req.params.address)

        if (reportedPlayer) {
          reportPlayer(clients, currentPlayer, reportedPlayer)

          res.json({ success: 1 })
        } else {
          res.json({ success: 0 })
        }
      } else {
        res.json({ success: 0 })
      }
    })

    server.post('/ban/:address', function(req, res) {
      db.log.push({
        event: 'Ban',
        value: req.params.address,
        caller: req.body.address
      })

      saveLog()

      if (verifySignature({ value: req.body.address, hash: req.body.signature }, req.body.address) && db.modList.includes(req.body.address)) {
        if (!db.banList.includes(req.params.address)) {
          db.banList.push(req.params.address)
        }

        if (clients.find(c => c.address === req.params.address)) {
          disconnectPlayer(clients.find(c => c.address === req.params.address))
        }

        saveBanList()
    
        res.json({ success: 1 })
      } else {
        res.json({ success: 0 })
      }
    })

    server.post('/unban/:address', function(req, res) {
      db.log.push({
        event: 'Unban',
        value: req.params.address,
        caller: req.body.address
      })

      saveLog()

      if (verifySignature({ value: req.body.address, hash: req.body.signature }, req.body.address) && db.modList.includes(req.body.address)) {
        db.banList.splice(db.banList.indexOf(req.params.address), 1)

        saveBanList()
    
        res.json({ success: 1 })
      } else {
        res.json({ success: 0 })
      }
    })

    server.post('/message/:address', function(req, res) {
      db.log.push({
        event: 'Message',
        value: req.params.address,
        caller: req.body.address,
        message: req.body.message
      })

      saveLog()

      if (verifySignature({ value: req.body.address, hash: req.body.signature }, req.body.address) && db.modList.includes(req.body.address)) {
        const socket = sockets[clients.find(c => c.address === req.params.address).id]

        emitDirect(socket, 'OnBroadcast', escape(JSON.stringify(req.body.message)))
    
        res.json({ success: 1 })
      } else {
        res.json({ success: 0 })
      }
    })

    server.post('/broadcast', function(req, res) {
      db.log.push({
        event: 'Broadcast',
        caller: req.body.address,
        message: req.body.message
      })

      saveLog()

      if (verifySignature({ value: req.body.address, hash: req.body.signature }, req.body.address) && db.modList.includes(req.body.address)) {

        publishEvent('OnBroadcast', escape(JSON.stringify(req.body.message)))
    
        res.json({ success: 1 })
      } else {
        res.json({ success: 0 })
      }
    })

    server.get('/user/:address', function(req, res) {
      if (!db.playerRewards[req.params.address]) db.playerRewards[req.params.address] = {}
      if (!db.playerRewards[req.params.address].pending) db.playerRewards[req.params.address].pending = {}

      res.json(db.playerRewards[req.params.address].pending)
    })

    server.get('/admin/claim/:address/:symbol/:amount/:tx', function(req, res) {
      if (!db.playerRewards[req.params.address]) db.playerRewards[req.params.address] = {}
      if (!db.playerRewards[req.params.address].pending) db.playerRewards[req.params.address].pending = {}
      if (!db.playerRewards[req.params.address].pending) db.playerRewards[req.params.address].pending[req.params.symbol] = 0
      if (!db.playerRewards[req.params.address].tx) db.playerRewards[req.params.address].tx = []

      const newReward = {
        type: "rune",
        symbol: req.params.symbol,
        quantity: db.playerRewards[req.params.address].pending[req.params.symbol],
        winner: {
          address: req.params.address
        },
        tx: req.params.tx
      }

      db.rewardHistory.push(newReward)

      saveRewardHistory()

      db.playerRewards[req.params.address].pending[req.params.symbol] -= parseFloat(req.params.amount)
      db.playerRewards[req.params.address].tx.push(req.params.tx)

      savePlayerRewards()

      res.json({ success: true })
    })

    server.get('/readiness_check', (req, res) => res.sendStatus(200))
    server.get('/liveness_check', (req, res) => res.sendStatus(200))

    server.get('/.well-known/acme-challenge/VtR7_TzQdGK-dXWCUYDKV_OJb1vXf5kPf0ijCAl-BbQ', (req, res) => res.end('VtR7_TzQdGK-dXWCUYDKV_OJb1vXf5kPf0ijCAl-BbQ.vuboczA32qq2liEOxQ8-eyB18eE2jCWY64W5dIEm4S8'))
  } catch(e) {
    logError(e)
  }
}

function clearSprites() {
  powerups.splice(0, powerups.length) // clear the powerup list
}

function periodicReboot() {
  announceReboot = true
}

const initGameServer = async () => {
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
  setTimeout(resetLeaderboard, config.roundLoopSeconds * 1000)
  setTimeout(periodicReboot, config.rebootSeconds * 1000)
  // setTimeout(flushEventQueue, config.flushEventQueueSeconds * 1000)
}

const initServices = async () => {
  // db.initCollections('crawler', {
  //   config: {
  //     fromBlock: 10961240,
  //     lastUpdated: 0
  //   },
  // })
  await services.init(db)
  await services.crawl(db)
}

const init = async () => {
  try {
    // db = await database.init()
    // db.initCollections('app', {
    //   leaderHistory: [],
    // })

    await initServices()
    await initGameServer()
    await initWebServer()
    await initRoutes()

    https.listen(443, function() {
      log(`:: Backend ready and listening on *:443`)
    })

    const port = process.env.PORT || 80

    http.listen(port, function() {
      log(`:: Backend ready and listening on *:${port}`)
    })
  } catch(e) {
    logError(e)
  }
}

init()