export function itSome<T>(it: Iterable<T>, func: (a: T) => boolean) {
  for (const i of it) {
    if (func(i))
      return true
  }

  return false
}
