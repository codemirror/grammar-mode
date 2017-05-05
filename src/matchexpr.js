class StringMatch {
  constructor(string) {
    this.string = string
  }

  toString() { return JSON.stringify(this.string) }

  get isNull() { return false }

  get matchesNewline() { return this.string == "\n" }

  eq(other) { return other instanceof StringMatch && other.string == this.string }
}
exports.StringMatch = StringMatch

class RangeMatch {
  constructor(from, to) {
    this.from = from
    this.to = to
  }

  toString() { return JSON.stringify(this.from) + "-" + JSON.stringify(this.to) }

  get isNull() { return false }

  get matchesNewline() { return this.from <= "\n" && this.to >= "\n" }

  eq(other) { return other instanceof RangeMatch && other.from == this.from && other.to == this.to }
}
exports.RangeMatch = RangeMatch

const anyMatch = exports.anyMatch = new class AnyMatch {
  toString() { return "_" }
  get isNull() { return false }
  get matchesNewline() { return true }
  eq(other) { return other == anyMatch }
}

const nullMatch = exports.nullMatch = new class NullMatch {
  toString() { return "ø" }
  get isNull() { return true }
  get matchesNewline() { return false }
  eq(other) { return other == anyMatch }
}

class SeqMatch {
  constructor(matches) {
    this.matches = matches
  }

  toString() { return this.matches.join(" ") }

  get isNull() { return false }

  get matchesNewline() { return false }

  eq(other) { return other instanceof SeqMatch && eqArray(other.matches, this.matches) }

  static create(left, right) {
    if (left == nullMatch) return right
    if (right == nullMatch) return left
    let matches = []
    if (left instanceof SeqMatch) matches = matches.concat(left.matches)
    else matches.push(left)
    let last = matches[matches.length - 1]
    if (right instanceof StringMatch && last instanceof StringMatch)
      matches[matches.length - 1] = new StringMatch(last.value + right.value)
    else if (right instanceof SeqMatch) matches = matches.concat(right.matches)
    else matches.push(right)
    if (matches.length == 1) return matches[0]
    else return new SeqMatch(matches)
  }
}
exports.SeqMatch = SeqMatch

class ChoiceMatch {
  constructor(matches) {
    this.matches = matches
  }

  toString() { return "(" + this.matches.join(" | ") + ")" }

  get isNull() { return false }

  get matchesNewline() { return false }

  eq(other) { return other instanceof ChoiceMatch && eqArray(other.matches, this.matches) }

  static create(left, right) {
    let matches = []
    if (left instanceof ChoiceMatch) matches = matches.concat(left.matches)
    else matches.push(left)
    if (right instanceof ChoiceMatch) matches = matches.concat(right.matches)
    else matches.push(right)
    return new ChoiceMatch(matches)
  }
}
exports.ChoiceMatch = ChoiceMatch

class RepeatMatch {
  constructor(match) {
    this.match = match
  }

  toString() { return this.match.toString() + "*" }

  get isNull() { return false }

  get matchesNewline() { return false }

  eq(other) { return other instanceof RepeatMatch && this.match.eq(other.match) }
}
exports.RepeatMatch = RepeatMatch

let eqArray = exports.eqArray = function(a, b) {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (!a[i].eq(b[i])) return false
  return true
}
