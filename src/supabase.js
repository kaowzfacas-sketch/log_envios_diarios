import { createClient } from '@supabase/supabase-js'

const url = typeof import.meta.env.VITE_SUPABASE_URL === 'string' ? import.meta.env.VITE_SUPABASE_URL.trim() : ''
const anonKey = typeof import.meta.env.VITE_SUPABASE_ANON_KEY === 'string' ? import.meta.env.VITE_SUPABASE_ANON_KEY.trim() : ''

function isHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false

  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export const isSupabaseConfigured = isHttpUrl(url) && Boolean(anonKey)
export const supabase = isSupabaseConfigured ? createClient(url, anonKey) : null
