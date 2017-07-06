module.exports = function(file, fileName) {
  return parseGrammar(new Input(file, fileName), 0)
}

class Node {
  constructor(type, start, props, end) {
    this.type = type
    this.start = start
    this.end = end
    if (props) for (let prop in props) this[prop] = props[prop]
  }
}

const wordChar = /[\w_$]/

class Input {
  constructor(string, fileName) {
    this.string = string
    this.fileName = fileName
    this.type = "sof"
    this.value = null
    this.start = this.end = this.lastEnd = 0
    this.next()
  }

  lineInfo(pos) {
    for (let line = 1, cur = 0;;) {
      let next = this.string.indexOf("\n", cur)
      if (next > -1 && next < pos) {
        ++line
        cur = next + 1
      } else {
        return {line, ch: pos - cur, fileName: this.fileName}
      }
    }
  }

  raise(msg, pos) {
    let info = this.lineInfo(pos)
    throw new SyntaxError(`${msg} (${info.fileName ? info.fileName + " " : ""}${info.line}:${info.ch})`)
  }

  match(pos, re) {
    let match = re.exec(this.string.slice(pos))
    return match ? pos + match[0].length : -1
  }

  next() {
    this.lastEnd = this.end
    let start = this.match(this.end, /^(\s|\/\/.*|\/\*[^]*?\*\/)*/)
    if (start == this.string.length) return this.set("eof", null, start, start)

    let next = this.string[start]
    if (next == '"') {
      let end = this.match(start + 1, /^(\\.|[^"])*"/)
      if (end == -1) this.raise("Unterminated string literal", start)
      return this.set("string", JSON.parse(this.string.slice(start, end)), start, end)
    } else if (/[()|&~!\-+*?{}\.,=]/.test(next)) {
      return this.set(next, null, start, start + 1)
    } else if (wordChar.test(next)) {
      let end = start + 1
      while (end < this.string.length && wordChar.test(this.string[end])) end++
      return this.set("id", this.string.slice(start, end), start, end)
    } else {
      this.raise("Unexpected character " + JSON.stringify(next), start)
    }
  }

  set(type, value, start, end) {
    this.type = type
    this.value = value
    this.start = start
    this.end = end
  }

  startNode(type, props) {
    return new Node(type, this.start, props)
  }

  finishNode(node, type) {
    if (type != null) node.type = type
    node.end = this.lastEnd
    return node
  }

  eat(type, value) {
    if (this.type == type && (value == null || this.value === value)) {
      this.next()
      return true
    } else {
      return false
    }
  }

  unexpected() {
    this.raise(`Unexpected token '${this.string.slice(this.start, this.end)}'`, this.start)
  }
}

function parseGrammar(input) {
  let node = input.startNode("GrammarDeclaration", {
    rules: Object.create(null),
    extends: null,
    included: []
  })

  for (;;) {
    let start = input.start
    if (input.eat("id", "extends")) {
      if (node.extends) input.raise("Can't extend multiple grammars", start)
      if (input.type != "string") input.unexpected()
      node.extends = input.value
      input.next()
    } else if (input.eat("id", "include")) {
      let inclNode = new Node("IncludeDeclaration", start)
      if (input.type != "string") input.unexpected()
      inclNode.value = input.value
      input.next()
      if (!input.eat("id", "as")) input.unexpected()
      inclNode.id = parseIdent(input)
      node.included.push(input.finishNode(inclNode))
    } else {
      break
    }
  }

  while (input.type != "eof") {
    if (input.eat("id", "skip")) {
      let skipExpr = parseExprChoice(input)
      if (!input.eat("{")) input.unexpected()
      while (!input.eat("}"))
        parseRule(input, node.rules, false, skipExpr)
    } else if (input.eat("id", "tokens")) {
      if (!input.eat("{")) input.unexpected()
      while (!input.eat("}"))
        parseRule(input, node.rules, true, null)
    } else {
      parseRule(input, node.rules, false, null)
    }
  }
  return input.finishNode(node)
}

function parseRule(input, rules, isToken, skip) {
  let node = input.startNode("RuleDeclaration", {
    isToken,
    // FIXME Storing the same sub-ast in multiple nodes is a rather
    // weird way to build an AST
    skip,
    context: input.eat("id", "context"),
    start: input.eat("id", "start"),
    id: parseIdent(input),
    tokenType: null,
    params: []
  })
  if (node.id.name in rules)
    input.raise(`Duplicate rule declaration '${node.id.name}'`, node.id.start)
  rules[node.id.name] = node

  if (input.eat("(")) while (!input.eat(")")) {
    if (node.params.length && !input.eat(",")) input.unexpected()
    node.params.push(parseIdent(input))
  }
  if (isToken && node.params.length > 0)
    input.raise("Token rules must not take parameters", node.params[0].start)
  if (input.eat("=")) {
    if (input.type != "string") input.unexpected()
    node.tokenType = input.value
    input.next()
    node.context = true
  }
  if (!input.eat("{")) input.unexpected()
  node.expr = parseExprChoice(input)
  if (!input.eat("}")) input.unexpected()
  return input.finishNode(node)
}

function parseExprInner(input) {
  if (input.eat("(")) {
    let expr = parseExprChoice(input)
    if (!input.eat(")")) input.unexpected()
    return expr
  }

  let node = input.startNode()
  if (input.type == "string") {
    let value = input.value
    input.next()
    if (value.length == 1 && input.eat("-")) {
      if (input.type != "string" || input.value.length != 1) input.unexpected()
      node.from = value
      node.to = input.value
      input.next()
      return input.finishNode(node, "CharacterRange")
    } else {
      if (value.length == 0) input.raise("Empty strings are not valid in grammars", node.start)
      node.value = value
      return input.finishNode(node, "StringMatch")
    }
  } else if (input.eat("id", "super")) {
    return input.finishNode(node, "SuperMatch")
  } else if (input.eat("&")) {
    node.id = parseIdent(input)
    return input.finishNode(node, "PredicateMatch")
  } else if (input.eat("id", "_")) {
    return input.finishNode(node, "AnyMatch")
  } else if (input.eat(".")) {
    return input.finishNode(node, "DotMatch")
  } else {
    node.id = parseDottedIdent(input)
    node.arguments = []
    if (input.start == node.id.end && input.eat("(")) while (!input.eat(")")) {
      if (node.arguments.length && !input.eat(",")) input.unexpected()
      node.arguments.push(parseExprChoice(input))
    }
    return input.finishNode(node, "RuleIdentifier")
  }
}

function parseExprSuffix(input) {
  let start = input.start
  let expr = parseExprInner(input)
  if (input.type == "*" || input.type == "?" || input.type == "+") {
    let node = new Node("RepeatedMatch", start, {
      expr,
      kind: input.type
    }, input.end)
    input.next()
    return node
  }
  return expr
}

function parseExprLookahead(input) {
  if (input.type == "!" || input.type == "~") {
    let node = input.startNode("LookaheadMatch", {kind: input.type})
    input.next()
    node.expr = parseExprSuffix(input)
    return input.finishNode(node)
  } else {
    return parseExprSuffix(input)
  }
}

function endOfSequence(input) {
  return input.type == "}" || input.type == ")" || input.type == "|" || input.type == "{" || input.type == ","
}

function parseExprSequence(input) {
  let start = input.start, first = parseExprLookahead(input)
  if (endOfSequence(input)) return first
  let node = new Node("SequenceMatch", start, {exprs: [first]})
  do { node.exprs.push(parseExprLookahead(input)) }
  while (!endOfSequence(input))
  return input.finishNode(node)
}

function parseExprChoice(input) {
  let start = input.start, left = parseExprSequence(input)
  if (!input.eat("|")) return left
  let node = new Node("ChoiceMatch", start, {exprs: [left]})
  do { node.exprs.push(parseExprSequence(input)) }
  while (input.eat("|"))
  return input.finishNode(node)
}

function parseIdent(input) {
  if (input.type != "id") input.unexpected()
  let node = input.startNode("Identifier", {name: input.value})
  input.next()
  return input.finishNode(node)
}

function parseDottedIdent(input) {
  if (input.type != "id") input.unexpected()
  let node = input.startNode("Identifier", {name: input.value})
  input.next()
  while (input.start == input.lastEnd && input.eat(".")) {
    if (input.type != "id") input.unexpected()
    node.name += "." + input.value
    input.next()
  }
  return input.finishNode(node)
}
