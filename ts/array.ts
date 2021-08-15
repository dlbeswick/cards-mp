import { assert } from './assert.js'

export function range(i: number) {
  return Array(i).fill(undefined)
}

export function equals(lhs: readonly any[], rhs: readonly any[]) {
  if (lhs.length != rhs.length)
    return false

  for (let i = 0; i < lhs.length; ++i)
    if (lhs[i] != rhs[i])
      return false
  
  return true
}

// Remove the first occurrance of the given element from the array
export function remove(ary: readonly any[], el: any) {
  const idx = ary.indexOf(el)
  assert(idx != -1, "OOB remove from array")
  return ary.slice(0, idx).concat(ary.slice(idx+1))
}

function sort_default(a:any, b:any) {
  return a - b
}

export function sorted<T>(e: Iterable<T>, sort: (a:T, b:T) => number = sort_default): T[] {
  return Array.from(e).sort(sort)
}

export function sorted_by<T, U>(
  ary: readonly T[],
  sort_by: (a:T) => U,
  sort: (a:U, b:U) => number = sort_default): T[] {
  
  const result =
    ary.
    map((el,i) => [sort_by(el), i] as [U, number]).
    sort((a,b) => sort(a[0], b[0]))
  return result.map((_, i) => ary[i])
}

export function group_by<T,G>(
  ary: readonly T[],
  group: (a:T) => G,
  sort:(a:G, b:G) => number = sort_default): [G,T[]][] {
  
  if (ary.length == 0)
    return []
  
  const result:[G,T[]][] = []
  let s = sorted_by(ary, group, sort)
  
  const g = group(s[0])
  while (s.length) {
    const accum = [] as T[]
    for (const el of s) {
      const g_ = group(el)
      if (sort(g, g) == 0) {
        accum.push(el)
      } else {
        result.push([g,accum])
        s = s.slice(accum.length)
      }
    }
  }
  return result
}

export function distinct<T>(ary: readonly T[], sort: (a:T, b:T) => number = sort_default): T[] {
  if (ary.length == 0)
    return []
  
  let s = sorted(ary, sort)

  const result = [s[0]]
  
  for (const el of s.slice(1)) {
    if (sort(el, result[result.length-1]) != 0)
      result.push(el)
  }
  
  return result
}
