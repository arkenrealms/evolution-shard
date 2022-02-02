import { logError } from '.'

export function catchExceptions() {
  process
    .on("unhandledRejection", (reason, p) => {
      console.log(reason, "Unhandled Rejection at Promise", p)
      logError(reason + ". Unhandled Rejection at Promise:" + p)
    })
    .on("uncaughtException", (err) => {
      console.log(err, "Uncaught Exception thrown")
      // logError(err + ". Uncaught Exception thrown" + err.stack)
      process.exit(1)
    })
}