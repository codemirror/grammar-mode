const parse = require("./parse")
const compile = require("./compile")
const {buildGraph} = require("./graph")
const path = require("path"), fs = require("fs")

let input = null, outputGraph = false, names = false, token = true, esModule = false, output = null

// declare global: process
for (let i = 2; i < process.argv.length; i++) {
  let arg = process.argv[i]
  if (arg == "--graph") outputGraph = true
  else if (arg == "--no-token") token = false
  else if (arg == "--es-module") esModule = true
  else if (arg == "--names") names = true
  else if (arg == "--output") output = process.argv[++i]
  else if (arg == "--help") usage(0)
  else if (input || arg[0] == "-") usage(1)
  else input = arg
}

function usage(code) {
  ;(code ? process.stderr : process.stdout).write(
    "grammar-mode [file] [--output file] [--es-module] [--no-token] [--graph] [--names]\n"
  )
  process.exit(code)
}

if (input) {
  out(run(parseWithSuper(path.dirname(input), fs.readFileSync(input, "utf8"))))
} else {
  let buffer = ""
  process.stdin.resume()
  process.stdin.on("data", chunk => buffer += chunk.toString("utf8"))
  process.stdin.on("end", () => out(run(parseWithSuper(process.cwd(), buffer))))
}


function parseWithSuper(base, input) {
  let ast = parse(input)
  if (ast.extends) {
    let file = path.resolve(base, ast.extends)
    ast.super = parseWithSuper(path.dirname(file), fs.readFileSync(file, "utf8"))
  }
  return ast
}

function run(ast) {
  let options = {token, esModule, names}
  let graphs = buildGraph(ast, options)
  if (outputGraph)
    return `digraph{\n${Object.keys(graphs).map(k => graphs[k].toString()).join("")}}\n`
  else
    return compile(graphs, options)
}

function out(string) {
  if (output) fs.writeFileSync(output, string, "utf8")
  else process.stdout.write(string, "utf8")
}
