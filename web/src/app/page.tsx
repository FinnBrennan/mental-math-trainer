'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../lib/supabase/client'

export default function Page() {
  const router = useRouter()

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code')
    if (code) router.replace(`/auth/callback?code=${code}`)
  }, [])

  async function handleLoginRegister() {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user?.is_anonymous) {
      localStorage.setItem('pre_auth_anon_id', session.user.id)
    }
    router.push('/auth')
  }

  return (
    <div className="min-h-screen bg-black text-white font-mono flex flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <span className="font-mono font-bold text-lg">Mental Math Trainer</span>
        <button
          onClick={handleLoginRegister}
          className="px-4 py-2 rounded font-mono text-sm bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 transition-colors"
        >
          Login / Register
        </button>
      </header>
      <main className="flex-1 flex items-center justify-center">
        <button
          onClick={() => router.push('/play')}
          className="px-8 py-4 rounded font-mono font-bold text-xl bg-zinc-100 hover:bg-white text-black transition-colors"
        >
          Play as guest
        </button>
      </main>
    </div>
  )
}
