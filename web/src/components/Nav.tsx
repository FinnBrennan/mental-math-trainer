'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '../lib/supabase/client'

export default function Nav() {
  const router = useRouter()
  const pathname = usePathname()
  const [username, setUsername] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    const supabase = createClient()

    async function loadUser() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session || session.user.is_anonymous) { setUsername(null); return }
      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', session.user.id)
        .single()
      setUsername(profile?.username ?? null)
    }

    loadUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session || session.user.is_anonymous) { setUsername(null); return }
      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', session.user.id)
        .single()
      setUsername(profile?.username ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <header className="flex items-center justify-between px-6 py-4">
      {pathname === '/' ? (
        <span className="font-mono font-bold text-lg text-white">Mental Math Trainer</span>
      ) : (
        <Link href="/" className="font-mono font-bold text-lg text-white hover:text-zinc-300 transition-colors">
          Mental Math Trainer
        </Link>
      )}
      <div className="flex items-center gap-4">
        {username ? (
          <>
            <Link
              href="/profile"
              className="font-mono text-sm text-zinc-300 hover:text-white transition-colors"
            >
              Profile
            </Link>
            <button
              onClick={handleSignOut}
              className="font-mono text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Sign out
            </button>
          </>
        ) : username === null ? (
          <Link
            href="/auth"
            className="px-4 py-2 rounded font-mono text-sm bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 transition-colors"
          >
            Login / Register
          </Link>
        ) : null}
      </div>
    </header>
  )
}
