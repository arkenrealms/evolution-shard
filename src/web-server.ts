import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import RateLimit from 'express-rate-limit'
import bodyParser from 'body-parser'
import morgan from 'morgan'
import { logError } from './util'

const path = require('path')

function initRoutes(server) {
  try {
    server.get('/.well-known/acme-challenge/M8BaoHsFi7co0BQAuCAq2mI7YrL6OS69HvIQrbyFlC8', (req, res) => res.end('M8BaoHsFi7co0BQAuCAq2mI7YrL6OS69HvIQrbyFlC8.vuboczA32qq2liEOxQ8-eyB18eE2jCWY64W5dIEm4S8'))
  } catch(e) {
    logError(e)
  }
}

export async function initWebServer(server) {
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

  initRoutes(server)
}
