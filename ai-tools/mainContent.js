import domino from '@mixmark-io/domino'
import lemonade from '../lib/lemonade.js'

// Finds a web page's main content with a MinerU-HTML model, for read_web_page (see
// webReader.js). This is MinerU-HTML v1.1's own method (github.com/opendatalab/MinerU-HTML,
// mineru_html/process, under the Apache License 2.0), ported:
//   1. The page is cut into numbered blocks: each paragraph, heading, list or data table, and
//      each run of text and links beside them, shortened and with most attributes removed
//      (simplify)
//   2. The model labels each block main or other (lemonade.labelHTML, parseLabels)
//   3. The main blocks are kept in the page as it was, with what's inside and around them
//      (keepMain)
// The model only labels blocks, so every word kept is the page's own.
// The license and notice for the ported code are in THIRD_PARTY_NOTICES.md.
//
// MinerU-HTML works on lxml trees, where the text after an element belongs to it (its "tail")
// and an element's "text" is what comes before its first child. Some of its steps depend on that
// (text removed with an element, or moved into the one before), so the helpers below do the same
// with text nodes.

// MinerU-HTML's inline tags; every other element is a block (br and textarea included)
const inlineTags = new Set([
  `map`, `optgroup`, `span`, `input`, `time`, `u`, `strong`, `small`, `sub`, `samp`, `blink`, `b`,
  `code`, `nobr`, `strike`, `bdo`, `basefont`, `abbr`, `var`, `i`, `cccode-inline`, `s`, `pic`,
  `label`, `mark`, `object`, `ccmath-inline`, `svg`, `button`, `a`, `font`, `dfn`, `sup`, `kbd`,
  `q`, `script`, `acronym`, `option`, `img`, `big`, `cite`, `em`, `marked-tail`, `marked-text`,
])

// What a data table holds besides inline content
const tableTags = new Set([`caption`, `colgroup`, `col`, `thead`, `tbody`, `tfoot`, `tr`, `td`, `th`, `br`])

// Removed before the page is cut into blocks
const removedTags = [`title`, `head`, `style`, `script`, `link`, `meta`, `iframe`, `frame`, `nav`]

// Read as a single block, whatever is inside
const noBlockTags = new Set([`math`])

// Their text isn't shortened, nor counted towards a block's length
const uncountedTags = new Set([`math`, `table`])

// Inline styles that hide an element
const hiddenStyles = new Map([
  [`display`, `none`],
  [`font-size`, `0px`],
  [`color`, `transparent`],
  [`visibility`, `hidden`],
  [`opacity`, `0`],
])

// The most text a block shows the model, in characters
const maxBlockText = 500

// Holds a run of text and inline elements in the page, so it can be kept or removed as one block
const runTag = `cc-alg-uc-text`

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const SHOW_ELEMENT = 1
const SHOW_COMMENT = 128

const isElement = function (node) {
  return node != null && node.nodeType === ELEMENT_NODE
}

// lxml lowercases every tag, SVG's included
const tagOf = function (element) {
  return element.localName.toLowerCase()
}

const childElements = function (element) {
  return Array.from(element.childNodes).filter(isElement)
}

// Every element inside `root`, in order, read as it's needed
const eachDescendant = function * (root) {
  const walker = root.ownerDocument.createTreeWalker(root, SHOW_ELEMENT)

  while (walker.nextNode() != null) {
    yield walker.currentNode
  }
}

// The text nodes in a row from `node` on, or back from it
const textNodesFrom = function (node, step) {
  const nodes = []
  let current = node

  while (current != null && current.nodeType === TEXT_NODE) {
    nodes.push(current)
    current = current[step]
  }

  return step === `previousSibling` ? nodes.reverse() : nodes
}

// An element's text, before its first child element (lxml's "text")
const textNodes = function (element) {
  return textNodesFrom(element.firstChild, `nextSibling`)
}

// The text after an element, up to the next one (lxml's "tail")
const tailNodes = function (element) {
  return textNodesFrom(element.nextSibling, `nextSibling`)
}

// The text just before an element, back to the one before it
const textNodesBefore = function (element) {
  return textNodesFrom(element.previousSibling, `previousSibling`)
}

const joinText = function (nodes) {
  return nodes.map((node) => node.data).join(``)
}

const getText = function (element) {
  return joinText(textNodes(element))
}

const getTail = function (element) {
  return joinText(tailNodes(element))
}

const removeNodes = function (nodes) {
  for (const node of nodes) {
    node.parentNode.removeChild(node)
  }
}

// (domino has no append, and its node lists are only array-like, hence Array.from)
const appendNodes = function (parent, nodes) {
  for (const node of nodes) {
    parent.appendChild(node)
  }
}

const setText = function (element, text) {
  removeNodes(textNodes(element))

  if (text !== ``) {
    element.insertBefore(element.ownerDocument.createTextNode(text), element.firstChild)
  }
}

const setTail = function (element, text) {
  removeNodes(tailNodes(element))

  if (text !== `` && element.parentNode != null) {
    element.parentNode.insertBefore(element.ownerDocument.createTextNode(text), element.nextSibling)
  }
}

// Removes an element with the text after it, as lxml does
const removeWithTail = function (element) {
  removeNodes(tailNodes(element))
  element.parentNode.removeChild(element)
}

// Python counts characters by code point
const lengthOf = function (text) {
  return [...text].length
}

const previousElement = function (element) {
  let current = element.previousSibling

  while (current != null && isElement(current) === false) {
    current = current.previousSibling
  }

  return current
}

const removeComments = function (document) {
  const walker = document.createTreeWalker(document, SHOW_COMMENT)
  const comments = []

  while (walker.nextNode() != null) {
    comments.push(walker.currentNode)
  }

  removeNodes(comments)
}

// Pairs each node of a copy with the page's own, for finding blocks again in the page
const pairNodes = function (copy, original, pairs) {
  pairs.set(copy, original)

  for (let index = 0; index < copy.childNodes.length; index += 1) {
    pairNodes(copy.childNodes[index], original.childNodes[index], pairs)
  }
}

// Hidden by its style, a menu named "nav" at the top of the page, or inside a closed <details>
const isHidden = function (element) {
  const parent = element.parentNode
  const className = element.getAttribute(`class`) ?? ``
  const id = element.getAttribute(`id`) ?? ``

  if ((className === `nav` || id === `nav`) && isElement(parent) && tagOf(parent) === `body`) {
    return true
  }

  const style = element.getAttribute(`style`) ?? ``

  for (const declaration of style.split(`;`)) {
    if (declaration.includes(`:`) === false) {
      continue
    }

    const [name, ...value] = declaration.split(`:`)

    if (hiddenStyles.get(name.trim()) === value.join(`:`).trim()) {
      return true
    }
  }

  if (isElement(parent) && tagOf(parent) === `details`) {
    return tagOf(element) !== `summary` && parent.hasAttribute(`open`) === false
  }

  return false
}

// Removes hidden elements, innermost first. Their tail stays, joined to the text before them;
// when the element before has no tail, MinerU-HTML adds it to that element's text.
const removeHidden = function (element) {
  for (const child of childElements(element)) {
    removeHidden(child)
  }

  const parent = element.parentNode

  if (isElement(parent) === false || isHidden(element) === false) {
    return
  }

  const tail = getTail(element)
  removeNodes(tailNodes(element))

  const previous = previousElement(element)

  if (previous == null) {
    setText(parent, getText(parent) + tail)
  } else if (tailNodes(previous).length > 0) {
    setTail(previous, getTail(previous) + tail)
  } else {
    setText(previous, getText(previous) + tail)
  }

  parent.removeChild(element)
}

// Whether any of `nodes` is in `table` itself, rather than in a table inside it
const isInTable = function (table, nodes) {
  return nodes.some(function (node) {
    for (let ancestor = node.parentNode; isElement(ancestor); ancestor = ancestor.parentNode) {
      if (ancestor === table) {
        return true
      }

      if (tagOf(ancestor) === `table`) {
        return false
      }
    }

    return false
  })
}

// A table of data (with a caption, columns, headed cells, or only cells of inline content)
// rather than one laying the page out. A data table is one block; a layout table's cells are
// read as blocks of their own.
const isDataTable = function (table) {
  const isMarked = [`caption`, `col`, `colgroup`, `td[headers], th[headers]`].some(function (selector) {
    return isInTable(table, Array.from(table.querySelectorAll(selector)))
  })

  if (isMarked || table.getAttribute(`role`) === `table` || table.getAttribute(`data-table`)) {
    return true
  }

  return [...eachDescendant(table)].every(function (node) {
    return tableTags.has(tagOf(node)) || inlineTags.has(tagOf(node))
  })
}

// Removes attributes but class and id, and an image's src (unless it's embedded) and alt
const cleanAttributes = function (element) {
  const kept = []
  const keep = function (name, value) {
    if (value !== ``) {
      kept.push([name, value])
    }
  }

  if (tagOf(element) === `img`) {
    const src = (element.getAttribute(`src`) ?? ``).trim()
    keep(`src`, src.startsWith(`data:image/`) ? `` : src)
    keep(`alt`, (element.getAttribute(`alt`) ?? ``).trim())
  }

  keep(`class`, (element.getAttribute(`class`) ?? ``).trim())
  keep(`id`, (element.getAttribute(`id`) ?? ``).trim())

  for (const { name } of Array.from(element.attributes)) {
    element.removeAttribute(name)
  }

  for (const [name, value] of kept) {
    element.setAttribute(name, value)
  }

  for (const child of childElements(element)) {
    cleanAttributes(child)
  }
}

// An ellipsis in place of a list's middle
const ellipsis = function (document) {
  const span = document.createElement(`span`)
  span.textContent = `...`
  return span
}

// Lists keep their first and last entries (a description list, its first and last terms with
// their descriptions), with "..." between
const shortenLists = function (element) {
  const tag = tagOf(element)
  const items = childElements(element)

  if ((tag === `ul` || tag === `ol`) && items.length > 2) {
    for (const item of items.slice(1, -1)) {
      removeWithTail(item)
    }

    element.insertBefore(ellipsis(element.ownerDocument), items.at(-1))
  } else if (tag === `dl` && items.length > 2) {
    const terms = items.filter((item) => tagOf(item) === `dt`)

    if (terms.length > 1) {
      const firstGroup = items.slice(items.indexOf(terms[0]), items.indexOf(terms[1]))
      const lastGroup = items.slice(items.indexOf(terms.at(-1)))

      // In lxml an element takes its tail along when it's moved
      const withTails = new Map(items.map((item) => [item, [item, ...tailNodes(item)]]))

      for (const nodes of withTails.values()) {
        removeNodes(nodes)
      }

      for (const item of firstGroup) {
        appendNodes(element, withTails.get(item))
      }

      element.appendChild(ellipsis(element.ownerDocument))

      for (const item of lastGroup) {
        appendNodes(element, withTails.get(item))
      }
    }
  }

  for (const child of childElements(element)) {
    shortenLists(child)
  }
}

// Any text, or an image with a source. An image's own tail isn't looked at, as in MinerU-HTML.
const hasContent = function (element) {
  if (getText(element).trim() !== ``) {
    return true
  }

  if (tagOf(element) === `img`) {
    return (element.getAttribute(`src`) ?? ``).trim() !== ``
  }

  if (childElements(element).some(hasContent)) {
    return true
  }

  return getTail(element).trim() !== ``
}

const isUncounted = function (element) {
  for (let current = element; isElement(current); current = current.parentNode) {
    if (uncountedTags.has(tagOf(current))) {
      return true
    }
  }

  return false
}

// Cuts a block's text at maxBlockText characters, ending it with "...", and drops what follows.
// Text in tables and math isn't counted or cut, though the text after an element is counted
// wherever it is.
const shortenText = function (root) {
  const countText = function (element) {
    let total = isUncounted(element) ? 0 : lengthOf(getText(element))

    for (const child of childElements(element)) {
      total += countText(child)
    }

    return total + lengthOf(getTail(element))
  }

  if (countText(root) <= maxBlockText) {
    return
  }

  const pieces = []

  const collect = function (element) {
    const text = getText(element)

    if (text !== `` && isUncounted(element) === false) {
      pieces.push({ isTail: false, element, text, canCut: true })
    }

    for (const child of childElements(element)) {
      collect(child)
    }

    const tail = getTail(element)

    if (tail !== ``) {
      const parent = element.parentNode
      pieces.push({ isTail: true, element, text: tail, canCut: isElement(parent) === false || isUncounted(parent) === false })
    }
  }

  // Everything after the cut goes: the element's later siblings, and its ancestors' too
  const dropFollowing = function (element) {
    for (let current = element; isElement(current.parentNode); current = current.parentNode) {
      const following = []

      for (let sibling = current.nextSibling; sibling != null; sibling = sibling.nextSibling) {
        if (isElement(sibling)) {
          following.push(sibling)
        }
      }

      for (const sibling of following) {
        removeWithTail(sibling)
      }
    }
  }

  collect(root)

  let length = 0
  let isCut = false

  for (const piece of pieces) {
    const write = piece.isTail ? setTail : setText

    if (isCut) {
      write(piece.element, ``)
      continue
    }

    const pieceLength = lengthOf(piece.text)

    if (length + pieceLength <= maxBlockText) {
      length += pieceLength
    } else if (piece.canCut) {
      const kept = [...piece.text].slice(0, maxBlockText - length).join(``)
      write(piece.element, `${kept}...`)
      length = maxBlockText
      isCut = true
      dropFollowing(piece.element)
    } else {
      length += pieceLength
    }
  }
}

// The single element a block of the page's <body> comes down to, or null when it doesn't:
// MinerU-HTML reads each block back as an HTML fragment, which a <body> doesn't survive
const bodyBlockElement = function (copy) {
  const elements = childElements(copy)

  if (getText(copy).trim() !== `` || elements.length !== 1 || getTail(elements[0]).trim() !== ``) {
    return null
  }

  // On its own, as a fragment's element is
  copy.removeChild(elements[0])
  return elements[0]
}

// Puts the page's nodes from `first` to `last` (children of one element), with the text before
// them, in a run element; the text after them goes in too, unless the run ends with a line break
const wrapRun = function (first, last) {
  const parent = first.parentNode

  if (parent == null || last.parentNode !== parent) {
    return null
  }

  const run = parent.ownerDocument.createElement(runTag)
  const leading = textNodesBefore(first)
  const trailing = tagOf(last) === `br` ? [] : tailNodes(last)

  parent.insertBefore(run, leading[0] ?? first)
  appendNodes(run, leading)

  let node = first

  while (node != null) {
    const next = node.nextSibling
    run.appendChild(node)

    if (node === last) {
      break
    }

    node = next
  }

  appendNodes(run, trailing)

  return run
}

// Puts text of `parent`'s matching `text` (its own, or the first child's tail that does) in a run
// element, or returns null when none matches
const wrapText = function (parent, text) {
  const candidates = [textNodes(parent), ...childElements(parent).map(tailNodes)]

  const nodes = candidates.find(function (candidate) {
    return candidate.length > 0 && joinText(candidate).trim() === text
  })

  if (nodes == null) {
    return null
  }

  const run = parent.ownerDocument.createElement(runTag)
  parent.insertBefore(run, nodes[0])
  appendNodes(run, nodes)

  return run
}

// Cuts the page in `document` into numbered blocks for the model. Returns the blocks as one
// page of HTML, how many there are, and the element in the page each id stands for (a run
// element, for a run of text). Changes `document`: comments go, and runs are wrapped.
export const simplify = function (document) {
  removeComments(document)
  document.documentElement.normalize()

  const page = document.documentElement
  const copy = page.cloneNode(true)
  const pageNodes = new Map()
  pairNodes(copy, page, pageNodes)

  for (const tag of removedTags) {
    for (const element of Array.from(copy.querySelectorAll(tag))) {
      if (element.parentNode != null) {
        removeWithTail(element)
      }
    }
  }

  removeHidden(copy)

  const dataTables = new Map()

  for (const table of Array.from(copy.querySelectorAll(`table`))) {
    dataTables.set(table, isDataTable(table))
  }

  // Lists of short entries (each a single block), as opposed to lists laying the page out
  const contentLists = new Map()
  // Elements inside math, which isn't cut into blocks
  const inMath = new Set()
  // Inline elements in the page found to hold blocks
  const holdsBlocks = new Set()

  const isBlock = function (element) {
    const tag = tagOf(element)

    // A cell of a data table, or an entry of a content list, is part of it rather than a block
    const isPartOf = function (containerTags, kinds) {
      let container = element

      while (isElement(container) && containerTags.includes(tagOf(container)) === false) {
        container = container.parentNode
      }

      return isElement(container) && kinds.get(container) !== true
    }

    if (tag === `td` || tag === `th`) {
      return isPartOf([`table`], dataTables)
    }

    if (tag === `li`) {
      return isPartOf([`ul`, `ol`], contentLists)
    }

    if (tag === `dt` || tag === `dd`) {
      return isPartOf([`dl`], contentLists)
    }

    return noBlockTags.has(tag) === false && inlineTags.has(tag) === false
  }

  const hasBlocksInside = function (element) {
    if (noBlockTags.has(tagOf(element))) {
      return false
    }

    for (const child of eachDescendant(element)) {
      const parent = child.parentNode

      if (noBlockTags.has(tagOf(parent)) || inMath.has(parent)) {
        inMath.add(child)
      }

      if (inMath.has(child) === false && isBlock(child)) {
        if (inlineTags.has(tagOf(element))) {
          holdsBlocks.add(pageNodes.get(element))
        }

        return true
      }
    }

    return false
  }

  const isContentList = function (list) {
    const itemTags = tagOf(list) === `dl` ? [`dt`, `dd`] : [`li`]
    const children = childElements(list)
    const items = children.filter((child) => [`li`, `dt`, `dd`].includes(tagOf(child)))

    if (items.length === 0) {
      return false
    }

    const hasOthers = children.some((child) => itemTags.includes(tagOf(child)) === false)
    const hasLooseText = Array.from(list.childNodes).some((node) => node.nodeType === TEXT_NODE && node.data.trim() !== ``)

    if (hasOthers || hasLooseText) {
      return false
    }

    return items.every((item) => hasBlocksInside(item) === false)
  }

  for (const list of Array.from(copy.querySelectorAll(`ul, ol, dl`))) {
    contentLists.set(list, isContentList(list))
  }

  // Each block: a copy of it for the model, and where it is in the copy of the page. A run is
  // the text and inline elements between blocks.
  const blocks = []

  const addRun = function (element, run) {
    const blockCopy = element.cloneNode(false)
    let hasElement = false

    run.forEach(function (part, index) {
      if (part.kind === `element`) {
        blockCopy.appendChild(part.element.cloneNode(true))

        // The text after it comes along, as in lxml; a line break ending the run leaves it to
        // the next one
        const tail = getTail(part.element)
        const isLastBreak = index === run.length - 1 && tagOf(part.element) === `br`

        if (tail !== `` && isLastBreak === false) {
          blockCopy.appendChild(element.ownerDocument.createTextNode(tail))
        }

        hasElement = true
      } else if (hasElement === false) {
        // Text after an element is already in, as that element's tail
        const text = getText(blockCopy)
        setText(blockCopy, text === `` ? part.text : `${text} ${part.text}`)
      }
    })

    blocks.push({ copy: blockCopy, element, run })
  }

  const walk = function (element) {
    let run = []
    const ownText = getText(element).trim()

    if (ownText !== ``) {
      run.push({ kind: `text`, text: ownText })
    }

    const addTail = function (child) {
      const tail = getTail(child).trim()

      if (tail !== ``) {
        run.push({ kind: `text`, text: tail })
      }
    }

    for (const child of childElements(element)) {
      if (isBlock(child) || hasBlocksInside(child)) {
        const isBreak = tagOf(child) === `br`

        if (isBreak) {
          run.push({ kind: `element`, element: child })
        }

        if (run.length > 0) {
          addRun(element, run)
          run = []
        }

        if (isBreak === false) {
          if (dataTables.get(child) === true || hasBlocksInside(child) === false) {
            blocks.push({ copy: child.cloneNode(true), element: child, run: null })
          } else {
            walk(child)
          }
        }

        addTail(child)
      } else {
        run.push({ kind: `element`, element: child })
        addTail(child)
      }
    }

    if (run.length > 0) {
      addRun(element, run)
    }
  }

  walk(copy)

  // Numbers the blocks the model will see, and finds each again in the page
  const pieces = []
  const blockElements = new Map()
  let count = 0

  for (const block of blocks) {
    let blockCopy = block.copy
    let pageElement = null

    if (tagOf(blockCopy) === `body` || tagOf(blockCopy) === `html`) {
      blockCopy = bodyBlockElement(blockCopy)

      if (blockCopy == null) {
        continue
      }

      // A run of one element stands for that element; the whole body, for the body
      const runElement = block.run?.find((part) => part.kind === `element`)?.element
      pageElement = pageNodes.get(runElement ?? block.element)
    }

    cleanAttributes(blockCopy)
    shortenLists(blockCopy)

    if (hasContent(blockCopy) === false) {
      continue
    }

    shortenText(blockCopy)

    count += 1
    const id = String(count)
    blockCopy.setAttribute(`_item_id`, id)

    // A block is its element in the page; a run, the element holding it (an inline one), or the
    // run's own nodes, wrapped
    const pageNode = pageNodes.get(block.element)

    if (pageElement == null && block.run == null) {
      pageElement = pageNode
    } else if (pageElement == null) {
      const runElements = block.run.filter((part) => part.kind === `element`).map((part) => pageNodes.get(part.element))

      if (runElements.length > 0) {
        const isInline = inlineTags.has(tagOf(block.element)) && tagOf(pageNode) !== `body` && holdsBlocks.has(pageNode) === false
        pageElement = isInline ? pageNode : wrapRun(runElements[0], runElements.at(-1))
      } else {
        const text = block.run.map((part) => part.text).join(` `).trim()
        pageElement = text === `` ? null : wrapText(pageNode, text)
      }
    }

    if (pageElement != null) {
      blockElements.set(id, pageElement)
    }

    // lxml writes a non-breaking space as the character itself

    pieces.push(blockCopy.outerHTML.replaceAll(`&nbsp;`, `\u00a0`))
  }

  // Whitespace between tags is collapsed, as MinerU-HTML does
  const html = `<html><head><meta charset="utf-8"></head><body>${pieces.join(``)}</body></html>`
    .replace(/(<[^>]+>)|([^<]+)/g, (whole, tag, text) => tag ?? text.replace(/\s+/g, ` `))
    .trim()

  return { html, count, blockElements }
}

// The model's answer, e.g. "<answer>1other2main3main</answer>" => a Map of id => label. Blocks it
// didn't get to are left out, so they're not kept.
export const parseLabels = function (answer) {
  const labels = new Map()

  for (const match of answer.matchAll(/(\d+)(main|other)/g)) {
    labels.set(match[1], match[2])
  }

  if (labels.size === 0) {
    throw new Error(`the model's answer had no labels`)
  }

  return labels
}

// Removes everything from the page but the blocks labelled main, with what's inside them, the
// elements around them, and line breaks beside them. Returns the page's HTML.
export const keepMain = function ({ document, blockElements, labels }) {
  const kept = new Set()

  for (const [id, label] of labels) {
    const element = blockElements.get(id)

    if (label !== `main` || element == null) {
      continue
    }

    kept.add(element)

    for (const descendant of eachDescendant(element)) {
      kept.add(descendant)
    }

    for (let ancestor = element.parentNode; isElement(ancestor); ancestor = ancestor.parentNode) {
      kept.add(ancestor)
    }
  }

  const page = document.documentElement
  let previous = null

  for (const element of [page, ...eachDescendant(page)]) {
    if (previous != null) {
      if (tagOf(element) === `br` && kept.has(previous) && tagOf(previous) !== `br`) {
        kept.add(element)
      }

      if (tagOf(previous) === `br` && kept.has(element) && tagOf(element) !== `br`) {
        kept.add(previous)
      }
    }

    previous = element
  }

  const prune = function (element) {
    if (kept.has(element) === false && isElement(element.parentNode)) {
      removeWithTail(element)
      return
    }

    for (const child of childElements(element)) {
      prune(child)
    }
  }

  prune(page)

  // The runs' contents go back in their place (domino's replaceWith can't move an element's own
  // children)
  for (const run of Array.from(page.querySelectorAll(runTag))) {
    while (run.firstChild != null) {
      run.parentNode.insertBefore(run.firstChild, run)
    }

    run.parentNode.removeChild(run)
  }

  return page.outerHTML
}

// The main content of the page in `pageHTML`, as HTML, found by the MinerU-HTML `model`. Returns
// { html, kept, total, isUnfinished }: how many of the blocks it kept, and whether the model
// stopped before labelling them all. Throws when there's nothing to keep.
export const readMainContent = async function ({ pageHTML, model, signal }) {
  const document = domino.createDocument(pageHTML)
  const { html, count, blockElements } = simplify(document)

  if (count === 0) {
    throw new Error(`the page has no content blocks`)
  }

  const { text, isCutOff } = await lemonade.labelHTML({ model, html, blockCount: count, signal })
  const labels = parseLabels(text)

  const kept = [...labels].filter(function ([id, label]) {
    return label === `main` && Number(id) >= 1 && Number(id) <= count
  }).length

  if (kept === 0) {
    throw new Error(`it found no main content`)
  }

  return { html: keepMain({ document, blockElements, labels }), kept, total: count, isUnfinished: isCutOff }
}

export default {
  simplify,
  parseLabels,
  keepMain,
  readMainContent,
}
