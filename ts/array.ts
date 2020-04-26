import { assert, assertf } from './assert.js'

export function range(i:number) {
  return Array(i).fill(undefined)
}

export function equals(lhs:any[], rhs:any[]) {
  if (lhs.length != rhs.length)
    return false

  for (let i = 0; i < lhs.length; ++i)
    if (lhs[i] != rhs[i])
      return false
  
  return true
}

export function remove(ary:any[], el:any) {
  const idx = ary.indexOf(el)
  assert(idx != -1, "OOB remove from array")
  return ary.slice(0, idx).concat(ary.slice(idx+1))
}

