function escRe(str) {
  return str.replace(/[^\w ]/g, ch => {
    if (ch == "\n") return "\\n"
    if (ch == "\t") return "\\t"
    return "\\" + ch
  })
}

class StringMatch {
  constructor(string) {
    this.string = string
  }

  get isNull() { return false }

  get isolated() { return this.string == "\n" }

  eq(other) { return other instanceof StringMatch && other.string == this.string }

  regexp() { return escRe(this.string) }
}
exports.StringMatch = StringMatch

class RangeMatch {
  constructor(from, to) {
    this.from = from
    this.to = to
  }

  get isNull() { return false }

  get isolated() { return this.from <= "\n" && this.to >= "\n" }

  eq(other) { return other instanceof RangeMatch && other.from == this.from && other.to == this.to }

  regexp() { return "[" + escRe(this.from) + "-" + escRe(this.to) + "]" }
}
exports.RangeMatch = RangeMatch

const anyMatch = exports.anyMatch = new class AnyMatch {
  get isNull() { return false }
  get isolated() { return true }
  eq(other) { return other == anyMatch }
  regexp() { return "[^]" }
}

const dotMatch = exports.dotMatch = new class DotMatch {
  get isNull() { return false }
  get isolated() { return false }
  eq(other) { return other == dotMatch }
  regexp() { return "." }
}

const nullMatch = exports.nullMatch = new class NullMatch {
  get isNull() { return true }
  get isolated() { return false }
  eq(other) { return other == anyMatch }
  regexp() { return "" }
}

class SeqMatch {
  constructor(matches) {
    this.matches = matches
  }

  get isNull() { return false }

  get isolated() { return false }

  eq(other) { return other instanceof SeqMatch && eqArray(other.matches, this.matches) }

  regexp() { return this.matches.map(m => m.regexp()).join("") }

  static create(left, right) {
    if (left == nullMatch) return right
    if (right == nullMatch) return left

    let before = left instanceof SeqMatch ? left.matches : [left]
    let after = right instanceof SeqMatch ? right.matches : [right]
    let last = before[before.length - 1], first = after[0]

    if (last instanceof StringMatch && first instanceof StringMatch) {
      after[0] = new StringMatch(last.string + right.string)
      before.pop()
    } else if (first instanceof RepeatMatch && first.type == "*") {
      if (last.eq(first.match)) {
        after[0] = new RepeatMatch(last, "+")
        before.pop()
      } else if (first.match instanceof StringMatch && last instanceof StringMatch &&
                 new RegExp(first.match.regexp() + "$").test(last.string)) {
        after[0] = new RepeatMatch(first.match, "+")
        before[before.length - 1] = new StringMatch(last.string.slice(0, last.string.length - first.match.string.length))
      }
    }
    let matches = before.concat(after)
    return matches.length == 1 ? matches[0] : new SeqMatch(matches)
  }
}
exports.SeqMatch = SeqMatch

class ChoiceMatch {
  constructor(matches) {
    this.matches = matches
  }

  get isNull() { return false }

  get isolated() { return false }

  eq(other) { return other instanceof ChoiceMatch && eqArray(other.matches, this.matches) }

  regexp() {
    let set = ""
    for (let i = 0; i < this.matches.length; i++) {
      let match = this.matches[i]
      if (match instanceof StringMatch && match.string.length == 1) {
        set += escRe(match.string)
      } else if (match instanceof RangeMatch) {
        set += escRe(match.from) + "-" + escRe(match.to)
      } else {
        set = null
        break
      }
    }
    if (set != null) return "[" + set + "]"
    return "(?:" + this.matches.map(m => m.regexp()).join("|") + ")"
  }

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
  constructor(match, type) {
    this.match = match
    this.type = type
  }

  get isNull() { return false }

  get isolated() { return false }

  eq(other) { return other instanceof RepeatMatch && this.match.eq(other.match) && this.type == other.type }

  regexp() {
    if (this.match instanceof SeqMatch) return "(?:" + this.match.regexp() + ")" + this.type
    else return this.match.regexp() + this.type
  }
}
exports.RepeatMatch = RepeatMatch

class LookaheadMatch {
  constructor(start, positive) {
    this.start = start
    this.positive = positive
  }

  get isNull() { return true }

  get isolated() { return true }

  eq(other) { return other instanceof LookaheadMatch && other.start == this.start && other.positive == this.positive }

  regexp() { // Not actually a regexp, but used for graph output
    return "LOOKAHEAD(" + this.start + ")"
  }
}
exports.LookaheadMatch = LookaheadMatch

class SimpleLookaheadMatch {
  constructor(expr, positive) {
    this.expr = expr
    this.positive = positive
  }

  get isNull() { return true }

  get isolated() { return false }

  eq(other) { return other instanceof SimpleLookaheadMatch && other.expr.eq(this.expr) && other.positive == this.positive }

  regexp() {
    return "(?" + (this.positive ? "=" : "!") + this.expr.regexp() + ")"
  }
}
exports.SimpleLookaheadMatch = SimpleLookaheadMatch

let eqArray = exports.eqArray = function(a, b) {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (!a[i].eq(b[i])) return false
  return true
}
