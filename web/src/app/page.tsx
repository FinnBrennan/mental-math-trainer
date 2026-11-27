'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '../components/Nav'
import { createClient } from '../lib/supabase/client'

type LeaderboardRow = {
  rank: number
  username: string
  avatar_url: string | null
  best_score: number
  games_played: number
}

export default function Page() {
  const router = useRouter()
  const [allTime, setAllTime] = useState<LeaderboardRow[]>([])
  const [daily, setDaily] = useState<LeaderboardRow[]>([])

  useEffect(() => {
    // Handle implicit flow magic link token in hash
    const hash = window.location.hash
    if (hash.includes('access_token')) {
      const supabase = createClient()
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          subscription.unsubscribe()
          const { data: profile } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', session.user.id)
            .single()
          router.replace(profile?.username ? '/play' : '/register')
        }
      })
      return () => subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.rpc('get_leaderboard', { p_period: 'alltime', p_limit: 10 }),
      supabase.rpc('get_leaderboard', { p_period: 'daily', p_limit: 10 }),
    ]).then(([{ data: at }, { data: d }]) => {
      setAllTime((at as LeaderboardRow[]) ?? [])
      setDaily((d as LeaderboardRow[]) ?? [])
    })
  }, [])

  return (
    <div className="min-h-screen bg-black text-white font-mono flex flex-col">
      <Nav />
      <main className="flex-1 flex flex-col items-center px-6 py-8 gap-12">

        <button
          onClick={() => router.push('/play')}
          className="px-8 py-4 rounded font-mono font-bold text-xl bg-zinc-100 hover:bg-white text-black transition-colors"
        >
          Play as guest
        </button>

        <div className="w-full max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-8">
          <LeaderboardTable title="All-time" rows={allTime} />
          <LeaderboardTable title="Today" rows={daily} />
        </div>

      </main>
    </div>
  )
}

function LeaderboardTable({ title, rows }: { title: string; rows: LeaderboardRow[] }) {
  return (
    <div>
      <h2 className="text-xs text-zinc-500 uppercase tracking-widest mb-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-zinc-700 text-sm">No entries yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map(row => (
            <div key={row.username} className="flex items-center text-sm gap-3">
              <span className="text-zinc-600 w-5 shrink-0">#{row.rank}</span>
              {row.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.avatar_url}
                  alt={row.username}
                  className="w-6 h-6 rounded-full object-cover border border-zinc-800 shrink-0"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-zinc-900 border border-zinc-800 shrink-0" />
              )}
              <span className="flex-1 text-zinc-300 truncate">{row.username}</span>
              <span className="text-white font-bold shrink-0">{row.best_score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
