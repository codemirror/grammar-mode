// TODO:
//
// - CodeMirror integration
// - Compiler
// - Sliding cache/token array
// - Don't make whitespace part of tokens or rules
// - Reconsider rule return values and conditions

var modifiers = [
  "required", "optional", "repeated", "reserved", "default", "extensions", "packed"
]
var types = [
  "bool", "bytes", "double", "float", "string",
  "int32", "int64", "uint32", "uint64", "sint32", "sint64", "fixed32", "fixed64", "sfixed32", "sfixed64"
];

class Rule {
  constructor(name, code, tokenType = null) {
    this.name = name
    this.code = code
    this.tokenType = tokenType
  }

  get cached() {
    return this.tokenType != null
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
  while (m.stream.group(space)) {}
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
  return m.stream.eof() || F
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

const identifier = new Rule("identifier", identifier_0, "variable")

function identifier_0(m) {
  let r = m.stream.re(/^[a-z]\w*/i)
  if (!r) return F
  let value = r[0]
  while (m.stream.group(space)) {}
  return value
}

const kw = new Rule("kw", kw_0, "keyword")

function kw_0(m) {
  return m.call(identifier, kw_1)
}

function kw_1(m, ident) {
  return m.arg == ident ? null : F
}

const type = new Rule("type", type_0, "variable-2")

function type_0(m) {
  return m.call(identifier, type_1)
}

function type_1(_, ident) {
  return types.indexOf(ident) > -1 ? null : F
}

const modifier = new Rule("modifier", modifier_0, "keyword")

function modifier_0() {
  return m.call(identifier, modifier_1)
}

function modifier_1(_, ident) {
  return modifiers.indexOf(ident) > -1 ? null : F
}

const p = new Rule("p", p_0)

function p_0(m) {
  if (!m.stream.str(m.arg)) return F
  while (m.stream.group(space)) {}
}

const number = new Rule("number", number_0, "number")

function number_0(m) {
  if (!m.stream.re(/^\d+/)) return F
  while (m.stream.group(space)) {}
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
  m.stream.any()
  while (m.stream.group(space)) {}
}

function anyTokens(m) {
  if (!m.stream.eof()) return m.call(anyToken, anyTokens)
}

class Match {
  constructor(rule, arg, line, ch, parent) {
    this.rule = rule
    this.arg = arg
    this.line = line
    this.ch = ch
    this.parent = parent
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
  constructor(line, ch, isLookahead, frameDepth, next, recover) {
    this.line = line
    this.ch = ch
    this.isLookahead = isLookahead
    this.frameDepth = frameDepth
    this.next = next
    this.recover = recover
  }
}

const MIN_SAVE_DISTANCE = 15, MAX_BACKTRACK_LINES = 10

class Stream {
  constructor(getLine, startLine, startCh) {
    this.line = startLine
    this.ch = startCh
    this.getLine = getLine
    this.curLine = getLine(startLine)
    this._nextLine = undefined
  }

  get nextLine() {
    if (this._nextLine === undefined) {
      let next = this.getLine(this.line + 1)
      this._nextLine = next === undefined ? null : next
    }
    return this._nextLine
  }

  goTo(line, ch) {
    if (line != this.line) {
      this.line = line
      this.curLine = this.getLine(line)
      this._nextLine = undefined
    }
    this.ch = ch
  }

  lineForward() {
    let next = this.nextLine
    if (next == null) return false
    this.line++
    this.ch = 0
    this.curLine = next
    this._nextLine = undefined
    return true
  }

  re(re) {
    let match = re.exec(this.curLine.slice(this.ch))
    if (match) this.ch += match[0].length
    return match || false
  }

  str(string) { // FIXME newlines
    if (this.curLine.slice(this.ch, this.ch + string.length) == string) {
      this.ch += string.length
      return true
    } else {
      return false
    }
  }

  eof() {
    return this.ch == this.curLine.length && this.nextLine == null
  }

  any() {
    if (this.ch == this.curLine.length) {
      return this.lineForward()
    } else {
      this.ch++
      return true
    }
  }

  group(str) {
    if (this.ch == this.curLine.length) {
      return str.indexOf("\n") > -1 && this.lineForward()
    } else if (str.indexOf(this.curLine[this.ch]) > -1) {
      this.ch++
      return true
    } else {
      return false
    }
  }
}

class ModeMatcher {
  constructor(stream) {
    this.stream = stream
    // :: [Frame]
    this.stack = []
    // :: [BacktrackFrame]
    this.backtrackStack = []
    this.callee = null
    this.frontierStack = null
    this.frontierBacktrack = null
    this.frontierLine = -1
    this.frontierCh = -1
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

  setBacktrack(next, recover, lookahead) {
    this.backtrackStack.push(new BacktrackFrame(this.stream.line, this.stream.ch, lookahead, this.stack.length, next, recover))
  }

  call(rule, next) {
    return this.callWith(rule, F, next)
  }

  callWith(rule, arg, next) {
    let match = rule.cached ? new Match(rule, arg == F ? null : arg, this.stream.line, this.stream.ch, this.currentMatch) : null
    this.stack.push(new Frame(match, arg, next))
    this.callee = rule
    return C
  }

  exec(startRule, onAdvance) {
    let result = C
    this.callee = startRule
    for (;;) {
      if (result === C) {
        result = this.callee.code(this)
      } else if (result === F) {
        let backtrack
        do {
          backtrack = this.backtrackStack.pop()
          // FIXME will backtrack across long lines
        } while (backtrack && backtrack.line < this.stream.line - MAX_BACKTRACK_LINES)
        if (backtrack) {
          if (!this.skipping &&
              !backtrack.isLookahead &&
              (this.stream.line > this.frontierLine || this.stream.line == this.frontierLine && this.ch > this.frontierCh) &&
              (this.stream.line > backtrack.line || this.stream.ch > backtrack.ch + MIN_SAVE_DISTANCE)) {
            this.frontierStack = this.stack.slice()
            this.frontierBacktrack = this.backtrackStack.concat(backtrack)
            this.frontierLine = this.stream.line
            this.frontierCh = this.stream.ch
          }
          this.stream.goTo(backtrack.line, backtrack.ch)
          this.stack.length = backtrack.frameDepth
          result = backtrack.next(this)
        } else if (!this.frontierStack) {
          result = anyTokens(this)
        } else {
          if (onAdvance(this) === false) return
          this.stack = this.frontierStack.slice()
          this.stream.goTo(this.frontierLine, this.frontierCh)
          this.skipping = true
          result = this.call(anyToken, m => {
            m.skipping = false
            m.backtrackStack = m.frontierBacktrack.slice()
            m.frontierLine = this.stream.line
            m.frontierCh = this.stream.ch
            for (let i = 0; i < m.backtrackStack.length; i++) {
              let bt = m.backtrackStack[i]
              bt.line = m.stream.line
              bt.ch = m.stream.ch
              if (bt.recover) {
                m.backtrackStack.splice(++i, 0, new BacktrackFrame(m.stream.line, m.stream.ch, false, bt.frameDepth, bt.recover))
                bt.recover = null
              }
            }
            return F
          })
        }
      } else if (this.stack.length == 0) {
        if (onAdvance(this) === false) return
        this.callee = startRule
        result = C
      } else {
        if (onAdvance(this) === false) return
        result = this.stack.pop().next(this, result)
      }
    }
  }
}

let lines = "package foo;\n\nmessage Address {\n  required string foo = 1-\n  optional int32 bar = 2;\n}\n".split("\n")

let m = new ModeMatcher(new Stream(n => lines[n], 0, 0))
m.exec(Program, m => m.stream.line < lines.length - 1)
