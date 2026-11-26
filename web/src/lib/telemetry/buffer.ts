import type { SessionConfig, AttemptRecord } from '../../types'
import type { createClient } from '../supabase/client'

type SupabaseClient = ReturnType<typeof createClient>

interface ProblemPayload {
  seq: number
  op: string
  a: number
  b: number
  answer: number
  shown_ms: number
  solved_ms: number | null
  keystrokes: unknown[]
}

export class TelemetryBuffer {
  private problems: ProblemPayload[] = []
  private startTimeMs = 0

  constructor(private readonly supabase: SupabaseClient) {}

  startSession(startTimeMs = Date.now()): void {
    this.startTimeMs = startTimeMs
    this.problems = []
  }

  recordProblem(attempt: AttemptRecord): void {
    const shownMs = Math.max(0, attempt.shown_at - this.startTimeMs)
    const solvedMs =
      attempt.solved_at != null
        ? Math.max(0, attempt.solved_at - this.startTimeMs)
        : null
    this.problems.push({
      seq: attempt.question_seq,
      op: attempt.question_type,
      a: attempt.operand_a,
      b: attempt.operand_b,
      answer: attempt.expected_answer,
      shown_ms: shownMs,
      solved_ms: solvedMs,
      keystrokes: attempt.keystrokes,
    })
  }

  async submitSession(config: SessionConfig, seed: number): Promise<string> {
    const isRanked = config.mode === 'standard' && config.duration_sec === 120
    const payload = {
      mode: isRanked ? 'ranked' : 'practice',
      ruleset: isRanked ? 'default_v1' : null,
      settings: config as unknown as Record<string, unknown>,
      seed,
      duration_s: config.duration_sec,
      app_version: '0.1.0',
      client_meta: {},
      problems: this.problems,
    }
    const { data, error } = await this.supabase.rpc('submit_session', { payload })
    if (error) throw error
    return data as string
  }
}
