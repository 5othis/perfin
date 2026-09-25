import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { holdings } from './holdings.js'
import { PortfolioService } from './lib/portfolio.js'
import { loadTransactions } from './lib/transactions.js'

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/chart.js', ['chart.js', 'text/javascript; charset=utf-8']],
])

export function createApp({
  service = new PortfolioService({ holdings, apiKey: process.env.EODHD_API_KEY }),
  transactionLoader = () => loadTransactions(holdings),
} = {}) {
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
    try {
      const url = new URL(req.url, 'http://localhost')
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET' }).end('Method not allowed')
        return
      }
      if (url.pathname === '/api/portfolio') {
        const data = await service.getPortfolio({ refresh: url.searchParams.get('refresh') === '1' })
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data))
        return
      }
      if (url.pathname === '/api/transactions') {
        const data = await transactionLoader()
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data))
        return
      }
      const asset = assets.get(url.pathname)
      if (!asset) {
        res.writeHead(404).end('Not found')
        return
      }
      const body = await readFile(new URL(`./public/${asset[0]}`, import.meta.url))
      res.writeHead(200, { 'Content-Type': asset[1] }).end(body)
    } catch {
      // Do not log upstream errors or URLs: they may contain the API token.
      console.error('Portfolio request failed. No upstream error details were logged.')
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        .end(JSON.stringify({ error: 'The local server could not complete this request. Please try again.' }))
    }
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be an integer between 1 and 65535.')
    process.exitCode = 1
  } else {
    // Bind to every interface on Render (or when HOST is set explicitly); stay on
    // localhost only for local runs, so the dashboard isn't exposed on your network.
    const host = process.env.HOST ?? (process.env.RENDER ? '0.0.0.0' : '127.0.0.1')
    const server = createApp()
    server.on('error', () => {
      console.error('Could not start the local server. Check whether PORT is already in use.')
      process.exitCode = 1
    })
    server.listen(port, host, () => {
      console.log(`Portfolio dashboard listening on ${host}:${port}`)
      if (!process.env.EODHD_API_KEY?.trim()) console.log('EODHD_API_KEY is not configured; prices will be unavailable.')
    })
  }
}
