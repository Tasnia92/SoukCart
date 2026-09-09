const API = '/api'
const TOKEN_KEY = 'nekcart_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string, persist = true) {
  localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
  ;(persist ? localStorage : sessionStorage).setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
}

function headers(): HeadersInit {
  const token = getToken()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { message?: string }).message || 'Request failed')
  return data as T
}

export const api = {
  get: <T,>(path: string) => req<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    req<T>(path, { method: 'POST', body: JSON.stringify(body || {}) }),
  patch: <T,>(path: string, body?: unknown) =>
    req<T>(path, { method: 'PATCH', body: JSON.stringify(body || {}) }),
  delete: <T,>(path: string) => req<T>(path, { method: 'DELETE' }),
  async upload(file: File) {
    const token = getToken()
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${API}/uploads`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((data as { message?: string }).message || 'Upload failed')
    return data as { url: string; filename: string }
  },
}
