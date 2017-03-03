'use strict'
const fs = require('fs')
const net = require('net')
const http = require('http')
const https = require('https')
const tls = require('tls')
const url = require('url')

const pem = require('pem')
const debug = require('debug')('stream-proxy')
const dump = require('debug')('stream-proxy:dump')
const debugStream = require('debug-stream')(dump)

const httpPort = 8080
const httpsPort = 10000 + parseInt(Math.random() * 10000, 10)

let ca
const CA_CERT_PATH = './data/ca.crt'
const CA_KEY_PATH = './data/ca.key'

getCA(function (err, _ca) {
  if (err) {
    throw err
  }
  ca = _ca

  const httpServer = http.createServer(handleRequest)
  httpServer.on('connect', handleHttpConnect)
  httpServer.on('error', handleError)
  httpServer.listen(httpPort, function () {
    console.log('Listen on 8080')
  })
  const httpsServer = https.createServer({SNICallback}, handleRequest)
  httpsServer.on('error', handleError)
  httpsServer.listen(httpsPort)
})

function getCA (callback) {
  try {
    fs.mkdirSync('data')
  } catch (err) {

  }
  try {
    const cert = fs.readFileSync(CA_CERT_PATH, 'utf8')
    const key = fs.readFileSync(CA_KEY_PATH, 'utf8')
    return callback(null, {cert, key})
  } catch (err) {
    pem.createCertificate({
      commonName: 'MITM CA'
    }, function (err, ca) {
      if (err) {
        return callback(err)
      }
      const cert = ca.certificate
      const key = ca.serviceKey
      fs.writeFileSync(CA_CERT_PATH, cert, 'utf8')
      fs.writeFileSync(CA_KEY_PATH, key, 'utf8')
      return callback(null, {cert, key})
    })
  }
}

function handleError (err) {
  console.error('handle Misc Errors', err.stack)
}

function handleHttpConnect (req, cltSocket, head) {
  // connect to an origin server
  const srvSocket = net.connect(httpsPort, 'localhost', () => {
    cltSocket.write('HTTP/1.1 200 Connection Established\r\n' +
      'Proxy-agent: Node.js-Proxy\r\n' +
      '\r\n')
    srvSocket.write(head.toString())
    srvSocket.pipe(cltSocket)
    cltSocket.pipe(srvSocket)
  })
}

function SNICallback (serverName, callback) {
  pem.createCertificate({
    commonName: serverName,
    serviceKey: ca.key,
    serviceCertificate: ca.cert
  }, function (err, keys) {
    if (err) {
      return callback(err)
    }
    const ctx = tls.createSecureContext({
      key: keys.clientKey,
      cert: keys.certificate,
      ca: [ca.certificate]
    })
    callback(null, ctx)
  })
}

function handleRequest (req, res) {
  const isSecureSocket = req.socket.constructor.name === 'TLSSocket'
  debug(isSecureSocket ? 'https' : 'http', req.method, req.headers.host, req.url)
  dump('headers', req.headers)

  if (req.url.startsWith('http://mitm.it')) {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Content-Length': ca.cert.length,
      'Content-Disposition': `attachment; filename=ca.crt`
    })
    res.end(ca.cert, 'utf8')
    return
  }

  const request = isSecureSocket ? https.request : http.request
  const urlObject = url.parse(req.url)
  const options = {
    method: req.method,
    host: req.headers.host,
    port: urlObject.port,
    headers: req.headers,
    path: urlObject.path
  }
  req.pause()
  const proxyReq = request(options, function (proxyRes) {
    proxyRes.pause()
    res.writeHeader(proxyRes.statusCode, proxyRes.headers)
    proxyRes.pipe(debugStream('response: %s')).pipe(res)
    proxyRes.resume()
  })
  proxyReq.on('error', handleError)
  req.pipe(debugStream('request: %s')).pipe(proxyReq)
  req.resume()
}

process.on('uncaughtException', function (err) {
  console.error('uncaughtException', err.stack)
  throw err
})
