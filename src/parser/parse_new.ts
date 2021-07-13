import { nanoid } from "nanoid"
import * as AST from "./ast"

const flagDict = {
  d: "hasIndices",
  g: "global",
  i: "ignoreCase",
  m: "multiline",
  s: "dotAll",
  u: "unicode",
  y: "sticky",
}
class Parser {
  regex: string
  message: string = ""
  index = 0
  ast: AST.Regex = { type: "regex", body: [], flags: [] }
  parent!: AST.Regex | AST.Node
  prev!: AST.Node
  groupIndex = 1
  flagSet: Set<AST.FlagShortKind> = new Set()
  constructor(regex: string) {
    this.regex = regex.trim()
  }

  public parse(): AST.Regex | AST.RegexError {
    if (!this.validate()) {
      return { type: "error", message: this.message }
    }
    this.onRegex()
    return this.ast
  }

  public validate() {
    try {
      const start = this.regex.indexOf("/")
      let end = -1

      if (start !== 0) {
        this.message = "Invalid regular expression"
        return false
      }

      for (let i = start + 1; i < this.regex.length; i++) {
        if (this.regex[i] === "/") {
          end = i
          break
        }
      }

      if (end === -1) {
        this.message = "Invalid regular expression"
        return false
      }

      for (let i = end + 1; i < this.regex.length; i++) {
        if (!/[gimsuy]/.test(this.regex[i])) {
          this.message = "Invalid regular expression flags"
          return false
        }
        this.flagSet.add(this.regex[i] as AST.FlagShortKind)
      }

      new RegExp(this.regex.slice(start + 1, end), this.regex.slice(end + 1))
    } catch (error) {
      this.message = error.message
      return false
    }
    return true
  }

  private advance(step = 1) {
    if (this.index === this.regex.length - 1) {
      return false
    }
    this.index += step
    return true
  }

  private cur(advance = 0) {
    return this.regex[this.index + advance]
  }

  private consume(endPoint: string) {
    do {
      switch (this.cur()) {
        case endPoint:
          return
        case "{":
        case "?":
        case "*":
        case "+":
          this.consumeQuantifier()
          break
        case "(":
          this.onGroup()
          break
        default:
          break
      }
    } while (this.advance())
  }

  private consumeQuantifier() {
    let quantifier: AST.Quantifier
    switch (this.cur()) {
      case "?":
        quantifier = { kind: "?", min: 0, max: 1, greedy: true }
        this.advance()
        break
      case "*":
        quantifier = { kind: "*", min: 0, max: Infinity, greedy: true }
        this.advance()
        break
      case "+":
        quantifier = { kind: "+", min: 1, max: Infinity, greedy: true }
        this.advance()
        break
      case "{":
        const min = this.eat("\\d+", "", 1)
        if (!min) {
          break
        }
        if (this.cur(min.length + 1) === "}") {
          quantifier = {
            kind: "custom",
            min: parseInt(min),
            max: parseInt(min),
            greedy: true,
          }
          this.advance(min.length + 2)
          break
        }

        const comma = this.eat(",", "", min.length + 1)
        if (comma) {
          if (this.cur(min.length + 2) === "}") {
            quantifier = {
              kind: "custom",
              min: parseInt(min),
              max: Infinity,
              greedy: true,
            }
            this.advance(min.length + 3)
            break
          }
        }

        const max = this.eat("\\d+", "", 1)
        if (!max) {
          break
        }
        if (this.cur(min.length + 1) === "}") {
          quantifier = {
            kind: "custom",
            min: parseInt(min),
            max: parseInt(max),
            greedy: true,
          }
          this.advance(min.length + max.length + 3)
        }
        break
      default:
        break
    }

    if (quantifier! && this.cur() === "?") {
      quantifier!.greedy = false
      this.advance()
    }

    if (quantifier!) {
      if (this.prev.type === "character" || this.prev.type === "group") {
        this.prev.quantifier = quantifier!
      } else {
        // TODO: error handling
      }
      return true
    }
    return false
  }

  private appendChild(node: AST.Node) {
    if (this.parent.type === "regex") {
      this.parent.body.push(node)
      return
    }
    if (
      this.parent.type === "group" ||
      this.parent.type === "lookAroundAssertion"
    ) {
      this.parent.children.push(node)
    }
    if (this.parent.type === "choice") {
      const { branches } = this.parent
      branches[branches.length - 1].push(node)
    }
  }

  private onRegex() {
    this.parent = this.ast
    this.onRegexBody()
    this.onFlags()
  }

  private onRegexBody() {
    this.advance()
    this.consume("/")
  }

  private onFlags() {
    this.flagSet.forEach((flag) => {
      this.ast.flags.push({ kind: flagDict[flag] as AST.FlagKind })
    })
  }

  private eat(
    startPoint: string,
    endPoint: string = "",
    advance = 0
  ): string | false {
    if (!endPoint) {
      const match = this.regex
        .slice(this.index + advance)
        .match(new RegExp(`^${startPoint}`))
      if (match) {
        return match[0]
      }
      return false
    }
    const match = this.regex
      .slice(this.index + advance)
      .match(new RegExp(`^${startPoint}(.*)${endPoint}`))

    if (match) {
      return match[1]
    }
    return false
  }

  private onGroup() {
    this.advance()

    let group: AST.Group
    if (this.eat("\\?:")) {
      this.advance(2)
      group = { kind: "nonCapturing" }
    } else {
      const name = this.eat("\\?<", ">")
      if (name) {
        this.advance((name as string).length + 3)
        group = { kind: "namedCapturing", name: name as string }
      }
    }

    if (!group!) {
      group = { kind: "capturing", name: this.groupIndex++ + "" }
    }
    const groupNode: AST.GroupNode = {
      id: nanoid(),
      type: "group",
      children: [],
      ...group!,
      quantifier: null,
    }
    this.appendChild(groupNode)

    this.consume(")")
    this.prev = groupNode
  }
}

const parse = (regex: string) => {
  const parser = new Parser(regex)
  return parser.parse()
}

export default parse