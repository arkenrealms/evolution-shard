import fs from 'fs'
import express from 'express'
import { log, logError, isDebug } from './util'
import { catchExceptions } from './util/process'
import { initGameServer } from './game-server'
import { initWebServer } from './web-server'

const path = require('path')

if (isDebug) {
  console.log('Running GS in DEBUG mode')
}

async function init() {
  catchExceptions()

  try {
    const server = express()
    const http = require('http').Server(server)
    const https = require('https').createServer({ 
      key: fs.readFileSync(path.resolve('../privkey.pem')),
      cert: fs.readFileSync(path.resolve('../fullchain.pem'))
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

    await initWebServer(server)
    await initGameServer(io)

    const port = process.env.PORT || 80
    http.listen(port, function() {
      log(`:: Backend ready and listening on *:${port}`)
    })

    const sslPort = process.env.SSL_PORT || 443
    https.listen(sslPort, function() {
      log(`:: Backend ready and listening on *:${sslPort}`)
    })
  } catch(e) {
    logError(e)
  }
}

init()