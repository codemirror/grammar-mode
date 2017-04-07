const F = {toString() { return "F"}}

// FIXME hard-coded hack
let eof = {name: "eof"}

exports.matchGrammar = function(grammar, input) {
  grammar.rules.eof = eof
  return runRule(grammar.rules[grammar.firstRule], {input, pos: 0, grammar}, [])
}

function maybeRun(expr, pos, env) {
  let start = pos.pos
  let result = run(expr, pos, env)
  if (result == F) pos.pos = start
  return result
}

function runRule(rule, pos, args) {
  if (rule == eof) return pos.pos == pos.input.length ? null : F

  let start = pos.pos
  if (args.length != rule.params.length)
    throw new SyntaxError("Wrong number of parameters for " + rule.name)
  let env = {}
  for (let i = 0; i < rule.params.length; i++)
    env[rule.params[i]] = args[i]
  let result = run(rule.expr, pos, env)
  if (result == F) return F
  env.$match = pos.input.slice(start, pos.pos)
  return rule.body ? evalIn(rule.body.string, env) : result
}

function run(expr, pos, env) {
  let t = expr.type
  if (t == "sequence") {
    for (let i = 0; i < expr.exprs.length; i++) {
      let val = run(expr.exprs[i], pos, env)
      if (val == F) return F
    }
  } else if (t == "choice") {
    for (let i = 0; i < expr.choices.length; i++) {
      let val = maybeRun(expr.choices[i], pos, env)
      if (val != F) return val
    }
    return F
  } else if (t == "string") {
    let end = pos.pos + expr.value.length
    if (pos.input.slice(pos.pos, end) != expr.value) return F
    pos.pos = end
  } else if (t == "regexp") {
    let match = expr.value.exec(pos.input.slice(pos.pos))
    if (!match) return F
    pos.pos += match[0].length
  } else if (t == "apply") {
    let rule = pos.grammar.rules[expr.rule]
    if (!rule) throw new SyntaxError("Undefined rule " + expr.rule)
    return runRule(rule, pos, expr.args ? evalIn(`return [${expr.args.string}]`, env) : [])
  } else if (t == "test") {
    let start = pos.pos, inner = expr.expr && run(expr.expr, pos, env)
    if (inner == F) return F
    if (!evalIn("return " + expr.test.string, Object.assign({}, env, {$: inner, $match: pos.input.slice(start, pos.pos)}))) return F
    return inner
  } else if (t == "repeat") {
    for (let i = 0; expr.max == -1 || i < expr.max; i++) {
      if (i < expr.min) {
        let result = run(expr.expr, pos, env)
        if (result == F) return F
      } else {
        let result = maybeRun(expr.expr, pos, env)
        if (result == F) break
      }
    }
  } else if (t == "until") {
    for (;;) {
      let stop = maybeRun(expr.until, pos, env)
      if (stop != F) return stop
      let next = run(expr.expr, pos, env)
      if (next == F) return F
    }
  } else if (t == "binding") {
    let result = run(expr.expr, pos, env)
    if (result == F) return F
    return env[expr.name] = result
  } else {
    throw new SyntaxError("Unknown AST node type " + t)
  }
}

function evalIn(code, env) {
  let args = [], values = []
  for (let prop in env) {
    args.push(prop)
    values.push(env[prop])
  }
  return (new Function(args.join(", "), code)).apply(null, values)
}
