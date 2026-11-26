import { DEFAULT_CONFIG, type SessionConfig, type OpKey } from '../types'
import {
  mulberry32,
  randInt,
  sampleOp,
  generateProblem,
  normalizeKey,
  parseConfigFromQuery,
  encodeConfigToQuery,
  validateConfig,
} from '../lib/game/engine'

const makeRng = (seed = 42) => mulberry32(seed)

// ─── mulberry32 ───────────────────────────────────────────────────────────────

describe('mulberry32', () => {
  it('same seed produces identical sequence', () => {
    const a = makeRng(1)
    const b = makeRng(1)
    const seqA = Array.from({ length: 5 }, () => a())
    const seqB = Array.from({ length: 5 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('different seeds produce different sequences', () => {
    const a = makeRng(1)
    const b = makeRng(2)
    const seqA = Array.from({ length: 5 }, () => a())
    const seqB = Array.from({ length: 5 }, () => b())
    expect(seqA).not.toEqual(seqB)
  })

  it('all output values are in [0, 1)', () => {
    const rng = makeRng(99)
    for (let i = 0; i < 100; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('consecutive values are not equal (not stuck)', () => {
    const rng = makeRng(7)
    const values = Array.from({ length: 20 }, () => rng())
    const allSame = values.every(v => v === values[0])
    expect(allSame).toBe(false)
  })

  it('seed 0 and seed 1 produce different streams', () => {
    const a = makeRng(0)
    const b = makeRng(1)
    expect(a()).not.toBe(b())
  })

  it('non-integer seed works via >>> 0 coercion', () => {
    // 123.7 >>> 0 === 123, so mulberry32(123.7) should equal mulberry32(123)
    const a = mulberry32(123.7)
    const b = mulberry32(123)
    const seqA = Array.from({ length: 5 }, () => a())
    const seqB = Array.from({ length: 5 }, () => b())
    expect(seqA).toEqual(seqB)
  })
})

// ─── randInt ─────────────────────────────────────────────────────────────────

describe('randInt', () => {
  it('when min === max always returns min', () => {
    const rng = makeRng()
    for (let i = 0; i < 100; i++) {
      expect(randInt(rng, 7, 7)).toBe(7)
    }
  })

  it('min=1, max=10: all results are in [1, 10] inclusive', () => {
    const rng = makeRng()
    for (let i = 0; i < 100; i++) {
      const v = randInt(rng, 1, 10)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(10)
    }
  })

  it('min=2, max=100: extremes 2 and 100 are both reachable over 10000 trials', () => {
    const rng = makeRng(5)
    let sawMin = false
    let sawMax = false
    for (let i = 0; i < 10000; i++) {
      const v = randInt(rng, 2, 100)
      if (v === 2) sawMin = true
      if (v === 100) sawMax = true
      if (sawMin && sawMax) break
    }
    expect(sawMin).toBe(true)
    expect(sawMax).toBe(true)
  })

  it('returns an integer', () => {
    const rng = makeRng()
    for (let i = 0; i < 100; i++) {
      const v = randInt(rng, 1, 100)
      expect(v).toBe(Math.floor(v))
    }
  })

  it('min=0, max=0 always returns 0', () => {
    const rng = makeRng()
    for (let i = 0; i < 100; i++) {
      expect(randInt(rng, 0, 0)).toBe(0)
    }
  })
})

// ─── sampleOp ────────────────────────────────────────────────────────────────

describe('sampleOp', () => {
  it('all 4 ops enabled, no weights: all ops appear over 1000 trials', () => {
    const rng = makeRng()
    const seen = new Set<OpKey>()
    for (let i = 0; i < 1000; i++) seen.add(sampleOp(rng, DEFAULT_CONFIG))
    expect(seen.has('add')).toBe(true)
    expect(seen.has('sub')).toBe(true)
    expect(seen.has('mul')).toBe(true)
    expect(seen.has('div')).toBe(true)
  })

  it('all 4 ops enabled, no weights: distribution is roughly uniform (15–35% each)', () => {
    const rng = makeRng()
    const counts: Record<OpKey, number> = { add: 0, sub: 0, mul: 0, div: 0 }
    const N = 1000
    for (let i = 0; i < N; i++) counts[sampleOp(rng, DEFAULT_CONFIG)]++
    for (const op of ['add', 'sub', 'mul', 'div'] as OpKey[]) {
      const pct = counts[op] / N
      expect(pct).toBeGreaterThanOrEqual(0.15)
      expect(pct).toBeLessThanOrEqual(0.35)
    }
  })

  it('only add enabled: always returns add', () => {
    const rng = makeRng()
    const cfg: SessionConfig = { ...DEFAULT_CONFIG, enabled_ops: { add: true, sub: false, mul: false, div: false } }
    for (let i = 0; i < 100; i++) expect(sampleOp(rng, cfg)).toBe('add')
  })

  it('only mul enabled: always returns mul', () => {
    const rng = makeRng()
    const cfg: SessionConfig = { ...DEFAULT_CONFIG, enabled_ops: { add: false, sub: false, mul: true, div: false } }
    for (let i = 0; i < 100; i++) expect(sampleOp(rng, cfg)).toBe('mul')
  })

  it('weight add:10 → add appears at least 60% of 1000 trials', () => {
    const rng = makeRng()
    const cfg: SessionConfig = {
      ...DEFAULT_CONFIG,
      op_weights: { add: 10, sub: 1, mul: 1, div: 1 },
    }
    let addCount = 0
    for (let i = 0; i < 1000; i++) if (sampleOp(rng, cfg) === 'add') addCount++
    expect(addCount / 1000).toBeGreaterThanOrEqual(0.60)
  })

  it('tiny mul/div weights → add+sub appear >98% of 1000 trials', () => {
    const rng = makeRng()
    const cfg: SessionConfig = {
      ...DEFAULT_CONFIG,
      op_weights: { add: 1, sub: 1, mul: 0.0001, div: 0.0001 },
    }
    let addSubCount = 0
    for (let i = 0; i < 1000; i++) {
      const op = sampleOp(rng, cfg)
      if (op === 'add' || op === 'sub') addSubCount++
    }
    expect(addSubCount / 1000).toBeGreaterThan(0.98)
  })

  it('no ops enabled: throws matching /no operations enabled/i', () => {
    const rng = makeRng()
    const cfg: SessionConfig = {
      ...DEFAULT_CONFIG,
      enabled_ops: { add: false, sub: false, mul: false, div: false },
    }
    expect(() => sampleOp(rng, cfg)).toThrow(/no operations enabled/i)
  })
})

// ─── generateProblem — ADD ───────────────────────────────────────────────────

describe('generateProblem — add', () => {
  it('returns op field "add"', () => {
    const rng = makeRng()
    expect(generateProblem(rng, 'add', DEFAULT_CONFIG).op).toBe('add')
  })

  it('operand_a is in [min_a, max_a] for 200 trials', () => {
    const rng = makeRng()
    const { min_a, max_a } = DEFAULT_CONFIG.ranges.add!
    for (let i = 0; i < 200; i++) {
      const p = generateProblem(rng, 'add', DEFAULT_CONFIG)
      expect(p.operand_a).toBeGreaterThanOrEqual(min_a)
      expect(p.operand_a).toBeLessThanOrEqual(max_a)
    }
  })

  it('operand_b is in [min_b, max_b] for 200 trials', () => {
    const rng = makeRng()
    const { min_b, max_b } = DEFAULT_CONFIG.ranges.add!
    for (let i = 0; i < 200; i++) {
      const p = generateProblem(rng, 'add', DEFAULT_CONFIG)
      expect(p.operand_b).toBeGreaterThanOrEqual(min_b)
      expect(p.operand_b).toBeLessThanOrEqual(max_b)
    }
  })

  it('expected_answer === operand_a + operand_b for 200 trials', () => {
    const rng = makeRng()
    for (let i = 0; i < 200; i++) {
      const p = generateProblem(rng, 'add', DEFAULT_CONFIG)
      expect(p.expected_answer).toBe(p.operand_a + p.operand_b)
    }
  })

  it('display_prompt matches "${a} + ${b}" for 50 trials', () => {
    const rng = makeRng()
    for (let i = 0; i < 50; i++) {
      const p = generateProblem(rng, 'add', DEFAULT_CONFIG)
      expect(p.display_prompt).toBe(`${p.operand_a} + ${p.operand_b}`)
    }
  })

  it('custom fixed range {min_a:5,max_a:5,min_b:7,max_b:7} always produces 5+7=12', () => {
    const rng = makeRng()
    const cfg: SessionConfig = {
      ...DEFAULT_CONFIG,
      ranges: { ...DEFAULT_CONFIG.ranges, add: { min_a: 5, max_a: 5, min_b: 7, max_b: 7 } },
    }
    for (let i = 0; i < 20; i++) {
      const p = generateProblem(rng, 'add', cfg)
      expect(p.operand_a).toBe(5)
      expect(p.operand_b).toBe(7)
      expect(p.expected_answer).toBe(12)
    }
  })

  it('falls back to DEFAULT_CONFIG ranges when config.ranges.add is undefined', () => {
    const rng = makeRng()
    const cfg: SessionConfig = { ...DEFAULT_CONFIG, ranges: {} }
    // Should not throw, should produce valid problem
    const p = generateProblem(rng, 'add', cfg)
    expect(p.op).toBe('add')
    expect(p.expected_answer).toBe(p.operand_a + p.operand_b)
    expect(p.operand_a).toBeGreaterThanOrEqual(2)
    expect(p.operand_a).toBeLessThanOrEqual(100)
  })
})

// ─── generateProblem — SUB ───────────────────────────────────────────────────

describe('generateProblem — sub', () => {
  it('returns op field "sub"', () => {
    const rng = makeRng()
    expect(generateProblem(rng, 'sub', DEFAULT_CONFIG).op).toBe('sub')
  })

  it('expected_answer >= 0 for all 500 trials (Zetamac invariant)', () => {
    const rng = makeRng()
    for (let i = 0; i < 500; i++) {
      const p = generateProblem(rng, 'sub', DEFAULT_CONFIG)
      expect(p.expected_answer).toBeGreaterThanOrEqual(0)
    }
  })

  it('operand_a === operand_b + expected_answer for 200 trials', () => {
    const rng = makeRng()
    for (let i = 0; i < 200; i++) {
      const p = generateProblem(rng, 'sub', DEFAULT_CONFIG)
      expect(p.operand_a).toBe(p.operand_b + p.expected_answer)
    }
  })

  it('display_prompt matches "${operand_a} - ${operand_b}" for 50 trials', () => {
    const rng = makeRng()
    for (let i = 0; i < 50; i++) {
      const p = generateProblem(rng, 'sub', DEFAULT_CONFIG)
      expect(p.display_prompt).toBe(`${p.operand_a} - ${p.operand_b}`)
    }
  })

  it('expected_answer (y) is in [min_y, max_y] for 200 trials', () => {
    const rng = makeRng()
    const { min_y, max_y } = DEFAULT_CONFIG.ranges.sub!
    for (let i = 0; i < 200; i++) {
      const p = generateProblem(rng, 'sub', DEFAULT_CONFIG)
      expect(p.expected_answer).toBeGreaterThanOrEqual(min_y)
      expect(p.expected_answer).toBeLessThanOrEqual(max_y)
    }
  })

  it('operand_b (x, the subtrahend) is in [min_x, max_x] for 200 trials', () => {
    const rng = makeRng()
    const { min_x, max_x } = DEFAULT_CONFIG.ranges.sub!
    for (let i = 0; i < 200; i++) {
      const p = generateProblem(rng, 'sub', DEFAULT_CONFIG)
      expect(p.operand_b).toBeGreaterThanOrEqual(min_x)
      expect(p.operand_b).toBeLessThanOrEqual(max_x)
    }
  })

  it('custom fixed range {min_x:7,max_x:7,min_y:8,max_y:8}: operand_a=15, operand_b=7, answer=8', () => {
    const rng = makeRng()
    const cfg: SessionConfig = {
      ...DEFAULT_CONFIG,
      ranges: { ...DEFAULT_CONFIG.ranges, sub: { min_x: 7, max_x: 7, min_y: 8, max_y: 8 } },
    }
    for (let i = 0; i < 10; i++) {
      const p = generateProblem(rng, 'sub', cfg)
      expect(p.operand_a).toBe(15)
      expect(p.operand_b).toBe(7)
      expect(p.expected_answer).toBe(8)
    }
  })
})

// ─── generateProblem — MUL ───────────────────────────────────────────────────

describe('generateProblem — mul', () => {
  it('returns op field "mul"', () => {
    const rng = makeRng()
    expect(generateProblem(rng, 'mul', DEFAULT_CONFIG).op).toBe('mul')
  })

  it('operand_a is in [2, 12] for 200 trials', () => {
    const rng = makeRng()
    for (let i = 0; i < 200; i++) {
      const p = generateProblem(rng, 'mul', DEFAULT_CONFIG)
      expect(p.operand_a).toBeGreaterThanOrEqual(2)
      expect(p.operand_a).toBeLessThanOrEqual(12)
    }
  })

  it('operand_b is in [2, 100] for 200 trials', () => {
    const rng = makeRng()
    for (let i = 0; i < 200; i++) {
      const p = generateProblem(rng, 'mul', DEFAULT_CONFIG)
      expect(p.operand_b).toBeGreaterThanOrEqual(2)
      expect(p.operand_b).toBeLessThanOrEqual(100)
    }
  })

  it('expected_answer === operand_a * operand_b for 200 trials', () => {
    const rng = makeRng()
    for (let i = 0; i < 200; i++) {
      const p = generateProblem(rng, 'mul', DEFAULT_CONFIG)
      expect(p.expected_answer).toBe(p.operand_a * p.operand_b)
    }
  })

  it('display_prompt contains × and matches "${a} × ${b}" for 50 trials', () => {
    const rng = makeRng()
    for (let i = 0; i < 50; i++) {
      const p = generateProblem(rng, 'mul', DEFAULT_CONFIG)
      expect(p.display_prompt).toContain('×')
      expect(p.display_prompt).toBe(`${p.operand_a} × ${p.operand_b}`)
    }
  })

  it('custom fixed range {min_a:7,max_a:7,min_b:8,max_b:8} always gives 7×8=56', () => {
    const rng = makeRng()
    const cfg: SessionConfig = {
      ...DEFAULT_CONFIG,
      ranges: { ...DEFAULT_CONFIG.ranges, mul: { min_a: 7, max_a: 7, min_b: 8, max_b: 8 } },
    }
    for (let i = 0; i < 20; i++) {
      const p = generateProblem(rng, 'mul', cfg)
      expect(p.operand_a).toBe(7)
      expect(p.operand_b).toBe(8)
      expect(p.expected_answer).toBe(56)
    }
  })
})

// ─── generateProblem — DIV ───────────────────────────────────────────────────

describe('generateProblem — div', () => {
  it('returns op field "div"', () => {
    const rng = makeRng()
    expect(generateProblem(rng, 'div', DEFAULT_CONFIG).op).toBe('div')
  })

  it('operand_b (divisor) is in [2, 12] for 200 trials', () => {
    const rng = makeRng()
    for (let i = 0; i < 200; i++) {
      const p = generateProblem(rng, 'div', DEFAULT_CONFIG)
      expect(p.operand_b).toBeGreaterThanOrEqual(2)
      expect(p.operand_b).toBeLessThanOrEqual(12)
    }
  })

  it('expected_answer (quotient) is in [2, 100] for 200 trials', () => {
    const rng = makeRng()
    for (let i = 0; i < 200; i++) {
      const p = generateProblem(rng, 'div', DEFAULT_CONFIG)
      expect(p.expected_answer).toBeGreaterThanOrEqual(2)
      expect(p.expected_answer).toBeLessThanOrEqual(100)
    }
  })

  it('operand_a === operand_b * expected_answer (exact integer division) for 200 trials', () => {
    const rng = makeRng()
    for (let i = 0; i < 200; i++) {
      const p = generateProblem(rng, 'div', DEFAULT_CONFIG)
      expect(p.operand_a).toBe(p.operand_b * p.expected_answer)
    }
  })

  it('expected_answer is always an integer for 200 trials', () => {
    const rng = makeRng()
    for (let i = 0; i < 200; i++) {
      const p = generateProblem(rng, 'div', DEFAULT_CONFIG)
      expect(p.expected_answer).toBe(Math.floor(p.expected_answer))
    }
  })

  it('operand_b (divisor) is never 0 for 200 trials', () => {
    const rng = makeRng()
    for (let i = 0; i < 200; i++) {
      const p = generateProblem(rng, 'div', DEFAULT_CONFIG)
      expect(p.operand_b).not.toBe(0)
    }
  })

  it('display_prompt contains ÷ and matches "${dividend} ÷ ${divisor}" for 50 trials', () => {
    const rng = makeRng()
    for (let i = 0; i < 50; i++) {
      const p = generateProblem(rng, 'div', DEFAULT_CONFIG)
      expect(p.display_prompt).toContain('÷')
      expect(p.display_prompt).toBe(`${p.operand_a} ÷ ${p.operand_b}`)
    }
  })

  it('custom fixed range {min_m:7,max_m:7,min_n:8,max_n:8}: operand_a=56, operand_b=7, answer=8', () => {
    const rng = makeRng()
    const cfg: SessionConfig = {
      ...DEFAULT_CONFIG,
      ranges: { ...DEFAULT_CONFIG.ranges, div: { min_m: 7, max_m: 7, min_n: 8, max_n: 8 } },
    }
    for (let i = 0; i < 10; i++) {
      const p = generateProblem(rng, 'div', cfg)
      expect(p.operand_a).toBe(56)
      expect(p.operand_b).toBe(7)
      expect(p.expected_answer).toBe(8)
    }
  })
})

// ─── generateProblem — DEFAULT_CONFIG fallback ───────────────────────────────

describe('generateProblem — DEFAULT_CONFIG fallback', () => {
  it('config with no ranges at all: all 4 ops generate valid problems without throwing', () => {
    const rng = makeRng()
    const cfg: SessionConfig = { ...DEFAULT_CONFIG, ranges: {} }
    for (const op of ['add', 'sub', 'mul', 'div'] as OpKey[]) {
      expect(() => generateProblem(rng, op, cfg)).not.toThrow()
      const p = generateProblem(rng, op, cfg)
      expect(p.op).toBe(op)
      expect(typeof p.expected_answer).toBe('number')
      expect(typeof p.display_prompt).toBe('string')
    }
  })
})

// ─── normalizeKey ─────────────────────────────────────────────────────────────

describe('normalizeKey', () => {
  it.each(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])(
    'digit %s → "digit"',
    (key) => {
      expect(normalizeKey(key)).toBe('digit')
    }
  )

  it('"Backspace" → "backspace"', () => {
    expect(normalizeKey('Backspace')).toBe('backspace')
  })

  it('"paste" → "paste"', () => {
    expect(normalizeKey('paste')).toBe('paste')
  })

  it.each([
    'ArrowLeft',
    'ArrowRight',
    'Enter',
    'Tab',
    'a',
    'A',
    ' ',
    '-',
    'Delete',
  ])('%s → "other"', (key) => {
    expect(normalizeKey(key)).toBe('other')
  })
})

// ─── parseConfigFromQuery ─────────────────────────────────────────────────────

describe('parseConfigFromQuery', () => {
  it('null → DEFAULT_CONFIG', () => {
    expect(parseConfigFromQuery(null)).toEqual(DEFAULT_CONFIG)
  })

  it('empty string → DEFAULT_CONFIG', () => {
    expect(parseConfigFromQuery('')).toEqual(DEFAULT_CONFIG)
  })

  it('undefined cast as null → DEFAULT_CONFIG', () => {
    expect(parseConfigFromQuery(null as unknown as null)).toEqual(DEFAULT_CONFIG)
  })

  it('valid base64 of DEFAULT_CONFIG → returns object equal to DEFAULT_CONFIG', () => {
    const encoded = btoa(JSON.stringify(DEFAULT_CONFIG))
    expect(parseConfigFromQuery(encoded)).toEqual(DEFAULT_CONFIG)
  })

  it('valid base64 of custom config (mul only, 60s) → returns that config', () => {
    const custom: SessionConfig = {
      duration_sec: 60,
      enabled_ops: { add: false, sub: false, mul: true, div: false },
      ranges: { mul: { min_a: 2, max_a: 12, min_b: 2, max_b: 100 } },
      mode: 'targeted_drill',
      drill_tag: 'mul_only',
    }
    const encoded = btoa(JSON.stringify(custom))
    expect(parseConfigFromQuery(encoded)).toEqual(custom)
  })

  it('invalid base64 string → DEFAULT_CONFIG (no throw)', () => {
    expect(parseConfigFromQuery('!!!notbase64!!!')).toEqual(DEFAULT_CONFIG)
  })

  it('valid base64 but invalid JSON → DEFAULT_CONFIG', () => {
    expect(parseConfigFromQuery(btoa('not json'))).toEqual(DEFAULT_CONFIG)
  })

  it('valid base64 + valid JSON but no enabled ops → DEFAULT_CONFIG', () => {
    const bad: SessionConfig = {
      ...DEFAULT_CONFIG,
      enabled_ops: { add: false, sub: false, mul: false, div: false },
    }
    expect(parseConfigFromQuery(btoa(JSON.stringify(bad)))).toEqual(DEFAULT_CONFIG)
  })

  it('valid base64 + valid JSON but duration out of range → DEFAULT_CONFIG', () => {
    const bad = { ...DEFAULT_CONFIG, duration_sec: 999 }
    expect(parseConfigFromQuery(btoa(JSON.stringify(bad)))).toEqual(DEFAULT_CONFIG)
  })

  it('roundtrip with DEFAULT_CONFIG', () => {
    const encoded = encodeConfigToQuery(DEFAULT_CONFIG)
    expect(parseConfigFromQuery(encoded)).toEqual(DEFAULT_CONFIG)
  })

  it('roundtrip with custom targeted drill config', () => {
    const custom: SessionConfig = {
      duration_sec: 60,
      enabled_ops: { add: false, sub: false, mul: true, div: false },
      op_weights: { mul: 5 },
      ranges: {
        mul: { min_a: 7, max_a: 8, min_b: 2, max_b: 100 },
      },
      mode: 'targeted_drill',
      drill_tag: 'mul_7_8',
      source_run_id: 'abc-123',
    }
    expect(parseConfigFromQuery(encodeConfigToQuery(custom))).toEqual(custom)
  })
})

// ─── encodeConfigToQuery ──────────────────────────────────────────────────────

describe('encodeConfigToQuery', () => {
  it('returns a non-empty string', () => {
    const result = encodeConfigToQuery(DEFAULT_CONFIG)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('result is valid base64 (atob does not throw)', () => {
    const result = encodeConfigToQuery(DEFAULT_CONFIG)
    expect(() => atob(result)).not.toThrow()
  })

  it('result decodes to valid JSON', () => {
    const result = encodeConfigToQuery(DEFAULT_CONFIG)
    expect(() => JSON.parse(atob(result))).not.toThrow()
  })

  it('roundtrip with DEFAULT_CONFIG', () => {
    const encoded = encodeConfigToQuery(DEFAULT_CONFIG)
    expect(JSON.parse(atob(encoded))).toEqual(DEFAULT_CONFIG)
  })

  it('different configs produce different encoded strings', () => {
    const a = encodeConfigToQuery(DEFAULT_CONFIG)
    const b = encodeConfigToQuery({ ...DEFAULT_CONFIG, duration_sec: 60 })
    expect(a).not.toBe(b)
  })
})

// ─── validateConfig ───────────────────────────────────────────────────────────

describe('validateConfig', () => {
  it('DEFAULT_CONFIG → returns true', () => {
    expect(validateConfig(DEFAULT_CONFIG)).toBe(true)
  })

  it('non-object input (string) → throws', () => {
    expect(() => validateConfig('hello' as unknown as SessionConfig)).toThrow()
  })

  it('null → throws', () => {
    expect(() => validateConfig(null as unknown as SessionConfig)).toThrow()
  })

  it('undefined → throws', () => {
    expect(() => validateConfig(undefined as unknown as SessionConfig)).toThrow()
  })

  it('duration_sec = 9 → throws mentioning duration', () => {
    const cfg = { ...DEFAULT_CONFIG, duration_sec: 9 }
    expect(() => validateConfig(cfg)).toThrow(/duration/i)
  })

  it('duration_sec = 601 → throws mentioning duration', () => {
    const cfg = { ...DEFAULT_CONFIG, duration_sec: 601 }
    expect(() => validateConfig(cfg)).toThrow(/duration/i)
  })

  it('duration_sec = 10 (minimum) → valid', () => {
    expect(validateConfig({ ...DEFAULT_CONFIG, duration_sec: 10 })).toBe(true)
  })

  it('duration_sec = 600 (maximum) → valid', () => {
    expect(validateConfig({ ...DEFAULT_CONFIG, duration_sec: 600 })).toBe(true)
  })

  it('all ops disabled → throws mentioning operations', () => {
    const cfg: SessionConfig = {
      ...DEFAULT_CONFIG,
      enabled_ops: { add: false, sub: false, mul: false, div: false },
    }
    expect(() => validateConfig(cfg)).toThrow(/operation/i)
  })

  it('exactly one op enabled → valid', () => {
    const cfg: SessionConfig = {
      ...DEFAULT_CONFIG,
      enabled_ops: { add: true, sub: false, mul: false, div: false },
    }
    expect(validateConfig(cfg)).toBe(true)
  })

  it('add range: min_a > max_a → throws', () => {
    const cfg: SessionConfig = {
      ...DEFAULT_CONFIG,
      ranges: { ...DEFAULT_CONFIG.ranges, add: { min_a: 50, max_a: 10, min_b: 2, max_b: 100 } },
    }
    expect(() => validateConfig(cfg)).toThrow()
  })

  it('sub range: min_y > max_y → throws', () => {
    const cfg: SessionConfig = {
      ...DEFAULT_CONFIG,
      ranges: { ...DEFAULT_CONFIG.ranges, sub: { min_x: 2, max_x: 100, min_y: 50, max_y: 10 } },
    }
    expect(() => validateConfig(cfg)).toThrow()
  })

  it('mul range: min_b > max_b → throws', () => {
    const cfg: SessionConfig = {
      ...DEFAULT_CONFIG,
      ranges: { ...DEFAULT_CONFIG.ranges, mul: { min_a: 2, max_a: 12, min_b: 50, max_b: 10 } },
    }
    expect(() => validateConfig(cfg)).toThrow()
  })

  it('div range: min_n > max_n → throws', () => {
    const cfg: SessionConfig = {
      ...DEFAULT_CONFIG,
      ranges: { ...DEFAULT_CONFIG.ranges, div: { min_m: 2, max_m: 12, min_n: 50, max_n: 10 } },
    }
    expect(() => validateConfig(cfg)).toThrow()
  })

  it('zero value in add ranges (min_a = 0) → throws (must be positive)', () => {
    const cfg: SessionConfig = {
      ...DEFAULT_CONFIG,
      ranges: { ...DEFAULT_CONFIG.ranges, add: { min_a: 0, max_a: 100, min_b: 2, max_b: 100 } },
    }
    expect(() => validateConfig(cfg)).toThrow()
  })

  it('missing ranges object entirely → valid', () => {
    // ranges is typed as required but we test runtime behaviour
    const cfg = { ...DEFAULT_CONFIG, ranges: undefined } as unknown as SessionConfig
    // validateConfig checks `if (config.ranges && ...)`, so missing ranges is skipped
    expect(validateConfig(cfg)).toBe(true)
  })

  it('valid targeted_drill config with drill_tag and source_run_id → returns true', () => {
    const cfg: SessionConfig = {
      duration_sec: 60,
      enabled_ops: { add: false, sub: false, mul: true, div: false },
      ranges: { mul: { min_a: 7, max_a: 8, min_b: 2, max_b: 100 } },
      mode: 'targeted_drill',
      drill_tag: 'mul_7_8_weakness',
      source_run_id: '550e8400-e29b-41d4-a716-446655440000',
    }
    expect(validateConfig(cfg)).toBe(true)
  })
})

// ─── DEFAULT_CONFIG structure ─────────────────────────────────────────────────

describe('DEFAULT_CONFIG structure', () => {
  it('duration_sec is 120', () => {
    expect(DEFAULT_CONFIG.duration_sec).toBe(120)
  })

  it('all 4 ops are enabled', () => {
    expect(DEFAULT_CONFIG.enabled_ops.add).toBe(true)
    expect(DEFAULT_CONFIG.enabled_ops.sub).toBe(true)
    expect(DEFAULT_CONFIG.enabled_ops.mul).toBe(true)
    expect(DEFAULT_CONFIG.enabled_ops.div).toBe(true)
  })

  it('mode is "standard"', () => {
    expect(DEFAULT_CONFIG.mode).toBe('standard')
  })

  it('drill_tag and source_run_id are undefined', () => {
    expect(DEFAULT_CONFIG.drill_tag).toBeUndefined()
    expect(DEFAULT_CONFIG.source_run_id).toBeUndefined()
  })

  it('add ranges are correct', () => {
    expect(DEFAULT_CONFIG.ranges.add).toEqual({ min_a: 2, max_a: 100, min_b: 2, max_b: 100 })
  })

  it('sub ranges are correct', () => {
    expect(DEFAULT_CONFIG.ranges.sub).toEqual({ min_x: 2, max_x: 100, min_y: 2, max_y: 100 })
  })

  it('mul ranges are correct', () => {
    expect(DEFAULT_CONFIG.ranges.mul).toEqual({ min_a: 2, max_a: 12, min_b: 2, max_b: 100 })
  })

  it('div ranges are correct', () => {
    expect(DEFAULT_CONFIG.ranges.div).toEqual({ min_m: 2, max_m: 12, min_n: 2, max_n: 100 })
  })

  it('op_weights is undefined', () => {
    expect(DEFAULT_CONFIG.op_weights).toBeUndefined()
  })
})
