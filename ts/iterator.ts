export function some<T>(it: Iterable<T>, func: (a: T) => boolean) {
  for (const i of it) {
    if (func(i))
      return true
  }

  return false
}

export function *filter<T, U>(it: Iterable<T>, func: (a: T) => U) {
  for (const i of it) {
    if (func(i))
      yield i
  }
}

export function *map<T, U>(it: Iterable<T>, func: (a: T) => U) {
  for (const i of it) {
    yield func(i)
  }
}

export function *flatMap<T, U>(it: Iterable<T>, func: (a: T) => Array<U>) {
  for (const i of it) {
    for (const j of func(i))
      yield j
  }
}
