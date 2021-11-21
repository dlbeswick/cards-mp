/*
 * Copyright (c) 2021 David Beswick.
 *
 * This file is part of cards-mp 
 * (see https://github.com/dlbeswick/cards-mp).
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */
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
