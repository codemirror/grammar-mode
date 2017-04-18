var modifiers = [
  "required", "optional", "repeated", "reserved", "default", "extensions", "packed"
]
var types = [
  "bool", "bytes", "double", "float", "string",
  "int32", "int64", "uint32", "uint64", "sint32", "sint64", "fixed32", "fixed64", "sfixed32", "sfixed64"
];

class Rule {
  constructor(name, code, isToken) {
    this.name = name
    this.code = code
    this.isToken = isToken
  }
}

const F = {F: true}, C = {C: true}

class Matcher {
  constructor(input) {
    this.pos = 0
    this.input = input
    this.stack = []
    this.callee = null
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

  backtrack(pos) {
    this.pos = pos
  }

  group(str) {
    if (this.pos < this.input.length && str.indexOf(this.input[this.pos]) > -1)
      this.pos++
    else
      return F
  }

  call(rule, success, failure) {
    this.stack.push(success, failure)
    this.callee = rule
    return C
  }

  callWith(rule, arg, success, failure) {
    this.stack.push(success, failure, arg)
    this.callee = rule
    return C
  }

  exec(rule) {
    this.stack.length = 0
    for (let next = rule.code, arg = null;;) {
      let result = next(this, arg)
      if (result == F) {
        if (this.stack.length == 0) return F
        next = this.stack.pop()
        this.stack.pop()
        arg = null
      } else if (result == C) {
        next = this.callee.code
        arg = null
      } else {
        if (this.stack.length == 0) return result
        this.stack.pop()
        next = this.stack.pop()
        arg = result
      }
    }
  }
}

const space = " \t\r\n"

function fail_0() {
  return F
}

function fail_1(m) {
  m.stack.pop()
  return F
}

function succeed_0(_, v) {
  return v
}

function succeed_1(m, v) {
  m.stack.pop()
  return v
}

const Program = new Rule("Program", Program_0)

function Program_0(m) {
  while (m.group(space) != F) {}
  return Program_1(m)
}

function Program_1(m) {
  return m.eof() == F ? m.call(Statement, Program_1, fail_0) : null
}

const Statement = new Rule("Statement", Statement_0)

function Statement_0(m) {
  m.stack.push(m.pos)
  return m.callWith(kw, "package", Statement_package_1, Statement_message)
}

function Statement_package_1(m) {
  return m.call(identifier, Statement_package_2, Statement_message)
}

function Statement_package_2(m) {
  return m.callWith(p, ";", succeed_1, Statement_message)
}

function Statement_message(m) {
  m.backtrack(m.stack.pop())
  return m.callWith(kw, "message", Statement_message_1, fail_0)
}

function Statement_message_1(m) {
  return m.call(identifier, Statement_message_2, fail_0)
}

function Statement_message_2(m) {
  return m.callWith(p, "{", Statement_message_3, fail_0)
}

function Statement_message_3(m) {
  return m.callWith(p, "}", succeed_0, Statement_message_4)
}

function Statement_message_4(m) {
  return m.call(Field, Statement_message_3, fail_0)
}

const Field = new Rule("Field", Field_0)

function Field_0(m) {
  m.stack.push(m.pos)
  return m.call(modifier, Field_1, Field_2)
}

function Field_1(m) {
  m.stack.pop()
  return Field_0(m)
}

function Field_2(m) {
  m.backtrack(m.stack.pop())
  return m.call(type, Field_3, fail_0)
}

function Field_3(m) {
  return m.call(identifier, Field_4, fail_0)
}

function Field_4(m) {
  return m.callWith(p, "=", Field_5, fail_0)
}

function Field_5(m) {
  return m.call(number, Field_6, fail_0)
}

function Field_6(m) {
  return m.callWith(p, ";", succeed_0, fail_0)
}

const identifier = new Rule("identifier", identifier_0, true)

function identifier_0(m) {
  let r = m.re(/\w+/)
  if (!r) return F
  let value = r[0]
  while (m.group(space) != F) {}
  return value
}

const kw = new Rule("kw", kw_0, true)

function kw_0(m) {
  return m.call(identifier, kw_1, fail_1)
}

function kw_1(m, ident) {
  return m.stack.pop() == ident ? null : F
}

const type = new Rule("type", type_0, true)

function type_0(m) {
  return m.call(identifier, type_1, fail_0)
}

function type_1(_, ident) {
  return types.indexOf(ident) > -1 ? null : F
}

const modifier = new Rule("modifier", modifier_0, true)

function modifier_0() {
  return m.call(identifier, modifier_1, fail_0)
}

function modifier_1(_, ident) {
  return modifiers.indexOf(ident) > -1 ? null : F
}

const p = new Rule("p", p_0, true)

function p_0(m) {
  if (m.str(m.stack.pop()) == F) return F
  while (m.group(space) != F) {}
}

const number = new Rule("number", number_0, true)

function number_0(m) {
  if (!m.re(/\d+/)) return F
  while (m.group(space) != F) {}
}

let m = new Matcher("package foo;\n\nmessage Address {\n  required string foo = 1;\n  optional int32 bar = 2;\n}\n")
console.log(m.exec(Program))
