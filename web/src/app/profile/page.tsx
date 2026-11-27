'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '../../components/Nav'
import { createClient } from '../../lib/supabase/client'

type Profile = {
  id: string
  username: string
  avatar_url: string | null
  is_public: boolean
}

type TopSession = {
  id: string
  score: number
  started_at: string
}

type DayScore = {
  day: string
  best: number
}

function ScoreChart({ data }: { data: DayScore[] }) {
  const W = 400
  const H = 120
  const padL = 44
  const padR = 16
  const padT = 16
  const padB = 32
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const maxScore = Math.max(...data.map(d => d.best), 10)

  const xs = data.map((_, i) =>
    padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW)
  )
  const ys = data.map(d =>
    padT + plotH - (d.best / maxScore) * plotH
  )

  const pathD = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')

  const yTicks = [0, Math.round(maxScore / 2), maxScore]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxWidth: W }}>
      {yTicks.map((v, i) => {
        const y = padT + plotH - (v / maxScore) * plotH
        return (
          <g key={i}>
            <line
              x1={padL} y1={y} x2={W - padR} y2={y}
              stroke="#27272a" strokeWidth="1"
            />
            <text
              x={padL - 6} y={y + 4}
              fill="#52525b" fontSize="10" textAnchor="end" fontFamily="monospace"
            >
              {v}
            </text>
          </g>
        )
      })}
      <path d={pathD} fill="none" stroke="#a1a1aa" strokeWidth="1.5" strokeLinejoin="round" />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r="3" fill="#ffffff" />
      ))}
      <text
        x={xs[0]} y={H - 4}
        fill="#52525b" fontSize="10" textAnchor="middle" fontFamily="monospace"
      >
        {data[0].day.slice(5)}
      </text>
      {data.length > 1 && (
        <text
          x={xs[xs.length - 1]} y={H - 4}
          fill="#52525b" fontSize="10" textAnchor="middle" fontFamily="monospace"
        >
          {data[data.length - 1].day.slice(5)}
        </text>
      )}
    </svg>
  )
}

export default function ProfilePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [topScores, setTopScores] = useState<TopSession[]>([])
  const [chartData, setChartData] = useState<DayScore[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    const supabase = createClient()

    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session || session.user.is_anonymous) { router.replace('/auth'); return }

      const userId = session.user.id

      const [{ data: profileData }, { data: sessionsData }] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, username, avatar_url, is_public')
          .eq('id', userId)
          .single(),
        supabase
          .from('sessions')
          .select('id, score, started_at')
          .eq('user_id', userId)
          .eq('mode', 'ranked')
          .order('score', { ascending: false })
          .limit(200),
      ])

      if (!profileData?.username) { router.replace('/register'); return }

      setProfile(profileData)
      setTopScores((sessionsData ?? []).slice(0, 5))

      const dayMap = new Map<string, number>()
      for (const s of sessionsData ?? []) {
        const day = s.started_at.slice(0, 10)
        dayMap.set(day, Math.max(dayMap.get(day) ?? 0, s.score))
      }
      const sorted = [...dayMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, best]) => ({ day, best }))
      setChartData(sorted)

      setLoading(false)
    }

    load()
  }, [])

  async function togglePublic() {
    if (!profile || toggling) return
    setToggling(true)
    const supabase = createClient()
    const next = !profile.is_public
    const { error } = await supabase
      .from('profiles')
      .update({ is_public: next })
      .eq('id', profile.id)
    if (!error) setProfile({ ...profile, is_public: next })
    setToggling(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white font-mono">
        <Nav />
        <div className="flex items-center justify-center h-64">
          <p className="text-zinc-500 text-sm">Loading…</p>
        </div>
      </div>
    )
  }

  if (!profile) return null

  return (
    <div className="min-h-screen bg-black text-white font-mono">
      <Nav />
      <main className="max-w-lg mx-auto px-6 py-8 space-y-8">

        <div className="flex items-center gap-4">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt={profile.username}
              className="w-16 h-16 rounded-full object-cover border border-zinc-700"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center text-zinc-600 text-xs">
              photo
            </div>
          )}
          <p className="text-xl font-bold">{profile.username}</p>
        </div>

        <div>
          <h2 className="text-xs text-zinc-500 uppercase tracking-widest mb-3">Top scores</h2>
          {topScores.length === 0 ? (
            <p className="text-zinc-600 text-sm">
              No ranked games yet.{' '}
              <button
                onClick={() => router.push('/play')}
                className="text-zinc-400 underline"
              >
                Play now
              </button>
            </p>
          ) : (
            <div className="space-y-2">
              {topScores.map((s, i) => (
                <div key={s.id} className="flex items-center text-sm">
                  <span className="text-zinc-600 w-6">#{i + 1}</span>
                  <span className="flex-1 text-white font-bold">{s.score}</span>
                  <span className="text-zinc-500 text-xs">{s.started_at.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {chartData.length > 0 && (
          <div>
            <h2 className="text-xs text-zinc-500 uppercase tracking-widest mb-3">Best score per day</h2>
            <ScoreChart data={chartData} />
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
          <div>
            <p className="text-sm text-white">Show on leaderboard</p>
            <p className="text-xs text-zinc-500 mt-0.5">Makes your profile public</p>
          </div>
          <button
            onClick={togglePublic}
            disabled={toggling}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${
              profile.is_public ? 'bg-zinc-200' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-black transition-transform ${
                profile.is_public ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

      </main>
    </div>
  )
}
