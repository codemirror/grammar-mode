const {tokTypes: tt, parse, plugins} = require("acorn")

function parseGrammar(p) {
  let node = p.startNode()
  p.next()
  node.id = p.parseIdent()
  node.rules = []
  node.whitespace = null
  p.expect(tt.braceL)
  while (!p.eat(tt.braceR)) {
    if (p.eatContextual("rules"))
      parseRules(p, node.rules, false, true)
    else if (p.eatContextual("tokens"))
      parseRules(p, node.rules, true, true)
    else if (p.eatContextual("helpers"))
      parseRules(p, node.rules, true, false)
    else if (p.isContextual("whitespace"))
      node.whitespace = parseRule(p, true, false)
  }
  checkDuplicate(p, node.rules)
  return p.finishNode(node, "GrammarDeclaration")
}

function checkDuplicate(p, rules) {
  for (let i = 0; i < rules.length; i++) {
    let name = rules[i].id.name
    for (let j = i + 1; j < rules.length; j++) {
      if (rules[j].id.name == name)
        p.raise(rules[j].id.start, `Duplicate rule name '${name}'`)
    }
  }
}

function parseRules(p, rules, lexical, significant) {
  p.expect(tt.braceL)
  while (!p.eat(tt.braceR))
    rules.push(parseRule(p, lexical, significant))
}

function parseRule(p, lexical, significant) {
  let node = p.startNode()
  node.lexical = lexical
  node.significant = significant
  node.id = p.parseIdent(true)
  p.expect(tt.braceL)
  node.expr = parseExprChoice(p)
  p.expect(tt.braceR)
  if (p.eat(tt.arrow))
    p.parseFunctionBody(node, true)
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
    if (p.type == tt.name && p.value == "_") {
      p.next()
      return p.finishNode(node, "AnyMatch")
    }
    node.id = p.parseIdent(true)
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
  return p.type == tt.braceR || p.type == tt.parenR || p.type == tt.bitwiseOR
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
  parser.extend("parseStatement", inner => function(decl, topLevel, exports) {
    if (topLevel && decl && this.isContextual("grammar"))
      return parseGrammar(this)
    else
      return inner.call(this, decl, topLevel, exports)
  })
}

module.exports = function(file) {
  return parse(file, {
    plugins: {modeGrammar: true}
  })
}
