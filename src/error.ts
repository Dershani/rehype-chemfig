export type ChemfigErrorCode = 'SYNTAX' | 'UNSUPPORTED' | 'LIMIT' | 'OPTIONS' | 'GEOMETRY';

export class ChemfigError extends Error {
  readonly name = 'ChemfigError';
  readonly line: number;
  readonly column: number;

  constructor(
    readonly code: ChemfigErrorCode,
    message: string,
    readonly source: string,
    readonly offset: number,
  ) {
    const before = source.slice(0, offset);
    const lines = before.split('\n');
    const line = lines.length;
    const column = (lines.at(-1)?.length ?? 0) + 1;
    super(`${message} (line ${line}, column ${column})`);
    this.line = line;
    this.column = column;
  }
}

type Limits = Record<'maxLength' | 'maxDepth' | 'maxAtoms' | 'maxBonds', number>;
export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  maxLength: 20_000,
  maxDepth: 32,
  maxAtoms: 1_000,
  maxBonds: 2_000,
});
const HARD_LIMITS = { maxLength: 200_000, maxDepth: 64, maxAtoms: 10_000, maxBonds: 20_000 };

export function resolveLimits(limits: import('./types.js').ParseLimits = {}): Limits {
  const result = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof typeof DEFAULT_LIMITS)[]) {
    const value = limits[key] ?? DEFAULT_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > HARD_LIMITS[key]) {
      throw new ChemfigError(
        'OPTIONS',
        `${key} must be an integer from 1 to ${HARD_LIMITS[key]}`,
        '',
        0,
      );
    }
    result[key] = value;
  }
  return result;
}
