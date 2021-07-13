/* eslint-disable func-names */
export default async function (options, db, req, res, next) {
    if (!options.security.admin) return next()
    if (!req.user) return next()
  
    // if (!req.$access('adminPanel')) {
    //   return res.status(401).json({ message: 'Invalid authorization' })
    // }
  
    next()
  }
  