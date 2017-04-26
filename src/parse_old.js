const acorn = require("acorn")

exports.parseGrammars = function(file, fileName) {
  let re = /\n\s*grammar\s+([\w$]+)\s+\{/g, match, grammars = {}
  while (match = re.exec(file)) {
    let parser = new GrammarParser(file, fileName, match.index + match[0].length)
    let rules = parser.parseRuleSet(), grammar = {
      name: match[1],
      firstRule: rules.length && rules[0].name,
      rules: {},
      start: match.index + 1, end: parser.pos
    }
    rules.forEach(r => grammar.rules[r.name] = r)
    grammars[match[1]] = grammar
  }
  return grammars
}

const acornOptions = {allowReturnOutsideFunction: true}

class GrammarParser {
  constructor(input, fileName, pos) {
    this.input = input
    this.fileName = fileName
    this.pos = pos
    this.tokenStart = pos
    this.tokenType = this.tokenValue = null
    this.nextToken()
  }

  skipSpace() {
    while (this.pos < this.input.length) {
      let next = this.input[this.pos]
      if (next == "/" && this.input[this.pos + 1] == "/") {
        this.pos += 2
        while (this.pos < this.input.length && !isNewline(this.input[this.pos])) this.pos++
      } else if (/\s/.test(next)) {
        this.pos++
      } else {
        break
      }
    }
  }

  nextToken() {
    this.skipSpace()
    if (this.pos == this.input.length) {
      this.tokenType = "eof"
      this.tokenValue = null
      return
    }
    let start = this.tokenStart = this.pos, next = this.input[this.pos++]
    if (identifierChar(next)) {
      while (this.pos < this.input.length && identifierChar(this.input[this.pos])) this.pos++
      this.tokenType = "identifier"
      this.tokenValue = this.input.slice(start, this.pos)
    } else if (/[\[\]{}()?|*+:!=]/.test(next)) {
      this.tokenType = "punctuation"
      this.tokenValue = next
    } else if (next == '"' || next == "'") {
      let quote = next
      for (;;) {
        if (this.pos == this.input.length) this.raise("Unterminated string literal")
        next = this.input[this.pos++]
        if (next == "\\" && this.pos < this.input.length) this.pos++
        if (next == quote) break
      }
      this.tokenType = "string"
      this.tokenValue = JSON.parse(this.input.slice(start, this.pos))
    } else if (next == "/") {
      for (;;) {
        if (this.pos == this.input.length) this.raise("Unterminated regexp")
        next = this.input[this.pos++]
        if (next == "\\" && this.pos < this.input.length) this.pos++
        if (next == "/") break
      }
      let re = this.input.slice(start + 1, this.pos - 1), flagStart = this.pos
      while (this.pos < this.input.length && /\w/.test(this.input[this.pos])) this.pos++
      this.tokenType = "regexp"
      this.tokenValue = new RegExp(`^(?:${re})`, this.input.slice(flagStart, this.pos))
    } else {
      this.raise(`Unexpected character '${next}'`)
    }
  }

  ident() {
    if (this.tokenType != "identifier") this.raise("Expected identifier")
    let value = this.tokenValue
    this.nextToken()
    return value
  }

  is(punc) {
    return this.tokenType == "punctuation" && this.tokenValue == punc
  }

  eat(punc) {
    if (this.is(punc)) {
      this.nextToken()
      return true
    } else {
      return false
    }
  }

  expect(punc) {
    if (!this.eat(punc)) this.raise(`Expected '${punc}'`)
  }

  find(pos) {
    let line = 1, lineStart = 0
    for (;;) {
      let next = this.input.indexOf("\n", lineStart)
      if (next == -1 || next >= pos) break
      line++
      lineStart = next + 1
    }
    return {line, ch: pos - lineStart}
  }

  raise(err) {
    let {line, ch} = this.find(this.tokenStart)
    throw new SyntaxError(`${err} (${this.fileName ? this.fileName + " " : ""}${line}:${ch})`)
  }

  jsBlock() {
    if (!this.is("{")) this.raise("Expected JavaScript block")
    let p = new acorn.Parser(acornOptions, this.input, this.pos - 1)
    p.nextToken()
    let block = p.parseBlock()
    this.pos = p.start
    this.nextToken()
    return {ast: block.body, string: this.input.slice(block.start + 1, block.end - 1)}
  }

  jsArgs() {
    let p = new acorn.Parser(acornOptions, this.input, this.pos - 1)
    p.nextToken()
    let array = p.parseExprAtom()
    this.pos = p.start
    this.nextToken()
    return {ast: array.elements, string: this.input.slice(array.start + 1, array.end - 1)}
  }

  parseExpression() {
    let start = this.parseSequenceExpression()
    if (!this.eat("|")) return start
    let choices = [start]
    do { choices.push(this.parseSequenceExpression()) }
    while (this.eat("|"))
    return {type: "choice", choices}
  }

  endOfSequence() {
    return this.tokenType == "punctuation" &&
      /^[|)}]$/.test(this.tokenValue)
  }

  parseSequenceExpression() {
    let first = this.parseSubscriptExpression()
    if (this.endOfSequence()) return first
    let exprs = [first]
    do { exprs.push(this.parseSubscriptExpression()) }
    while (!this.endOfSequence())
    return {type: "sequence", exprs}
  }

  parseSubscriptExpression() {
    let expr = this.parsePrimaryExpression()

    while (this.eat(":"))
      expr = {type: "test", test: this.jsBlock(), expr}

    for (;;) {
      if (this.eat("*"))
        expr = {type: "repeat", min: 0, max: -1, expr}
      else if (this.eat("+"))
        expr = {type: "repeat", min: 1, max: -1, expr}
      else if (this.eat("?"))
        expr = {type: "repeat", min: 0, max: 1, expr}
      else
        break
    }

    if (this.eat("!"))
      expr = {type: "until", expr, until: this.parseExpression()}

    return expr
  }

  parsePrimaryExpression() {
    if (this.tokenType == "string" || this.tokenType == "regexp") {
      let value = {type: this.tokenType, value: this.tokenValue}
      this.nextToken()
      return value
    }

    if (this.tokenType == "identifier") {
      let value = {type: "apply", rule: this.tokenValue}
      this.nextToken()
      if (this.eat("="))
        return {type: "binding", name: value.rule, expr: this.parseExpression()}
      value.args = this.is("[") ? this.jsArgs() : null
      return value
    }

    if (this.eat("(")) {
      let inside = this.parseExpression()
      this.expect(")")
      return inside
    }

    if (this.eat(":"))
      return {type: "test", test: this.jsBlock(), expr: null}

    this.raise("Unexpected token")
  }

  parseRule() {
    let name = this.ident(), params = []
    if (this.eat("[")) {
      if (!this.is("]")) {
        do { params.push(this.ident()) }
        while (this.eat(","))
      }
      this.expect("]")
    }
    this.expect("{")
    let expr = this.parseExpression(), body = null
    this.expect("}")
    if (this.is("{")) body = this.jsBlock()
    return {name, expr, body, params}
  }

  parseRuleSet() {
    let rules = []
    while (!this.is("}")) rules.push(this.parseRule())
    return rules
  }
}

function isNewline(ch) { return ch == "\n" || ch == "\r" }

function identifierChar(ch) { return /\w/.test(ch) }
