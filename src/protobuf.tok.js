class Stream {
  constructor(getLine, line, ch) {
    this.line = line
    this.ch = ch
    this.getLine = getLine
  }

  set(line, ch) {
    this.line = line
    this.ch = ch
  }

  get curLine() {
    return this.getLine(this.line)
  }

  get nextLine() {
    return this.getLine(this.line + 1)
  }

  lineForward() {
    if (this.nextLine == null) return false
    this.line++
    this.ch = 0
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

class Token {
  constructor(name, match) {
    this.name = name
    this.match = match
  }
}

let modifiers = ['required', 'optional', 'repeated', 'reserved', 'default', 'extensions', 'packed']
let types = ['bool', 'bytes', 'double', 'float', 'string', 'int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64', 'fixed32', 'fixed64', 'sfixed32', 'sfixed64']

const PACKAGE = new Token("package", stream => ID.match(stream) == "package")
const MESSAGE = new Token("message", stream => ID.match(stream) == "message")
const MODIFIER = new Token("modifier", stream => modifiers.indexOf(ID.match(stream)) > -1)
const TYPE = new Token("type", stream => types.indexOf(ID.match(stream)) > -1)
const ID = new Token("id", stream => { let m = stream.re(/^[a-z]\w*/i); return m && m[0] })
const NUMBER = new Token("number", stream => stream.re(/^\d+/))
const COMMENT = new Token("comment", stream => stream.re(/^\/\/.*/))

const tokens = [PACKAGE, MESSAGE, MODIFIER, TYPE, ID, NUMBER, COMMENT]

function punc(str) { return new Token(str, stream => stream.str(str)) }

function space(stream) { // FIXME include comments
  while (stream.group(" \n\r\t")) {}
}

const Program_0 = [PACKAGE, state => state.call(Statement_p_1, Program_0),
                   MESSAGE, state => state.call(Statement_m_1, Program_0)],
      Statement_p_1 = [ID, state => state.go(Statement_p_2)],
      Statement_p_2 = [punc(';'), state => state.ret()],
      Statement_m_1 = [ID, state => state.go(Statement_m_2)],
      Statement_m_2 = [punc('{'), state => state.go(Statement_m_3)],
      Statement_m_3 = [punc('}'), state => state.ret(),
                       MODIFIER, state => state.call(Field_1, Statement_m_3),
                       TYPE, state => state.call(Field_1, Statement_m_3)],
      Field_1 = [MODIFIER, state => state.go(Field_1),
                 TYPE, state => state.go(Field_2)],
      Field_2 = [ID, state => state.go(Field_3)],
      Field_3 = [punc('='), state => state.go(Field_4)],
      Field_4 = [NUMBER, state => state.go(Field_5)],
      Field_5 = [punc(';'), state => state.ret()]

class State {
  constructor(stack, context) {
    this.stack = stack
    this.context = context
  }

  step(stream) {
    let ch = stream.ch, line = stream.line
    for (let d = this.stack.length - 1; d >= 0; d--) {
      let next = this.stack[d]
      for (let i = 0; i < next.length; i += 2) {
        let token = next[i]
        if (token.match(stream)) {
          this.stack.length = d + 1
          next[i + 1](this)
          return token.name
        }
        stream.set(line, ch)
      }
    }
    for (let i = 0; i < tokens.length; i++) {
      let token = tokens[i]
      if (token.match(stream)) return token.name
      stream.set(line, ch)
    }
    stream.any()
    return null
  }

  call(next, ret) {
    let len = this.stack.length
    this.stack[len - 1] = ret
    this.stack[len] = next
  }

  go(next) {
    this.stack[this.stack.length - 1] = next
  }

  ret() {
    this.stack.pop()
  }
}

let lines = "package foo;\n\nmessage Address {\n  required string foo = 1;\n  optional int32 bar = 2;\n}\n".split("\n")

let stream = new Stream(n => lines[n], 0, 0)
let state = new State([Program_0], null)
for (;;) {
  space(stream)
  if (stream.line == lines.length - 1) break
  let l = stream.line, ch = stream.ch, tok = state.step(stream)
  console.log(tok, l, ch, "to", stream.line, stream.ch)
}
