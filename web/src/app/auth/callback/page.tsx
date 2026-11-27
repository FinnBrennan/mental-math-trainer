'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase/client'

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')

    if (!code) {
      router.replace('/auth')
      return
    }

    const supabase = createClient()
    supabase.auth.exchangeCodeForSession(code).then(async ({ error }) => {
      if (error) {
        router.replace('/auth?error=1')
        return
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/auth?error=1')
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .single()

      router.replace(profile?.username ? '/play' : '/register')
    })
  }, [])

  return (
    <div className="min-h-screen bg-black text-white font-mono flex items-center justify-center">
      <p className="text-zinc-400 text-sm">Signing in…</p>
    </div>
  )
}
