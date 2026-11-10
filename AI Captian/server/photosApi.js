import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const MAX_BYTES = 12_000_000 // a full-size JPEG as a data URL, with room to spare

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BYTES) {
        reject(Object.assign(new Error('Photo too large'), { status: 413 }))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

// POST /api/photos { image: 'data:image/jpeg;base64,…', name? }
// Saves the photo into `folder` (data/photos by default) and returns where it went.
export function photoRoutes(folder) {
  const dir = resolve(folder)
  const send = (res, status, body) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }

  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/photos')) return next()
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })
    try {
      const { image, name } = await readJson(req)
      const m = typeof image === 'string' && image.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/)
      if (!m) return send(res, 400, { error: 'Expected a JPEG or PNG data URL' })
      // only a plain file name, never a path
      const base = String(name || '').replace(/[^\w.-]/g, '').replace(/^\.+/, '').slice(0, 80) || `greeny-${Date.now()}`
      let file = `${base.replace(/\.(jpe?g|png)$/i, '')}.${m[1] === 'png' ? 'png' : 'jpg'}`
      const bytes = Buffer.from(m[2], 'base64')
      await mkdir(dir, { recursive: true })
      // never overwrite an earlier photo
      await writeFile(join(dir, file), bytes, { flag: 'wx' }).catch(async (e) => {
        if (e.code !== 'EEXIST') throw e
        file = `${Date.now()}-${file}`
        await writeFile(join(dir, file), bytes, { flag: 'wx' })
      })
      return send(res, 201, { file, folder: dir, path: join(dir, file) })
    } catch (e) {
      console.error('[photos]', e)
      return send(res, e.status || 500, { error: e.status ? e.message : 'Could not save the photo' })
    }
  }
}
