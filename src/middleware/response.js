/* eslint-disable func-names */
export default async function (options, db, req, res, next) {
    const statusOriginal = res.status
    const jsonOriginal = res.json
    const endOriginal = res.end
  
    const exposeDevMessages = [400, 401, 422, 500, 501]
    const isDevelopment = process.env.NODE_ENV !== 'production'
  
    const isValid = () => {
      if (options.responses && !(res.statusCode in options.responses)) {
        res.statusCode = 500
        jsonOriginal.call(res, { message: `Response status not found in spec: ${res.statusCode}` })
        return false
      }
  
      // TODO: validate response schema
  
      return true
    }
  
    const exposeDevMessage = () => {
      if (!isDevelopment) return false
      if (!exposeDevMessages.includes(res.statusCode)) return false
  
      if (!options.responses[res.statusCode]) {
        jsonOriginal.call(res, { message: `Response for ${res.statusCode} not defined in spec` })
        return true
      }
  
      const message = options.responses[res.statusCode].description
  
      jsonOriginal.call(res, { message })
      return true
    }
  
    // HACK: Unfortunately we have to return a dummy res object that does nothing.
    // The reason is during dev we expose the error messages from the API spec.
    // Because headers are sent when we do that, it shouldn't allow any further chain calls to send more headers.
    const dummyRes = {
      json: () => dummyRes,
      data: () => dummyRes,
    }
  
    res.data = function (data) {
      return jsonOriginal.call(res, {
        ...(res.metaData || {}),
        permissions: res.permissionsData || {},
        data,
      })
    }
  
    res.permissions = function (permissionsData) {
      res.permissionsData = permissionsData
  
      return res
    }
  
    res.meta = function (metaData) {
      res.metaData = metaData
  
      return res
    }
  
    res.status = function (...args) {
      if (exposeDevMessage()) return dummyRes
      if (!isValid()) return res
  
      return statusOriginal.call(res, ...args)
    }
  
    res.json = function (...args) {
      if (exposeDevMessage()) return dummyRes
      if (!isValid()) return res
  
      if (!options.responses[res.statusCode].content || !options.responses[res.statusCode].content['application/json']) {
        res.statusCode = 500
        jsonOriginal.call(res, { message: 'Response content type not found in spec' })
        return false
      }
  
      // Print the error to the API console when there's a 500
      setTimeout(() => res.statusCode === 500 && console.log(args[0]), 0)
  
      return jsonOriginal.call(res, ...args)
    }
  
    // TODO: if not sending a response, send the spec description
    res.end = function (...args) {
      return endOriginal.call(res, ...args)
    }
  
    res.unauthorized = function () {
      return res.status(401).json({ message: 'Unauthorized' })
    }
  
    next()
  }
  