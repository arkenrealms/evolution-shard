import { log, logError, getTime } from '@arken/node/util';

const os = require('os');
const fs = require('fs');

export function initMonitor(app) {
  let logs = [];

  setInterval(function () {
    const available = Number(/MemAvailable:[ ]+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1]) / 1024;

    if (available < 500) {
      if (logs.length >= 5) {
        const free = os.freemem() / 1024 / 1024;
        const total = os.totalmem() / 1024 / 1024;

        logError('GS Free mem', free);
        logError('GS Available mem', available);
        logError('GS Total mem', total);

        process.exit();
      }
    } else {
      logs = [];
    }
  }, 60 * 1000);

  setInterval(function () {
    const available = Number(/MemAvailable:[ ]+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1]) / 1024;
    // const free = os.freemem() / 1024 / 1024
    // const total = os.totalmem() / 1024 / 1024
    // log('Free mem', free)
    // log('Available mem', available)
    // log('Total mem', total)
    if (available < 500) {
      // if ((os.freemem() / os.totalmem()) < 0.2) {
      log('GS Memory flagged', available);
      logs.push(true);
    }
  }, 10 * 1000);
}
