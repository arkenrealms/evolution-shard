import jetpack from 'fs-jetpack'
import crypto from 'crypto'

const path = require('path')

const logData = jetpack.read(path.resolve('../public/data/log.json'), 'json') || []

export const isDebug = process.env.HOME === '/Users/dev'
console.log(process.env.HOME)
export function logError(err) {
  console.log("[GS]", err)

  const errorLog = jetpack.read(path.resolve('../public/data/errors.json'), 'json') || []

  errorLog.push(err + '')
  
  jetpack.write(path.resolve('../public/data/errors.json'), JSON.stringify(errorLog, null, 2), { atomic: true })
}

export function getTime() {
  return new Date().getTime()
}

export function sha256(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("base64")
}

export function isNumeric(str) {
  if (typeof str != "string") return false // we only process strings!  
  // @ts-ignore
  return !isNaN(str) && // use type coercion to parse the _entirety_ of the string (`parseFloat` alone does not do this)...
         !isNaN(parseFloat(str)) // ...and ensure strings of whitespace fail
}

export function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function randomPosition(min, max) {
  return Math.random() * (max - min) + min
}

export function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
  }

  return array
}

export function convertToDecimal(byte) {
  let result = 0

  byte = byte.split('')

  byte.reverse()

  for (let a = 0; a < byte.length; a++) {
    if (byte[a] === '1'){
      result += 2 ** a
    }
  }

  return result
}

export function binaryAgent(str) {
  let bytes = str.split(' ')
  let output = ''
    
  for (let k = 0; k < bytes.length; k++){
      if (bytes[k]) output += String.fromCharCode(convertToDecimal(bytes[k]));
  }

  return output
}

export function decodePayload(msg) {
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

export function log(...msgs) {
  for (const msg of msgs) {
    logData.push(msg + '')
  }

  if (isDebug) {
    console.log('[GS]', ...msgs)
  }

  jetpack.write(path.resolve('../public/data/log.json'), JSON.stringify(logData, null, 2))
}

export const getAddress = (address) => {
  const mainNetChainId = 56
  const chainId = process.env.CHAIN_ID
  return address[chainId] ? address[chainId] : address[mainNetChainId]
}
