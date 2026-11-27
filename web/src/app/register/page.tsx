'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabase/client'

type State = 'idle' | 'loading' | 'error'

export default function RegisterPage() {
  const router = useRouter()
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [state, setState] = useState<State>('idle')
  const [username, setUsername] = useState('')
  const [usernameError, setUsernameError] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/auth')
        return
      }
      supabase
        .from('profiles')
        .select('username')
        .eq('id', session.user.id)
        .single()
        .then(({ data }) => {
          if (data?.username) router.replace('/play')
        })
    })
  }, [])

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    if (f) setPreview(URL.createObjectURL(f))
    else setPreview(null)
  }

  function validateUsername(val: string): string {
    if (!/^[a-z0-9_]{3,20}$/.test(val)) {
      return '3–20 chars: lowercase letters, digits, underscores'
    }
    return ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError('')
    const err = validateUsername(username)
    if (err) { setUsernameError(err); return }

    setState('loading')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setState('error'); setSubmitError('Not authenticated.'); return }

    let avatarUrl: string | undefined
    if (file) {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `${user.id}/avatar.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true })
      if (!uploadErr) {
        avatarUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
      }
    }

    try {
      const anonId = localStorage.getItem('pre_auth_anon_id')
      if (anonId) {
        const { error: migrateErr } = await supabase.rpc('migrate_anon_user', { p_anon_user_id: anonId })
        void migrateErr
        localStorage.removeItem('pre_auth_anon_id')
      }
    } catch {}

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ username, ...(avatarUrl ? { avatar_url: avatarUrl } : {}) })
      .eq('id', user.id)

    if (updateErr) {
      setState('error')
      setSubmitError(
        updateErr.code === '23505' ? 'Username already taken.' : updateErr.message
      )
      return
    }

    router.push('/play')
  }

  return (
    <div className="min-h-screen bg-black text-white font-mono flex flex-col items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-6">
        <h1 className="text-xl font-bold">Create account</h1>

        <div className="flex flex-col items-center gap-3">
          {preview ? (
            <img src={preview} alt="Avatar preview" className="w-20 h-20 rounded-full object-cover border border-zinc-700" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center text-zinc-600 text-xs">
              photo
            </div>
          )}
          <label className="cursor-pointer text-sm text-zinc-400 hover:text-white transition-colors">
            Choose photo
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFile}
            />
          </label>
        </div>

        <div className="space-y-1">
          <input
            type="text"
            placeholder="username"
            value={username}
            onChange={e => {
              setUsername(e.target.value)
              setUsernameError(validateUsername(e.target.value))
            }}
            className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded font-mono text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-400"
          />
          {usernameError && <p className="text-red-400 text-xs font-mono">{usernameError}</p>}
        </div>

        {submitError && <p className="text-red-400 text-xs font-mono">{submitError}</p>}

        <button
          type="submit"
          disabled={state === 'loading'}
          className="w-full py-2 rounded font-mono font-bold text-sm bg-zinc-100 hover:bg-white text-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {state === 'loading' ? 'Setting up…' : 'Continue'}
        </button>
      </form>
    </div>
  )
}
