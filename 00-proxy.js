'use strict'
const http = require('http')
const url = require('url')
const debug = require('debug')('stream-proxy')

http.createServer(function (clientReq, serverRes) {
  debug('url', clientReq.url)
  const options = url.parse(clientReq.url)
  options.headers = clientReq.headers
  options.method = clientReq.method
  clientReq.pause()
  const serverReq = http.request(options, function (remoteRes) {
    remoteRes.pause()
    serverRes.writeHeader(remoteRes.statusCode, remoteRes.headers)
    remoteRes.pipe(serverRes)
    remoteRes.resume()
  })
  clientReq.pipe(serverReq)
  clientReq.resume()
}).listen(8091, function () {
  console.log('Listen on 8091')
})
