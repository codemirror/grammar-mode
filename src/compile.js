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
    this.rules = Object.create(null)
    this.outside = this.node(null, "outside")
    this.grammar = grammar
    this.first = null
    for (let i = 0; i < grammar.rules.length; i++) {
      let rule = grammar.rules[i],
          startNode = this.node(null, rule.id.name + "_start"),
          endNode = this.node(null, rule.id.name + "_end")
      this.rules[rule.id.name] = {ast: rule, start: startNode.label, end: endNode.label}
      if (this.first == null && !rule.lexical) this.first = rule.id.name
    }
    for (let n in this.rules) {
      let {ast, start, end} = this.rules[n]
      let endNode = this.nodes[end]
      this.withLabels(ast.id.name, () => {
        generateExpr(this.nodes[start], endNode, ast.expr, this)
        this.edge(endNode, this.outside, new NullMatch(ast), [new ReturnEffect])
      })
    }
  }

  node(suffix, label) {
    if (!label) label = this.curLabel + (suffix ? "_" + suffix : "")
    for (let i = 0;; i++) {
      let cur = i ? label + "_" + i : label
      if (!(cur in this.aliases)) return this.nodes[cur] = new Node(cur)
    }
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
    let prevLabel = this.curLabel
    this.curLabel = label
    f()
    this.curLabel = prevLabel
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

class RepeatMatch extends Match {
  constructor(ast, match) {
    super(ast)
    this.match = match
  }

  toString() { return this.match.toString() + "*" }
}

class CallEffect {
  constructor(rule, returnTo) {
    this.rule = rule
    this.returnTo = returnTo
  }

  eq(other) {
    return other instanceof CallEffect && other.rule == this.rule && other.returnTo == this.returnTo
  }

  toString() { return "call " + this.rule }
}

class ReturnEffect {
  constructor() {}

  eq(other) { return other instanceof ReturnEffect }

  toString() { return "return" }
}

class ReturnFromEffect {
  constructor() {}

  eq(_other) { return false }

  toString() { return "returnFrom" }
}

function generateExpr(start, end, expr, graph) {
  let t = expr.type
  if (t == "CharacterRange") {
    graph.edge(start, end, new RangeMatch(expr, expr.from, expr.to))
  } else if (t == "StringMatch") {
    graph.edge(start, end, new StringMatch(expr, expr.value))
  } else if (t == "AnyMatch") {
    graph.edge(start, end, new AnyMatch(expr))
  } else if (t == "RuleIdentifier") {
    let rule = graph.rules[expr.id.name]
    if (!rule) throw new SyntaxError(`No rule '${expr.id.name}' defined`)
    graph.edge(start, graph.aliases[rule.start], new NullMatch(expr), [new CallEffect(expr.id.name, end)])
    graph.edge(graph.outside, end, new NullMatch(expr), [new ReturnFromEffect])
  } else if (t == "RepeatedMatch") {
    if (expr.kind == "*") {
      graph.edge(start, end, new NullMatch(expr))
      generateExpr(start, start, expr.expr, graph)
    } else if (expr.kind == "+") {
      generateExpr(start, end, expr.expr, graph)
      generateExpr(end, end, expr.expr, graph)
    } else if (expr.kind == "?") {
      graph.edge(start, end, new NullMatch(expr))
      generateExpr(start, end, expr.expr, graph)
    }
  } else if (t == "LookaheadMatch") {
    throw new Error("not supporting lookahead yet")
  } else if (t == "SequenceMatch") {
    for (let i = 0; i < expr.exprs.length; i++) {
      let to = i == expr.exprs.length - 1 ? end : graph.node()
      generateExpr(start, to, expr.exprs[i], graph)
      start = to
    }
  } else if (t == "ChoiceMatch") {
    for (let i = 0; i < expr.exprs.length; i++)
      generateExpr(start, end, expr.exprs[i], graph)
  } else {
    throw new Error("Unrecognized AST node type " + t)
  }
}

function removeReturnFrom(graph, node) {
  for (let i = 0; i < node.incoming.length; i++) {
    let edge = node.incoming[i]
    if (edge.from == graph.outside) return edge.rm()
  }
  throw new Error("No return from")
}

function simplifySequence(graph, node) {
  if (node.incoming.length != 1 || node.outgoing.length != 1) return false
  let inEdge = node.incoming[0], outEdge = node.outgoing[0]
  let start = inEdge.from, end = outEdge.to, effects
  if (start == node || end == node || start == graph.outside) return false
  if (end == graph.outside) { // A return edge
    let call = -1
    for (let i = inEdge.effects.length - 1; i >= 0; i--) if (inEdge.effects[i] instanceof CallEffect) {
      end = graph.aliases[inEdge.effects[i].returnTo]
      removeReturnFrom(graph, end)
      effects = inEdge.effects.slice(0, i).concat(inEdge.effects.slice(i + 1))
      break
    }
    if (end == graph.outside) return false
  } else {
    effects = inEdge.effects.concat(outEdge.effects)
  }
  inEdge.rm(); outEdge.rm()
  graph.merge(start, node)
  graph.edge(start, end, SeqMatch.create(inEdge.match, outEdge.match), effects)
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
  let cycleIndex, cycleEdge
  for (let i = 0; i < node.outgoing.length; i++) {
    let edge = node.outgoing[i]
    if (edge.to == node) {
      if (cycleEdge) return false
      cycleIndex = i
      cycleEdge = edge
    }
  }
  if (!cycleEdge || cycleEdge.effects.length) return false
  let newNode = graph.node(null, node.label + "_split")
  cycleEdge.rm()
  while (node.outgoing.length) {
    let edge = node.outgoing[0]
    edge.rm()
    graph.edge(newNode, edge.to, edge.match, edge.effects)
  }
  graph.edge(node, newNode, new RepeatMatch(cycleEdge.match.ast, cycleEdge.match), cycleEdge.effects)
  return true
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
