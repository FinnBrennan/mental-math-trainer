'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '../../lib/supabase/client'

type State = 'idle' | 'loading' | 'sent' | 'error'

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<State>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.is_anonymous) {
        localStorage.setItem('pre_auth_anon_id', session.user.id)
      }
    })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setState('loading')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + '/auth/callback' },
    })
    if (error) {
      setErrorMsg(error.message)
      setState('error')
    } else {
      setState('sent')
    }
  }

  return (
    <div className="min-h-screen bg-black text-white font-mono flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        {state === 'sent' ? (
          <>
            <p className="text-sm text-zinc-300">
              Check your inbox — we sent a magic link to <span className="text-white">{email}</span>.
            </p>
            <Link href="/" className="text-zinc-600 hover:text-zinc-400 text-sm font-mono block">
              ← Back
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold font-mono">Sign in</h1>
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded font-mono text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-400"
              />
              {state === 'error' && (
                <p className="text-red-400 text-xs font-mono">{errorMsg}</p>
              )}
              <button
                type="submit"
                disabled={state === 'loading'}
                className="w-full py-2 rounded font-mono font-bold text-sm bg-zinc-100 hover:bg-white text-black transition-colors disabled:opacity-40"
              >
                {state === 'loading' ? 'Sending…' : 'Send magic link'}
              </button>
            </form>
            <Link href="/" className="text-zinc-600 hover:text-zinc-400 text-sm font-mono block">
              ← Back
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
