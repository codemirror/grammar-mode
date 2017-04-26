const {tokTypes: tt, parse, plugins} = require("acorn")

function parseGrammar(p) {
  let node = p.startNode()
  p.next()
  node.name = p.parseIdent()
  node.rules = []
  node.whitespace = null
  p.expect(tt.braceL)
  while (!p.eat(tt.braceR)) {
    if (p.eatContextual("rules"))
      parseRules(p, node.rules, true)
    else if (p.eatContextual("tokens"))
      parseRules(p, node.rules, false)
    else if (p.eatContextual("helpers"))
      parseRules(p, node.rules, false)
    else if (p.eatContextual("whitespace"))
      node.whitespace = parseRule(p)
  }
  return p.finishNode(node, "GrammarDeclaration")
}

function parseRules(p, rules, lexical) {
  p.expect(tt.braceL)
  while (!p.eat(tt.braceR)) {
    let node = p.startNode()
    node.lexical = lexical
    node.name = p.parseIdent()
    node.expr = parseRule(p)
    if (p.eat(tt.arrow))
      p.parseFunctionBody(node, true)
    rules.push(p.finishNode(node, "RuleDeclaration"))
  }
}

function parseRule(p) {
  p.expect(tt.braceL)
  let expr = parseExprChoice(p)
  p.expect(tt.braceR)
  return expr
}

function parseExprInner(p) {
  if (p.eat(tt.parenL)) {
    let expr = parseExprChoice(p)
    p.expect(tt.parenR)
    return expr
  } else if (p.type == tt.string) {
    let node = p.startNode(), value = p.value
    p.next()
    if (p.type == tt.plusMin && p.value == "-") {
      p.next()
      if (p.type != tt.string) p.unexpected()
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
    node.name = p.parseIdent(true)
    return p.finishNode(node, "RuleIdentifier")
  }
}

function parseExprSuffix(p) {
  let start = p.start
  let expr = parseExprInner(p)
  if (p.type == tt.star || p.type == tt.question || p.type == tt.plusMin && p.value == "+") {
    let node = p.startNodeAt(start)
    node.expr = expr
    node.repeat = p.value
    p.next()
    return p.finishNode(node, "RepeatedRule")
  }
  return expr
}

function parseExprLookahead(p) {
  if (p.type == tt.prefix && (p.value == "!" || p.value == "~")) {
    let node = p.startNode()
    node.type = p.value
    p.next()
    node.expr = parseExprSuffix(p)
    return p.finishNode(node, "LookaheadRule")
  } else {
    return parseExprSuffix(p)
  }
}

function endOfSequence(p) {
  return p.type == tt.braceR || p.type == tt.parenR || p.type == tt.bitwiseOR
}

function parseExprSequence(p) {
  let start = p.start, first = parseExprLookahead(p)
  if (endOfSequence(p)) return first
  let node = p.startNodeAt(start)
  node.exprs = [first]
  do { node.exprs.push(parseExprLookahead(p)) }
  while (!endOfSequence(p))
  return p.finishNode(node, "RuleSequence")
}

function parseExprChoice(p) {
  let start = p.start, left = parseExprSequence(p)
  if (!p.eat(tt.bitwiseOR)) return left
  let node = p.startNodeAt(start)
  node.choices = [left]
  do { node.choices.push(parseExprSequence(p)) }
  while (p.eat(tt.bitwiseOR))
  return p.finishNode(node, "RuleChoice")
}

plugins.modeGrammar = function(parser) {
  parser.extend("parseStatement", inner => function(decl, topLevel, exports) {
    if (topLevel && decl && this.isContextual("grammar"))
      return parseGrammar(this)
    else
      return inner.call(this, decl, topLevel, exports)
  })
}

function p(file) {
  return parse(file, {
    plugins: {modeGrammar: true}
  })
}

console.log(p(require("fs").readFileSync("./protobuf.in.js")))
