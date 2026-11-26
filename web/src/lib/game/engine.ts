import { DEFAULT_CONFIG } from '../../types';
import type { OpKey, SessionConfig, Problem, KeystrokeEvent } from '../../types';

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function sampleOp(rng: () => number, config: SessionConfig): OpKey {
  const enabled = (Object.entries(config.enabled_ops) as [OpKey, boolean][])
    .filter(([, on]) => on)
    .map(([key]) => key);
  if (enabled.length === 0) throw new Error('No operations enabled');

  const weights = enabled.map(op => config.op_weights?.[op] ?? 1);
  const total = weights.reduce((a, b) => a + b, 0);

  let r = rng() * total;
  for (let i = 0; i < enabled.length; i++) {
    r -= weights[i];
    if (r <= 0) return enabled[i];
  }
  return enabled[enabled.length - 1];
}

export function generateProblem(rng: () => number, op: OpKey, config: SessionConfig): Problem {
  const defaultRanges = DEFAULT_CONFIG.ranges;

  switch (op) {
    case 'add': {
      const r = config.ranges.add ?? defaultRanges.add!;
      const a = randInt(rng, r.min_a, r.max_a);
      const b = randInt(rng, r.min_b, r.max_b);
      return {
        op,
        operand_a: a,
        operand_b: b,
        display_prompt: `${a} + ${b}`,
        expected_answer: a + b,
      };
    }
    case 'sub': {
      const r = config.ranges.sub ?? defaultRanges.sub!;
      const x = randInt(rng, r.min_x, r.max_x);
      const y = randInt(rng, r.min_y, r.max_y);
      // display: "(x+y) - x", answer: y
      return {
        op,
        operand_a: x + y,
        operand_b: x,
        display_prompt: `${x + y} - ${x}`,
        expected_answer: y,
      };
    }
    case 'mul': {
      const r = config.ranges.mul ?? defaultRanges.mul!;
      const a = randInt(rng, r.min_a, r.max_a);
      const b = randInt(rng, r.min_b, r.max_b);
      return {
        op,
        operand_a: a,
        operand_b: b,
        display_prompt: `${a} × ${b}`,
        expected_answer: a * b,
      };
    }
    case 'div': {
      const r = config.ranges.div ?? defaultRanges.div!;
      const m = randInt(rng, r.min_m, r.max_m);
      const n = randInt(rng, r.min_n, r.max_n);
      // display: "(m*n) ÷ m", answer: n
      return {
        op,
        operand_a: m * n,
        operand_b: m,
        display_prompt: `${m * n} ÷ ${m}`,
        expected_answer: n,
      };
    }
  }
}

export function normalizeKey(raw: string): KeystrokeEvent['normalized_key'] {
  if (raw === 'paste') return 'paste';
  if (raw === 'Backspace') return 'backspace';
  if (raw.length === 1 && raw >= '0' && raw <= '9') return 'digit';
  return 'other';
}

export function parseConfigFromQuery(param: string | null): SessionConfig {
  if (!param) return DEFAULT_CONFIG;
  try {
    const decoded = JSON.parse(atob(param)) as SessionConfig;
    validateConfig(decoded);
    return decoded;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function encodeConfigToQuery(config: SessionConfig): string {
  return btoa(JSON.stringify(config));
}

export function validateConfig(config: SessionConfig): true {
  if (!config || typeof config !== 'object') {
    throw new Error('Config must be an object');
  }

  if (typeof config.duration_sec !== 'number' || config.duration_sec < 10 || config.duration_sec > 600) {
    throw new Error('duration_sec must be between 10 and 600');
  }

  if (!config.enabled_ops || typeof config.enabled_ops !== 'object') {
    throw new Error('enabled_ops must be an object');
  }

  const hasEnabled = Object.values(config.enabled_ops).some(Boolean);
  if (!hasEnabled) {
    throw new Error('At least one operation must be enabled');
  }

  if (config.ranges && typeof config.ranges === 'object') {
    const { add, sub, mul, div } = config.ranges;

    if (add) {
      if (add.min_a > add.max_a) throw new Error('add: min_a must be <= max_a');
      if (add.min_b > add.max_b) throw new Error('add: min_b must be <= max_b');
      if (add.min_a < 1 || add.min_b < 1) throw new Error('add ranges must be positive');
    }
    if (sub) {
      if (sub.min_x > sub.max_x) throw new Error('sub: min_x must be <= max_x');
      if (sub.min_y > sub.max_y) throw new Error('sub: min_y must be <= max_y');
      if (sub.min_x < 1 || sub.min_y < 1) throw new Error('sub ranges must be positive');
    }
    if (mul) {
      if (mul.min_a > mul.max_a) throw new Error('mul: min_a must be <= max_a');
      if (mul.min_b > mul.max_b) throw new Error('mul: min_b must be <= max_b');
      if (mul.min_a < 1 || mul.min_b < 1) throw new Error('mul ranges must be positive');
    }
    if (div) {
      if (div.min_m > div.max_m) throw new Error('div: min_m must be <= max_m');
      if (div.min_n > div.max_n) throw new Error('div: min_n must be <= max_n');
      if (div.min_m < 1 || div.min_n < 1) throw new Error('div ranges must be positive');
    }
  }

  return true;
}
