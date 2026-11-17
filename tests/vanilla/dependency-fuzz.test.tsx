import { expect, it } from 'vitest'
import { atom } from 'jotai/vanilla'
import type { Atom, PrimitiveAtom } from 'jotai/vanilla'
import {
  INTERNAL_buildStoreRev4 as INTERNAL_buildStore,
  INTERNAL_getBuildingBlocksRev4 as INTERNAL_getBuildingBlocks,
  INTERNAL_initializeStoreHooksRev4 as INTERNAL_initializeStoreHooks,
  INTERNAL_KEY_atomStateMap as KEY_atomStateMap,
  INTERNAL_KEY_mountedMap as KEY_mountedMap,
  INTERNAL_KEY_storeHooks as KEY_storeHooks,
  INTERNAL_KEY_unflushedMounts as KEY_unflushedMounts,
} from 'jotai/vanilla/internals'

const createRandom = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

const PRIMITIVES = 5
const DERIVED = 4

const run = (seed: number, steps: number) => {
  const random = createRandom(seed)
  const int = (n: number) => Math.floor(random() * n)
  const storeHooks = INTERNAL_initializeStoreHooks({})
  const store = INTERNAL_buildStore({ [KEY_storeHooks]: storeHooks })
  const buildingBlocks = INTERNAL_getBuildingBlocks(store)
  const mountedMap = buildingBlocks[KEY_mountedMap]
  const atomStateMap = buildingBlocks[KEY_atomStateMap]
  const unflushedMounts = buildingBlocks[KEY_unflushedMounts]

  type Counts = { m: number; u: number; onMount: number; onUnmount: number }
  const counts = new Map<Atom<unknown>, Counts>()
  const watch = (a: Atom<unknown>) => {
    const c: Counts = { m: 0, u: 0, onMount: 0, onUnmount: 0 }
    counts.set(a, c)
    storeHooks.m.add(a, () => void c.m++)
    storeHooks.u.add(a, () => void c.u++)
    return c
  }
  const primitives: PrimitiveAtom<number>[] = []
  for (let i = 0; i < PRIMITIVES; i++) {
    const a = atom(i)
    const c = watch(a)
    a.onMount = () => {
      c.onMount++
      return () => void c.onUnmount++
    }
    primitives.push(a)
  }
  const selectors = Array.from({ length: DERIVED }, () => atom(0))
  selectors.forEach(watch)
  const derived: Atom<number>[] = []
  for (let i = 0; i < DERIVED; i++) {
    const a = atom((get) => {
      const k = get(selectors[i]!)
      let v = get(primitives[k % PRIMITIVES]!)
      if (i > 0 && k % 3 === 0) {
        v += get(derived[i - 1]!)
      }
      if (k % 2 === 1) {
        v += get(atom((get) => get(primitives[(k + 1) % PRIMITIVES]!)))
      }
      return v
    })
    watch(a)
    derived.push(a)
  }
  const expected = (i: number): number => {
    const k = store.get(selectors[i]!)
    let v = store.get(primitives[k % PRIMITIVES]!)
    if (i > 0 && k % 3 === 0) {
      v += expected(i - 1)
    }
    if (k % 2 === 1) {
      v += store.get(primitives[(k + 1) % PRIMITIVES]!)
    }
    return v
  }
  const subs: { i: number; unsub: () => void }[] = []
  const check = (where: string) => {
    expect(unflushedMounts.size, `${where}: unflushed mounts`).toBe(0)
    for (const [a, c] of counts) {
      const mounted = mountedMap.has(a) ? 1 : 0
      expect(c.m - c.u, `${where}: mount hooks`).toBe(mounted)
      if (primitives.includes(a as PrimitiveAtom<number>)) {
        expect(c.onMount - c.onUnmount, `${where}: onMount`).toBe(mounted)
      }
    }
    for (const a of derived) {
      const mounted = mountedMap.get(a)
      if (mounted) {
        const deps = new Set(atomStateMap.get(a)!.d.keys())
        expect(new Set(mounted.d), `${where}: mounted.d`).toEqual(deps)
        for (const dep of deps) {
          expect(mountedMap.get(dep)?.t.has(a), `${where}: mounted.t`).toBe(
            true,
          )
        }
      }
    }
    for (const { i } of subs) {
      expect(store.get(derived[i]!), `${where}: value`).toBe(expected(i))
    }
  }
  for (let step = 0; step < steps; step++) {
    const op = int(10)
    if (op <= 1) {
      const entry = { i: int(DERIVED), unsub: () => {} }
      const unsubWhenNotified = int(6) === 0
      entry.unsub = store.sub(derived[entry.i]!, () => {
        const index = subs.indexOf(entry)
        if (unsubWhenNotified && index >= 0) {
          subs.splice(index, 1)
          entry.unsub()
        }
      })
      subs.push(entry)
    } else if (op === 2 && subs.length) {
      subs.splice(int(subs.length), 1)[0]!.unsub()
    } else if (op === 3) {
      store.set(selectors[int(DERIVED)]!, int(12))
    } else if (op === 4) {
      store.set(primitives[int(PRIMITIVES)]!, int(100))
    } else {
      const plan = Array.from({ length: 1 + int(6) }, () => [
        int(4),
        int(DERIVED),
        int(12),
        int(PRIMITIVES),
        int(100),
      ])
      store.set(
        atom(null, (get, set) => {
          for (const [kind, i, k, j, v] of plan) {
            if (kind === 0) {
              set(selectors[i!]!, k!)
            } else if (kind === 1) {
              set(primitives[j!]!, v!)
            } else if (kind === 2) {
              get(derived[i!]!)
            } else {
              store.get(derived[i!]!)
            }
          }
        }),
      )
    }
    check(`seed ${seed} step ${step}`)
  }
  subs.splice(0).forEach(({ unsub }) => unsub())
  check(`seed ${seed} end`)
}

it('keeps values and mounted state consistent under random operations', () => {
  for (let seed = 1; seed <= 30; seed++) {
    expect(() => run(seed, 300)).not.toThrow()
  }
})
