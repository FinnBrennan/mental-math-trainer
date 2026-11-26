export type OpKey = 'add' | 'sub' | 'mul' | 'div';

export interface AddRanges {
  min_a: number; max_a: number;
  min_b: number; max_b: number;
}
export interface SubRanges {
  min_x: number; max_x: number;
  min_y: number; max_y: number;
}
export interface MulRanges {
  min_a: number; max_a: number;
  min_b: number; max_b: number;
}
export interface DivRanges {
  min_m: number; max_m: number;
  min_n: number; max_n: number;
}

export interface SessionConfig {
  duration_sec: number;
  enabled_ops: Record<OpKey, boolean>;
  op_weights?: Partial<Record<OpKey, number>>;
  ranges: {
    add?: AddRanges;
    sub?: SubRanges;
    mul?: MulRanges;
    div?: DivRanges;
  };
  mode: 'standard' | 'targeted_drill';
  drill_tag?: string;
  source_run_id?: string;
}

export const DEFAULT_CONFIG: SessionConfig = {
  duration_sec: 120,
  enabled_ops: { add: true, sub: true, mul: true, div: true },
  ranges: {
    add: { min_a: 2, max_a: 100, min_b: 2, max_b: 100 },
    sub: { min_x: 2, max_x: 100, min_y: 2, max_y: 100 },
    mul: { min_a: 2, max_a: 12,  min_b: 2, max_b: 100 },
    div: { min_m: 2, max_m: 12,  min_n: 2, max_n: 100 },
  },
  mode: 'standard',
};

export interface Problem {
  op: OpKey;
  operand_a: number;
  operand_b: number;
  display_prompt: string;
  expected_answer: number;
}

export interface KeystrokeEvent {
  keystroke_seq: number;
  event_type: 'keydown' | 'paste' | 'blur';
  raw_key: string;
  normalized_key: 'digit' | 'backspace' | 'other' | 'paste';
  is_backspace: boolean;
  client_timestamp_ms: number;
  delta_from_prev_ms: number;
  delta_from_question_start_ms: number;
}

export interface AttemptRecord {
  question_seq: number;
  question_type: OpKey;
  operand_a: number;
  operand_b: number;
  display_prompt: string;
  expected_answer: number;
  user_final_input: string;
  is_correct: boolean;
  shown_at: number;
  solved_at: number | null;
  time_to_solve_ms: number | null;
  keystroke_count: number;
  backspace_count: number;
  had_paste: boolean;
  keystrokes: KeystrokeEvent[];
}

export interface GameState {
  phase: 'idle' | 'playing' | 'submitting' | 'results';
  config: SessionConfig;
  seed: number;
  sessionId: string | null;
  score: number;
  seq: number;
  currentProblem: Problem | null;
  currentInput: string;
  currentKeystrokes: KeystrokeEvent[];
  problemShownAt: number | null;
  timeRemaining: number;
}
