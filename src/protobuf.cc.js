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

const identifier = new Rule("identifier", identifier_0, "variable")

function identifier_0(m) {
  let r = m.re(/^[a-z]\w*/i)
  if (r == F) return F
  let value = r[0]
  while (m.group(space) != F) {}
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
  if (m.str(m.arg) == F) return F
  while (m.group(space) != F) {}
}

const number = new Rule("number", number_0, "number")

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

class ModeMatcher {
  constructor(getLine, startLine = 0, startCh = 0) {
    this.line = startLine
    this.ch = startCh
    this.getLine = getLine
    this.lineStr = getLine(startLine)
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

  goTo(line, ch) {
    if (line != this.line) {
      this.line = line
      this.lineStr = this.getLine(line)
    }
    this.ch = ch
  }

  nextLine() {
    let next = this.getLine(this.line + 1)
    if (next == null) return false
    this.line++
    this.ch = 0
    this.lineStr = next
    return true
  }

  re(re) {
    let match = re.exec(this.lineStr.slice(this.ch))
    if (match) this.ch += match[0].length
    return match || F
  }

  str(string) { // FIXME newlines
    if (this.lineStr.slice(this.ch, this.ch + string.length) == string)
      this.ch += string.length
    else
      return F
  }

  eof() {
    return this.ch == this.lineStr.length && this.getLine(this.line + 1) == null ? null : F
  }

  any() {
    if (this.ch == this.lineStr.length)
      return this.nextLine() ? null : F
    else
      this.ch++
  }

  group(str) {
    if (this.ch == this.lineStr.length)
      return str.indexOf("\n") > -1 && this.nextLine() ? null : F
    else if (str.indexOf(this.lineStr[this.ch]) > -1)
      this.ch++
    else
      return F
  }

  setBacktrack(next, recover, lookahead) {
    this.backtrackStack.push(new BacktrackFrame(this.line, this.ch, lookahead, this.stack.length, next, recover))
  }

  call(rule, next) {
    return this.callWith(rule, F, next)
  }

  callWith(rule, arg, next) {
    let match = rule.cached ? new Match(rule, arg == F ? null : arg, this.line, this.ch, this.currentMatch) : null
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
        } while (backtrack && backtrack.line < this.line - MAX_BACKTRACK_LINES)
        if (backtrack) {
          if (!this.skipping &&
              !backtrack.isLookahead &&
              (this.line > this.frontierLine || this.line == this.frontierLine && this.ch > this.frontierCh) &&
              (this.line > backtrack.line || this.ch > backtrack.ch + MIN_SAVE_DISTANCE)) {
            this.frontierStack = this.stack.slice()
            this.frontierBacktrack = this.backtrackStack.concat(backtrack)
            this.frontierLine = this.line
            this.frontierCh = this.ch
          }
          this.goTo(backtrack.line, backtrack.ch)
          this.stack.length = backtrack.frameDepth
          result = backtrack.next(this)
        } else if (!this.frontierStack) {
          result = anyTokens(this)
        } else {
          if (onAdvance(this) === false) return
          this.stack = this.frontierStack.slice()
          this.goTo(this.frontierLine, this.frontierCh)
          this.skipping = true
          result = this.call(anyToken, m => {
            m.skipping = false
            m.backtrackStack = m.frontierBacktrack.slice()
            m.frontierLine = this.line
            m.frontierCh = this.ch
            for (let i = 0; i < m.backtrackStack.length; i++) {
              let bt = m.backtrackStack[i]
              bt.line = m.line
              bt.ch = m.ch
              if (bt.recover) {
                m.backtrackStack.splice(++i, 0, new BacktrackFrame(m.line, m.ch, false, bt.frameDepth, bt.recover))
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

let m = new ModeMatcher(n => lines[n], 0, 0)
m.exec(Program, m => m.line < lines.length - 1)
