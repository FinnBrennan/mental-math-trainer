'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase/client'

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/auth'); return }
      const { data: profile } = await supabase
        .from('profiles').select('username').eq('id', session.user.id).single()
      router.replace(profile?.username ? '/play' : '/register')
    })
  }, [])

  return (
    <div className="min-h-screen bg-black text-white font-mono flex items-center justify-center">
      <p className="text-zinc-400 text-sm">Signing in…</p>
    </div>
  )
}
