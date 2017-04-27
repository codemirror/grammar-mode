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
    this.aliases = Object.create(this.nodes)
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

  node(suffix) {
    let label = this.curLabel + "_" + (suffix || this.curLabelId++)
    return this.nodes[label] = new Node(label)
  }

  edge(from, to, match, effects) {
    let edge = new Edge(from, to, match, effects)
    from.outgoing.push(edge)
    to.incoming.push(edge)
    return edge
  }

  merge(a, b) {
    this.aliases[b.label] = a
    delete this.nodes[b.label]
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
    this.label = label
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

  rm() {
    this.from.outgoing.splice(this.from.outgoing.indexOf(this), 1)
    this.to.incoming.splice(this.to.incoming.indexOf(this), 1)
  }

  toString() {
    let effects = this.effects.length ? " " + this.effects.join(" ") : ""
    return `${this.from} -> ${this.to}[label=${JSON.stringify(this.match.toString() + effects)}]`
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

class SeqMatch extends Match {
  constructor(ast, matches) {
    super(ast)
    this.matches = matches
  }

  toString() { return this.matches.join(" ") }

  static create(left, right) {
    if (left instanceof NullMatch) return right
    if (right instanceof NullMatch) return left
    let matches = []
    if (left instanceof SeqMatch) matches = matches.concat(left.matches)
    else matches.push(left)
    let last = matches[matches.length - 1]
    if (right instanceof StringMatch && last instanceof StringMatch)
      matches[matches.length - 1] = new StringMatch(last.ast, last.value + right.value)
    else if (right instanceof SeqMatch) matches = matches.concat(right.matches)
    else matches.push(right)
    if (matches.length == 1) return matches[0]
    else return new SeqMatch(left.ast, matches)
  }
}

class ChoiceMatch extends Match {
  constructor(ast, matches) {
    super(ast)
    this.matches = matches
  }

  toString() { return "(" + this.matches.join(" | ") + ")" }

  static create(left, right) {
    let matches = []
    if (left instanceof ChoiceMatch) matches = matches.concat(left.matches)
    else matches.push(left)
    if (right instanceof ChoiceMatch) matches = matches.concat(right.matches)
    else matches.push(right)
    return new ChoiceMatch(left.ast, matches)
  }
}

class CallEffect {
  constructor(rule, returnTo) {
    this.rule = rule
    this.returnTo = returnTo
  }

  eq(other) {
    return other instanceof CallEffect && other.rule == this.rule && other.returnTo == this.returnTo
  }

  toString() { return "call " + this.rule.id.name }
}

class ReturnEffect {
  constructor() {}

  eq(other) { return other instanceof ReturnEffect }

  toString() { return "return" }
}


function fillRule(graph, rule) {
  graph.withLabels(rule.ast.id.name, () => {
    let start = graph.node("start"), end = graph.node("end")
    rule.start = start.label; rule.end = end.label
    fillExpr(start, end, rule.ast.expr, graph)
  })
}

function fillExpr(start, end, expr, graph) {
  let t = expr.type
  if (t == "CharacterRange") {
    graph.edge(start, end, new RangeMatch(expr, expr.from, expr.to))
  } else if (t == "StringMatch") {
    graph.edge(start, end, new StringMatch(expr, expr.value))
  } else if (t == "AnyMatch") {
    graph.edge(start, end, new AnyMatch(expr))
  } else if (t == "RuleIdentifier") {
    let rule = graph.rules[expr.id.name]
    if (!rule.start) fillRule(graph, rule)
    graph.edge(start, graph.aliases[rule.start], new NullMatch(expr), [new CallEffect(rule.ast, end)])
    graph.edge(graph.aliases[rule.end], end, new NullMatch(expr), [new ReturnEffect])
  } else if (t == "RepeatedMatch") {
    if (expr.kind == "*") {
      graph.edge(start, end, new NullMatch(expr))
      fillExpr(start, start, expr.expr, graph)
    } else if (expr.kind == "+") {
      fillExpr(start, end, expr.expr, graph)
      fillExpr(end, end, expr.expr, graph)
    } else if (expr.kind == "?") {
      graph.edge(start, end, new NullMatch(expr))
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

function mergeEffects(a, b) {
  for (let i = 0; i < b.length; i++) {
    if (b[i] instanceof ReturnEffect) for (let j = a.length - 1; j >= 0; j--) {
      if (a[j] instanceof CallEffect)
        return mergeEffects(a.slice(0, j).concat(a.slice(j + 1)),
                            b.slice(0, i).concat(b.slice(i + 1)))
    }
  }
  return a.concat(b)
}

function simplifySequence(graph, node) {
  if (node.incoming.length != 1 || node.outgoing.length != 1) return false
  let inEdge = node.incoming[0], outEdge = node.outgoing[0]
  // FIXME handle context effects
  if (inEdge.from == node || outEdge.to == node) return false
  if (inEdge.effects.some(e => e instanceof ReturnEffect)) return false
  inEdge.rm(); outEdge.rm()
  graph.merge(inEdge.from, node)
  let effects = mergeEffects(inEdge.effects, outEdge.effects)
  graph.edge(inEdge.from, outEdge.to, SeqMatch.create(inEdge.match, outEdge.match), effects)
  return true
}

function sameEffect(edge1, edge2) {
  let e1 = edge1.effects, e2 = edge2.effects
  if (e1.length != e2.length) return false
  for (let i = 0; i < e1.length; i++)
    if (!e1[i].eq(e2[i])) return false
  return true
}

function simplifyChoice(graph, node) {
  if (node.outgoing.length < 2) return false
  let first = node.outgoing[0]
  for (let i = 1; i < node.outgoing.length; i++) {
    let edge = node.outgoing[i]
    if (edge.to != first.to || !sameEffect(edge, first)) return false
  }
  let match = first.match
  first.rm()
  while (node.outgoing.length) {
    match = ChoiceMatch.create(match, node.outgoing[0].match)
    node.outgoing[0].rm()
  }
  graph.edge(node, first.to, match, first.effects)
  return true
}

function simplifyRepeat(graph, node) {
  // FIXME
}

// Look for simplification possibilities around the given node, return
// true if anything was done
function simplifyWith(graph, simplifiers) {
  let changed = false
  for (let n in graph.nodes) {
    let node = graph.nodes[n]
    for (let i = 0; i < simplifiers.length; i++) if (simplifiers[i](graph, node)) {
      changed = true
      break
    }
  }
  return changed
}

function simplify(graph) {
  while (simplifyWith(graph, [simplifySequence, simplifyChoice, simplifyRepeat])) {}
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

function compileGrammar(grammar, file) {
  let graph = new Graph(grammar)
  simplify(graph)
  console.log(printGraph(graph))
  return "FIXME"
}
