var modifiers = [
  "required", "optional", "repeated", "reserved", "default", "extensions", "packed"
]
var types = [
  "bool", "bytes", "double", "float", "string",
  "int32", "int64", "uint32", "uint64", "sint32", "sint64", "fixed32", "fixed64", "sfixed32", "sfixed64"
];

class Rule {
  constructor(name, code, isToken = false) {
    this.name = name
    this.code = code
    this.isToken = isToken
  }

  get cached() {
    return this.isToken
  }
}

const F = {F: true}, C = {C: true}

const space = " \t\r\n"

function succeed(_, v) {
  return v
}

function succeed_drop(m, v) {
  m.backtrackStack.pop()
  return v
}

const Program = new Rule("Program", Program_0)

function Program_0(m) {
  while (m.group(space) != F) {}
  return Program_1(m)
}

function Program_1(m) {
  m.setBacktrack(Program_3, Program_1)
  return m.call(Statement, Program_2)
}

function Program_2(m) {
  m.backtrackStack.pop()
  return Program_1(m)
}

function Program_3(m) {
  return m.eof()
}

const Statement = new Rule("Statement", Statement_0)

function Statement_0(m) {
  m.setBacktrack(Statement_message)
  return m.callWith(kw, "package", Statement_package_1)
}

function Statement_package_1(m) {
  return m.call(identifier, Statement_package_2)
}

function Statement_package_2(m) {
  return m.callWith(p, ";", succeed_drop)
}

function Statement_message(m) {
  return m.callWith(kw, "message", Statement_message_1)
}

function Statement_message_1(m) {
  return m.call(identifier, Statement_message_2)
}

function Statement_message_2(m) {
  return m.callWith(p, "{", Statement_message_3)
}

function Statement_message_3(m) {
  m.setBacktrack(Statement_message_5, Statement_message_3)
  return m.call(Field, Statement_message_4)
}

function Statement_message_4(m) {
  m.backtrackStack.pop()
  return Statement_message_3(m)
}

function Statement_message_5(m) {
  return m.callWith(p, "}", succeed)
}

const Field = new Rule("Field", Field_0)

function Field_0(m) {
  m.setBacktrack(Field_2, Field_0)
  return m.call(modifier, Field_1)
}

function Field_1(m) {
  m.backtrackStack.pop()
  return Field_0(m)
}

function Field_2(m) {
  return m.call(type, Field_3)
}

function Field_3(m) {
  return m.call(identifier, Field_4)
}

function Field_4(m) {
  return m.callWith(p, "=", Field_5)
}

function Field_5(m) {
  return m.call(number, Field_6)
}

function Field_6(m) {
  return m.callWith(p, ";", succeed)
}

const identifier = new Rule("identifier", identifier_0, true)

function identifier_0(m) {
  let r = m.re(/^[a-z]\w*/i)
  if (r == F) return F
  let value = r[0]
  while (m.group(space) != F) {}
  return value
}

const kw = new Rule("kw", kw_0, true)

function kw_0(m) {
  return m.call(identifier, kw_1)
}

function kw_1(m, ident) {
  return m.arg == ident ? null : F
}

const type = new Rule("type", type_0, true)

function type_0(m) {
  return m.call(identifier, type_1)
}

function type_1(_, ident) {
  return types.indexOf(ident) > -1 ? null : F
}

const modifier = new Rule("modifier", modifier_0, true)

function modifier_0() {
  return m.call(identifier, modifier_1)
}

function modifier_1(_, ident) {
  return modifiers.indexOf(ident) > -1 ? null : F
}

const p = new Rule("p", p_0, true)

function p_0(m) {
  if (m.str(m.arg) == F) return F
  while (m.group(space) != F) {}
}

const number = new Rule("number", number_0, true)

function number_0(m) {
  if (m.re(/^\d+/) == F) return F
  while (m.group(space) != F) {}
}

const anyToken = new Rule("anyToken", anyToken_0)

function anyToken_0(m) {
  m.setBacktrack(anyToken_1)
  return m.call(number, succeed_drop)
}

function anyToken_1(m) {
  m.setBacktrack(anyToken_2)
  return m.call(identifier, succeed_drop)
}

function anyToken_2(m) {
  m.any()
  while (m.group(space) != F) {}
}

function anyTokens(m) {
  if (m.eof() == F) return m.call(anyToken, anyTokens)
}

class Match {
  constructor(rule, arg, start, parent) {
    this.rule = rule
    this.arg = arg
    this.start = start
    this.parent = parent
    this.end = -1
    this.value = null
  }
}

class Frame {
  constructor(match, arg, next) {
    this.match = match
    this.arg = arg
    this.next = next
  }
}

class BacktrackFrame {
  constructor(pos, isLookahead, frameDepth, next, recover) {
    this.pos = pos
    this.isLookahead = isLookahead
    this.frameDepth = frameDepth
    this.next = next
    this.recover = recover
  }
}

const MIN_SAVE_DISTANCE = 15

class ModeMatcher {
  constructor(input) {
    this.pos = 0
    this.input = input
    // :: [Frame]
    this.stack = []
    // :: [BacktrackFrame]
    this.backtrackStack = []
    this.callee = null
    this.cache = []
    this.frontierStack = null
    this.frontierBacktrack = null
    this.frontierPos = -1
    this.skipping = false
  }

  get currentMatch() {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      let m = this.stack[i].match
      if (m) return m
    }
  }

  get arg() {
    return this.stack[this.stack.length - 1].arg
  }

  re(re) {
    let match = re.exec(this.input.slice(this.pos))
    if (match) this.pos += match[0].length
    return match || F
  }

  str(string) {
    if (this.input.slice(this.pos, this.pos + string.length) == string)
      this.pos += string.length
    else
      return F
  }

  eof() {
    return this.pos == this.input.length ? null : F
  }

  any() {
    if (this.pos == this.input.length) return F
    this.pos++
  }

  setBacktrack(next, recover, lookahead) {
    this.backtrackStack.push(new BacktrackFrame(this.pos, lookahead, this.stack.length, next, recover))
  }

  group(str) {
    if (this.pos < this.input.length && str.indexOf(this.input[this.pos]) > -1)
      this.pos++
    else
      return F
  }

  getMatch(rule, arg) {
    let cached = this.cache[this.pos]
    if (cached) for (let i = 0; i < cached.length; i++)
      if (cached[i].rule === rule && cached[i].arg === arg) return cached[i]
  }

  call(rule, next) {
    return this.callWith(rule, F, next)
  }

  callWith(rule, arg, next) {
    let match
    if (rule.cached) {
      let argVal = arg == F ? null : arg
      let cached = this.getMatch(rule, argVal)
      if (cached) {
        cached.parent = this.currentMatch
        this.pos = cached.end
        return next(this, cached.value)
      }
      match = new Match(rule, argVal, this.pos, this.currentMatch)
    }
    this.stack.push(new Frame(match, arg, next))
    this.callee = rule
    return C
  }

  exec(startRule, upto) {
    let result = C
    this.callee = startRule
    for (;;) {
      if (result === C) {
        result = this.callee.code(this)
      } else if (result === F) {
        let backtrack = this.backtrackStack.pop()
        if (backtrack) {
          if (!this.skipping &&
              !backtrack.isLookahead && this.pos > this.frontierPos &&
              this.pos > backtrack.pos + MIN_SAVE_DISTANCE) {
            this.frontierStack = this.stack.slice()
            this.frontierBacktrack = this.backtrackStack.concat(backtrack)
            this.frontierPos = this.pos
          }
          this.pos = backtrack.pos
          this.stack.length = backtrack.frameDepth
          result = backtrack.next(this)
        } else if (!this.frontierStack) {
          result = anyTokens(this)
        } else {
          if (this.pos >= upto) return
          this.stack = this.frontierStack.slice()
          this.pos = this.frontierPos
          this.skipping = true
          result = this.call(anyToken, m => {
            m.skipping = false
            m.backtrackStack = m.frontierBacktrack.slice()
            m.frontierPos = this.pos
            for (let i = 0; i < m.backtrackStack.length; i++) {
              let bt = m.backtrackStack[i]
              bt.pos = m.pos
              if (bt.recover) {
                m.backtrackStack.splice(++i, 0, new BacktrackFrame(m.pos, false, bt.frameDepth, bt.recover))
                bt.recover = null
              }
            }
            return F
          })
        }
      } else if (this.stack.length == 0) {
        if (this.pos >= upto) return
        this.callee = startRule
        result = C
      } else {
        if (this.pos > upto) return
        let frame = this.stack.pop(), match = frame.match
        if (match) {
          match.end = this.pos
          match.value = result
          ;(this.cache[match.start] || (this.cache[match.start] = [])).push(match)
        }
        result = frame.next(this, result)
      }
    }
  }
}

let m = new ModeMatcher("package foo;\n\nmessage Address {\n  required string foo = 1-\n  optional int32 bar = 2;\n}\n")
m.exec(Program, m.input.length)
