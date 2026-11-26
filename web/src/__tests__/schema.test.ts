import { readFileSync } from 'fs'
import { resolve } from 'path'

const SQL = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/20261127000001_part1_schema.sql'),
  'utf-8'
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function containsAll(sql: string, fragments: string[]): void {
  for (const fragment of fragments) {
    expect(sql).toContain(fragment)
  }
}

// ---------------------------------------------------------------------------
// Drop old objects
// ---------------------------------------------------------------------------

describe('schema: drops superseded objects', () => {
  it('drops on_auth_user_created trigger', () => {
    expect(SQL).toContain('DROP TRIGGER IF EXISTS on_auth_user_created')
  })

  it('drops handle_new_user function', () => {
    expect(SQL).toContain('DROP FUNCTION IF EXISTS public.handle_new_user()')
  })

  it('drops submit_session function', () => {
    expect(SQL).toContain('DROP FUNCTION IF EXISTS public.submit_session(jsonb)')
  })

  it('drops get_public_dashboard function', () => {
    expect(SQL).toContain('DROP FUNCTION IF EXISTS public.get_public_dashboard(text)')
  })

  it('drops old problems table', () => {
    expect(SQL).toContain('DROP TABLE IF EXISTS public.problems CASCADE')
  })

  it('drops old sessions table before recreating', () => {
    expect(SQL).toContain('DROP TABLE IF EXISTS public.sessions CASCADE')
  })

  it('drops profiles table', () => {
    expect(SQL).toContain('DROP TABLE IF EXISTS public.profiles CASCADE')
  })
})

// ---------------------------------------------------------------------------
// sessions table
// ---------------------------------------------------------------------------

describe('schema: sessions table', () => {
  it('creates public.sessions', () => {
    expect(SQL).toContain('CREATE TABLE public.sessions')
  })

  it('id is uuid primary key with gen_random_uuid()', () => {
    expect(SQL).toMatch(/id\s+uuid\s+PRIMARY KEY DEFAULT gen_random_uuid\(\)/)
  })

  it('player_id is non-null uuid', () => {
    expect(SQL).toMatch(/player_id\s+uuid\s+NOT NULL/)
  })

  it('started_at is non-null timestamptz', () => {
    expect(SQL).toMatch(/started_at\s+timestamptz\s+NOT NULL/)
  })

  it('ended_at is nullable (NULL until finalized)', () => {
    expect(SQL).toMatch(/ended_at\s+timestamptz,/)
  })

  it('duration_sec has BETWEEN 10 AND 600 check constraint', () => {
    expect(SQL).toContain('CHECK (duration_sec BETWEEN 10 AND 600)')
  })

  it('mode has IN check constraint for standard and targeted_drill', () => {
    expect(SQL).toContain("CHECK (mode IN ('standard', 'targeted_drill'))")
  })

  it('config_json is non-null jsonb', () => {
    expect(SQL).toMatch(/config_json\s+jsonb\s+NOT NULL/)
  })

  it('schema_version defaults to 1', () => {
    expect(SQL).toContain('schema_version   int              NOT NULL DEFAULT 1')
  })

  it('has index on player_id and started_at DESC', () => {
    expect(SQL).toContain('CREATE INDEX sessions_player_time_idx ON public.sessions (player_id, started_at DESC)')
  })

  it('drill_tag is nullable', () => {
    expect(SQL).toMatch(/drill_tag\s+text,/)
  })

  it('source_run_id is nullable uuid', () => {
    expect(SQL).toMatch(/source_run_id\s+uuid,/)
  })

  it('final_score, total_attempts, correct_attempts are nullable (until finalized)', () => {
    expect(SQL).toMatch(/final_score\s+int,/)
    expect(SQL).toMatch(/total_attempts\s+int,/)
    expect(SQL).toMatch(/correct_attempts\s+int,/)
  })
})

// ---------------------------------------------------------------------------
// question_attempts table
// ---------------------------------------------------------------------------

describe('schema: question_attempts table', () => {
  it('creates public.question_attempts', () => {
    expect(SQL).toContain('CREATE TABLE public.question_attempts')
  })

  it('session_id references sessions with CASCADE delete', () => {
    expect(SQL).toContain('REFERENCES public.sessions(id) ON DELETE CASCADE')
  })

  it('question_seq has non-negative check constraint', () => {
    expect(SQL).toContain('CHECK (question_seq >= 0)')
  })

  it('question_type has IN check for all four ops', () => {
    expect(SQL).toContain("CHECK (question_type IN ('add', 'sub', 'mul', 'div'))")
  })

  it('operand_a and operand_b are non-null int', () => {
    expect(SQL).toMatch(/operand_a\s+int\s+NOT NULL/)
    expect(SQL).toMatch(/operand_b\s+int\s+NOT NULL/)
  })

  it('display_prompt is non-null text', () => {
    expect(SQL).toMatch(/display_prompt\s+text\s+NOT NULL/)
  })

  it('expected_answer is non-null int', () => {
    expect(SQL).toMatch(/expected_answer\s+int\s+NOT NULL/)
  })

  it('is_correct is non-null bool', () => {
    expect(SQL).toMatch(/is_correct\s+bool\s+NOT NULL/)
  })

  it('shown_at is non-null timestamptz', () => {
    expect(SQL).toMatch(/shown_at\s+timestamptz\s+NOT NULL/)
  })

  it('solved_at is nullable (timeout case)', () => {
    expect(SQL).toMatch(/solved_at\s+timestamptz,/)
  })

  it('time_to_solve_ms is nullable', () => {
    expect(SQL).toMatch(/time_to_solve_ms\s+int,/)
  })

  it('keystroke_count defaults to 0', () => {
    expect(SQL).toContain('keystroke_count  int         NOT NULL DEFAULT 0')
  })

  it('backspace_count defaults to 0', () => {
    expect(SQL).toContain('backspace_count  int         NOT NULL DEFAULT 0')
  })

  it('had_paste defaults to false', () => {
    expect(SQL).toContain('had_paste        bool        NOT NULL DEFAULT false')
  })

  it('has UNIQUE constraint on (session_id, question_seq)', () => {
    expect(SQL).toContain('UNIQUE (session_id, question_seq)')
  })

  it('has index on player_id and session_id', () => {
    expect(SQL).toContain('CREATE INDEX qa_player_session_idx ON public.question_attempts (player_id, session_id)')
  })
})

// ---------------------------------------------------------------------------
// keystrokes table
// ---------------------------------------------------------------------------

describe('schema: keystrokes table', () => {
  it('creates public.keystrokes', () => {
    expect(SQL).toContain('CREATE TABLE public.keystrokes')
  })

  it('attempt_id references question_attempts with CASCADE delete', () => {
    expect(SQL).toContain('REFERENCES public.question_attempts(id) ON DELETE CASCADE')
  })

  it('session_id references sessions with CASCADE delete', () => {
    // keystrokes table has two FK references; second occurrence is keystrokes → sessions
    const matches = SQL.match(/REFERENCES public\.sessions\(id\) ON DELETE CASCADE/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeGreaterThanOrEqual(2)
  })

  it('keystroke_seq has non-negative check constraint', () => {
    expect(SQL).toContain('CHECK (keystroke_seq >= 0)')
  })

  it('event_type has IN check for keydown, paste, blur', () => {
    expect(SQL).toContain("CHECK (event_type IN ('keydown', 'paste', 'blur'))")
  })

  it('normalized_key has IN check for all four categories', () => {
    expect(SQL).toContain("CHECK (normalized_key IN ('digit', 'backspace', 'other', 'paste'))")
  })

  it('is_backspace is non-null bool', () => {
    expect(SQL).toMatch(/is_backspace\s+bool\s+NOT NULL/)
  })

  it('client_timestamp_ms is double precision', () => {
    expect(SQL).toMatch(/client_timestamp_ms\s+double precision\s+NOT NULL/)
  })

  it('delta_from_prev_ms is double precision defaulting to 0', () => {
    expect(SQL).toContain('delta_from_prev_ms           double precision NOT NULL DEFAULT 0')
  })

  it('delta_from_question_start_ms is non-null double precision', () => {
    expect(SQL).toMatch(/delta_from_question_start_ms double precision\s+NOT NULL/)
  })

  it('recorded_at defaults to now()', () => {
    expect(SQL).toContain('recorded_at                  timestamptz      NOT NULL DEFAULT now()')
  })

  it('has UNIQUE constraint on (attempt_id, keystroke_seq)', () => {
    expect(SQL).toContain('UNIQUE (attempt_id, keystroke_seq)')
  })

  it('has index on attempt_id', () => {
    expect(SQL).toContain('CREATE INDEX ks_attempt_idx ON public.keystrokes (attempt_id)')
  })

  it('has index on session_id', () => {
    expect(SQL).toContain('CREATE INDEX ks_session_idx ON public.keystrokes (session_id)')
  })
})

// ---------------------------------------------------------------------------
// Privileges
// ---------------------------------------------------------------------------

describe('schema: privileges', () => {
  it('revokes all from anon and authenticated before granting', () => {
    expect(SQL).toContain('REVOKE ALL ON public.sessions, public.question_attempts, public.keystrokes FROM anon, authenticated')
  })

  it('grants SELECT, INSERT, UPDATE on sessions to anon and authenticated', () => {
    expect(SQL).toContain('GRANT SELECT, INSERT, UPDATE ON public.sessions          TO anon, authenticated')
  })

  it('grants only SELECT, INSERT (no UPDATE) on question_attempts', () => {
    expect(SQL).toContain('GRANT SELECT, INSERT         ON public.question_attempts TO anon, authenticated')
    expect(SQL).not.toContain('GRANT SELECT, INSERT, UPDATE ON public.question_attempts')
  })

  it('grants only SELECT, INSERT (no UPDATE) on keystrokes', () => {
    expect(SQL).toContain('GRANT SELECT, INSERT         ON public.keystrokes        TO anon, authenticated')
    expect(SQL).not.toContain('GRANT SELECT, INSERT, UPDATE ON public.keystrokes')
  })

  it('grants SELECT on dashboard_daily_bests view', () => {
    expect(SQL).toContain('GRANT SELECT ON public.dashboard_daily_bests TO anon, authenticated')
  })
})

// ---------------------------------------------------------------------------
// RLS
// ---------------------------------------------------------------------------

describe('schema: row-level security', () => {
  it('enables RLS on all three tables', () => {
    containsAll(SQL, [
      'ALTER TABLE public.sessions          ENABLE ROW LEVEL SECURITY',
      'ALTER TABLE public.question_attempts ENABLE ROW LEVEL SECURITY',
      'ALTER TABLE public.keystrokes        ENABLE ROW LEVEL SECURITY',
    ])
  })

  it('sessions INSERT policy checks player_id = auth.uid()', () => {
    expect(SQL).toContain('"insert own session" ON public.sessions')
    expect(SQL).toContain('WITH CHECK (player_id = (SELECT auth.uid()))')
  })

  it('sessions SELECT policy uses player_id = auth.uid()', () => {
    expect(SQL).toContain('"read own sessions" ON public.sessions')
  })

  it('sessions UPDATE policy has both USING and WITH CHECK', () => {
    expect(SQL).toContain('"update own session" ON public.sessions')
    // UPDATE policy must have both clauses — count occurrences within sessions block
    const updateBlock = SQL.slice(
      SQL.indexOf('"update own session"'),
      SQL.indexOf('-- question_attempts')
    )
    expect(updateBlock).toContain('USING (player_id = (SELECT auth.uid()))')
    expect(updateBlock).toContain('WITH CHECK (player_id = (SELECT auth.uid()))')
  })

  it('question_attempts INSERT policy', () => {
    expect(SQL).toContain('"insert own attempts" ON public.question_attempts')
  })

  it('question_attempts SELECT policy', () => {
    expect(SQL).toContain('"read own attempts" ON public.question_attempts')
  })

  it('keystrokes INSERT policy', () => {
    expect(SQL).toContain('"insert own keystrokes" ON public.keystrokes')
  })

  it('keystrokes SELECT policy', () => {
    expect(SQL).toContain('"read own keystrokes" ON public.keystrokes')
  })

  it('no UPDATE policy on question_attempts (immutable once written)', () => {
    expect(SQL).not.toMatch(/"update.*attempts"\s+ON public\.question_attempts/)
  })

  it('no UPDATE policy on keystrokes (immutable once written)', () => {
    expect(SQL).not.toMatch(/"update.*keystrokes"\s+ON public\.keystrokes/)
  })

  it('all policies use subquery form (SELECT auth.uid()) for performance', () => {
    const directAuthUid = /\(player_id = auth\.uid\(\)\)/g
    expect(SQL).not.toMatch(directAuthUid)
  })
})

// ---------------------------------------------------------------------------
// dashboard_daily_bests view
// ---------------------------------------------------------------------------

describe('schema: dashboard_daily_bests view', () => {
  it('creates the view', () => {
    expect(SQL).toContain('CREATE VIEW public.dashboard_daily_bests AS')
  })

  it('filters to standard sessions only', () => {
    expect(SQL).toContain("WHERE mode = 'standard'")
  })

  it('filters out sessions without a final_score', () => {
    expect(SQL).toContain('AND final_score IS NOT NULL')
  })

  it('groups by player_id and day', () => {
    expect(SQL).toContain('GROUP BY player_id,')
  })

  it('exposes rounds count', () => {
    expect(SQL).toContain('COUNT(*)::int                           AS rounds')
  })

  it('exposes best_score as MAX(final_score)', () => {
    expect(SQL).toContain('MAX(final_score)                        AS best_score')
  })

  it('exposes avg_score rounded to one decimal', () => {
    expect(SQL).toContain('ROUND(AVG(final_score)::numeric, 1)     AS avg_score')
  })

  it('casts started_at to date in UTC', () => {
    expect(SQL).toContain("(started_at AT TIME ZONE 'UTC')::date  AS day")
  })
})

// ---------------------------------------------------------------------------
// Well-formedness
// ---------------------------------------------------------------------------

describe('schema: well-formedness', () => {
  it('is not empty', () => {
    expect(SQL.trim().length).toBeGreaterThan(0)
  })

  it('has no unbalanced parentheses', () => {
    const open = (SQL.match(/\(/g) ?? []).length
    const close = (SQL.match(/\)/g) ?? []).length
    expect(open).toBe(close)
  })

  it('references only public schema tables', () => {
    // No bare table references without public. prefix (excluding auth.uid and auth.users)
    const suspiciousRefs = SQL.match(/REFERENCES (?!public\.)(?!auth\.)\w+\.\w+/g)
    expect(suspiciousRefs).toBeNull()
  })

  it('all three tables appear in correct creation order (sessions before question_attempts before keystrokes)', () => {
    const sessionsIdx = SQL.indexOf('CREATE TABLE public.sessions')
    const qaIdx = SQL.indexOf('CREATE TABLE public.question_attempts')
    const ksIdx = SQL.indexOf('CREATE TABLE public.keystrokes')
    expect(sessionsIdx).toBeLessThan(qaIdx)
    expect(qaIdx).toBeLessThan(ksIdx)
  })

  it('schema_version = 1 appears in all three tables', () => {
    const matches = SQL.match(/schema_version\s+int\s+NOT NULL DEFAULT 1/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(3)
  })
})
