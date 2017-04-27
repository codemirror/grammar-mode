module.exports = function(ast, file) {
  let result = file
  for (let i = ast.body.length - 1; i >= 0; i--) {
    let node = ast.body[i]
    if (node.type == "GrammarDeclaration")
      result = result.slice(0, node.start) + compileGrammar(node, file) + result.slice(node.end)
  }
  return result
}

class Node {
  constructor(label) {
    this.label = label || getLabel()
    this.incoming = []
    this.outgoing = []
  }

  toString() { return this.label }
}

class Edge {
  constructor(from, to, match, effects) {
    this.from = from
    this.to = to
    this.match = match
    this.effects = effects || []
  }

  toString() {
    let effects = this.effects.map(e => e[0] + (e[1] ? " " + e[1] : "")).join(" ")
    return `${this.from} -> ${this.to}[label=${JSON.stringify(this.match.toString() + (effects ? " " + effects : ""))}]`
  }

  static create(from, to, match, effects) {
    let edge = new Edge(from, to, match, effects)
    from.outgoing.push(edge)
    to.incoming.push(edge)
    return edge
  }
}

class Match {
  constructor(ast) { this.ast = ast }
}

class StringMatch extends Match {
  constructor(ast, string) {
    super(ast)
    this.string = string
  }

  toString() { return JSON.stringify(this.string) }
}

class RangeMatch extends Match {
  constructor(ast, from, to) {
    super(ast)
    this.from = from
    this.to = to
  }

  toString() { return JSON.stringify(this.from) + "-" + JSON.stringify(this.to) }
}

class AnyMatch extends Match {
  toString() { return "_" }
}

class NullMatch extends Match {
  toString() { return "ø" }
}

function createGraph(grammar) {
  let rules = Object.create(null), first = null
  for (let i = 0; i < grammar.rules.length; i++) {
    let rule = grammar.rules[i]
    rules[rule.id.name] = {ast: rule, graph: null}
    if (first == null && !rule.lexical) first = rule.id.name
  }
  return getRuleGraph(rules, first)
}

let curLabel, curLabelId
function withLabels(label, f) {
  let prevLabel = curLabel, prevId = curLabelId
  curLabel = label
  curLabelId = 0
  f()
  curLabel = prevLabel
  curLabelId = prevId
}

function getLabel() {
  return curLabel + curLabelId++
}

function buildRuleGraph(rule, rules) {
  withLabels(rule.ast.id.name, () => {
    let start = new Node, end = new Node
    rule.graph = {start, end}
    buildExprGraph(start, end, rule.ast.expr, rules)
  })
}

function getRuleGraph(rules, name) {
  let rule = rules[name]
  if (!rule) throw new SyntaxError("Rule '" + name + "' is not defined")
  if (!rule.graph) buildRuleGraph(rule, rules)
  return rule.graph
}

function buildExprGraph(start, end, expr, rules) {
  let t = expr.type
  if (t == "CharacterRange") {
    Edge.create(start, end, new RangeMatch(expr, expr.from, expr.to))
  } else if (t == "StringMatch") {
    Edge.create(start, end, new StringMatch(expr, expr.value))
  } else if (t == "AnyMatch") {
    Edge.create(start, end, new AnyMatch(expr))
  } else if (t == "RuleIdentifier") {
    let subGraph = getRuleGraph(rules, expr.id.name)
    Edge.create(start, subGraph.start, new NullMatch(expr), [["call", expr.id.name, end]])
    Edge.create(subGraph.end, end, new NullMatch(expr), [["return"]])
  } else if (t == "RepeatedMatch") {
    if (expr.kind == "*") {
      Edge.create(start, end, new NullMatch(expr))
      buildExprGraph(start, start, expr.expr, rules)
    } else if (expr.kind == "+") {
      buildExprGraph(start, end, expr.expr, rules)
      buildExprGraph(end, end, expr.expr, rules)
    } else if (expr.kind == "?") {
      Edge.create(start, end, new NullMatch(expr))
      buildExprGraph(start, end, expr.expr, rules)
    }
  } else if (t == "LookaheadMatch") {
    throw new Error("not supporting lookahead yet")
  } else if (t == "SequenceMatch") {
    for (let i = 0; i < expr.exprs.length; i++) {
      let to = i == expr.exprs.length - 1 ? end : new Node
      buildExprGraph(start, to, expr.exprs[i], rules)
      start = to
    }
  } else if (t == "ChoiceMatch") {
    for (let i = 0; i < expr.exprs.length; i++)
      buildExprGraph(start, end, expr.exprs[i], rules)
  } else {
    throw new Error("Unrecognized AST node type " + t)
  }
}

function printGraph(node) {
  let seen = Object.create(null)
  seen[node.label] = true
  let toScan = [node], output = "digraph {\n"
  while (toScan.length) {
    let cur = toScan.pop()
    for (let i = 0; i < cur.outgoing.length; i++) {
      let edge = cur.outgoing[i]
      output += "  " + edge.toString() + ";\n"
      if (!(edge.to.label in seen)) {
        seen[edge.to.label] = true
        toScan.push(edge.to)
      }
    }
  }
  return output + "}\n"
}

function compileGrammar(node, file) {
  let graph = createGraph(node)
  console.log(printGraph(graph.start))
  return "FIXME"
}
