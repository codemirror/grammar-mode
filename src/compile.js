module.exports = function(ast, file) {
  let result = file
  for (let i = ast.body.length - 1; i >= 0; i--) {
    let node = ast.body[i]
    if (node.type == "GrammarDeclaration")
      result = result.slice(0, node.start) + compileGrammar(node, file) + result.slice(node.end)
  }
  return result
}

class Graph {
  constructor(grammar) {
    this.nodes = Object.create(null)
    this.curLabel = "-"
    this.curLabelId = 0
    this.rules = Object.create(null)
    this.grammar = grammar
    this.first = null
    for (let i = 0; i < grammar.rules.length; i++) {
      let rule = grammar.rules[i]
      this.rules[rule.id.name] = {ast: rule, start: null, end: null}
      if (this.first == null && !rule.lexical) this.first = rule.id.name
    }
    fillRule(this, this.rules[this.first])
  }

  node() {
    let label = this.curLabel + this.curLabelId++
    return this.nodes[label] = new Node(label)
  }

  merge(a, b) {
    this.nodes[b.label] = a
  }

  withLabels(label, f) {
    let prevLabel = this.curLabel, prevId = this.curLabelId
    this.curLabel = label
    this.curLabelId = 0
    f()
    this.curLabel = prevLabel
    this.curLabelId = prevId
  }
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
    let effects = this.effects.map(e => e[0] + (e[1] ? " " + e[1].id.name : "")).join(" ")
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

function fillRule(graph, rule) {
  graph.withLabels(rule.ast.id.name, () => {
    fillExpr(rule.start = graph.node(), rule.end = graph.node(), rule.ast.expr, graph)
  })
}

function fillExpr(start, end, expr, graph) {
  let t = expr.type
  if (t == "CharacterRange") {
    Edge.create(start, end, new RangeMatch(expr, expr.from, expr.to))
  } else if (t == "StringMatch") {
    Edge.create(start, end, new StringMatch(expr, expr.value))
  } else if (t == "AnyMatch") {
    Edge.create(start, end, new AnyMatch(expr))
  } else if (t == "RuleIdentifier") {
    let rule = graph.rules[expr.id.name]
    if (!rule.start) fillRule(graph, rule)
    Edge.create(start, graph.nodes[rule.start], new NullMatch(expr), [["call", rule.ast, end]])
    Edge.create(graph.nodes[rule.end], end, new NullMatch(expr), [["return"]])
  } else if (t == "RepeatedMatch") {
    if (expr.kind == "*") {
      Edge.create(start, end, new NullMatch(expr))
      fillExpr(start, start, expr.expr, graph)
    } else if (expr.kind == "+") {
      fillExpr(start, end, expr.expr, graph)
      fillExpr(end, end, expr.expr, graph)
    } else if (expr.kind == "?") {
      Edge.create(start, end, new NullMatch(expr))
      fillExpr(start, end, expr.expr, graph)
    }
  } else if (t == "LookaheadMatch") {
    throw new Error("not supporting lookahead yet")
  } else if (t == "SequenceMatch") {
    for (let i = 0; i < expr.exprs.length; i++) {
      let to = i == expr.exprs.length - 1 ? end : graph.node()
      fillExpr(start, to, expr.exprs[i], graph)
      start = to
    }
  } else if (t == "ChoiceMatch") {
    for (let i = 0; i < expr.exprs.length; i++)
      fillExpr(start, end, expr.exprs[i], graph)
  } else {
    throw new Error("Unrecognized AST node type " + t)
  }
}

function printGraph(graph) {
  let output = "digraph {\n"
  for (let n in graph.nodes) {
    let node = graph.nodes[n]
    for (let i = 0; i < node.outgoing.length; i++)
      output += "  " + node.outgoing[i].toString() + ";\n"
  }
  return output + "}\n"
}

function simplifySequence(node) {
  return false
}

function simplifyChoice(node) {
}

function simplifyCall(node) {
}

function simplifyNull(node) {

}

// Look for simplification possibilities around the given node, return
// true if anything was done
function simplify(node) {
  return simplifySequence(node) || simplifyChoice(node) || simplifyCall(node) || simplifyNull(node)
}

function compileGrammar(grammar, file) {
  let graph = new Graph(grammar)
  console.log(printGraph(graph))
  return "FIXME"
}
