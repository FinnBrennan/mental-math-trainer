'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  SessionConfig,
  Problem,
  KeystrokeEvent,
  AttemptRecord,
  OpKey,
  DEFAULT_CONFIG,
} from '../types'
import {
  mulberry32,
  sampleOp,
  generateProblem,
  normalizeKey,
  parseConfigFromQuery,
  encodeConfigToQuery,
} from '../lib/game/engine'
import { createClient, ensureAnonymousSession } from '../lib/supabase/client'
import { TelemetryBuffer } from '../lib/telemetry/buffer'

interface Props {
  configParam: string | null
}

const DURATION_PRESETS = [60, 120, 300]

const OP_LABELS: Record<OpKey, string> = {
  add: '+',
  sub: '−',
  mul: '×',
  div: '÷',
}

const OP_NAMES: Record<OpKey, string> = {
  add: 'Addition',
  sub: 'Subtraction',
  mul: 'Multiplication',
  div: 'Division',
}

type RangeRow = { label: string; minKey: string; maxKey: string }
const OP_RANGE_ROWS: Record<OpKey, [RangeRow, RangeRow]> = {
  add: [
    { label: 'First',       minKey: 'min_a', maxKey: 'max_a' },
    { label: 'Second',      minKey: 'min_b', maxKey: 'max_b' },
  ],
  sub: [
    { label: 'Subtrahend',  minKey: 'min_x', maxKey: 'max_x' },
    { label: 'Answer',      minKey: 'min_y', maxKey: 'max_y' },
  ],
  mul: [
    { label: 'First',       minKey: 'min_a', maxKey: 'max_a' },
    { label: 'Second',      minKey: 'min_b', maxKey: 'max_b' },
  ],
  div: [
    { label: 'Divisor',     minKey: 'min_m', maxKey: 'max_m' },
    { label: 'Quotient',    minKey: 'min_n', maxKey: 'max_n' },
  ],
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export function GameApp({ configParam }: Props) {
  const initialConfig = parseConfigFromQuery(configParam)

  const [phase, setPhase] = useState<'idle' | 'playing' | 'submitting' | 'results'>('idle')
  const [config, setConfig] = useState<SessionConfig>(initialConfig)
  const [score, setScore] = useState(0)
  const [timeRemaining, setTimeRemaining] = useState(initialConfig.duration_sec)
  const [currentProblem, setCurrentProblem] = useState<Problem | null>(null)
  const [currentInput, setCurrentInput] = useState('')
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Refs — used in callbacks/intervals without stale closure issues
  const rngRef = useRef<(() => number) | null>(null)
  const bufferRef = useRef<TelemetryBuffer | null>(null)
  const gameEndTimeRef = useRef<number | null>(null)
  const problemShownAtRef = useRef<number | null>(null)
  const keystrokesRef = useRef<KeystrokeEvent[]>([])
  const seqRef = useRef(0)
  const scoreRef = useRef(0)
  const hasEndedRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  const seedRef = useRef(0)
  const configAtStartRef = useRef<SessionConfig>(DEFAULT_CONFIG)
  // Mirror currentProblem in a ref so endGame can read it without stale closure
  const currentProblemRef = useRef<Problem | null>(null)
  const phaseRef = useRef<'idle' | 'playing' | 'submitting' | 'results'>('idle')

  // Keep refs in sync with state
  useEffect(() => {
    currentProblemRef.current = currentProblem
  }, [currentProblem])
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  // Focus input after every problem change — useEffect is cross-browser safe (Safari)
  useEffect(() => {
    if (phase === 'playing') inputRef.current?.focus()
  }, [phase, currentProblem])

  // Auth on mount
  useEffect(() => {
    const client = createClient()
    supabaseRef.current = client

    ensureAnonymousSession(client)
      .then(() => client.auth.getUser())
      .then(({ data }) => {
        if (data.user) setPlayerId(data.user.id)
      })
      .catch(() => {
        setError('Auth failed — playing offline (data won\'t be saved)')
        setPlayerId('offline')
      })
  }, [])

  const endGame = useCallback(() => {
    if (hasEndedRef.current) return
    if (phaseRef.current !== 'playing') return
    hasEndedRef.current = true

    setPhase('submitting')

    const prob = currentProblemRef.current
    const shownAt = problemShownAtRef.current

    if (prob && shownAt) {
      const timeoutAttempt: AttemptRecord = {
        question_seq: seqRef.current,
        question_type: prob.op,
        operand_a: prob.operand_a,
        operand_b: prob.operand_b,
        display_prompt: prob.display_prompt,
        expected_answer: prob.expected_answer,
        user_final_input: inputRef.current?.value ?? '',
        is_correct: false,
        shown_at: shownAt,
        solved_at: null,
        time_to_solve_ms: null,
        keystroke_count: keystrokesRef.current.length,
        backspace_count: keystrokesRef.current.filter(k => k.is_backspace).length,
        had_paste: keystrokesRef.current.some(k => k.event_type === 'paste'),
        keystrokes: keystrokesRef.current,
      }
      bufferRef.current?.recordProblem(timeoutAttempt)
    }

    const finalize = bufferRef.current
      ?.submitSession(configAtStartRef.current, seedRef.current)
      .catch(err => console.error('[telemetry] submit failed:', err))

    ;(finalize ?? Promise.resolve()).finally(() => {
      setPhase('results')
    })
  }, [])

  // Timer
  useEffect(() => {
    if (phase !== 'playing') return

    const id = setInterval(() => {
      if (!gameEndTimeRef.current) return
      const ms = gameEndTimeRef.current - Date.now()
      const secs = Math.max(0, Math.ceil(ms / 1000))
      setTimeRemaining(secs)
      if (ms <= 0) endGame()
    }, 100)

    return () => clearInterval(id)
  }, [phase, endGame])

  const startGame = useCallback(async () => {
    if (!playerId) return

    setError(null)
    hasEndedRef.current = false
    seqRef.current = 0
    scoreRef.current = 0
    keystrokesRef.current = []

    const seed = Date.now()
    const rng = mulberry32(seed)
    rngRef.current = rng
    seedRef.current = seed
    configAtStartRef.current = config

    const isOffline = playerId === 'offline' || !supabaseRef.current

    if (!isOffline) {
      const buffer = new TelemetryBuffer(supabaseRef.current!)
      buffer.startSession()
      bufferRef.current = buffer
    } else {
      bufferRef.current = null
    }

    const firstOp = sampleOp(rng, config)
    const firstProblem = generateProblem(rng, firstOp, config)

    problemShownAtRef.current = Date.now()
    gameEndTimeRef.current = Date.now() + config.duration_sec * 1000

    setScore(0)
    setTimeRemaining(config.duration_sec)
    setCurrentProblem(firstProblem)
    setCurrentInput('')
    setPhase('playing')

    setTimeout(() => inputRef.current?.focus(), 0)
  }, [playerId, config])

  const advanceProblem = useCallback(
    (finalInput: string) => {
      const prob = currentProblemRef.current
      const shownAt = problemShownAtRef.current
      if (!prob || !shownAt || !rngRef.current) return

      const now = Date.now()
      const attempt: AttemptRecord = {
        question_seq: seqRef.current,
        question_type: prob.op,
        operand_a: prob.operand_a,
        operand_b: prob.operand_b,
        display_prompt: prob.display_prompt,
        expected_answer: prob.expected_answer,
        user_final_input: finalInput,
        is_correct: true,
        shown_at: shownAt,
        solved_at: now,
        time_to_solve_ms: now - shownAt,
        keystroke_count: keystrokesRef.current.length,
        backspace_count: keystrokesRef.current.filter(k => k.is_backspace).length,
        had_paste: keystrokesRef.current.some(k => k.event_type === 'paste'),
        keystrokes: keystrokesRef.current,
      }

      bufferRef.current?.recordProblem(attempt)

      const newScore = scoreRef.current + 1
      scoreRef.current = newScore
      seqRef.current += 1

      const nextOp = sampleOp(rngRef.current, config)
      const nextProblem = generateProblem(rngRef.current, nextOp, config)

      keystrokesRef.current = []
      problemShownAtRef.current = Date.now()

      setScore(newScore)
      setCurrentProblem(nextProblem)
      setCurrentInput('')

      setTimeout(() => inputRef.current?.focus(), 0)
    },
    [config]
  )

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (phaseRef.current !== 'playing') return
    if (!problemShownAtRef.current) return

    const now = Date.now()
    const prevKs = keystrokesRef.current
    const ks: KeystrokeEvent = {
      keystroke_seq: prevKs.length,
      event_type: 'keydown',
      raw_key: e.key,
      normalized_key: normalizeKey(e.key),
      is_backspace: e.key === 'Backspace',
      client_timestamp_ms: now,
      delta_from_prev_ms:
        prevKs.length > 0 ? now - prevKs[prevKs.length - 1].client_timestamp_ms : 0,
      delta_from_question_start_ms: now - problemShownAtRef.current,
    }
    keystrokesRef.current = [...prevKs, ks]
  }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (phaseRef.current !== 'playing' || !currentProblemRef.current) return

      const val = e.target.value.replace(/[^0-9]/g, '')
      setCurrentInput(val)

      if (val !== '' && parseInt(val, 10) === currentProblemRef.current.expected_answer) {
        advanceProblem(val)
      }
    },
    [advanceProblem]
  )

  const handlePaste = useCallback(() => {
    if (!problemShownAtRef.current) return
    const now = Date.now()
    const prevKs = keystrokesRef.current
    const ks: KeystrokeEvent = {
      keystroke_seq: prevKs.length,
      event_type: 'paste',
      raw_key: 'paste',
      normalized_key: 'paste',
      is_backspace: false,
      client_timestamp_ms: now,
      delta_from_prev_ms:
        prevKs.length > 0 ? now - prevKs[prevKs.length - 1].client_timestamp_ms : 0,
      delta_from_question_start_ms: now - problemShownAtRef.current,
    }
    keystrokesRef.current = [...prevKs, ks]
  }, [])

  const handleBlur = useCallback(() => {
    if (phaseRef.current !== 'playing' || !problemShownAtRef.current) return
    const now = Date.now()
    const prevKs = keystrokesRef.current
    const ks: KeystrokeEvent = {
      keystroke_seq: prevKs.length,
      event_type: 'blur',
      raw_key: 'blur',
      normalized_key: 'other',
      is_backspace: false,
      client_timestamp_ms: now,
      delta_from_prev_ms:
        prevKs.length > 0 ? now - prevKs[prevKs.length - 1].client_timestamp_ms : 0,
      delta_from_question_start_ms: now - problemShownAtRef.current,
    }
    keystrokesRef.current = [...prevKs, ks]
  }, [])

  const toggleOp = useCallback((op: OpKey) => {
    setConfig(prev => {
      const enabled = prev.enabled_ops
      const activeCount = Object.values(enabled).filter(Boolean).length
      if (enabled[op] && activeCount === 1) return prev
      return {
        ...prev,
        mode: 'targeted_drill',
        enabled_ops: { ...enabled, [op]: !enabled[op] },
      }
    })
  }, [])

  const setDuration = useCallback((sec: number) => {
    setConfig(prev => ({ ...prev, duration_sec: sec }))
    setTimeRemaining(sec)
  }, [])

  const switchRangeMode = useCallback((mode: 'default' | 'custom') => {
    setConfig(prev => ({
      ...prev,
      mode: mode === 'default' ? 'standard' : 'targeted_drill',
      enabled_ops: mode === 'default' ? DEFAULT_CONFIG.enabled_ops : prev.enabled_ops,
      ranges: mode === 'default' ? DEFAULT_CONFIG.ranges : prev.ranges,
    }))
  }, [])

  const updateRange = useCallback((op: 'add' | 'mul', field: string, raw: string) => {
    const val = parseInt(raw, 10)
    if (isNaN(val) || val < 1) return
    setConfig(prev => {
      const existing = prev.ranges[op] ?? DEFAULT_CONFIG.ranges[op]!
      const updated = { ...existing, [field]: val }
      const newRanges = { ...prev.ranges, [op]: updated }

      // sub mirrors add; div mirrors mul
      if (op === 'add') {
        const r = updated as typeof DEFAULT_CONFIG.ranges.add & Record<string, number>
        newRanges.sub = { min_x: r.min_a, max_x: r.max_a, min_y: r.min_b, max_y: r.max_b }
      }
      if (op === 'mul') {
        const r = updated as typeof DEFAULT_CONFIG.ranges.mul & Record<string, number>
        newRanges.div = { min_m: r.min_a, max_m: r.max_a, min_n: r.min_b, max_n: r.max_b }
      }

      return { ...prev, ranges: newRanges }
    })
  }, [])

  const copyDrillLink = useCallback(() => {
    const url = `${window.location.origin}/?config=${encodeConfigToQuery(config)}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [config])

  const resetToIdle = useCallback(() => {
    setPhase('idle')
    setCurrentProblem(null)
    setCurrentInput('')
    setScore(0)
    setTimeRemaining(config.duration_sec)
  }, [config.duration_sec])

  // ─── IDLE / SETTINGS ─────────────────────────────────────────────────────

  if (phase === 'idle') {
    const activeOps = Object.entries(config.enabled_ops).filter(([, v]) => v)
    const isCustomDuration = !DURATION_PRESETS.includes(config.duration_sec)
    const rangeMode = config.mode === 'standard' ? 'default' : 'custom'
    const addR = config.ranges.add ?? DEFAULT_CONFIG.ranges.add!
    const mulR = config.ranges.mul ?? DEFAULT_CONFIG.ranges.mul!
    // type="text" inputMode="numeric" avoids Safari number-input bugs
    const inp = 'w-10 bg-zinc-900 border border-zinc-700 rounded py-1 font-mono text-sm text-zinc-100 text-center focus:outline-none focus:border-zinc-400'

    return (
      <div className="fixed inset-0 bg-black overflow-y-auto">
        <div className="flex min-h-full items-center justify-center px-8 py-16">
        <div className="w-full max-w-sm space-y-8">

          <h1 className="text-2xl font-mono font-bold text-zinc-100">Mental Math Trainer</h1>

          {error && <p className="text-sm text-yellow-400 font-mono">{error}</p>}

          {/* Duration */}
          <div className="space-y-2">
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-mono">Duration</p>
            <div className="flex gap-2">
              {DURATION_PRESETS.map(sec => (
                <button key={sec} onClick={() => setDuration(sec)}
                  className={`px-4 py-2 rounded font-mono text-sm transition-colors ${config.duration_sec === sec ? 'bg-zinc-100 text-black' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100'}`}>
                  {sec === 60 ? '60s' : sec === 120 ? '120s' : '300s'}
                </button>
              ))}
              {isCustomDuration && (
                <span className="px-4 py-2 rounded font-mono text-sm bg-zinc-100 text-black">{config.duration_sec}s</span>
              )}
            </div>
          </div>

          {/* Operations */}
          <div className="space-y-2">
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-mono">Operations</p>
            <div className="flex gap-2">
              {(Object.keys(OP_LABELS) as OpKey[]).map(op => {
                const isActive = config.enabled_ops[op]
                const isOnly = isActive && activeOps.length === 1
                return (
                  <button key={op} onClick={() => toggleOp(op)} disabled={isOnly}
                    className={`w-12 h-12 rounded font-mono text-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isActive ? 'bg-zinc-100 text-black' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100'}`}>
                    {OP_LABELS[op]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Ranges */}
          <div className="space-y-3">
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-mono">Ranges</p>
            <div className="flex gap-2">
              <button onClick={() => switchRangeMode('default')}
                className={`px-4 py-2 rounded font-mono text-sm transition-colors ${rangeMode === 'default' ? 'bg-zinc-100 text-black' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100'}`}>
                Default
              </button>
              <button onClick={() => switchRangeMode('custom')}
                className={`px-4 py-2 rounded font-mono text-sm transition-colors ${rangeMode === 'custom' ? 'bg-zinc-100 text-black' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100'}`}>
                Custom
              </button>
            </div>

            {rangeMode === 'default' && (
              <p className="text-xs text-zinc-600 font-mono">Standard Zetamac — scores count towards rankings.</p>
            )}

            {rangeMode === 'custom' && (
              <div className="space-y-4 pt-1">
                <p className="text-xs text-zinc-600 font-mono">Custom ranges — scores are not ranked.</p>

                <div className="space-y-1">
                  <p className="text-sm font-mono text-zinc-400">Addition</p>
                  <div className="flex items-center gap-1.5 font-mono text-sm text-zinc-600">
                    <input type="text" inputMode="numeric" pattern="[0-9]*" defaultValue={addR.min_a} onBlur={e => updateRange('add', 'min_a', e.target.value)} className={inp} />
                    <span>to</span>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" defaultValue={addR.max_a} onBlur={e => updateRange('add', 'max_a', e.target.value)} className={inp} />
                    <span>+</span>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" defaultValue={addR.min_b} onBlur={e => updateRange('add', 'min_b', e.target.value)} className={inp} />
                    <span>to</span>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" defaultValue={addR.max_b} onBlur={e => updateRange('add', 'max_b', e.target.value)} className={inp} />
                  </div>
                </div>

                <div>
                  <p className="text-sm font-mono text-zinc-400">Subtraction</p>
                  <p className="text-sm font-mono text-zinc-600">Addition problems in reverse.</p>
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-mono text-zinc-400">Multiplication</p>
                  <div className="flex items-center gap-1.5 font-mono text-sm text-zinc-600">
                    <input type="text" inputMode="numeric" pattern="[0-9]*" defaultValue={mulR.min_a} onBlur={e => updateRange('mul', 'min_a', e.target.value)} className={inp} />
                    <span>to</span>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" defaultValue={mulR.max_a} onBlur={e => updateRange('mul', 'max_a', e.target.value)} className={inp} />
                    <span>×</span>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" defaultValue={mulR.min_b} onBlur={e => updateRange('mul', 'min_b', e.target.value)} className={inp} />
                    <span>to</span>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" defaultValue={mulR.max_b} onBlur={e => updateRange('mul', 'max_b', e.target.value)} className={inp} />
                  </div>
                </div>

                <div>
                  <p className="text-sm font-mono text-zinc-400">Division</p>
                  <p className="text-sm font-mono text-zinc-600">Multiplication problems in reverse.</p>
                </div>
              </div>
            )}
          </div>

          {/* Start */}
          <div className="space-y-3">
            <button onClick={startGame} disabled={!playerId}
              className="w-full py-3 rounded font-mono font-bold text-lg transition-colors bg-zinc-100 hover:bg-white text-black disabled:opacity-40 disabled:cursor-not-allowed">
              {playerId ? 'Start' : 'Connecting…'}
            </button>
            <button onClick={copyDrillLink}
              className="w-full py-2 rounded font-mono text-sm transition-colors bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-zinc-800">
              {copied ? 'Copied!' : 'Copy drill link'}
            </button>
          </div>

        </div>
        </div>
      </div>
    )
  }

  // ─── PLAYING / SUBMITTING ────────────────────────────────────────────────

  if (phase === 'playing' || phase === 'submitting') {
    const isSubmitting = phase === 'submitting'
    const timerRed = timeRemaining <= 10

    return (
      <div className="min-h-screen bg-black flex flex-col">
        {/* Header bar */}
        <div className="flex items-center justify-between px-8 py-5">
          <span className="font-mono text-zinc-500 text-sm">
            Score: <span className="text-zinc-100 font-bold">{score}</span>
          </span>
          <span
            className={`font-mono text-2xl font-bold tabular-nums transition-colors ${
              timerRed ? 'text-red-400' : 'text-zinc-100'
            }`}
          >
            {formatTime(timeRemaining)}
          </span>
        </div>

        {/* Game area */}
        <div className="flex-1 flex flex-col items-center justify-center gap-10">
          {currentProblem && (
            <p className="font-mono font-bold text-zinc-100 text-6xl sm:text-7xl tracking-tight select-none">
              {currentProblem.display_prompt}
            </p>
          )}

          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            value={currentInput}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onBlur={handleBlur}
            disabled={isSubmitting}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="text-4xl font-mono text-center bg-transparent border-b-2 border-zinc-600 focus:border-zinc-100 outline-none w-48 text-zinc-100 pb-1 disabled:opacity-50 transition-colors"
          />

          {isSubmitting && (
            <p className="font-mono text-zinc-500 text-sm">Saving…</p>
          )}
        </div>
      </div>
    )
  }

  // ─── RESULTS ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="text-center space-y-8">
        <div className="space-y-2">
          <p className="font-mono text-zinc-500 text-sm uppercase tracking-widest">Score</p>
          <p className="font-mono font-bold text-zinc-100 text-8xl tabular-nums">{score}</p>
        </div>

        <div className="flex flex-col gap-3 items-center">
          <button
            onClick={startGame}
            className="px-10 py-3 rounded font-mono font-bold text-lg bg-zinc-100 hover:bg-white text-black transition-colors"
          >
            Play again
          </button>
          <button
            onClick={resetToIdle}
            className="px-10 py-2 rounded font-mono text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-100 transition-colors"
          >
            Change settings
          </button>
        </div>
      </div>
    </div>
  )
}
