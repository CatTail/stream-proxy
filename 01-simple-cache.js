'use strict'
const http = require('http')
const url = require('url')
const util = require('util')
const buffer = require('buffer')
const stream = require('stream')

const debug = require('debug')('stream-proxy')

const Transform = stream.Transform
const Readable = stream.Readable
const Buffer = buffer.Buffer

const caches = {}

http.createServer(function (clientReq, serverRes) {
  debug('url', clientReq.url)
  const options = url.parse(clientReq.url)
  options.headers = clientReq.headers
  options.method = clientReq.method
  const cache = getCache(clientReq)
  if (cache) {
    serverRes.writeHeader(cache.statusCode, cache.headers)
    const replayStream = new Readable()
    replayStream.pipe(serverRes)
    replayStream.push(cache.response)
    replayStream.push(null)
    return
  }

  clientReq.pause()
  const serverReq = http.request(options, function (remoteRes) {
    remoteRes.pause()
    serverRes.writeHeader(remoteRes.statusCode, remoteRes.headers)
    const cacheStream = new CacheStream(clientReq, remoteRes)
    remoteRes.pipe(cacheStream).pipe(serverRes)
    remoteRes.resume()
  })
  clientReq.pipe(serverReq)
  clientReq.resume()
}).listen(8091, function () {
  console.log('Listen on 8091')
})

function getCache (req) {
  if (!isCacheable(req.method, req.headers)) {
    return null
  }
  if (!caches[req.url]) {
    return null
  }

  debug('hit cache')
  const cache = caches[req.url]
  return cache
}

function isCacheable (method, headers) {
  return method === 'GET'
}

function CacheStream (clientReq, remoteRes) {
  this.cache = caches[clientReq.url] = {
    statusCode: remoteRes.statusCode,
    headers: remoteRes.headers,
    response: null
  }
  this.chunks = []

  Transform.call(this)
}
util.inherits(CacheStream, Transform)

CacheStream.prototype._transform = function (chunk, encoding, callback) {
  this.chunks.push(chunk)

  this.push(chunk)
  callback()
}

CacheStream.prototype._flush = function (callback) {
  this.cache.response = Buffer.concat(this.chunks)
  callback()
}
