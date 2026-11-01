// The Strategies screen data: every rule is well-formed, ids are unique, and the PR Sundar set is labelled honestly.
import { describe, expect, it } from 'vitest'
import { GROUPS, RULES } from '../src/ui/strategiesData'

describe('strategies data', () => {
  it('ids are unique and every rule belongs to a listed group', () => {
    const ids = RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    const groups = new Set(GROUPS.map((g) => g.id))
    for (const r of RULES) expect(groups.has(r.group)).toBe(true)
  })
  it('PR Sundar rules: a full set, attributed, tagged as his claims, with the two live setups wired to the board', () => {
    const mine = RULES.filter((r) => r.group === 'sundar')
    expect(mine.length).toBeGreaterThanOrEqual(12)
    for (const r of mine) {
      expect(r.who).toBe('PR Sundar')
      expect(r.evidence === 'claim' || r.evidence === undefined).toBe(true)
      expect(r.evidence === 'backtest' || r.evidence === 'study').toBe(false)
    }
    const live = mine.filter((r) => r.apply?.board === 'sundar').map((r) => r.id).sort()
    expect(live).toEqual(['sundar-ironfly', 'sundar-strangle'])
    // The honesty card is there and points at the SEBI order.
    const rec = mine.find((r) => r.id === 'sundar-record')!
    expect(rec.entry).toMatch(/SEBI/)
    expect(rec.source?.url).toMatch(/sebi\.gov\.in/)
  })
})
