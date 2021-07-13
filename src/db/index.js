import * as Loki from 'lokijs'
import * as chalk from 'chalk'
import * as moment from 'moment'
import * as jetpack from 'fs-jetpack'

const safeStringify = require('fast-safe-stringify')

const db = {
  loki: null,
  collections: [],
  initCollection(name, key, data) {
    if (!db.collections[name]) db.collections[name] = {}

    if (!db.collections[name][key]) {
      db.collections[name][key] = db.loki.addCollection(`${name}.${key}`)
    }

    if (key === 'config') {
      delete data.meta
      delete data.$loki

      if (!db.collections[name][key].length) {
        db.collections[name][key].insert(data)
      }

      for (const k in data) {
        if (db.collections[name][key].data[0][k] === undefined && data[k] !== undefined) {
          db.collections[name][key].data[0][k] = data[k]
        }
      }

      for (const k in db.collections[name][key].data[0]) {
        if (Object.prototype.hasOwnProperty.call(db.collections[name][key].data[0], k)) {
          if (db.collections[name][key][k] === undefined) {
            Object.defineProperty(db.collections[name][key], k, {
              get() {
                return db.collections[name][key].data[0][k]
              },
              set(x) {
                db.collections[name][key].data[0][k] = x
              },
            })
          }
        }
      }
    } else {
      for (const i in data) {
        const item = data[i]
        delete item.meta
        delete item.$loki

        if (!db.collections[name][key].data.length) {
          db.collections[name][key].insert(item)
        }

        for (const k in item) {
          if (typeof db.collections[name][key].data[i] === 'undefined') db.collections[name][key].data[i] = {}

          if (db.collections[name][key].data[i][k] === undefined && item[k] !== undefined) {
            db.collections[name][key].data[i][k] = item[k]
          }
        }
      }
    }

    db.collections[name][key].ensureId()
    db.collections[name][key].ensureAllIndexes(true)
  },
  initCollections(name, data) {
    console.log(`${chalk.blue.bold('db')} > ${chalk.yellow(moment().toString())} > Adding collection: ${name}`)

    for (const key in data) {
      db.initCollection(name, key, data[key])
    }

    return db.collections[name]
  },
  getCollections(name) {
    return db.collections[name]
  },
  beautify(data) {
    return JSON.stringify(JSON.parse(safeStringify(data)), null, 4) // beautify(JSON.parse(safeStringify(data)), null, 4, 100) // beautify(parse(stringify(data)), null, 4, 100) // stringify(data) // beautify(parse(stringify(data)), null, 4, 100)
  },
}

export function saveData() {
  // console.log('[db] Saving data')
  const data = {}

  for (const name in db.collections) {
    data[name] = {}

    for (const key in db.collections[name]) {
      if (key === 'config') {
        delete db.collections[name][key].data[0].meta
        delete db.collections[name][key].data[0].$loki
        data[name].config = db.collections[name][key].data[0]
      } else {
        data[name][key] = Object.keys(db.collections[name][key].data).map((k) => {
          const item = db.collections[name][key].data[k]
          delete item.meta
          delete item.$loki
          return item
        })
      }

      jetpack.write(`public/data/db/${name}/${key}.json`, db.beautify(data[name][key]))
      jetpack.write(`public/data/db/${name}/${key}.json.backup`, db.beautify(data[name][key]))
    }
  }
}

export function restoreData() {
  console.log(`${chalk.blue.bold('db')} > ${chalk.yellow(moment().toString())} > Restoring data`)

  const files = jetpack.find('public/data/db', { matching: '**/*.json' })

  for (const file of files) {
    console.log(`${chalk.blue.bold('db')} > ${chalk.yellow(moment().toString())} > Found file: ${file}`)

    try {
      const data = jetpack.read(file, 'json')
      const [name, key] = file.replace('public/data/db/', '').replace('.json', '').split('/')

      db.initCollection(name, key, data)
    } catch (e) {
      if (e.toString().indexOf('JSON parsing failed') !== -1) {
        console.log(
          `${chalk.blue.bold('db')} > ${chalk.yellow(moment().toString())} > File corrupt, loading backup: ${file}`
        )

        const data = jetpack.read(`${file}.backup`, 'json')
        const [name, key] = file.replace('public/data/db/', '').replace('.json', '').split('/')

        db.initCollection(name, key, data)
      }
    }
  }
}

export async function init() {
  return new Promise(function (resolve) {
    db.loki = new Loki(null, {
      autoload: false,
      autosave: false,
    })

    restoreData()

    setInterval(saveData, 5000)

    resolve(db)
  })
}
