var modifiers = [
  "required", "optional", "repeated", "reserved", "default", "extensions", "packed"
]
var types = [
  "bool", "bytes", "double", "float", "string",
  "int32", "int64", "uint32", "uint64", "sint32", "sint64", "fixed32", "fixed64", "sfixed32", "sfixed64"
];

const F = {F: true}, C = {C: true}

class Matcher {
  constructor(input) {
    this._pos = 0
    this._input = input
    this._stack = []
    this._callee = null
  }

  _re(re) {
    let match = re.exec(this._input.slice(this._pos))
    if (match) this._pos += match[0].length
    return match || F
  }

  _str(string) {
    if (this._input.slice(this._pos, this._pos + string.length) == string)
      this._pos += string.length
    else
      return F
  }

  eof() {
    return this._pos == this._input.length ? null : F
  }

  _backtrack(pos) {
    this._pos = pos
  }

  _group(str) {
    if (this._pos < this._input.length && str.indexOf(this._input[this._pos]) > -1)
      this._pos++
    else
      return F
  }

  _call(callee, onSucc, onFail) {
    this._stack.push(onSucc, onFail)
    this._callee = callee
    return C
  }

  _exec(rule) {
    this._stack.length = 0
    for (let next = rule, arg = null;;) {
      let result = next.call(this, arg)
      console.log("call @", this._pos, next.name || next.toString().slice(0, 15), "=>", result == C ? "call " + (this._callee.name || this._callee.toString().slice(0, 15)) : result)
      if (result == F) {
        if (this._stack.length == 0) return F
        next = this._stack.pop()
        this._stack.pop()
        arg = null
      } else if (result == C) {
        next = this._callee
        arg = null
      } else {
        if (this._stack.length == 0) return result
        this._stack.pop()
        next = this._stack.pop()
        arg = result
      }
    }
  }
}

const space = " \t\r\n"

function fail_0() {
  return F
}

function succeed_0(v) {
  return v
}

function succeed_1(v) {
  this._stack.pop()
  return v
}

class ProtobufMatcher extends Matcher {
  Program() {
    while (this._group(space) != F) {}
    return this.Program_1()
  }

  Program_1() {
    if (this.eof() != F) return
    return this._call(this.Statement, this.Program_1, fail_0)
  }

  Statement() {
    this._stack.push(this._pos)
    return this._call(function() { return this.kw("package"); }, this.Statement_package_1, this.Statement_message)
  }

  Statement_package_1() {
    return this._call(this.identifier, this.Statement_package_2, this.Statement_message)
  }

  Statement_package_2() {
    return this._call(function() { return this.p(";") }, succeed_1, this.Statement_message)
  }

  Statement_message() {
    this._backtrack(this._stack.pop())
    return this._call(function() { return this.kw("message"); }, this.Statement_message_1, fail_0)
  }

  Statement_message_1() {
    return this._call(this.identifier, this.Statement_message_2, fail_0)
  }

  Statement_message_2() {
    return this._call(function() { return this.p("{") }, this.Statement_message_3, fail_0)
  }

  Statement_message_3() {
    return this._call(function() { return this.p("}") }, succeed_0, this.Statement_message_4)
  }

  Statement_message_4() {
    return this._call(this.Field, this.Statement_message_3, fail_0)
  }

  Field() {
    this._stack.push(this._pos)
    return this._call(this.modifier, this.Field_1, this.Field_2)
  }

  Field_1() {
    this._stack.pop()
    return this.Field()
  }

  Field_2() {
    this._backtrack(this._stack.pop())
    return this._call(this.type, this.Field_3, fail_0)
  }

  Field_3() {
    return this._call(this.identifier, this.Field_4, fail_0)
  }

  Field_4() {
    return this._call(function() { return this.p("=") }, this.Field_5, fail_0)
  }

  Field_5() {
    return this._call(this.number, this.Field_6, fail_0)
  }

  Field_6() {
    return this._call(function() { return this.p(";") }, succeed_0, fail_0)
  }

  identifier() {
    let r = this._re(/\w+/)
    if (!r) return F
    let value = r[0]
    while (this._group(space) != F) {}
    return value
  }

  kw(value) {
    return this._call(this.identifier, function(val) { if (val != value) return F }, fail_0)
  }

  type() {
    return this._call(this.identifier, function(val) { if (types.indexOf(val) == -1) return F }, fail_0)
  }

  modifier() {
    return this._call(this.identifier, function(val) { if (modifiers.indexOf(val) == -1) return F }, fail_0)
  }

  p(value) {
    if (this._str(value) == F) return F
    while (this._group(space) != F) {}
  }

  number() {
    if (!this._re(/\d+/)) return F
    while (this._group(space) != F) {}
  }
}


let m = new ProtobufMatcher("package foo;\n\nmessage Address {\n  required string foo = 1;\n  optional int32 bar = 2;\n}\n")
console.log(m._exec(m.Program))
