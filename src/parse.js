const {tokTypes: tt, parse, plugins} = require("acorn")

// FIXME Get rid of Acorn now that no actual JavaScript can appear in these files anymore?

function parseGrammar(p, node) {
  node.rules = Object.create(null)
  while (p.type != tt.eof) {
    if (p.eatContextual("skip")) {
      let skip = parseExprChoice(p)
      p.expect(tt.braceL)
      while (!p.eat(tt.braceR))
        parseRule(p, node.rules, false, skip)
    } else if (p.eatContextual("tokens")) {
      p.expect(tt.braceL)
      while (!p.eat(tt.braceR))
        parseRule(p, node.rules, true, null)
    } else {
      parseRule(p, node.rules, false, null)
    }
  }
  return p.finishNode(node, "GrammarDeclaration")
}

function parseRule(p, rules, isToken, skip) {
  let node = p.startNode()
  node.isToken = isToken
  // FIXME Storing the same sub-ast in multiple nodes is a rather
  // weird way to build an AST
  node.skip = skip
  node.id = p.parseIdent(true)
  node.params = []
  if (p.eat(tt.parenL)) while (!p.eat(tt.parenR))
    node.params.push(p.parseIdent(true))
  if (isToken && node.params.length > 0)
    p.raise(node.params[0].start, "Token rules must not take parameters")
  if (node.id.name in rules)
    p.raise(node.id.start, `Duplicate rule declaration '${node.id.name}'`)
  rules[node.id.name] = node
  node.context = p.eat(tt.star)
  node.tokenType = null
  p.expect(tt.braceL)
  node.expr = parseExprChoice(p)
  p.expect(tt.braceR)
  if (!node.context && p.eat(tt.eq)) {
    if (p.type != tt.string) p.unexpected()
    node.tokenType = p.value
    p.next()
  }
  return p.finishNode(node, "RuleDeclaration")
}

function parseExprInner(p) {
  if (p.eat(tt.parenL)) {
    let expr = parseExprChoice(p)
    p.expect(tt.parenR)
    return expr
  } else if (p.type == tt.string) {
    let node = p.startNode(), value = p.value
    p.next()
    if (p.type == tt.plusMin && p.value == "-" && value.length == 1) {
      p.next()
      if (p.type != tt.string || p.value.length != 1) p.unexpected()
      node.from = value
      node.to = p.value
      p.next()
      return p.finishNode(node, "CharacterRange")
    } else {
      node.value = value
      return p.finishNode(node, "StringMatch")
    }
  } else {
    let node = p.startNode()
    if (p.type == tt.name && p.value == "_") {
      p.next()
      return p.finishNode(node, "AnyMatch")
    }
    node.id = p.parseIdent(true)
    node.arguments = []
    if (p.start == p.lastTokEnd && p.eat(tt.parenL)) while (!p.eat(tt.parenR))
      node.arguments.push(parseExprChoice(p))
    return p.finishNode(node, "RuleIdentifier")
  }
}

function parseExprSuffix(p) {
  let start = p.start
  let expr = parseExprInner(p)
  if (p.type == tt.star || p.type == tt.question || p.type == tt.plusMin && p.value == "+") {
    let node = p.startNodeAt(start)
    node.expr = expr
    node.kind = p.type == tt.question ? "?" : p.type == tt.star ? "*" : p.value
    p.next()
    return p.finishNode(node, "RepeatedMatch")
  }
  return expr
}

function parseExprLookahead(p) {
  if (p.type == tt.prefix && (p.value == "!" || p.value == "~")) {
    let node = p.startNode()
    node.kind = p.value
    p.next()
    node.expr = parseExprSuffix(p)
    return p.finishNode(node, "LookaheadMatch")
  } else {
    return parseExprSuffix(p)
  }
}

function endOfSequence(p) {
  return p.type == tt.braceR || p.type == tt.parenR || p.type == tt.bitwiseOR || p.type == tt.braceL
}

function parseExprSequence(p) {
  let start = p.start, first = parseExprLookahead(p)
  if (endOfSequence(p)) return first
  let node = p.startNodeAt(start)
  node.exprs = [first]
  do { node.exprs.push(parseExprLookahead(p)) }
  while (!endOfSequence(p))
  return p.finishNode(node, "SequenceMatch")
}

function parseExprChoice(p) {
  let start = p.start, left = parseExprSequence(p)
  if (!p.eat(tt.bitwiseOR)) return left
  let node = p.startNodeAt(start)
  node.exprs = [left]
  do { node.exprs.push(parseExprSequence(p)) }
  while (p.eat(tt.bitwiseOR))
  return p.finishNode(node, "ChoiceMatch")
}

plugins.modeGrammar = function(parser) {
  parser.extend("parseTopLevel", () => function(node) {
    return parseGrammar(this, node)
  })
}

module.exports = function(file) {
  return parse(file, {
    plugins: {modeGrammar: true}
  })
}
