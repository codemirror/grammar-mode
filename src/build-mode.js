let input = null, graph = false, output = null

for (let i = 2; i < process.argv.length; i++) {
  let arg = process.argv[i]
  if (arg == "--graph") graph=true
  else if (arg == "--output") output = process.argv[++i]
  else if (arg == "--help") usage(0)
  else if (input || arg[0] == "-") usage(1)
  else input = arg
}

function usage(code) {
  console.log("build-mode [file] [--output file] --graph")
  process.exit(code)
}

if (input) {
  out(run(require("fs").readFileSync(input, "utf8")))
} else {
  let buffer = ""
  process.stdin.resume()
  process.stdin.on("data", chunk => buffer += chunk.toString("utf8"))
  process.stdin.on("end", () => out(run(buffer)))
}

function run(input) {
  let ast = require("./parse")(input)
  let graph = require("./graph").buildGraph(ast)
  if (graph)
    return graph.toString()
  else
    return require("./compile")(graph)
}

function out(string) {
  if (output) require("fs").writeFileSync(output, string, "utf8")
  else process.stdout.write(string, "utf8")
}
