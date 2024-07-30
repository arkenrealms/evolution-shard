import express from 'express';
import RateLimit from 'express-rate-limit';
import bodyParser from 'body-parser';
import morgan from 'morgan';
import { logError } from '@arken/node/util';

const path = require('path');

function initRoutes(server) {
  try {
    server.get('/hello', (req, res) => res.end('world'));
  } catch (e) {
    logError(e);
  }
}

export async function initWebServer(server) {
  console.log('Init web server');

  // @ts-ignore
  const rateLimiter = new RateLimit({
    windowMs: 2,
    max: 5,
  });

  // Accept json and other formats in the body
  server.use(bodyParser.urlencoded({ extended: true }));
  server.use(bodyParser.json());

  // Apply ratelimit
  server.use(rateLimiter);

  // Logging
  server.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  server.use(express.static(path.resolve('./public')));

  initRoutes(server);
}
