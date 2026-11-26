import { TelemetryBuffer } from '../lib/telemetry/buffer'
import type { AttemptRecord } from '../types'
import { DEFAULT_CONFIG } from '../types'

function makeMockSupabase(resolveValue = { data: 'mock-session-uuid', error: null }) {
  const rpc = vi.fn(() => Promise.resolve(resolveValue))
  return { rpc }
}

function makeAttempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    question_seq: 0,
    question_type: 'add',
    operand_a: 47,
    operand_b: 36,
    display_prompt: '47 + 36',
    expected_answer: 83,
    user_final_input: '83',
    is_correct: true,
    shown_at: 1000,
    solved_at: 4500,
    time_to_solve_ms: 3500,
    keystroke_count: 2,
    backspace_count: 0,
    had_paste: false,
    keystrokes: [
      {
        keystroke_seq: 0,
        event_type: 'keydown',
        raw_key: '8',
        normalized_key: 'digit',
        is_backspace: false,
        client_timestamp_ms: 2000,
        delta_from_prev_ms: 0,
        delta_from_question_start_ms: 1000,
      },
    ],
    ...overrides,
  }
}

describe('TelemetryBuffer.startSession', () => {
  it('resets the internal problems list on each call', async () => {
    const mock = makeMockSupabase()
    const buffer = new TelemetryBuffer(mock as never)
    buffer.startSession(0)
    buffer.recordProblem(makeAttempt({ shown_at: 100, solved_at: 2000 }))
    buffer.startSession(0)
    // After reset, submitSession should send an empty problems array
    await buffer.submitSession(DEFAULT_CONFIG, 1)
    const payload = (mock.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1].payload
    expect(payload.problems).toHaveLength(0)
  })
})

describe('TelemetryBuffer.recordProblem', () => {
  let buffer: TelemetryBuffer
  const START = 1000000

  beforeEach(() => {
    buffer = new TelemetryBuffer(makeMockSupabase() as never)
    buffer.startSession(START)
  })

  it('converts shown_at to ms-from-start', async () => {
    const mock = makeMockSupabase()
    buffer = new TelemetryBuffer(mock as never)
    buffer.startSession(START)
    buffer.recordProblem(makeAttempt({ shown_at: START + 500, solved_at: START + 3000 }))
    await buffer.submitSession(DEFAULT_CONFIG, 1)
    const p = (mock.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1].payload.problems[0]
    expect(p.shown_ms).toBe(500)
    expect(p.solved_ms).toBe(3000)
  })

  it('sets solved_ms to null for a timed-out attempt', async () => {
    const mock = makeMockSupabase()
    buffer = new TelemetryBuffer(mock as never)
    buffer.startSession(START)
    buffer.recordProblem(makeAttempt({ shown_at: START + 100, solved_at: null }))
    await buffer.submitSession(DEFAULT_CONFIG, 1)
    const p = (mock.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1].payload.problems[0]
    expect(p.solved_ms).toBeNull()
  })

  it('maps AttemptRecord fields to DB problem fields', async () => {
    const mock = makeMockSupabase()
    buffer = new TelemetryBuffer(mock as never)
    buffer.startSession(START)
    buffer.recordProblem(makeAttempt({ shown_at: START, solved_at: START + 2000, question_seq: 3 }))
    await buffer.submitSession(DEFAULT_CONFIG, 1)
    const p = (mock.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1].payload.problems[0]
    expect(p).toMatchObject({
      seq: 3,
      op: 'add',
      a: 47,
      b: 36,
      answer: 83,
    })
    expect(p.keystrokes).toHaveLength(1)
  })

  it('clamps shown_ms to 0 when shown_at < startTimeMs', async () => {
    const mock = makeMockSupabase()
    buffer = new TelemetryBuffer(mock as never)
    buffer.startSession(START)
    buffer.recordProblem(makeAttempt({ shown_at: START - 50, solved_at: START + 1000 }))
    await buffer.submitSession(DEFAULT_CONFIG, 1)
    const p = (mock.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1].payload.problems[0]
    expect(p.shown_ms).toBe(0)
  })
})

describe('TelemetryBuffer.submitSession', () => {
  it('calls rpc("submit_session") with a payload object', async () => {
    const mock = makeMockSupabase()
    const buffer = new TelemetryBuffer(mock as never)
    buffer.startSession(0)
    await buffer.submitSession(DEFAULT_CONFIG, 12345)
    expect(mock.rpc).toHaveBeenCalledWith('submit_session', expect.objectContaining({ payload: expect.any(Object) }))
  })

  it('returns the session UUID from the RPC', async () => {
    const mock = makeMockSupabase()
    const buffer = new TelemetryBuffer(mock as never)
    buffer.startSession(0)
    const id = await buffer.submitSession(DEFAULT_CONFIG, 1)
    expect(id).toBe('mock-session-uuid')
  })

  it('uses mode=ranked and ruleset=default_v1 for standard 120s config', async () => {
    const mock = makeMockSupabase()
    const buffer = new TelemetryBuffer(mock as never)
    buffer.startSession(0)
    await buffer.submitSession({ ...DEFAULT_CONFIG, mode: 'standard', duration_sec: 120 }, 1)
    const payload = (mock.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1].payload
    expect(payload.mode).toBe('ranked')
    expect(payload.ruleset).toBe('default_v1')
  })

  it('uses mode=practice and ruleset=null for custom config', async () => {
    const mock = makeMockSupabase()
    const buffer = new TelemetryBuffer(mock as never)
    buffer.startSession(0)
    await buffer.submitSession({ ...DEFAULT_CONFIG, mode: 'targeted_drill' }, 1)
    const payload = (mock.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1].payload
    expect(payload.mode).toBe('practice')
    expect(payload.ruleset).toBeNull()
  })

  it('uses mode=practice for standard config with non-120s duration', async () => {
    const mock = makeMockSupabase()
    const buffer = new TelemetryBuffer(mock as never)
    buffer.startSession(0)
    await buffer.submitSession({ ...DEFAULT_CONFIG, mode: 'standard', duration_sec: 60 }, 1)
    const payload = (mock.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1].payload
    expect(payload.mode).toBe('practice')
  })

  it('includes duration_s, seed, and app_version in payload', async () => {
    const mock = makeMockSupabase()
    const buffer = new TelemetryBuffer(mock as never)
    buffer.startSession(0)
    await buffer.submitSession({ ...DEFAULT_CONFIG, duration_sec: 60 }, 99999)
    const payload = (mock.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1].payload
    expect(payload.duration_s).toBe(60)
    expect(payload.seed).toBe(99999)
    expect(payload.app_version).toBe('0.1.0')
  })

  it('throws when RPC returns an error', async () => {
    const mock = makeMockSupabase({ data: null, error: { message: 'rpc failed' } } as never)
    const buffer = new TelemetryBuffer(mock as never)
    buffer.startSession(0)
    await expect(buffer.submitSession(DEFAULT_CONFIG, 1)).rejects.toMatchObject({ message: 'rpc failed' })
  })

  it('includes all recorded problems in the payload', async () => {
    const mock = makeMockSupabase()
    const buffer = new TelemetryBuffer(mock as never)
    buffer.startSession(0)
    buffer.recordProblem(makeAttempt({ question_seq: 0, shown_at: 100, solved_at: 2000 }))
    buffer.recordProblem(makeAttempt({ question_seq: 1, shown_at: 2100, solved_at: 5000 }))
    buffer.recordProblem(makeAttempt({ question_seq: 2, shown_at: 5100, solved_at: null }))
    await buffer.submitSession(DEFAULT_CONFIG, 1)
    const payload = (mock.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1].payload
    expect(payload.problems).toHaveLength(3)
    expect(payload.problems[2].solved_ms).toBeNull()
  })
})
